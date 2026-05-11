import { randomUUID } from "node:crypto";
import type { BrowserPageSnapshot } from "../../browser/playwright/index.ts";
import type {
  AgentEvent,
  AgentEventType,
  AgentFinalOutcome,
  AgentPolicyDecision,
  AgentPolicyResult,
  AgentRiskClass,
  AgentTask,
  AgentTrace,
  ScenarioStep
} from "../../shared/contracts.ts";
import { errorMessage, toIsoTimestamp } from "../../shared/utils.ts";
import type { AgentObservation } from "../observation.ts";
import type { AgentDecision } from "../planner.ts";
import type { AgentVerificationResult } from "../verifier.ts";
import { createTraceObservation } from "./observation.ts";
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
  const traceId = randomUUID();
  const startedAt = toIsoTimestamp();
  const events: AgentEvent[] = [];
  const observations: Record<string, unknown>[] = [];
  const decisions: Record<string, unknown>[] = [];
  const policyResults: AgentPolicyResult[] = [];
  const verificationResults: Record<string, unknown>[] = [];
  const artifactRefs: string[] = [];
  let finishedTrace: AgentTrace | null = null;

  function addEvent(stepIndex: number, eventType: AgentEventType, payload: Record<string, unknown>): void {
    events.push({
      schema_version: "0.1",
      event_id: randomUUID(),
      task_id: task.task_id,
      attempt_id: task.attempt_id,
      run_id: task.run_id,
      step_index: stepIndex,
      event_type: eventType,
      occurred_at: toIsoTimestamp(),
      payload
    });
  }

  return {
    recordObservation(stepIndex, observation) {
      const observationId = randomUUID();
      observations.push(createTraceObservation(task, stepIndex, observationId, observation.snapshot));
      addEvent(stepIndex, "AGENT_OBSERVATION_CAPTURED", {
        observation_id: observationId,
        url: observation.snapshot.finalUrl,
        candidate_count: observation.snapshot.interactiveComponents.length
      });
      addEvent(stepIndex, "AGENT_CANDIDATES_EXTRACTED", {
        observation_id: observationId,
        candidate_count: observation.snapshot.interactiveComponents.length
      });
      return observationId;
    },

    recordDecision(stepIndex, observationId, decision) {
      const decisionId = randomUUID();
      decisions.push({
        schema_version: "0.1",
        decision_id: decisionId,
        task_id: task.task_id,
        observation_id: observationId,
        decision_type: decision.kind === "finish" ? "STOP_BLOCKED" : "ACT",
        action: {
          tool: decision.action.type,
          target_key: decision.targetKey,
          target: decision.action.target ?? null,
          value: decision.action.value ?? null,
          options: decision.action.options ?? {}
        },
        expected_outcome: {},
        reason: decision.reason,
        confidence: decision.confidence,
        stage: decision.stage,
        planner_source: decision.source ?? "rule_based"
      });
      addEvent(stepIndex, "AGENT_DECISION_RECEIVED", {
        decision_id: decisionId,
        observation_id: observationId,
        decision_type: decision.kind === "finish" ? "STOP_BLOCKED" : "ACT",
        action_type: decision.action.type,
        confidence: decision.confidence,
        planner_source: decision.source ?? "rule_based"
      });
      addEvent(stepIndex, "AGENT_DECISION_VALIDATED", {
        decision_id: decisionId,
        valid: true
      });
      return decisionId;
    },

    recordPolicyResult(stepIndex, decisionId, result) {
      const policyResultId = randomUUID();
      policyResults.push({
        schema_version: "0.1",
        policy_result_id: policyResultId,
        task_id: task.task_id,
        decision_id: decisionId,
        risk_class: result.riskClass,
        decision: result.decision,
        reason: result.reason,
        matched_signals: result.matchedSignals,
        final_outcome: result.finalOutcome ?? null
      });
      addEvent(stepIndex, result.decision === "BLOCK" ? "AGENT_POLICY_BLOCKED" : "AGENT_POLICY_ALLOWED", {
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
      addEvent(stepIndex, "AGENT_ACTION_STARTED", {
        decision_id: decisionId,
        step_id: step.step_id,
        tool: step.action.type,
        target: step.action.target ?? null
      });
    },

    recordActionCompleted(stepIndex, decisionId, step, snapshot) {
      addEvent(stepIndex, "AGENT_ACTION_COMPLETED", {
        decision_id: decisionId,
        step_id: step.step_id,
        tool: step.action.type,
        final_url: snapshot.finalUrl,
        title: snapshot.title
      });
      addEvent(stepIndex, "AGENT_SETTLE_COMPLETED", {
        decision_id: decisionId,
        step_id: step.step_id,
        final_url: snapshot.finalUrl
      });
    },

    recordActionFailed(stepIndex, decisionId, step, error) {
      addEvent(stepIndex, "AGENT_ACTION_FAILED", {
        decision_id: decisionId,
        step_id: step?.step_id ?? null,
        tool: step?.action.type ?? null,
        error_message: errorMessage(error)
      });
    },

    recordVerification(stepIndex, decisionId, verification) {
      const verificationId = randomUUID();
      const status = verification.satisfied ? "SUCCESS" : "PROGRESS";
      verificationResults.push({
        schema_version: "0.1",
        verification_id: verificationId,
        task_id: task.task_id,
        decision_id: decisionId,
        status,
        goal_progress: verification.satisfied ? "CHECKOUT_ENTRY_REACHED" : "NO_PROGRESS",
        confidence: verification.confidence,
        reason: verification.reason,
        evidence: {}
      });
      addEvent(stepIndex, "AGENT_VERIFICATION_COMPLETED", {
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
      addEvent(0, outcome.category === "FAILED" ? "AGENT_FAILED" : "AGENT_STOPPED", {
        final_outcome: outcome.final_outcome,
        category: outcome.category,
        reason: outcome.reason
      });
      finishedTrace = {
        schema_version: "0.1",
        trace_id: traceId,
        task_id: task.task_id,
        attempt_id: task.attempt_id,
        run_id: task.run_id,
        started_at: startedAt,
        finished_at: toIsoTimestamp(),
        final_outcome: outcome.final_outcome,
        events,
        observations,
        decisions,
        policy_results: policyResults,
        verification_results: verificationResults,
        artifact_refs: artifactRefs,
        outcome
      };
      return finishedTrace;
    }
  };
}
