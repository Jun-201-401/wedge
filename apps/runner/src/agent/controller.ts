import type { BrowserSession } from "../browser/playwright/index.ts";
import type { CallbackClient } from "../callback/index.ts";
import type { CapturePipeline } from "../capture/index.ts";
import { createDeliverySummary, mergeDeliveryIssues, type DeliveryIssue, type DeliverySummary } from "../delivery/index.ts";
import { ScenarioExecutionError, type ScenarioExecutionSummary } from "../scenario/executor/index.ts";
import { executeScenarioStep } from "../scenario/executor/step-executor.ts";
import type { ArtifactStore } from "../storage/index.ts";
import type { AgentTask, Artifact, ScenarioPlan, ScenarioStep } from "../shared/contracts.ts";
import { classifyRunnerFailure, errorMessage, logOperationalEvent } from "../shared/utils.ts";
import { emitAgentEventBestEffort, emitAgentTraceBestEffort } from "./callbacks.ts";
import { HeuristicDecisionClient, type AgentDecision, type AgentDecisionClient } from "./planner.ts";
import { observePage } from "./observation.ts";
import { evaluateAgentPolicy } from "./policy.ts";
import { createInitialAgentState } from "./state.ts";
import { createAgentScenarioPlanExportArtifact, exportAgentTraceToScenarioPlan, type AgentTraceScenarioPlanExport } from "./trace-export.ts";
import { createAgentTrace, createAgentTraceArtifact, summarizeObservation, type AgentTrace, type AgentTurnTrace } from "./trace.ts";
import { verifyGoal } from "./verifier.ts";

export interface AgentExecutionResult {
  summary: ScenarioExecutionSummary;
  delivery: DeliverySummary;
  trace: AgentTrace;
  traceArtifact?: Artifact;
  scenarioPlanExport?: AgentTraceScenarioPlanExport;
  scenarioPlanExportArtifact?: Artifact;
}

export interface AgentExecutorInput {
  runId: string;
  task: AgentTask;
  runtimePlan: ScenarioPlan;
  session: BrowserSession;
  callbackClient: CallbackClient;
  capturePipeline: CapturePipeline;
  artifactStore: ArtifactStore;
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

  for (let turn = 1; turn <= config.maxTurns; turn += 1) {
    let observation: Awaited<ReturnType<typeof observePage>>;
    try {
      assertAgentDeadline(deadline, "turn start");
      observation = await runWithinAgentDeadline(deadline, "observation", () => observePage(input.session));
    } catch (error) {
      if (error instanceof AgentBudgetExceededError) {
        trace.outcome = {
          status: "EXHAUSTED",
          reason: error.message
        };
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
      observation: summarizeObservation(observation.snapshot),
      preDecisionVerification
    };
    trace.turns.push(turnTrace);

    deliveryIssues.push(...(await emitAgentEventBestEffort(input.callbackClient, input.runId, input.task, "PRE_DECISION_VERIFIED", {
      outcome: preDecisionVerification.outcome,
      terminal: preDecisionVerification.terminal,
      satisfied: preDecisionVerification.satisfied,
      reason: preDecisionVerification.reason,
      confidence: preDecisionVerification.confidence
    }, turn)));

    if (preDecisionVerification.terminal) {
      trace.outcome = {
        status: traceStatusFromVerification(preDecisionVerification.outcome),
        reason: preDecisionVerification.reason
      };
      break;
    }

    let decision: AgentDecision;
    try {
      decision = await runWithinAgentDeadline(deadline, "decision", () => decisionClient.decide({
        goal: resolveTaskGoal(input.task),
        startUrl: input.task.start_url,
        state,
        observation,
        maxScrolls: config.maxScrolls,
        remainingTimeMs: remainingAgentBudgetMs(deadline)
      }));
    } catch (error) {
      if (error instanceof AgentBudgetExceededError) {
        trace.outcome = {
          status: "EXHAUSTED",
          reason: error.message
        };
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
      targetKey: decision.targetKey
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
      reason: policy.reason
    }, turn)));

    if (!policy.allowed) {
      trace.outcome = {
        status: "POLICY_BLOCKED",
        reason: policy.reason
      };
      break;
    }

    let stopRequested = false;

    if (decision.kind === "act") {
      try {
        const stepResult = await runWithinAgentDeadline(deadline, "action", () => executeScenarioStep({
          runId: input.runId,
          stepOrder: turn,
          step,
          plan: input.runtimePlan,
          session: input.session,
          callbackClient: input.callbackClient,
          capturePipeline: input.capturePipeline,
          artifactStore: input.artifactStore,
          emitStepEvents: false
        }));
        deliveryIssues.push(...stepResult.deliveryIssues);
        turnTrace.actionResult = {
          actionType: decision.action.type,
          finalUrl: input.session.snapshot().finalUrl,
          completed: true
        };
        deliveryIssues.push(...(await emitAgentEventBestEffort(input.callbackClient, input.runId, input.task, "ACTION_COMPLETED", {
          actionType: decision.action.type,
          finalUrl: input.session.snapshot().finalUrl,
          targetKey: decision.targetKey
        }, turn)));

        stopRequested = stepResult.stopRequested;
      } catch (error) {
        if (error instanceof AgentBudgetExceededError) {
          trace.outcome = {
            status: "EXHAUSTED",
            reason: error.message
          };
          break;
        }

        const failureCode = classifyRunnerFailure(error);
        const failureMessage = errorMessage(error);

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

        deliveryIssues.push(...(await emitAgentEventBestEffort(input.callbackClient, input.runId, input.task, "ACTION_FAILED", {
          description: step.description,
          stage: step.stage,
          actionType: step.action.type,
          failureCode,
          failureMessage
        }, turn)));

        throw new ScenarioExecutionError({
          cause: error,
          summary: {
            completedStepCount,
            failedStepCount: 1,
            stopped: false
          },
          delivery: createDeliverySummary(mergeDeliveryIssues(deliveryIssues)),
          failedStepKey: step.step_id,
          failedStepOrder: turn,
          failureCode
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
        trace.outcome = {
          status: "EXHAUSTED",
          reason: "Agent action requested a stop condition before completing the goal."
        };
        break;
      }
    } else {
      turnTrace.actionResult = {
        actionType: decision.action.type,
        finalUrl: input.session.snapshot().finalUrl,
        completed: false
      };
    }

    const verification = verifyGoal({
      goal: resolveTaskGoal(input.task),
      startUrl: input.task.start_url,
      previousUrl,
      snapshot: input.session.snapshot(),
      phase: "post_action",
      decision
    });
    turnTrace.postActionVerification = verification;

    state.turns.push({
      turn,
      actionType: decision.action.type,
      targetKey: decision.targetKey,
      finalUrl: input.session.snapshot().finalUrl,
      goalSatisfied: verification.satisfied
    });

    deliveryIssues.push(...(await emitAgentEventBestEffort(input.callbackClient, input.runId, input.task, "GOAL_VERIFIED", {
      outcome: verification.outcome,
      terminal: verification.terminal,
      satisfied: verification.satisfied,
      reason: verification.reason,
      confidence: verification.confidence
    }, turn)));

    if (verification.satisfied || decision.kind === "finish") {
      trace.outcome = {
        status: verification.satisfied ? "SUCCESS" : "EXHAUSTED",
        reason: verification.reason
      };
      break;
    }
  }

  if (trace.outcome.status === "RUNNING") {
    trace.outcome = {
      status: "EXHAUSTED",
      reason: "Agent execution reached the configured turn budget."
    };
  }

  const traceDelivery = await persistAgentTraceArtifact({
    task: input.task,
    runId: input.runId,
    trace,
    artifactStore: input.artifactStore,
    callbackClient: input.callbackClient
  });
  deliveryIssues.push(...traceDelivery.deliveryIssues);

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
  deliveryIssues.push(...scenarioPlanExportDelivery.deliveryIssues);

  if (input.task.artifact_policy?.capture_trace !== false) {
    deliveryIssues.push(...(await emitAgentEventBestEffort(input.callbackClient, input.runId, input.task, "TRACE_PERSISTED", {
      outcome: trace.outcome.status,
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
      stopped: shouldReportStopped(trace)
    },
    delivery: createDeliverySummary(mergeDeliveryIssues(deliveryIssues)),
    trace,
    traceArtifact: traceDelivery.artifact,
    scenarioPlanExport,
    scenarioPlanExportArtifact: scenarioPlanExportDelivery.artifact
  };
}

function traceStatusFromVerification(outcome: ReturnType<typeof verifyGoal>["outcome"]): AgentTrace["outcome"]["status"] {
  switch (outcome) {
    case "SUCCESS":
      return "SUCCESS";
    case "POLICY_BLOCKED":
      return "POLICY_BLOCKED";
    case "BLOCKED_LOGIN":
    case "BLOCKED_CAPTCHA":
      return "BLOCKED";
    case "EXHAUSTED":
      return "EXHAUSTED";
    case "CONTINUE":
      return "RUNNING";
  }
}

async function persistAgentTraceArtifact({
  task,
  runId,
  trace,
  artifactStore,
  callbackClient
}: {
  task: AgentTask;
  runId: string;
  trace: AgentTrace;
  artifactStore: ArtifactStore;
  callbackClient: CallbackClient;
}): Promise<{ artifact?: Artifact; deliveryIssues: DeliveryIssue[] }> {
  if (task.artifact_policy?.capture_trace === false) {
    return {
      deliveryIssues: []
    };
  }

  const deliveryIssues: DeliveryIssue[] = [];
  let storedArtifacts: Artifact[] = [];

  try {
    storedArtifacts = await artifactStore.persistArtifacts({
      runId,
      artifacts: [createAgentTraceArtifact(trace)]
    });
  } catch (error) {
    deliveryIssues.push({
      scope: "artifact-storage",
      stepKey: "agent_trace",
      message: `agent trace artifact storage failed: ${errorMessage(error)}`
    });
  }

  if (storedArtifacts.length > 0) {
    try {
      await callbackClient.sendArtifacts(runId, {
        artifacts: storedArtifacts
      });
    } catch (error) {
      deliveryIssues.push({
        scope: "artifacts-callback",
        stepKey: "agent_trace",
        message: `agent trace artifact callback failed: ${errorMessage(error)}`
      });
    }
  }

  return {
    artifact: storedArtifacts[0],
    deliveryIssues
  };
}

async function persistAgentScenarioPlanExportArtifact({
  task,
  runId,
  traceExport,
  artifactStore,
  callbackClient
}: {
  task: AgentTask;
  runId: string;
  traceExport: AgentTraceScenarioPlanExport;
  artifactStore: ArtifactStore;
  callbackClient: CallbackClient;
}): Promise<{ artifact?: Artifact; deliveryIssues: DeliveryIssue[] }> {
  if (task.artifact_policy?.capture_trace === false || traceExport.status !== "EXPORTED") {
    return {
      deliveryIssues: []
    };
  }

  const deliveryIssues: DeliveryIssue[] = [];
  let storedArtifacts: Artifact[] = [];

  try {
    storedArtifacts = await artifactStore.persistArtifacts({
      runId,
      artifacts: [createAgentScenarioPlanExportArtifact(traceExport)]
    });
  } catch (error) {
    deliveryIssues.push({
      scope: "artifact-storage",
      stepKey: "agent_scenario_plan_export",
      message: `agent scenario plan export artifact storage failed: ${errorMessage(error)}`
    });
  }

  if (storedArtifacts.length > 0) {
    try {
      await callbackClient.sendArtifacts(runId, {
        artifacts: storedArtifacts
      });
    } catch (error) {
      deliveryIssues.push({
        scope: "artifacts-callback",
        stepKey: "agent_scenario_plan_export",
        message: `agent scenario plan export artifact callback failed: ${errorMessage(error)}`
      });
    }
  }

  return {
    artifact: storedArtifacts[0],
    deliveryIssues
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

interface AgentDeadline {
  readonly expiresAtMs: number;
}

class AgentBudgetExceededError extends Error {
  constructor(phase: string) {
    super(`Agent execution exceeded max_duration_ms during ${phase}.`);
    this.name = "AgentBudgetExceededError";
  }
}

function createAgentDeadline(maxDurationMs: number): AgentDeadline {
  return {
    expiresAtMs: Date.now() + maxDurationMs
  };
}

function remainingAgentBudgetMs(deadline: AgentDeadline): number {
  return deadline.expiresAtMs - Date.now();
}

function assertAgentDeadline(deadline: AgentDeadline, phase: string): void {
  if (remainingAgentBudgetMs(deadline) <= 0) {
    throw new AgentBudgetExceededError(phase);
  }
}

async function runWithinAgentDeadline<T>(
  deadline: AgentDeadline,
  phase: string,
  operation: () => Promise<T> | T
): Promise<T> {
  assertAgentDeadline(deadline, phase);
  const remainingMs = remainingAgentBudgetMs(deadline);
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new AgentBudgetExceededError(phase)), Math.max(1, remainingMs));
      })
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function shouldReportStopped(trace: AgentTrace): boolean {
  return trace.outcome.status === "POLICY_BLOCKED" || trace.outcome.status === "BLOCKED";
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
