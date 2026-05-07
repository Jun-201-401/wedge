import type { RunnerConfig } from "../config/index.ts";
import { errorMessage, logOperationalEvent } from "../shared/utils.ts";
import { parseLlmDecision } from "./llm-decision-parser.ts";
import { createLlmCandidateReferences, createLlmRequestPayload } from "./llm-prompt.ts";
import { createFetchLlmDecisionTransport, type AgentLlmDecisionTransport } from "./llm-transport.ts";
import { HeuristicDecisionClient, type AgentDecision, type AgentDecisionClient, type AgentDecisionInput } from "./planner.ts";

export type { AgentLlmDecisionRequest, AgentLlmDecisionTransport } from "./llm-transport.ts";

export interface AgentLlmDecisionClientOptions {
  endpoint?: string;
  apiKey?: string;
  model: string;
  timeoutMs: number;
  fallbackClient?: AgentDecisionClient;
  transport?: AgentLlmDecisionTransport;
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

function resolveLlmTimeoutMs(configuredTimeoutMs: number, remainingTimeMs: number | undefined): number {
  if (remainingTimeMs === undefined) {
    return configuredTimeoutMs;
  }

  return Math.max(1, Math.min(configuredTimeoutMs, Math.floor(remainingTimeMs)));
}
