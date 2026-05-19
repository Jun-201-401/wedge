import type { BrowserSession } from "../browser/playwright/index.ts";
import type { CallbackClient } from "../callback/index.ts";
import type { CapturePipeline } from "../capture/index.ts";
import { createDeliverySummary, mergeDeliveryIssues, type DeliveryIssue, type DeliverySummary } from "../delivery/index.ts";
import {
  createEmptyCollectorStatusSummary,
  mergeCollectorStatusSummaries,
  type CollectorStatusSummary
} from "../observability/collectors.ts";
import type { ArtifactStore } from "../storage/index.ts";
import type { AgentTask, Artifact, ScenarioPlan, ScenarioStep } from "../shared/contracts.ts";
import { classifyRunnerFailure, errorMessage, logOperationalEvent, type RunnerFailureCode } from "../shared/utils.ts";
import { RunnerExecutionPolicyError } from "../scenario/policy.ts";
import { persistAgentScenarioPlanExportArtifact, persistAgentTraceArtifact } from "./trace/artifacts.ts";
import { emitAgentEventBestEffort, emitAgentTraceBestEffort } from "./callbacks.ts";
import { AgentBudgetExceededError, assertAgentDeadline, createAgentDeadline, remainingAgentBudgetMs, runSideEffectWithDeadlineCleanup, runWithinAgentDeadline } from "./deadline.ts";
import {
  decideNextAction,
  ensureAgentDecisionMetadata,
  HeuristicDecisionClient,
  type AgentDecision,
  type AgentDecisionClient,
  type AgentDecisionInput
} from "./planner.ts";
import { observePage } from "./observation.ts";
import { evaluateAgentPolicy } from "./policy.ts";
import { decideFromReplayHints } from "./replay-hint-planner.ts";
import { createInitialAgentState } from "./state.ts";
import {
  createScenarioSafetyBlock,
  createSafetyBlockedOutcome,
  createTraceOutcome,
  reasonCodeFromPolicy,
  reasonCodeFromVerification,
  shouldReportStopped,
  traceStatusFromVerification
} from "./outcome.ts";
import { exportAgentTraceToScenarioPlan, type AgentTraceScenarioPlanExport } from "./trace/export.ts";
import { createAgentTrace, summarizeObservation, type AgentTrace, type AgentTurnTrace } from "./trace/index.ts";
import { verifyGoal } from "./verifier.ts";

export interface AgentExecutionResult {
  summary: AgentExecutionSummary;
  delivery: DeliverySummary;
  trace: AgentTrace;
  traceArtifact?: Artifact;
  scenarioPlanExport?: AgentTraceScenarioPlanExport;
  scenarioPlanExportArtifact?: Artifact;
}

export interface AgentExecutionSummary {
  completedStepCount: number;
  failedStepCount: number;
  stopped: boolean;
  collectorStatus?: CollectorStatusSummary;
}

export interface AgentActionRuntime {
  executeStep: (input: AgentActionRuntimeStepInput) => Promise<AgentActionRuntimeStepResult>;
  emitFailureEvidence: (input: AgentActionRuntimeFailureInput) => Promise<AgentActionRuntimeFailureEvidence>;
  createExecutionError: (input: AgentActionRuntimeErrorInput) => Error;
}

export interface AgentActionRuntimeStepInput {
  runId: string;
  stepOrder: number;
  step: ScenarioStep;
  plan: ScenarioPlan;
  session: BrowserSession;
  callbackClient: CallbackClient;
  capturePipeline: CapturePipeline;
  artifactStore: ArtifactStore;
}

export interface AgentActionRuntimeStepResult {
  stopRequested: boolean;
  deliveryIssues: DeliveryIssue[];
  collectorStatus: CollectorStatusSummary;
}

export interface AgentActionRuntimeFailureInput {
  runId: string;
  stepOrder: number;
  step: ScenarioStep;
  plan: ScenarioPlan;
  failureCode: RunnerFailureCode;
  failureMessage: string;
  session: BrowserSession;
  callbackClient: CallbackClient;
  capturePipeline: CapturePipeline;
  artifactStore: ArtifactStore;
}

export interface AgentActionRuntimeFailureEvidence {
  deliveryIssues: DeliveryIssue[];
  artifactRefs: string[];
  checkpointId?: string;
  collectorStatus: CollectorStatusSummary;
}

export interface AgentActionRuntimeErrorInput {
  cause: unknown;
  summary: AgentExecutionSummary;
  delivery: DeliverySummary;
  failedStepKey: string;
  failedStepOrder: number;
  failureCode: RunnerFailureCode;
  failureArtifactRefs: string[];
  failureCheckpointId?: string;
}

export interface AgentExecutorInput {
  runId: string;
  task: AgentTask;
  runtimePlan: ScenarioPlan;
  session: BrowserSession;
  callbackClient: CallbackClient;
  capturePipeline: CapturePipeline;
  artifactStore: ArtifactStore;
  actionRuntime: AgentActionRuntime;
  decisionClient?: AgentDecisionClient;
}

export async function executeAgentRun(input: AgentExecutorInput): Promise<AgentExecutionResult> {
  const config = resolveAgentBudget(input.task);
  const deadline = createAgentDeadline(config.maxDurationMs);
  const decisionClient = input.decisionClient ?? new HeuristicDecisionClient();
  const state = createInitialAgentState();
  const trace = createAgentTrace(input.task);
  const deliveryIssues: DeliveryIssue[] = [];
  let completedStepCount = 0;
  let collectorStatus = createEmptyCollectorStatusSummary(input.runtimePlan);

  for (let turn = 1; turn <= config.maxTurns; turn += 1) {
    let observation: Awaited<ReturnType<typeof observePage>>;
    try {
      assertAgentDeadline(deadline, "turn start");
      observation = await runWithinAgentDeadline(deadline, "observation", () => observePage(input.session));
    } catch (error) {
      if (markBudgetExceeded(trace, error)) {
        break;
      }
      throw error;
    }

    const previousUrl = observation.snapshot.finalUrl;
    const preDecisionVerification = verifyGoal({
      goal: resolveTaskGoal(input.task),
      startUrl: input.task.start_url,
      previousUrl,
      snapshot: observation.snapshot,
      phase: "pre_decision"
    });
    const turnTrace: AgentTurnTrace = {
      turn,
      observation: summarizeObservation(observation.snapshot, input.task.observation_budget),
      preDecisionVerification
    };
    trace.turns.push(turnTrace);

    deliveryIssues.push(...(await emitAgentEventBestEffort(input.callbackClient, input.runId, input.task, "PRE_DECISION_VERIFIED", {
      outcome: preDecisionVerification.outcome,
      outcomeReasonCode: reasonCodeFromVerification(preDecisionVerification.outcome),
      terminal: preDecisionVerification.terminal,
      satisfied: preDecisionVerification.satisfied,
      reason: preDecisionVerification.reason,
      confidence: preDecisionVerification.confidence
    }, turn)));

    if (preDecisionVerification.terminal) {
      trace.outcome = createTraceOutcome(
        traceStatusFromVerification(preDecisionVerification.outcome),
        preDecisionVerification.reason,
        reasonCodeFromVerification(preDecisionVerification.outcome)
      );
      break;
    }

    let decision: AgentDecision;
    try {
      const decisionInput = {
        runId: input.runId,
        goal: resolveTaskGoal(input.task),
        startUrl: input.task.start_url,
        state,
        observation,
        maxScrolls: config.maxScrolls,
        remainingTimeMs: remainingAgentBudgetMs(deadline)
      };
      decision = shouldBootstrapStartUrl(state.started, observation.snapshot.finalUrl, input.task.start_url)
        ? decideNextAction(decisionInput)
        : decideFromReplayHints({
          ...decisionInput,
          replayHints: input.task.replay_hints
        }) ?? ensureAgentDecisionMetadata(await runWithinAgentDeadline(deadline, "decision", () => decisionClient.decide(decisionInput)));
      decision = preferVisibleHeuristicClickOverScroll(decision, decisionInput);
      decision = capRepeatedScrollDecision(decision, state.scrollCount, config.maxScrolls);
    } catch (error) {
      if (markBudgetExceeded(trace, error)) {
        break;
      }
      throw error;
    }

    turnTrace.decision = decision;
    const step = agentDecisionToScenarioStep(decision, turn, config.captureEveryTurn);

    deliveryIssues.push(...(await emitAgentEventBestEffort(input.callbackClient, input.runId, input.task, "DECISION_MADE", {
      decisionReason: decision.reason,
      confidence: decision.confidence,
      actionType: decision.action.type,
      targetKey: decision.targetKey,
      decisionId: decision.metadata?.decisionId,
      decisionSource: decision.metadata?.decisionSource,
      model: decision.metadata?.model
    }, turn)));

    const policy = evaluateAgentPolicy({
      task: input.task,
      decision,
      snapshot: observation.snapshot
    });
    turnTrace.policy = policy;

    deliveryIssues.push(...(await emitAgentEventBestEffort(input.callbackClient, input.runId, input.task, "POLICY_CHECKED", {
      allowed: policy.allowed,
      riskClass: policy.riskClass,
      reason: policy.reason,
      outcomeReasonCode: policy.allowed ? "IN_PROGRESS" : reasonCodeFromPolicy(policy)
    }, turn)));

    if (!policy.allowed) {
      trace.outcome = createTraceOutcome("POLICY_BLOCKED", policy.reason, reasonCodeFromPolicy(policy));
      break;
    }

    let stopRequested = false;
    let postActionSnapshot = observation.snapshot;

    if (decision.kind === "act" || (decision.kind === "checkpoint" && step.checkpoint)) {
      try {
        const stepResult = await runSideEffectWithDeadlineCleanup(deadline, "action", () => input.actionRuntime.executeStep({
          runId: input.runId,
          stepOrder: turn,
          step,
          plan: input.runtimePlan,
          session: input.session,
          callbackClient: input.callbackClient,
          capturePipeline: input.capturePipeline,
          artifactStore: input.artifactStore
        }));
        deliveryIssues.push(...stepResult.deliveryIssues);
        collectorStatus = mergeCollectorStatusSummaries(collectorStatus, stepResult.collectorStatus);
        postActionSnapshot = input.session.snapshot();
        turnTrace.actionResult = {
          actionType: decision.action.type,
          finalUrl: postActionSnapshot.finalUrl,
          completed: true
        };
        deliveryIssues.push(...(await emitAgentEventBestEffort(input.callbackClient, input.runId, input.task, "ACTION_COMPLETED", {
          actionType: decision.action.type,
          finalUrl: postActionSnapshot.finalUrl,
          targetKey: decision.targetKey
        }, turn)));

        stopRequested = stepResult.stopRequested;
      } catch (error) {
        if (markBudgetExceeded(trace, error)) {
          break;
        }

        if (error instanceof RunnerExecutionPolicyError) {
          const safetyBlock = createScenarioSafetyBlock({
            safetyCode: error.safetyCode,
            riskClass: error.riskClass,
            reason: error.message,
            details: error.details
          });
          const safetyOutcome = createSafetyBlockedOutcome(safetyBlock.safetyCode, safetyBlock.reason);
          trace.outcome = safetyOutcome;
          turnTrace.safetyBlock = safetyBlock;
          postActionSnapshot = input.session.snapshot();
          turnTrace.actionResult = {
            actionType: decision.action.type,
            finalUrl: postActionSnapshot.finalUrl,
            completed: false
          };

          logOperationalEvent(
            "agent-executor",
            "scenario_safety_blocked",
            {
              runId: input.runId,
              turn,
              stepKey: step.step_id,
              actionType: step.action.type,
              safetyCode: safetyBlock.safetyCode,
              riskClass: safetyBlock.riskClass,
              reasonCode: safetyOutcome.reason_code,
              reason: safetyBlock.reason,
              details: safetyBlock.details
            },
            "warn"
          );

          deliveryIssues.push(...(await emitAgentEventBestEffort(input.callbackClient, input.runId, input.task, "POLICY_CHECKED", {
            allowed: false,
            ...safetyBlock,
            outcomeReasonCode: safetyOutcome.reason_code
          }, turn)));

          break;
        }

        const failureCode = classifyRunnerFailure(error);
        const failureMessage = errorMessage(error);
        const recoverableReplayHintFailure = isReplayHintDecision(decision);

        logOperationalEvent(
          "agent-executor",
          "turn_failed",
          {
            runId: input.runId,
            turn,
            stepKey: step.step_id,
            actionType: step.action.type,
            failureCode,
            failureMessage
          },
          recoverableReplayHintFailure ? "warn" : "error"
        );

        deliveryIssues.push(...(await emitAgentEventBestEffort(input.callbackClient, input.runId, input.task, "ACTION_FAILED", {
          description: step.description,
          stage: step.stage,
          actionType: step.action.type,
          failureCode,
          failureMessage
        }, turn)));

        if (recoverableReplayHintFailure) {
          state.replayHintsDisabled = true;
          postActionSnapshot = input.session.snapshot();
          turnTrace.actionResult = {
            actionType: decision.action.type,
            finalUrl: postActionSnapshot.finalUrl,
            completed: false
          };
          state.turns.push({
            turn,
            actionType: decision.action.type,
            targetKey: decision.targetKey,
            finalUrl: postActionSnapshot.finalUrl,
            goalSatisfied: false
          });
          continue;
        }

        const failureEvidence = await input.actionRuntime.emitFailureEvidence({
          runId: input.runId,
          stepOrder: turn,
          step,
          plan: input.runtimePlan,
          failureCode,
          failureMessage,
          session: input.session,
          callbackClient: input.callbackClient,
          capturePipeline: input.capturePipeline,
          artifactStore: input.artifactStore
        });
        deliveryIssues.push(...failureEvidence.deliveryIssues);
        collectorStatus = mergeCollectorStatusSummaries(collectorStatus, failureEvidence.collectorStatus);

        throw input.actionRuntime.createExecutionError({
          cause: error,
          summary: {
            completedStepCount,
            failedStepCount: 1,
            stopped: false,
            collectorStatus
          },
          delivery: createDeliverySummary(mergeDeliveryIssues(deliveryIssues)),
          failedStepKey: step.step_id,
          failedStepOrder: turn,
          failureCode,
          failureArtifactRefs: failureEvidence.artifactRefs,
          failureCheckpointId: failureEvidence.checkpointId
        });
      }

      completedStepCount += 1;
      state.started = true;
      if (decision.action.type === "scroll") {
        state.scrollCount += 1;
      }
      if (decision.action.type === "click" && decision.targetKey) {
        state.clickedTargetKeys.add(decision.targetKey);
      }

      if (stopRequested) {
        trace.outcome = createTraceOutcome(
          "EXHAUSTED",
          "Agent action requested a stop condition before completing the goal.",
          "STOP_CONDITION_REACHED"
        );
        break;
      }
    } else {
      postActionSnapshot = input.session.snapshot();
      turnTrace.actionResult = {
        actionType: decision.action.type,
        finalUrl: postActionSnapshot.finalUrl,
        completed: false
      };
    }

    const verification = verifyGoal({
      goal: resolveTaskGoal(input.task),
      startUrl: input.task.start_url,
      previousUrl,
      snapshot: postActionSnapshot,
      phase: "post_action",
      decision
    });
    turnTrace.postActionVerification = verification;

    state.turns.push({
      turn,
      actionType: decision.action.type,
      targetKey: decision.targetKey,
      finalUrl: postActionSnapshot.finalUrl,
      goalSatisfied: verification.satisfied
    });

    deliveryIssues.push(...(await emitAgentEventBestEffort(input.callbackClient, input.runId, input.task, "GOAL_VERIFIED", {
      outcome: verification.outcome,
      outcomeReasonCode: reasonCodeFromVerification(verification.outcome),
      terminal: verification.terminal,
      satisfied: verification.satisfied,
      reason: verification.reason,
      confidence: verification.confidence
    }, turn)));

    if (verification.satisfied || decision.kind === "finish") {
      trace.outcome = createTraceOutcome(
        verification.satisfied ? "SUCCESS" : "EXHAUSTED",
        verification.reason,
        verification.satisfied ? "GOAL_REACHED" : "FINISH_DECISION"
      );
      break;
    }
  }

  if (trace.outcome.status === "RUNNING") {
    trace.outcome = createTraceOutcome(
      "EXHAUSTED",
      "Agent execution reached the configured turn budget.",
      "TURN_BUDGET_EXHAUSTED"
    );
  }

  const {
    traceDelivery,
    scenarioPlanExport,
    scenarioPlanExportDelivery
  } = await finalizeAgentTraceArtifacts(input, trace);
  deliveryIssues.push(...traceDelivery.deliveryIssues);
  deliveryIssues.push(...scenarioPlanExportDelivery.deliveryIssues);

  if (input.task.artifact_policy?.capture_trace !== false) {
    deliveryIssues.push(...(await emitAgentEventBestEffort(input.callbackClient, input.runId, input.task, "TRACE_PERSISTED", {
      outcome: trace.outcome.status,
      outcomeReasonCode: trace.outcome.reason_code,
      traceArtifactId: traceDelivery.artifact?.artifactId,
      scenarioPlanExportStatus: scenarioPlanExport.status,
      scenarioPlanExportArtifactId: scenarioPlanExportDelivery.artifact?.artifactId
    })));
    deliveryIssues.push(...(await emitAgentTraceBestEffort(input.callbackClient, input.runId, input.task, trace, traceDelivery.artifact)));
  }

  return {
    summary: {
      completedStepCount,
      failedStepCount: 0,
      stopped: shouldReportStopped(trace),
      collectorStatus
    },
    delivery: createDeliverySummary(mergeDeliveryIssues(deliveryIssues)),
    trace,
    traceArtifact: traceDelivery.artifact,
    scenarioPlanExport,
    scenarioPlanExportArtifact: scenarioPlanExportDelivery.artifact
  };
}

function isReplayHintDecision(decision: AgentDecision): boolean {
  return decision.metadata?.decisionSource === "replay_hint";
}

function preferVisibleHeuristicClickOverScroll(decision: AgentDecision, input: AgentDecisionInput): AgentDecision {
  if (decision.kind !== "act" || decision.action.type !== "scroll") {
    return decision;
  }

  const visibleDecision = decideNextAction(input);
  if (visibleDecision.kind !== "act" || visibleDecision.action.type !== "click") {
    return decision;
  }

  return {
    ...visibleDecision,
    reason: `${visibleDecision.reason} The model requested another scroll, but a visible goal-matching entrypoint is already actionable.`,
    confidence: Math.max(visibleDecision.confidence, Math.min(decision.confidence, 0.8))
  };
}

function capRepeatedScrollDecision(decision: AgentDecision, completedScrollCount: number, maxScrolls: number): AgentDecision {
  if (decision.kind !== "act" || decision.action.type !== "scroll" || completedScrollCount < maxScrolls) {
    return decision;
  }

  return {
    kind: "finish",
    description: "Stop after repeated scroll attempts did not reveal a goal-matching entrypoint.",
    reason: `The agent could not find a goal-matching CTA after ${completedScrollCount} scroll attempt(s).`,
    confidence: Math.max(0.4, Math.min(decision.confidence, 0.7)),
    action: {
      type: "checkpoint"
    },
    settleStrategy: {
      type: "none",
      timeout_ms: 0
    },
    stage: decision.stage,
    targetKey: null,
    metadata: decision.metadata
  };
}

function resolveAgentBudget(task: AgentTask): {
  maxTurns: number;
  maxDurationMs: number;
  maxScrolls: number;
  captureEveryTurn: boolean;
} {
  return {
    maxTurns: task.budget.max_steps,
    maxDurationMs: task.budget.max_duration_ms,
    maxScrolls: task.budget.max_same_page_attempts ?? 3,
    captureEveryTurn: task.artifact_policy?.capture_screenshots ?? true
  };
}

function resolveTaskGoal(task: AgentTask): string {
  return task.goal ?? task.goal_type;
}

function shouldBootstrapStartUrl(started: boolean, finalUrl: string, startUrl: string): boolean {
  if (started) {
    return false;
  }

  const currentOrigin = resolveHttpOrigin(finalUrl);
  const startOrigin = resolveHttpOrigin(startUrl);
  return currentOrigin === null || startOrigin === null || currentOrigin !== startOrigin;
}

function resolveHttpOrigin(candidateUrl: string): string | null {
  try {
    const parsedUrl = new URL(candidateUrl);
    return parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:"
      ? parsedUrl.origin
      : null;
  } catch {
    return null;
  }
}

function markBudgetExceeded(trace: AgentTrace, error: unknown): boolean {
  if (!(error instanceof AgentBudgetExceededError)) {
    return false;
  }

  trace.outcome = {
    status: "EXHAUSTED",
    reason_code: "DURATION_BUDGET_EXHAUSTED",
    reason: error.message
  };
  return true;
}

async function finalizeAgentTraceArtifacts(
  input: AgentExecutorInput,
  trace: AgentTrace
): Promise<{
  traceDelivery: Awaited<ReturnType<typeof persistAgentTraceArtifact>>;
  scenarioPlanExport: AgentTraceScenarioPlanExport;
  scenarioPlanExportDelivery: Awaited<ReturnType<typeof persistAgentScenarioPlanExportArtifact>>;
}> {
  const traceDelivery = await persistAgentTraceArtifact({
    task: input.task,
    runId: input.runId,
    trace,
    artifactStore: input.artifactStore,
    callbackClient: input.callbackClient
  });

  const scenarioPlanExport = exportAgentTraceToScenarioPlan({
    task: input.task,
    trace
  });
  const scenarioPlanExportDelivery = await persistAgentScenarioPlanExportArtifact({
    task: input.task,
    runId: input.runId,
    traceExport: scenarioPlanExport,
    artifactStore: input.artifactStore,
    callbackClient: input.callbackClient
  });

  return {
    traceDelivery,
    scenarioPlanExport,
    scenarioPlanExportDelivery
  };
}

function agentDecisionToScenarioStep(decision: AgentDecision, turn: number, checkpoint: boolean): ScenarioStep {
  return {
    step_id: `agent_turn_${String(turn).padStart(3, "0")}`,
    stage: decision.stage,
    description: decision.description,
    action: actionForScenarioExecution(decision),
    settle_strategy: decision.settleStrategy,
    checkpoint
  };
}

function actionForScenarioExecution(decision: AgentDecision): AgentDecision["action"] {
  if (decision.metadata?.decisionSource !== "replay_hint") {
    return decision.action;
  }

  return {
    ...decision.action,
    options: {
      ...decision.action.options,
      disable_recovery_retry: true
    }
  };
}
