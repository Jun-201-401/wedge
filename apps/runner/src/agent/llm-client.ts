import type { RunnerConfig } from "../config/index.ts";
import type { InteractiveComponentObservationItem, ScenarioAction, ScenarioStage } from "../shared/contracts.ts";
import { errorMessage, logOperationalEvent } from "../shared/utils.ts";
import { targetFromComponent, targetKey } from "./component-target.ts";
import { HeuristicDecisionClient, type AgentDecision, type AgentDecisionClient, type AgentDecisionInput } from "./planner.ts";
import { redactSensitiveString, redactSensitiveValue } from "./redaction.ts";

export interface AgentLlmDecisionTransport {
  complete: (request: AgentLlmDecisionRequest) => Promise<unknown>;
}

export interface AgentLlmDecisionRequest {
  endpoint: string;
  apiKey?: string;
  model: string;
  timeoutMs: number;
  payload: Record<string, unknown>;
}

export interface AgentLlmDecisionClientOptions {
  endpoint?: string;
  apiKey?: string;
  model: string;
  timeoutMs: number;
  fallbackClient?: AgentDecisionClient;
  transport?: AgentLlmDecisionTransport;
}

const SCENARIO_STAGES = new Set<ScenarioStage>(["FIRST_VIEW", "VALUE", "CTA", "INPUT", "COMMIT"]);

interface LlmCandidateReference {
  id: string;
  rawTargetKey: string;
  component: InteractiveComponentObservationItem;
}

export class AgentLlmDecisionClient implements AgentDecisionClient {
  private readonly options: AgentLlmDecisionClientOptions;
  private readonly fallbackClient: AgentDecisionClient;
  private readonly transport: AgentLlmDecisionTransport;

  constructor(options: AgentLlmDecisionClientOptions) {
    this.options = options;
    this.fallbackClient = options.fallbackClient ?? new HeuristicDecisionClient();
    this.transport = options.transport ?? createFetchLlmDecisionTransport();
  }

  async decide(input: AgentDecisionInput): Promise<AgentDecision> {
    if (!this.options.endpoint) {
      return this.fallbackClient.decide(input);
    }

    try {
      const candidateReferences = createLlmCandidateReferences(input.observation.snapshot.interactiveComponents);
      const rawResponse = await this.transport.complete({
        endpoint: this.options.endpoint,
        apiKey: this.options.apiKey,
        model: this.options.model,
        timeoutMs: resolveLlmTimeoutMs(this.options.timeoutMs, input.remainingTimeMs),
        payload: createLlmRequestPayload(input, this.options.model, candidateReferences)
      });

      return parseLlmDecision(rawResponse, input, candidateReferences);
    } catch (error) {
      logOperationalEvent(
        "agent-llm-decision",
        "fallback_to_heuristic",
        {
          reason: errorMessage(error)
        },
        "warn"
      );
      return this.fallbackClient.decide(input);
    }
  }
}

function resolveLlmTimeoutMs(configuredTimeoutMs: number, remainingTimeMs: number | undefined): number {
  if (remainingTimeMs === undefined) {
    return configuredTimeoutMs;
  }

  return Math.max(1, Math.min(configuredTimeoutMs, Math.floor(remainingTimeMs)));
}

export function createAgentDecisionClient(config: Pick<
  RunnerConfig,
  "agentDecisionMode" | "agentLlmEndpoint" | "agentLlmApiKey" | "agentLlmModel" | "agentLlmTimeoutMs"
>): AgentDecisionClient {
  if (config.agentDecisionMode !== "llm") {
    return new HeuristicDecisionClient();
  }

  return new AgentLlmDecisionClient({
    endpoint: config.agentLlmEndpoint,
    apiKey: config.agentLlmApiKey,
    model: config.agentLlmModel,
    timeoutMs: config.agentLlmTimeoutMs
  });
}

function createFetchLlmDecisionTransport(): AgentLlmDecisionTransport {
  return {
    async complete(request) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), request.timeoutMs);

      try {
        const response = await fetch(request.endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(request.apiKey ? { authorization: `Bearer ${request.apiKey}` } : {})
          },
          body: JSON.stringify(request.payload),
          signal: controller.signal
        });

        if (!response.ok) {
          throw new Error(`LLM decision request failed with status ${response.status}`);
        }

        return await response.json();
      } finally {
        clearTimeout(timeout);
      }
    }
  };
}

function createLlmRequestPayload(
  input: AgentDecisionInput,
  model: string,
  candidateReferences: LlmCandidateReference[]
): Record<string, unknown> {
  const userPayload = redactSensitiveValue({
    goal: input.goal,
    startUrl: input.startUrl,
    state: {
      started: input.state.started,
      scrollCount: input.state.scrollCount,
      clickedTargetKeys: [...input.state.clickedTargetKeys]
    },
    page: {
      finalUrl: input.observation.snapshot.finalUrl,
      title: input.observation.snapshot.title,
      candidates: candidateReferences.map((candidate) => ({
        targetKey: candidate.id,
        text: candidate.component.text,
        selector: candidate.component.selector,
        role: candidate.component.role,
        href: candidate.component.href,
        tag: candidate.component.tag,
        isPrimaryLike: candidate.component.is_primary_like,
        isCtaCandidate: candidate.component.is_cta_candidate
      }))
    },
    outputSchema: {
      kind: "act|checkpoint|finish",
      targetKey: "opaque candidate targetKey for click, null otherwise",
      actionType: "goto|click|scroll|checkpoint",
      scrollY: "number, only for scroll",
      stage: "FIRST_VIEW|VALUE|CTA|INPUT|COMMIT",
      reason: "short reason",
      confidence: "0..1"
    }
  });

  return {
    model,
    temperature: 0,
    response_format: {
      type: "json_object"
    },
    messages: [
      {
        role: "system",
        content: [
          "Return only JSON for a constrained browser AgentDecision.",
          "Allowed actions are goto start_url before start, click an observed target_key, scroll, checkpoint without browser action, or finish.",
          "Never invent selectors, credentials, payment data, shell commands, JavaScript, or final purchase actions.",
          "Policy and verifier run after this decision and may reject unsafe actions."
        ].join(" ")
      },
      {
        role: "user",
        content: JSON.stringify(userPayload)
      }
    ]
  };
}

function createLlmCandidateReferences(components: InteractiveComponentObservationItem[]): LlmCandidateReference[] {
  return components.map((component, index) => ({
    id: `candidate_${String(index + 1).padStart(3, "0")}`,
    rawTargetKey: targetKey(component),
    component
  }));
}

function parseLlmDecision(
  rawResponse: unknown,
  input: AgentDecisionInput,
  candidateReferences: LlmCandidateReference[]
): AgentDecision {
  const candidate = extractDecisionCandidate(rawResponse);
  const record = asRecord(candidate, "LLM decision");
  const kind = readString(record, "kind");
  const reason = redactSensitiveString(readString(record, "reason") ?? "LLM selected a constrained browser decision.");
  const confidence = clampConfidence(readNumber(record, "confidence") ?? 0.5);
  const stage = readStage(record, "stage") ?? "CTA";

  if (kind === "finish") {
    return {
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
    };
  }

  if (kind !== "act" && kind !== "checkpoint") {
    throw new Error("LLM decision kind must be act, checkpoint, or finish");
  }

  const actionType = readString(record, "actionType") ?? readNestedActionType(record);
  if (kind === "checkpoint" || actionType === "checkpoint") {
    return {
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
    };
  }

  if (actionType === "goto") {
    if (input.state.started) {
      throw new Error("LLM goto is allowed only before the agent has started");
    }

    return {
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
    };
  }

  if (actionType === "click") {
    const selectedTargetKey = readString(record, "targetKey");
    const selectedCandidate = candidateReferences.find((candidate) =>
      candidate.id === selectedTargetKey
    ) ?? candidateReferences.find((candidate) =>
      candidate.rawTargetKey === selectedTargetKey
    );

    if (!selectedTargetKey || !selectedCandidate) {
      throw new Error("LLM click targetKey must match an observed component");
    }

    return {
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
      targetKey: selectedCandidate.rawTargetKey
    };
  }

  if (actionType === "scroll") {
    return {
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
    };
  }

  throw new Error(`LLM actionType is not allowed: ${actionType ?? "missing"}`);
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
      const parsed = JSON.parse(content) as unknown;
      return (parsed && typeof parsed === "object" && "decision" in parsed)
        ? (parsed as { decision: unknown }).decision
        : parsed;
    }
  }

  return rawResponse;
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
