import type { BrowserSession } from "../browser/playwright/index.ts";
import type { CallbackClient } from "../callback/index.ts";
import type { CapturePipeline } from "../capture/index.ts";
import { createDeliverySummary, mergeDeliveryIssues, type DeliveryIssue, type DeliverySummary } from "../delivery/index.ts";
import { ScenarioExecutionError, type ScenarioExecutionSummary } from "../scenario/executor/index.ts";
import { emitStepEventBestEffort } from "../scenario/executor/step-events.ts";
import { executeScenarioStep } from "../scenario/executor/step-executor.ts";
import type { ArtifactStore } from "../storage/index.ts";
import type { AgentTask, ScenarioPlan, ScenarioStep } from "../shared/contracts.ts";
import { classifyRunnerFailure, errorMessage, logOperationalEvent } from "../shared/utils.ts";
import { decideNextAction, type AgentDecision } from "./planner.ts";
import { observePage } from "./observation.ts";
import { createInitialAgentState } from "./state.ts";
import { verifyGoal } from "./verifier.ts";

export interface AgentExecutionResult {
  summary: ScenarioExecutionSummary;
  delivery: DeliverySummary;
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
  const deliveryIssues: DeliveryIssue[] = [];
  let completedStepCount = 0;
  let stopped = false;

  for (let turn = 1; turn <= config.maxTurns; turn += 1) {
    const observation = await observePage(input.session);
    const previousUrl = observation.snapshot.finalUrl;
    const decision = decideNextAction({
      goal: resolveTaskGoal(input.task),
      startUrl: input.task.start_url,
      state,
      observation,
      maxScrolls: config.maxScrolls
    });
    const step = agentDecisionToScenarioStep(decision, turn, config.captureEveryTurn);

    deliveryIssues.push(...(await emitStepEventBestEffort(input.callbackClient, input.runId, turn, step.step_id, "ISSUE_SIGNAL_DETECTED", {
      agentTurn: turn,
      event: "DECISION_MADE",
      decisionReason: decision.reason,
      confidence: decision.confidence,
      actionType: decision.action.type,
      targetKey: decision.targetKey
    })));

    try {
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
    } catch (error) {
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

      deliveryIssues.push(...(await emitStepEventBestEffort(input.callbackClient, input.runId, turn, step.step_id, "STEP_FAILED", {
        agentTurn: turn,
        description: step.description,
        stage: step.stage,
        actionType: step.action.type,
        failureCode,
        failureMessage
      })));

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

    const verification = verifyGoal({
      goal: resolveTaskGoal(input.task),
      startUrl: input.task.start_url,
      previousUrl,
      snapshot: input.session.snapshot(),
      decision
    });

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
      break;
    }
  }

  return {
    summary: {
      completedStepCount,
      failedStepCount: 0,
      stopped
    },
    delivery: createDeliverySummary(mergeDeliveryIssues(deliveryIssues))
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
