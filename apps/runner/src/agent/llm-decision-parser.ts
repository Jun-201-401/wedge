import type { ScenarioAction, ScenarioStage } from "../shared/contracts.ts";
import { candidateText, replayHintFromComponent, targetFromComponent } from "./component-target.ts";
import type { LlmCandidateReference } from "./llm-prompt.ts";
import { withAgentDecisionMetadata, type AgentDecision, type AgentDecisionInput, type AgentDecisionPromptMetadata } from "./planner.ts";
import { redactSensitiveString } from "./redaction.ts";
import { plannerSemantics } from "./semantics.ts";

const SCENARIO_STAGES = new Set<ScenarioStage>(["FIRST_VIEW", "VALUE", "CTA", "INPUT", "COMMIT"]);

export class LlmDecisionInvalidJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmDecisionInvalidJsonError";
  }
}

export class LlmDecisionUnsafeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmDecisionUnsafeError";
  }
}

export function isRetryableLlmDecisionError(error: unknown): boolean {
  return error instanceof LlmDecisionInvalidJsonError;
}

export function isUnsafeLlmDecisionError(error: unknown): boolean {
  return error instanceof LlmDecisionUnsafeError;
}

export function parseLlmDecision(
  rawResponse: unknown,
  input: AgentDecisionInput,
  candidateReferences: LlmCandidateReference[],
  metadata: {
    model: string;
    promptMetadata: AgentDecisionPromptMetadata;
  }
): AgentDecision {
  const candidate = extractDecisionCandidate(rawResponse);
  const record = asRecord(candidate, "LLM decision");
  const kind = readString(record, "kind");
  const reason = redactSensitiveString(readString(record, "reason") ?? "LLM selected a constrained browser decision.");
  const confidence = clampConfidence(readNumber(record, "confidence") ?? 0.5);
  const stage = readStage(record, "stage") ?? "CTA";

  if (kind === "finish") {
    return llmDecision({
      kind: "finish",
      description: "LLM requested agent stop.",
      reason,
      confidence,
      action: {
        type: "checkpoint"
      },
      settleStrategy: {
        type: "none",
        timeout_ms: 0
      },
      stage: "COMMIT",
      targetKey: null
    }, metadata);
  }

  if (kind !== "act" && kind !== "checkpoint") {
    throw new Error("LLM decision kind must be act, checkpoint, or finish");
  }

  const actionType = readString(record, "actionType") ?? readNestedActionType(record);
  if (kind === "checkpoint" || actionType === "checkpoint") {
    return llmDecision({
      kind: "checkpoint",
      description: "LLM requested checkpoint without browser action.",
      reason,
      confidence,
      action: {
        type: "checkpoint"
      },
      settleStrategy: {
        type: "none",
        timeout_ms: 0
      },
      stage,
      targetKey: null
    }, metadata);
  }

  if (actionType === "goto") {
    if (input.state.started) {
      throw new LlmDecisionUnsafeError("LLM goto is allowed only before the agent has started");
    }

    return llmDecision({
      kind: "act",
      description: "LLM selected start URL navigation.",
      reason,
      confidence,
      action: {
        type: "goto",
        target: {
          url: input.startUrl
        }
      },
      settleStrategy: {
        type: "network_idle",
        timeout_ms: 1_000
      },
      stage: "FIRST_VIEW",
      targetKey: input.startUrl
    }, metadata);
  }

  if (actionType === "click") {
    const selectedTargetKey = readString(record, "targetKey");
    const selectedCandidate = candidateReferences.find((candidate) =>
      candidate.id === selectedTargetKey
    ) ?? candidateReferences.find((candidate) =>
      candidate.rawTargetKey === selectedTargetKey
    );

    if (!selectedTargetKey || !selectedCandidate) {
      throw new LlmDecisionUnsafeError("LLM click targetKey must match an observed component");
    }

    assertGoalCompatibleLlmClick(input.goal, selectedCandidate);

    return llmDecision({
      kind: "act",
      description: `LLM selected click target: ${redactSensitiveString(selectedTargetKey)}`,
      reason,
      confidence,
      action: {
        type: "click",
        target: targetFromComponent(selectedCandidate.component)
      },
      settleStrategy: {
        type: "fixed_short",
        timeout_ms: 500
      },
      stage,
      targetKey: selectedCandidate.rawTargetKey,
      replayHint: replayHintFromComponent(selectedCandidate.component)
    }, metadata);
  }

  if (actionType === "scroll") {
    return llmDecision({
      kind: "act",
      description: "LLM selected bounded scroll.",
      reason,
      confidence,
      action: {
        type: "scroll",
        value: readNumber(record, "scrollY") ?? 700
      },
      settleStrategy: {
        type: "fixed_short",
        timeout_ms: 250
      },
      stage: "VALUE",
      targetKey: "scroll:700"
    }, metadata);
  }

  if (actionType) {
    throw new LlmDecisionUnsafeError(`LLM actionType is not allowed: ${actionType}`);
  }

  throw new Error("LLM actionType is missing");
}


function assertGoalCompatibleLlmClick(goal: string, selectedCandidate: LlmCandidateReference): void {
  const text = candidateText(selectedCandidate.component);
  const incompatibleMessage = "LLM click target does not match the requested goal semantics";

  if (plannerSemantics.signupLeadGoal.test(goal) && !plannerSemantics.signupLeadEntrypoint.test(text)) {
    throw new LlmDecisionUnsafeError(incompatibleMessage);
  }
  if (plannerSemantics.contactGoal.test(goal) && !plannerSemantics.contactEntrypoint.test(text)) {
    throw new LlmDecisionUnsafeError(incompatibleMessage);
  }
  if (plannerSemantics.pricingGoal.test(goal) && !plannerSemantics.pricingEntrypoint.test(text)) {
    throw new LlmDecisionUnsafeError(incompatibleMessage);
  }
}

function llmDecision(
  decision: AgentDecision,
  metadata: {
    model: string;
    promptMetadata: AgentDecisionPromptMetadata;
  }
): AgentDecision {
  return withAgentDecisionMetadata(decision, {
    decisionSource: "llm",
    model: metadata.model,
    promptMetadata: metadata.promptMetadata
  });
}

function extractDecisionCandidate(rawResponse: unknown): unknown {
  const responseRecord = rawResponse && typeof rawResponse === "object" ? rawResponse as Record<string, unknown> : null;
  const directDecision = responseRecord?.decision;
  if (directDecision) {
    return directDecision;
  }

  const choices = responseRecord?.choices;
  if (Array.isArray(choices)) {
    const firstChoice = choices[0] as { message?: { content?: unknown } } | undefined;
    const content = firstChoice?.message?.content;
    if (typeof content === "string") {
      return parseDecisionJsonText(content, "LLM decision content");
    }
  }

  const outputText = responseRecord?.output_text;
  if (typeof outputText === "string") {
    return parseDecisionJsonText(outputText, "LLM decision output_text");
  }

  const responseOutputText = extractResponsesOutputText(responseRecord?.output);
  if (responseOutputText) {
    return parseDecisionJsonText(responseOutputText, "LLM decision output content");
  }

  return rawResponse;
}

function extractResponsesOutputText(output: unknown): string | null {
  if (!Array.isArray(output)) {
    return null;
  }

  for (const item of output) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }
    const content = (item as Record<string, unknown>).content;
    if (!Array.isArray(content)) {
      continue;
    }
    for (const part of content) {
      if (!part || typeof part !== "object" || Array.isArray(part)) {
        continue;
      }
      const record = part as Record<string, unknown>;
      if (record.type === "output_text" && typeof record.text === "string") {
        return record.text;
      }
    }
  }

  return null;
}

function parseDecisionJsonText(text: string, label: string): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new LlmDecisionInvalidJsonError(`${label} must be valid JSON`);
  }
  return (parsed && typeof parsed === "object" && "decision" in parsed)
    ? (parsed as { decision: unknown }).decision
    : parsed;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  throw new Error(`${label} must be an object`);
}

function readNestedActionType(record: Record<string, unknown>): ScenarioAction["type"] | null {
  const action = record.action;
  if (!action || typeof action !== "object") {
    return null;
  }

  return readString(action as Record<string, unknown>, "type") as ScenarioAction["type"] | null;
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readNumber(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readStage(record: Record<string, unknown>, key: string): ScenarioStage | null {
  const value = readString(record, key);
  return value && SCENARIO_STAGES.has(value as ScenarioStage) ? value as ScenarioStage : null;
}

function clampConfidence(value: number): number {
  return Math.min(1, Math.max(0, value));
}
