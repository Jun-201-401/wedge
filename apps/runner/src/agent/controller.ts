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
import { HeuristicDecisionClient, type AgentDecision, type AgentDecisionClient } from "./planner.ts";
import { observePage } from "./observation.ts";
import { evaluateAgentPolicy } from "./policy.ts";
import { createInitialAgentState } from "./state.ts";
import { createAgentTrace, summarizeObservation, type AgentTrace, type AgentTurnTrace } from "./trace.ts";
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
  decisionClient?: AgentDecisionClient;
}

export async function executeAgentRun(input: AgentExecutorInput): Promise<AgentExecutionResult> {
  const config = resolveAgentBudget(input.task);
  const decisionClient = input.decisionClient ?? new HeuristicDecisionClient();
  const state = createInitialAgentState();
  const trace = createAgentTrace(input.task);
  const deliveryIssues: DeliveryIssue[] = [];
  let completedStepCount = 0;
  let stopped = false;

  for (let turn = 1; turn <= config.maxTurns; turn += 1) {
    const observation = await observePage(input.session);
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

    deliveryIssues.push(...(await emitStepEventBestEffort(input.callbackClient, input.runId, turn, `agent_turn_${String(turn).padStart(3, "0")}`, "ISSUE_SIGNAL_DETECTED", {
      agentTurn: turn,
      event: "PRE_DECISION_VERIFIED",
      satisfied: preDecisionVerification.satisfied,
      reason: preDecisionVerification.reason,
      confidence: preDecisionVerification.confidence
    })));

    if (preDecisionVerification.satisfied) {
      trace.outcome = {
        status: "SUCCESS",
        reason: preDecisionVerification.reason
      };
      stopped = true;
      break;
    }

    const decision = await decisionClient.decide({
      goal: resolveTaskGoal(input.task),
      startUrl: input.task.start_url,
      state,
      observation,
      maxScrolls: config.maxScrolls
    });
    turnTrace.decision = decision;
    const step = agentDecisionToScenarioStep(decision, turn, config.captureEveryTurn);

    deliveryIssues.push(...(await emitStepEventBestEffort(input.callbackClient, input.runId, turn, step.step_id, "ISSUE_SIGNAL_DETECTED", {
      agentTurn: turn,
      event: "DECISION_MADE",
      decisionReason: decision.reason,
      confidence: decision.confidence,
      actionType: decision.action.type,
      targetKey: decision.targetKey
    })));

    const policy = evaluateAgentPolicy({
      task: input.task,
      decision,
      snapshot: observation.snapshot
    });
    turnTrace.policy = policy;

    deliveryIssues.push(...(await emitStepEventBestEffort(input.callbackClient, input.runId, turn, step.step_id, "ISSUE_SIGNAL_DETECTED", {
      agentTurn: turn,
      event: "POLICY_CHECKED",
      allowed: policy.allowed,
      riskClass: policy.riskClass,
      reason: policy.reason
    })));

    if (!policy.allowed) {
      trace.outcome = {
        status: "POLICY_BLOCKED",
        reason: policy.reason
      };
      stopped = true;
      break;
    }

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
      turnTrace.actionResult = {
        actionType: decision.action.type,
        finalUrl: input.session.snapshot().finalUrl,
        completed: true
      };
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

    deliveryIssues.push(...(await emitStepEventBestEffort(input.callbackClient, input.runId, turn, step.step_id, "ISSUE_SIGNAL_DETECTED", {
      agentTurn: turn,
      event: "GOAL_VERIFIED",
      satisfied: verification.satisfied,
      reason: verification.reason,
      confidence: verification.confidence
    })));

    if (verification.satisfied || decision.kind === "finish") {
      trace.outcome = {
        status: verification.satisfied ? "SUCCESS" : "EXHAUSTED",
        reason: verification.reason
      };
      stopped = true;
      break;
    }
  }

  if (trace.outcome.status === "RUNNING") {
    trace.outcome = {
      status: "EXHAUSTED",
      reason: "Agent execution reached the configured turn budget."
    };
  }

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
