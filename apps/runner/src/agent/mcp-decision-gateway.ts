import { errorMessage, logOperationalEvent } from "../shared/utils.ts";
import { parseLlmDecision } from "./llm-decision-parser.ts";
import { createLlmCandidateReferences, type LlmCandidateReference } from "./llm-prompt.ts";
import { HeuristicDecisionClient, type AgentDecision, type AgentDecisionClient, type AgentDecisionInput } from "./planner.ts";
import { redactSensitiveValue } from "./redaction.ts";

const DEFAULT_MCP_GATEWAY_TIMEOUT_MS = 10_000;

export interface AgentMcpDecisionGatewayRequest {
  gatewayUrl: string;
  serviceToken?: string;
  timeoutMs: number;
  payload: AgentMcpDecisionGatewayPayload;
}

export interface AgentMcpDecisionGatewayPayload {
  runId: string;
  goal: string;
  startUrl: string;
  state: {
    started: boolean;
    scrollCount: number;
    clickedTargetKeys: string[];
  };
  page: {
    finalUrl: string;
    title: string;
    candidates: AgentMcpDecisionCandidate[];
  };
  allowedActions: string[];
  outputSchema: {
    kind: "act|checkpoint|finish";
    actionType: "goto|click|scroll|checkpoint";
    targetKey: "opaque candidate targetKey for click, null otherwise";
    scrollY: "number, only for scroll";
    stage: "FIRST_VIEW|VALUE|CTA|INPUT|COMMIT";
    reason: "short reason";
    confidence: "0..1";
  };
}

export interface AgentMcpDecisionCandidate {
  targetKey: string;
  text?: string | null;
  role?: string | null;
  tag: string;
  isPrimaryLike: boolean;
  isCtaCandidate: boolean;
}

export interface AgentMcpDecisionGatewayTransport {
  decide: (request: AgentMcpDecisionGatewayRequest) => Promise<unknown>;
}

export interface AgentMcpDecisionClientOptions {
  gatewayUrl?: string;
  serviceToken?: string;
  timeoutMs?: number;
  fallbackClient?: AgentDecisionClient;
  transport?: AgentMcpDecisionGatewayTransport;
}

export class AgentMcpDecisionClient implements AgentDecisionClient {
  private readonly gatewayUrl?: string;
  private readonly serviceToken?: string;
  private readonly timeoutMs: number;
  private readonly fallbackClient: AgentDecisionClient;
  private readonly transport: AgentMcpDecisionGatewayTransport;

  constructor(options: AgentMcpDecisionClientOptions = {}) {
    this.gatewayUrl = options.gatewayUrl;
    this.serviceToken = options.serviceToken;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_MCP_GATEWAY_TIMEOUT_MS;
    this.fallbackClient = options.fallbackClient ?? new HeuristicDecisionClient();
    this.transport = options.transport ?? createFetchMcpDecisionGatewayTransport();
  }

  async decide(input: AgentDecisionInput): Promise<AgentDecision> {
    if (!this.gatewayUrl) {
      logOperationalEvent(
        "agent-mcp-decision",
        "fallback_to_heuristic",
        {
          reason: "MCP decision gateway URL is not configured"
        },
        "warn"
      );
      return this.fallbackClient.decide(input);
    }

    try {
      const candidateReferences = createLlmCandidateReferences(input.observation.snapshot.interactiveComponents);
      const rawResponse = await this.transport.decide({
        gatewayUrl: this.gatewayUrl,
        serviceToken: this.serviceToken,
        timeoutMs: resolveMcpGatewayTimeoutMs(this.timeoutMs, input.remainingTimeMs),
        payload: createMcpDecisionGatewayPayload(input, candidateReferences)
      });

      return parseLlmDecision(rawResponse, input, candidateReferences);
    } catch (error) {
      logOperationalEvent(
        "agent-mcp-decision",
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

export function createMcpDecisionGatewayPayload(
  input: AgentDecisionInput,
  candidateReferences: LlmCandidateReference[]
): AgentMcpDecisionGatewayPayload {
  return redactSensitiveValue({
    runId: input.runId,
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
        role: candidate.component.role,
        tag: candidate.component.tag,
        isPrimaryLike: candidate.component.is_primary_like,
        isCtaCandidate: candidate.component.is_cta_candidate
      }))
    },
    allowedActions: input.state.started
      ? ["click", "scroll", "checkpoint", "finish"]
      : ["goto", "checkpoint", "finish"],
    outputSchema: {
      kind: "act|checkpoint|finish",
      actionType: "goto|click|scroll|checkpoint",
      targetKey: "opaque candidate targetKey for click, null otherwise",
      scrollY: "number, only for scroll",
      stage: "FIRST_VIEW|VALUE|CTA|INPUT|COMMIT",
      reason: "short reason",
      confidence: "0..1"
    }
  }) as AgentMcpDecisionGatewayPayload;
}

export function createFetchMcpDecisionGatewayTransport(): AgentMcpDecisionGatewayTransport {
  return {
    decide: async (request) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), request.timeoutMs);

      try {
        const response = await fetch(request.gatewayUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(request.serviceToken ? { Authorization: `Bearer ${request.serviceToken}` } : {})
          },
          body: JSON.stringify(request.payload),
          signal: controller.signal
        });

        if (!response.ok) {
          throw new Error(`MCP decision gateway failed with status ${response.status}`);
        }

        return await response.json() as unknown;
      } finally {
        clearTimeout(timeout);
      }
    }
  };
}

function resolveMcpGatewayTimeoutMs(configuredTimeoutMs: number, remainingTimeMs: number | undefined): number {
  if (remainingTimeMs === undefined) {
    return configuredTimeoutMs;
  }

  return Math.max(1, Math.min(configuredTimeoutMs, Math.floor(remainingTimeMs)));
}
