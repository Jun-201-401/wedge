import { randomUUID } from "node:crypto";
import type { BrowserPageSnapshot } from "../browser/playwright/index.ts";
import type { AgentTask, ArtifactDraft, ScenarioAction } from "../shared/contracts.ts";
import type { AgentDecision } from "./planner.ts";
import type { AgentPolicyResult } from "./policy.ts";
import { redactAgentTrace, redactSensitiveString } from "./redaction.ts";
import type { AgentVerificationResult } from "./verifier.ts";

export interface AgentTurnTrace {
  turn: number;
  observation: {
    finalUrl: string;
    title: string;
    candidateCount: number;
  };
  preDecisionVerification: AgentVerificationResult;
  decision?: AgentDecision;
  policy?: AgentPolicyResult;
  actionResult?: {
    actionType: ScenarioAction["type"];
    finalUrl: string;
    completed: boolean;
  };
  postActionVerification?: AgentVerificationResult;
}

export interface AgentTrace {
  schema_version: "0.1";
  task_id: string;
  attempt_id: string;
  run_id: string;
  turns: AgentTurnTrace[];
  outcome: {
    status: "RUNNING" | "SUCCESS" | "POLICY_BLOCKED" | "BLOCKED" | "FAILED" | "EXHAUSTED";
    reason: string;
  };
}

export function createAgentTrace(task: AgentTask): AgentTrace {
  return {
    schema_version: "0.1",
    task_id: task.task_id,
    attempt_id: task.attempt_id,
    run_id: task.run_id,
    turns: [],
    outcome: {
      status: "RUNNING",
      reason: "Agent execution is in progress."
    }
  };
}

export function summarizeObservation(snapshot: BrowserPageSnapshot): AgentTurnTrace["observation"] {
  return {
    finalUrl: redactSensitiveString(snapshot.finalUrl),
    title: redactSensitiveString(snapshot.title),
    candidateCount: snapshot.interactiveComponents.length
  };
}

export function createAgentTraceArtifact(trace: AgentTrace): ArtifactDraft {
  return {
    artifactId: randomUUID(),
    artifactType: "TRACE",
    stepKey: "agent_trace",
    mimeType: "application/json",
    fileExtension: "json",
    content: JSON.stringify(redactAgentTrace(trace), null, 2)
  };
}
