import { errorMessage, logOperationalEvent } from "../shared/utils.ts";
import { parseLlmDecision } from "./llm-decision-parser.ts";
import { createLlmCandidateReferences, createLlmPromptMetadata, type LlmCandidateReference } from "./llm-prompt.ts";
import { type AgentDecision, type AgentDecisionClient, type AgentDecisionInput } from "./planner.ts";
import { redactSensitiveValue } from "./redaction.ts";

const DEFAULT_MCP_GATEWAY_TIMEOUT_MS = 10_000;
const DEFAULT_PENDING_DECISION_POLL_INTERVAL_MS = 500;
const MCP_DECISION_ENDPOINT_SUFFIX = "/decision";
const MCP_PENDING_DECISIONS_ENDPOINT_SUFFIX = "/pending-decisions";

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
  transport?: AgentMcpDecisionGatewayTransport;
}

export class AgentMcpDecisionClient implements AgentDecisionClient {
  private readonly gatewayUrl?: string;
  private readonly serviceToken?: string;
  private readonly timeoutMs: number;
  private readonly transport: AgentMcpDecisionGatewayTransport;

  constructor(options: AgentMcpDecisionClientOptions = {}) {
    this.gatewayUrl = options.gatewayUrl;
    this.serviceToken = options.serviceToken;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_MCP_GATEWAY_TIMEOUT_MS;
    this.transport = options.transport ?? createFetchMcpDecisionGatewayTransport();
  }

  async decide(input: AgentDecisionInput): Promise<AgentDecision> {
    if (!this.gatewayUrl) {
      throw new Error("MCP decision gateway URL is not configured");
    }

    try {
      const candidateReferences = createLlmCandidateReferences(input.observation.snapshot.interactiveComponents);
      const rawResponse = await this.transport.decide({
        gatewayUrl: this.gatewayUrl,
        serviceToken: this.serviceToken,
        timeoutMs: resolveMcpGatewayTimeoutMs(this.timeoutMs, input.remainingTimeMs),
        payload: createMcpDecisionGatewayPayload(input, candidateReferences)
      });

      return parseLlmDecision(rawResponse, input, candidateReferences, {
        model: "mcp-decision-gateway",
        promptMetadata: createLlmPromptMetadata(candidateReferences)
      });
    } catch (error) {
      logOperationalEvent(
        "agent-mcp-decision",
        "decision_failed",
        {
          reason: errorMessage(error)
        },
        "error"
      );
      throw error;
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
      const pendingDecisionsUrl = resolvePendingDecisionsUrl(request.gatewayUrl);
      const deadline = Date.now() + request.timeoutMs;

      const createResponse = asPendingDecisionResponse(await fetchJsonWithinDeadline(
        pendingDecisionsUrl,
        {
          method: "POST",
          headers: createMcpGatewayHeaders(request.serviceToken),
          body: JSON.stringify(request.payload)
        },
        deadline,
        "create MCP pending decision"
      ));

      if (!createResponse.pendingDecisionId) {
        throw new Error("MCP pending decision response is missing pendingDecisionId");
      }

      let current = createResponse;
      while (true) {
        if (current.status === "COMPLETED") {
          if (current.decision === undefined || current.decision === null) {
            throw new Error("MCP pending decision completed without decision payload");
          }
          return { decision: current.decision };
        }

        if (current.status === "EXPIRED") {
          throw new Error(`MCP pending decision expired: ${current.pendingDecisionId}`);
        }

        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) {
          throw new Error(`MCP pending decision timed out: ${current.pendingDecisionId}`);
        }

        await sleep(Math.min(DEFAULT_PENDING_DECISION_POLL_INTERVAL_MS, remainingMs));
        current = asPendingDecisionResponse(await fetchJsonWithinDeadline(
          resolvePendingDecisionStatusUrl(pendingDecisionsUrl, current.pendingDecisionId),
          {
            method: "GET",
            headers: createMcpGatewayHeaders(request.serviceToken)
          },
          deadline,
          "get MCP pending decision"
        ));
      }
    }
  };
}

interface AgentMcpPendingDecisionResponse {
  pendingDecisionId: string;
  status: "PENDING" | "COMPLETED" | "EXPIRED";
  decision?: unknown;
}

async function fetchJsonWithinDeadline(
  url: string,
  init: RequestInit,
  deadline: number,
  operation: string
): Promise<unknown> {
  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) {
    throw new Error(`MCP pending decision timed out before ${operation}`);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), remainingMs);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`MCP decision gateway ${operation} failed with status ${response.status}`);
    }

    return unwrapApiResponseData(await response.json() as unknown);
  } finally {
    clearTimeout(timeout);
  }
}

function createMcpGatewayHeaders(serviceToken: string | undefined): HeadersInit {
  return {
    "Content-Type": "application/json",
    ...(serviceToken ? { Authorization: `Bearer ${serviceToken}` } : {})
  };
}

function asPendingDecisionResponse(value: unknown): AgentMcpPendingDecisionResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("MCP pending decision response must be an object");
  }

  const record = value as Record<string, unknown>;
  const pendingDecisionId = record.pendingDecisionId;
  const status = record.status;
  if (typeof pendingDecisionId !== "string" || pendingDecisionId.length === 0) {
    throw new Error("MCP pending decision response pendingDecisionId must be a string");
  }
  if (status !== "PENDING" && status !== "COMPLETED" && status !== "EXPIRED") {
    throw new Error("MCP pending decision response status must be PENDING, COMPLETED, or EXPIRED");
  }

  return {
    pendingDecisionId,
    status,
    decision: record.decision
  };
}

function resolvePendingDecisionsUrl(gatewayUrl: string): string {
  const url = new URL(gatewayUrl);
  if (url.pathname.endsWith(MCP_PENDING_DECISIONS_ENDPOINT_SUFFIX)) {
    return url.toString();
  }

  if (url.pathname.endsWith(MCP_DECISION_ENDPOINT_SUFFIX)) {
    url.pathname = url.pathname.slice(0, -MCP_DECISION_ENDPOINT_SUFFIX.length) + MCP_PENDING_DECISIONS_ENDPOINT_SUFFIX;
    return url.toString();
  }

  url.pathname = `${url.pathname.replace(/\/$/, "")}${MCP_PENDING_DECISIONS_ENDPOINT_SUFFIX}`;
  return url.toString();
}

function resolvePendingDecisionStatusUrl(pendingDecisionsUrl: string, pendingDecisionId: string): string {
  const url = new URL(pendingDecisionsUrl);
  url.pathname = `${url.pathname.replace(/\/$/, "")}/${encodeURIComponent(pendingDecisionId)}`;
  return url.toString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function unwrapApiResponseData(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const record = value as Record<string, unknown>;
  if ("data" in record && "meta" in record) {
    return record.data;
  }

  return value;
}

function resolveMcpGatewayTimeoutMs(configuredTimeoutMs: number, remainingTimeMs: number | undefined): number {
  if (remainingTimeMs === undefined) {
    return configuredTimeoutMs;
  }

  return Math.max(1, Math.min(configuredTimeoutMs, Math.floor(remainingTimeMs)));
}
