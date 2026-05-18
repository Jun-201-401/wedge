import type { RunnerConfig } from "../config/index.ts";
import { errorMessage, logOperationalEvent } from "../shared/utils.ts";
import {
  isRetryableLlmDecisionError,
  isUnsafeLlmDecisionError,
  parseLlmDecision
} from "./llm-decision-parser.ts";
import { createLlmCandidateReferences, createLlmPromptMetadata, createLlmRequestPayload } from "./llm-prompt.ts";
import { createFetchLlmDecisionTransport, type AgentLlmDecisionTransport } from "./llm-transport.ts";
import { AgentMcpDecisionClient } from "./mcp-decision-gateway.ts";
import { HeuristicDecisionClient, type AgentDecision, type AgentDecisionClient, type AgentDecisionInput } from "./planner.ts";

export type { AgentLlmDecisionRequest, AgentLlmDecisionTransport } from "./llm-transport.ts";

const DEFAULT_INVALID_JSON_RETRY_COUNT = 1;

export interface AgentLlmDecisionClientOptions {
  endpoint?: string;
  apiKey?: string;
  model: string;
  timeoutMs: number;
  invalidJsonRetryCount?: number;
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

    const candidateReferences = createLlmCandidateReferences(input.observation.snapshot.interactiveComponents);
    const promptMetadata = createLlmPromptMetadata(candidateReferences);
    const retryCount = resolveInvalidJsonRetryCount(this.options.invalidJsonRetryCount);

    for (let attemptIndex = 0; attemptIndex <= retryCount; attemptIndex += 1) {
      try {
        const rawResponse = await this.transport.complete({
          endpoint: this.options.endpoint,
          apiKey: this.options.apiKey,
          model: this.options.model,
          timeoutMs: resolveLlmTimeoutMs(this.options.timeoutMs, input.remainingTimeMs),
          payload: createLlmRequestPayload(input, this.options.model, candidateReferences, this.options.endpoint)
        });

        return parseLlmDecision(rawResponse, input, candidateReferences, {
          model: this.options.model,
          promptMetadata
        });
      } catch (error) {
        if (isRetryableLlmDecisionError(error) && attemptIndex < retryCount) {
          logOperationalEvent(
            "agent-llm-decision",
            "retry_invalid_json",
            {
              attempt: attemptIndex + 1,
              maxAttempts: retryCount + 1,
              reason: errorMessage(error)
            },
            "warn"
          );
          continue;
        }

        if (isUnsafeLlmDecisionError(error)) {
          logOperationalEvent(
            "agent-llm-decision",
            "unsafe_decision_fallback_to_heuristic",
            {
              reason: errorMessage(error)
            },
            "warn"
          );
          return this.fallbackClient.decide(input);
        }

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

    return this.fallbackClient.decide(input);
  }
}

export function createAgentDecisionClient(config: Pick<
  RunnerConfig,
  | "agentDecisionMode"
  | "agentLlmEndpoint"
  | "agentLlmApiKey"
  | "agentLlmModel"
  | "agentLlmTimeoutMs"
  | "agentMcpGatewayUrl"
  | "agentMcpServiceToken"
  | "agentMcpGatewayTimeoutMs"
>): AgentDecisionClient {
  if (config.agentDecisionMode === "mcp") {
    return new AgentMcpDecisionClient({
      gatewayUrl: config.agentMcpGatewayUrl,
      serviceToken: config.agentMcpServiceToken,
      timeoutMs: config.agentMcpGatewayTimeoutMs
    });
  }

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

function resolveInvalidJsonRetryCount(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_INVALID_JSON_RETRY_COUNT;
  }

  return Number.isInteger(value) && value > 0 ? value : 0;
}

function resolveLlmTimeoutMs(configuredTimeoutMs: number, remainingTimeMs: number | undefined): number {
  if (remainingTimeMs === undefined) {
    return configuredTimeoutMs;
  }

  return Math.max(1, Math.min(configuredTimeoutMs, Math.floor(remainingTimeMs)));
}
