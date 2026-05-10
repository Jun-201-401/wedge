import { randomUUID } from "node:crypto";
import type { BrowserPageSnapshot } from "../browser/playwright/index.ts";
import type { CallbackClient } from "../callback/index.ts";
import type { DeliveryIssue } from "../delivery/index.ts";
import type { ArtifactStore } from "../storage/index.ts";
import type {
  AgentEvent,
  AgentEventType,
  AgentFinalOutcome,
  AgentOutcome,
  AgentTask,
  AgentTrace,
  ArtifactDraft,
  ScenarioStep
} from "../shared/contracts.ts";
import { errorMessage, toIsoTimestamp } from "../shared/utils.ts";
import type { AgentVerificationResult } from "./verifier.ts";
import type { AgentDecision } from "./planner.ts";
import type { AgentObservation } from "./observation.ts";

export interface AgentTraceBuilder {
  recordObservation: (stepIndex: number, observation: AgentObservation) => string;
  recordDecision: (stepIndex: number, observationId: string, decision: AgentDecision) => string;
  recordActionStarted: (stepIndex: number, decisionId: string, step: ScenarioStep) => void;
  recordActionCompleted: (stepIndex: number, decisionId: string, step: ScenarioStep, snapshot: BrowserPageSnapshot) => void;
  recordActionFailed: (stepIndex: number, decisionId: string | null, step: ScenarioStep | null, error: unknown) => void;
  recordVerification: (stepIndex: number, decisionId: string, verification: AgentVerificationResult) => string;
  finish: (outcome: AgentOutcomeInput) => AgentTrace;
}

export interface AgentOutcomeInput {
  finalOutcome: AgentFinalOutcome;
  category: AgentOutcome["category"];
  reason: string;
  evidenceRefs?: string[];
  verificationId?: string | null;
  policyResultId?: string | null;
}

export function createAgentTraceBuilder(task: AgentTask): AgentTraceBuilder {
  const traceId = randomUUID();
  const startedAt = toIsoTimestamp();
  const events: AgentEvent[] = [];
  const observations: Record<string, unknown>[] = [];
  const decisions: Record<string, unknown>[] = [];
  const policyResults: Record<string, unknown>[] = [];
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
        stage: decision.stage
      });
      addEvent(stepIndex, "AGENT_DECISION_RECEIVED", {
        decision_id: decisionId,
        observation_id: observationId,
        decision_type: decision.kind === "finish" ? "STOP_BLOCKED" : "ACT",
        action_type: decision.action.type,
        confidence: decision.confidence
      });
      addEvent(stepIndex, "AGENT_DECISION_VALIDATED", {
        decision_id: decisionId,
        valid: true
      });
      addEvent(stepIndex, "AGENT_POLICY_ALLOWED", {
        decision_id: decisionId,
        reason: "No agent-specific policy block was produced by the current MVP runtime."
      });
      return decisionId;
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
      const outcome: AgentOutcome = {
        schema_version: "0.1",
        final_outcome: outcomeInput.finalOutcome,
        category: outcomeInput.category,
        terminal: true,
        reason: outcomeInput.reason,
        evidence_refs: outcomeInput.evidenceRefs ?? [],
        verification_id: outcomeInput.verificationId ?? null,
        policy_result_id: outcomeInput.policyResultId ?? null
      };
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

export async function persistAgentTraceArtifact(input: {
  runId: string;
  trace: AgentTrace;
  artifactStore: ArtifactStore;
  callbackClient: CallbackClient;
}): Promise<DeliveryIssue[]> {
  const deliveryIssues: DeliveryIssue[] = [];
  const artifact: ArtifactDraft = {
    artifactId: input.trace.trace_id,
    artifactType: "TRACE",
    stepKey: "agent_trace",
    mimeType: "application/json",
    fileExtension: "json",
    content: `${JSON.stringify(input.trace, null, 2)}\n`
  };

  let storedArtifacts: Awaited<ReturnType<ArtifactStore["persistArtifacts"]>> = [];
  try {
    storedArtifacts = await input.artifactStore.persistArtifacts({
      runId: input.runId,
      artifacts: [artifact]
    });
  } catch (error) {
    deliveryIssues.push({
      scope: "artifact-storage",
      stepKey: artifact.stepKey,
      message: `agent trace artifact storage failed: ${errorMessage(error)}`
    });
    return deliveryIssues;
  }

  try {
    if (storedArtifacts.length > 0) {
      await input.callbackClient.sendArtifacts(input.runId, { artifacts: storedArtifacts });
    }
  } catch (error) {
    deliveryIssues.push({
      scope: "artifacts-callback",
      stepKey: artifact.stepKey,
      message: `agent trace artifact callback failed: ${errorMessage(error)}`
    });
  }

  return deliveryIssues;
}

function createTraceObservation(
  task: AgentTask,
  stepIndex: number,
  observationId: string,
  snapshot: BrowserPageSnapshot
): Record<string, unknown> {
  return {
    schema_version: "0.1",
    observation_id: observationId,
    task_id: task.task_id,
    step_index: stepIndex,
    captured_at: toIsoTimestamp(),
    url: snapshot.finalUrl,
    origin: readOrigin(snapshot.finalUrl),
    title: snapshot.title,
    page_kind: inferPageKind(snapshot.finalUrl, snapshot.title),
    visible_headings: [],
    visible_text_sample: [],
    forms: [],
    candidates: snapshot.interactiveComponents.map((component, index) => ({
      candidate_id: `candidate-${stepIndex}-${index + 1}`,
      candidate_fingerprint: `${component.role ?? component.tag}:${component.text}:${component.selector ?? ""}`,
      role: component.role,
      text: component.text,
      accessible_name: component.text,
      tag_name: component.tag,
      input_type: null,
      href: null,
      form_action: null,
      form_method: null,
      is_visible: true,
      is_enabled: component.clickable,
      is_in_viewport: true,
      is_covered_or_occluded: "unknown",
      occlusion_reason: null,
      bounding_box: component.bounds,
      frame_id: "main",
      shadow_root_path: null,
      locator_recipe: {
        frame_id: "main",
        role: component.role,
        text: component.text,
        selector: component.selector
      },
      kind_hint: component.is_cta_candidate ? "CTA" : "INTERACTIVE",
      risk_hint: component.is_cta_candidate ? "CHECKOUT_NAVIGATION" : "UNKNOWN",
      confidence: component.is_primary_like ? 0.82 : 0.65,
      source: ["DOM", "HEURISTIC"],
      nearby_text: [],
      parent_section_heading: null,
      language_hint: task.environment.locale
    })),
    risk_candidates: [],
    artifact_refs: {}
  };
}

function readOrigin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "unknown";
  }
}

function inferPageKind(url: string, title: string): string {
  const text = `${url} ${title}`.toLowerCase();
  if (/checkout|payment|결제|주문/.test(text)) {
    return "CHECKOUT";
  }
  if (/cart|장바구니/.test(text)) {
    return "CART";
  }
  if (/pricing|price|요금|가격/.test(text)) {
    return "PRICING";
  }
  return "UNKNOWN";
}
