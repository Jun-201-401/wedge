import type { RunnerConfig } from "../config/index.ts";
import type { InteractiveComponentObservationItem, ScenarioAction, ScenarioStage, TargetDescriptorMap } from "../shared/contracts.ts";
import { errorMessage, logOperationalEvent } from "../shared/utils.ts";
import { decideNextAction, HeuristicDecisionClient, targetKey, type AgentDecision, type AgentDecisionClient, type AgentDecisionInput } from "./planner.ts";

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
      const rawResponse = await this.transport.complete({
        endpoint: this.options.endpoint,
        apiKey: this.options.apiKey,
        model: this.options.model,
        timeoutMs: this.options.timeoutMs,
        payload: createLlmRequestPayload(input, this.options.model)
      });

      return parseLlmDecision(rawResponse, input);
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

function createLlmRequestPayload(input: AgentDecisionInput, model: string): Record<string, unknown> {
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
          "Allowed actions are goto start_url before start, click an observed target_key, scroll, or finish.",
          "Never invent selectors, credentials, payment data, shell commands, JavaScript, or final purchase actions.",
          "Policy and verifier run after this decision and may reject unsafe actions."
        ].join(" ")
      },
      {
        role: "user",
        content: JSON.stringify({
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
            candidates: input.observation.snapshot.interactiveComponents.map((component) => ({
              targetKey: targetKey(component),
              text: component.text,
              selector: component.selector,
              role: component.role,
              href: component.href,
              tag: component.tag,
              isPrimaryLike: component.is_primary_like,
              isCtaCandidate: component.is_cta_candidate
            }))
          },
          outputSchema: {
            kind: "act|finish",
            targetKey: "observed targetKey for click, null otherwise",
            actionType: "goto|click|scroll|checkpoint",
            scrollY: "number, only for scroll",
            stage: "FIRST_VIEW|VALUE|CTA|INPUT|COMMIT",
            reason: "short reason",
            confidence: "0..1"
          }
        })
      }
    ]
  };
}

function parseLlmDecision(rawResponse: unknown, input: AgentDecisionInput): AgentDecision {
  const candidate = extractDecisionCandidate(rawResponse);
  const record = asRecord(candidate, "LLM decision");
  const kind = readString(record, "kind");
  const reason = readString(record, "reason") ?? "LLM selected a constrained browser decision.";
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

  if (kind !== "act") {
    throw new Error("LLM decision kind must be act or finish");
  }

  const actionType = readString(record, "actionType") ?? readNestedActionType(record);
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
    const selectedComponent = input.observation.snapshot.interactiveComponents.find((component) =>
      targetKey(component) === selectedTargetKey
    );

    if (!selectedTargetKey || !selectedComponent) {
      throw new Error("LLM click targetKey must match an observed component");
    }

    return {
      kind: "act",
      description: `LLM selected click target: ${selectedTargetKey}`,
      reason,
      confidence,
      action: {
        type: "click",
        target: targetFromComponent(selectedComponent)
      },
      settleStrategy: {
        type: "fixed_short",
        timeout_ms: 500
      },
      stage,
      targetKey: selectedTargetKey
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

  if (actionType === "checkpoint") {
    return decideNextAction({
      ...input,
      state: {
        ...input.state,
        scrollCount: input.maxScrolls
      }
    });
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

function targetFromComponent(component: InteractiveComponentObservationItem): TargetDescriptorMap {
  const target: TargetDescriptorMap = {};
  if (component.selector) {
    target.selector = component.selector;
  }
  if (component.role) {
    target.role = component.role;
  }
  if (component.text) {
    target.text = component.text;
  }
  if (component.href) {
    target.url = component.href;
  }
  return target;
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
