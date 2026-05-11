import { randomUUID } from "node:crypto";
import type { BrowserPageSnapshot } from "../../browser/playwright/index.ts";
import type {
  AgentCallbackEventType,
  AgentFinalOutcome,
  AgentPolicyDecision,
  AgentPolicyResult,
  AgentRiskClass,
  AgentTask,
  AgentTrace,
  AgentTurnTrace,
  ScenarioStep
} from "../../shared/contracts.ts";
import { errorMessage } from "../../shared/utils.ts";
import type { AgentObservation } from "../observation.ts";
import type { AgentDecision } from "../planner.ts";
import { summarizeObservation } from "../trace.ts";
import type { AgentVerificationResult } from "../verifier.ts";
import { createAgentOutcome, type AgentOutcomeInput } from "./outcome.ts";

export type { AgentOutcomeInput } from "./outcome.ts";

export interface AgentPolicyTraceInput {
  riskClass: AgentRiskClass;
  decision: AgentPolicyDecision;
  reason: string;
  matchedSignals: string[];
  finalOutcome?: AgentFinalOutcome | null;
}

export interface AgentTraceBuilder {
  recordObservation: (stepIndex: number, observation: AgentObservation) => string;
  recordDecision: (stepIndex: number, observationId: string, decision: AgentDecision) => string;
  recordPolicyResult: (stepIndex: number, decisionId: string, result: AgentPolicyTraceInput) => string;
  recordActionStarted: (stepIndex: number, decisionId: string, step: ScenarioStep) => void;
  recordActionCompleted: (stepIndex: number, decisionId: string, step: ScenarioStep, snapshot: BrowserPageSnapshot) => void;
  recordActionFailed: (stepIndex: number, decisionId: string | null, step: ScenarioStep | null, error: unknown) => void;
  recordVerification: (stepIndex: number, decisionId: string, verification: AgentVerificationResult) => string;
  finish: (outcome: AgentOutcomeInput) => AgentTrace;
}

export function createAgentTraceBuilder(task: AgentTask): AgentTraceBuilder {
  const events: Array<{ eventType: AgentCallbackEventType; payload: Record<string, unknown> }> = [];
  const turnsByStepIndex = new Map<number, AgentTurnTrace>();
  let finishedTrace: AgentTrace | null = null;

  function addEvent(_stepIndex: number, eventType: AgentCallbackEventType, payload: Record<string, unknown>): void {
    events.push({ eventType, payload });
  }

  function ensureTurn(stepIndex: number): AgentTurnTrace {
    let turn = turnsByStepIndex.get(stepIndex);
    if (!turn) {
      turn = {
        turn: Math.max(1, stepIndex),
        observation: {
          finalUrl: task.start_url,
          title: "unknown",
          candidateCount: 0
        },
        preDecisionVerification: {
          satisfied: false,
          terminal: false,
          outcome: "CONTINUE",
          reason: "Trace builder has not recorded pre-decision verification.",
          confidence: 0,
          phase: "pre_decision"
        }
      };
      turnsByStepIndex.set(stepIndex, turn);
    }
    return turn;
  }

  return {
    recordObservation(stepIndex, observation) {
      const observationId = randomUUID();
      const turn = ensureTurn(stepIndex);
      turn.observation = summarizeObservation(observation.snapshot, task.observation_budget);
      addEvent(stepIndex, "PRE_DECISION_VERIFIED", {
        observation_id: observationId,
        url: observation.snapshot.finalUrl,
        candidate_count: observation.snapshot.interactiveComponents.length
      });
      return observationId;
    },

    recordDecision(stepIndex, observationId, decision) {
      const decisionId = randomUUID();
      ensureTurn(stepIndex).decision = {
        ...decision,
        metadata: decision.metadata ? { ...decision.metadata } : undefined
      };
      addEvent(stepIndex, "DECISION_MADE", {
        decision_id: decisionId,
        observation_id: observationId,
        decision_type: decision.kind === "finish" ? "STOP_BLOCKED" : "ACT",
        action_type: decision.action.type,
        confidence: decision.confidence,
        planner_source: decision.metadata?.decisionSource ?? "heuristic"
      });
      return decisionId;
    },

    recordPolicyResult(stepIndex, decisionId, result) {
      const policyResultId = randomUUID();
      const policy: AgentPolicyResult = {
        allowed: result.decision === "ALLOW",
        reason: result.reason,
        riskClass: result.riskClass
      };
      ensureTurn(stepIndex).policy = policy;
      addEvent(stepIndex, "POLICY_CHECKED", {
        policy_result_id: policyResultId,
        decision_id: decisionId,
        risk_class: result.riskClass,
        decision: result.decision,
        reason: result.reason,
        matched_signals: result.matchedSignals,
        final_outcome: result.finalOutcome ?? null
      });
      return policyResultId;
    },

    recordActionStarted(stepIndex, decisionId, step) {
      addEvent(stepIndex, "ACTION_COMPLETED", {
        decision_id: decisionId,
        step_id: step.step_id,
        tool: step.action.type,
        target: step.action.target ?? null
      });
    },

    recordActionCompleted(stepIndex, decisionId, step, snapshot) {
      ensureTurn(stepIndex).actionResult = {
        actionType: step.action.type,
        finalUrl: snapshot.finalUrl,
        completed: true
      };
      addEvent(stepIndex, "ACTION_COMPLETED", {
        decision_id: decisionId,
        step_id: step.step_id,
        tool: step.action.type,
        final_url: snapshot.finalUrl,
        title: snapshot.title
      });
    },

    recordActionFailed(stepIndex, decisionId, step, error) {
      addEvent(stepIndex, "ACTION_FAILED", {
        decision_id: decisionId,
        step_id: step?.step_id ?? null,
        tool: step?.action.type ?? null,
        error_message: errorMessage(error)
      });
    },

    recordVerification(stepIndex, decisionId, verification) {
      const verificationId = randomUUID();
      const status = verification.satisfied ? "SUCCESS" : "PROGRESS";
      const turn = ensureTurn(stepIndex);
      if (verification.phase === "pre_decision") {
        turn.preDecisionVerification = verification;
      } else {
        turn.postActionVerification = verification;
      }
      addEvent(stepIndex, "GOAL_VERIFIED", {
        verification_id: verificationId,
        decision_id: decisionId,
        status,
        confidence: verification.confidence,
        reason: verification.reason
      });
      return verificationId;
    },

    finish(outcomeInput) {
      if (finishedTrace) {
        return finishedTrace;
      }
      const outcome = createAgentOutcome(outcomeInput);
      addEvent(0, outcome.status === "FAILED" ? "ACTION_FAILED" : "GOAL_VERIFIED", {
        final_outcome: outcome.status,
        category: outcomeInput.category,
        reason: outcome.reason
      });
      finishedTrace = {
        schema_version: "0.1",
        task_id: task.task_id,
        attempt_id: task.attempt_id,
        attempt_index: task.attempt_index,
        run_id: task.run_id,
        turns: [...turnsByStepIndex.values()].sort((left, right) => left.turn - right.turn),
        outcome
      };
      return finishedTrace;
    }
  };
}
