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
