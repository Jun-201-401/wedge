import { LlmDecisionInvalidJsonError } from "./llm-decision-parser.ts";
import { recordAiRequestMetrics, type AiRequestErrorType } from "../observability/metrics.ts";

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

export function createFetchLlmDecisionTransport(): AgentLlmDecisionTransport {
  return {
    async complete(request) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), request.timeoutMs);
      const startedAt = performance.now();

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
          throw new LlmDecisionHttpError(response.status);
        }

        try {
          const payload = await response.json();
          recordLlmRequestMetric(request, startedAt, "none");
          return payload;
        } catch (error) {
          if (error instanceof LlmDecisionInvalidJsonError) {
            throw error;
          }
          throw new LlmDecisionInvalidJsonError("LLM decision response body must be valid JSON");
        }
      } catch (error) {
        recordLlmRequestMetric(request, startedAt, classifyLlmRequestError(error));
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    }
  };
}

class LlmDecisionHttpError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`LLM decision request failed with status ${status}`);
    this.name = "LlmDecisionHttpError";
    this.status = status;
  }
}

function recordLlmRequestMetric(
  request: AgentLlmDecisionRequest,
  startedAt: number,
  errorType: AiRequestErrorType
): void {
  recordAiRequestMetrics({
    service: "runner",
    feature: "agent_decision",
    model: request.model,
    status: errorType === "none" ? "success" : "error",
    errorType,
    durationMs: performance.now() - startedAt
  });
}

function classifyLlmRequestError(error: unknown): AiRequestErrorType {
  if (error instanceof LlmDecisionHttpError) {
    return "http_error";
  }
  if (error instanceof LlmDecisionInvalidJsonError) {
    return "invalid_json";
  }
  if (error instanceof DOMException && error.name === "AbortError") {
    return "timeout";
  }
  if (error instanceof TypeError) {
    return "network_error";
  }
  return "unknown";
}
