import type { BrowserSession } from "../browser/playwright/index.ts";
import type { CallbackClient } from "../callback/index.ts";
import type { CapturePipeline } from "../capture/index.ts";
import { createDeliverySummary, mergeDeliveryIssues, type DeliveryIssue, type DeliverySummary } from "../delivery/index.ts";
import type { ScenarioExecutionSummary } from "../scenario/executor/index.ts";
import { emitStepEventBestEffort } from "../scenario/executor/step-events.ts";
import { executeScenarioStep } from "../scenario/executor/step-executor.ts";
import type { ArtifactStore } from "../storage/index.ts";
import type { AgentTask, AgentTrace, ScenarioPlan, ScenarioStep } from "../shared/contracts.ts";
import { classifyRunnerFailure, errorMessage, logOperationalEvent } from "../shared/utils.ts";
import { evaluateAgentPolicy } from "./policy.ts";
import { type AgentDecision } from "./planner.ts";
import { replayHintAgentPlanner } from "./replay-hint-planner.ts";
import { observePage } from "./observation.ts";
import { createInitialAgentState } from "./state.ts";
import { AgentExecutionError } from "./errors.ts";
import { createAgentTraceBuilder } from "./trace/index.ts";
import { verifyGoal } from "./verifier.ts";

export interface AgentExecutionResult {
  summary: ScenarioExecutionSummary;
  delivery: DeliverySummary;
  trace: AgentTrace;
}

export interface AgentExecutorInput {
  runId: string;
  task: AgentTask;
  runtimePlan: ScenarioPlan;
  session: BrowserSession;
  callbackClient: CallbackClient;
  capturePipeline: CapturePipeline;
  artifactStore: ArtifactStore;
}

export async function executeAgentRun(input: AgentExecutorInput): Promise<AgentExecutionResult> {
  const config = resolveAgentBudget(input.task);
  const state = createInitialAgentState();
  const traceBuilder = createAgentTraceBuilder(input.task);
  const deliveryIssues: DeliveryIssue[] = [];
  let completedStepCount = 0;
  let stopped = false;
  let lastVerificationId: string | null = null;
  let lastVerificationReason = "Agent turn budget was exhausted before the goal was verified.";

  for (let turn = 1; turn <= config.maxTurns; turn += 1) {
    const observation = await observePage(input.session);
    const observationId = traceBuilder.recordObservation(turn, observation);
    const previousUrl = observation.snapshot.finalUrl;
    const decision = replayHintAgentPlanner.decideNextAction({
      goal: resolveTaskGoal(input.task),
      startUrl: input.task.start_url,
      state,
      observation,
      maxScrolls: config.maxScrolls,
      replayHints: input.task.replay_hints ?? null
    });
    const decisionId = traceBuilder.recordDecision(turn, observationId, decision);
    const step = agentDecisionToScenarioStep(decision, turn, config.captureEveryTurn);
    const policy = evaluateAgentPolicy({
      task: input.task,
      currentUrl: previousUrl,
      decision
    });
    const policyResultId = traceBuilder.recordPolicyResult(turn, decisionId, policy);

    deliveryIssues.push(...(await emitStepEventBestEffort(input.callbackClient, input.runId, turn, step.step_id, "ISSUE_SIGNAL_DETECTED", {
      agentTurn: turn,
      event: "DECISION_MADE",
      decisionReason: decision.reason,
      confidence: decision.confidence,
      actionType: decision.action.type,
      targetKey: decision.targetKey
    })));

    if (policy.decision === "BLOCK" && policy.finalOutcome) {
      deliveryIssues.push(...(await emitStepEventBestEffort(input.callbackClient, input.runId, turn, step.step_id, "ISSUE_SIGNAL_DETECTED", {
        agentTurn: turn,
        event: "POLICY_BLOCKED",
        riskClass: policy.riskClass,
        reason: policy.reason,
        matchedSignals: policy.matchedSignals,
        finalOutcome: policy.finalOutcome
      })));
      const trace = traceBuilder.finish({
        finalOutcome: policy.finalOutcome,
        category: policy.finalOutcome.startsWith("POLICY_BLOCKED") ? "POLICY_BLOCKED" : "BLOCKED",
        reason: policy.reason,
        policyResultId
      });
      return {
        summary: {
          completedStepCount,
          failedStepCount: 0,
          stopped: true
        },
        delivery: createDeliverySummary(mergeDeliveryIssues(deliveryIssues)),
        trace
      };
    }

    try {
      traceBuilder.recordActionStarted(turn, decisionId, step);
      const stepResult = await executeScenarioStep({
        runId: input.runId,
        stepOrder: turn,
        step,
        plan: input.runtimePlan,
        session: input.session,
        callbackClient: input.callbackClient,
        capturePipeline: input.capturePipeline,
        artifactStore: input.artifactStore
      });
      deliveryIssues.push(...stepResult.deliveryIssues);
      traceBuilder.recordActionCompleted(turn, decisionId, step, input.session.snapshot());
    } catch (error) {
      const failureCode = classifyRunnerFailure(error);
      const failureMessage = errorMessage(error);
      traceBuilder.recordActionFailed(turn, decisionId, step, error);

      if (decision.source === "replay_hint") {
        state.replayHintsDisabled = true;
        state.turns.push({
          turn,
          actionType: decision.action.type,
          targetKey: decision.targetKey,
          finalUrl: input.session.snapshot().finalUrl,
          goalSatisfied: false
        });

        logOperationalEvent(
          "agent-executor",
          "replay_hint_failed_fallback",
          {
            runId: input.runId,
            turn,
            stepKey: step.step_id,
            actionType: step.action.type,
            failureCode,
            failureMessage
          },
          "warn"
        );

        deliveryIssues.push(...(await emitStepEventBestEffort(input.callbackClient, input.runId, turn, step.step_id, "ISSUE_SIGNAL_DETECTED", {
          agentTurn: turn,
          event: "REPLAY_HINT_FAILED_FALLBACK",
          description: step.description,
          stage: step.stage,
          actionType: step.action.type,
          failureCode,
          failureMessage
        })));

        continue;
      }

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
        "error"
      );

      deliveryIssues.push(...(await emitStepEventBestEffort(input.callbackClient, input.runId, turn, step.step_id, "STEP_FAILED", {
        agentTurn: turn,
        description: step.description,
        stage: step.stage,
        actionType: step.action.type,
        failureCode,
        failureMessage
      })));

      throw new AgentExecutionError({
        cause: error,
        summary: {
          completedStepCount,
          failedStepCount: 1,
          stopped: false
        },
        delivery: createDeliverySummary(mergeDeliveryIssues(deliveryIssues)),
        failedStepKey: step.step_id,
        failedStepOrder: turn,
        failureCode,
        trace: traceBuilder.finish({
          finalOutcome: "FAILED_ACTION_ERROR",
          category: "FAILED",
          reason: failureMessage,
          verificationId: lastVerificationId
        })
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

    const verification = verifyGoal({
      goal: resolveTaskGoal(input.task),
      startUrl: input.task.start_url,
      previousUrl,
      snapshot: input.session.snapshot(),
      decision
    });
    lastVerificationId = traceBuilder.recordVerification(turn, decisionId, verification);
    lastVerificationReason = verification.reason;

    state.turns.push({
      turn,
      actionType: decision.action.type,
      targetKey: decision.targetKey,
      finalUrl: input.session.snapshot().finalUrl,
      goalSatisfied: verification.satisfied
    });

    deliveryIssues.push(...(await emitStepEventBestEffort(input.callbackClient, input.runId, turn, step.step_id, "ISSUE_SIGNAL_DETECTED", {
      agentTurn: turn,
      event: "GOAL_VERIFIED",
      satisfied: verification.satisfied,
      reason: verification.reason,
      confidence: verification.confidence
    })));

    if (verification.satisfied || decision.kind === "finish") {
      stopped = true;
      const trace = traceBuilder.finish({
        finalOutcome: verification.satisfied ? "SUCCESS_CHECKOUT_ENTRY_REACHED" : "BLOCKED_NO_CHECKOUT_PATH_FOUND",
        category: verification.satisfied ? "SUCCESS" : "BLOCKED",
        reason: verification.reason,
        verificationId: lastVerificationId
      });
      return {
        summary: {
          completedStepCount,
          failedStepCount: 0,
          stopped
        },
        delivery: createDeliverySummary(mergeDeliveryIssues(deliveryIssues)),
        trace
      };
    }
  }

  const trace = traceBuilder.finish({
    finalOutcome: "FAILED_BUDGET_EXHAUSTED",
    category: "FAILED",
    reason: lastVerificationReason,
    verificationId: lastVerificationId
  });

  return {
    summary: {
      completedStepCount,
      failedStepCount: 0,
      stopped
    },
    delivery: createDeliverySummary(mergeDeliveryIssues(deliveryIssues)),
    trace
  };
}

function resolveAgentBudget(task: AgentTask): { maxTurns: number; maxScrolls: number; captureEveryTurn: boolean } {
  return {
    maxTurns: task.budget.max_steps,
    maxScrolls: task.budget.max_same_page_attempts ?? 3,
    captureEveryTurn: task.artifact_policy?.capture_screenshots ?? true
  };
}

function resolveTaskGoal(task: AgentTask): string {
  return task.goal ?? task.goal_type;
}

function agentDecisionToScenarioStep(decision: AgentDecision, turn: number, checkpoint: boolean): ScenarioStep {
  return {
    step_id: `agent_turn_${String(turn).padStart(3, "0")}`,
    stage: decision.stage,
    description: decision.description,
    action: decision.action,
    settle_strategy: decision.settleStrategy,
    checkpoint
  };
}
