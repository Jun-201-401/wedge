import assert from "node:assert/strict";
import test from "node:test";
import {
  AgentMcpDecisionClient,
  createFetchMcpDecisionGatewayTransport,
  createMcpDecisionGatewayPayload,
  type AgentMcpDecisionGatewayTransport
} from "../src/agent/mcp-decision-gateway.ts";
import { createLlmCandidateReferences } from "../src/agent/llm-prompt.ts";
import { createInitialAgentState } from "../src/agent/state.ts";
import { createAgentDecisionClient } from "../src/agent/llm-client.ts";
import { createMinimalPlan, createRunnerTestConfig, createSimulatedPageSnapshot } from "./support.ts";

test("[Agent MCP Decision] config mode가 mcp이면 MCP decision client를 사용한다", () => {
  const client = createAgentDecisionClient(createRunnerTestConfig({
    agentDecisionMode: "mcp",
    agentMcpGatewayUrl: "http://api-server:8080/internal/agent/mcp/decision"
  }));

  assert.equal(client.constructor.name, "AgentMcpDecisionClient");
});

test("[Agent MCP Decision] gateway 응답 targetKey를 관찰된 candidate로만 변환한다", async () => {
  let capturedRequest: unknown;
  const transport: AgentMcpDecisionGatewayTransport = {
    decide: async (request) => {
      capturedRequest = request;

      return {
        decision: {
          kind: "act",
          actionType: "click",
          targetKey: "candidate_001",
          stage: "CTA",
          reason: "MCP host selected a visible CTA candidate.",
          confidence: 0.84
        }
      };
    }
  };
  const client = new AgentMcpDecisionClient({
    gatewayUrl: "http://api-server:8080/internal/agent/mcp/decision",
    serviceToken: "mcp-gateway-token",
    timeoutMs: 1_000,
    transport
  });

  const decision = await client.decide({
    runId: "00000000-0000-4000-8000-000000000301",
    goal: "Find checkout",
    startUrl: "https://example.com/product",
    state: {
      ...createInitialAgentState(),
      started: true
    },
    maxScrolls: 1,
    observation: {
      snapshot: createSimulatedPageSnapshot(createMinimalPlan(), {
        interactiveComponents: [
          {
            text: "Checkout",
            selector: "#checkout",
            role: "link",
            href: "https://checkout.example/session",
            tag: "a",
            clickable: true,
            clicked_in_scenario: false,
            is_cta_candidate: true,
            is_primary_like: true,
            bounds: {
              x: 0,
              y: 0,
              width: 100,
              height: 40,
              unit: "css_px"
            }
          }
        ]
      })
    }
  });

  assert.ok(capturedRequest);
  assert.equal(decision.action.type, "click");
  assert.deepEqual(decision.action.target, {
    selector: "#checkout",
    role: "link",
    text: "Checkout",
    url: "https://checkout.example/session"
  });
  assert.equal(decision.targetKey, "#checkout");
});

test("[Agent MCP Decision] gateway payload는 browser-control primitive 대신 constrained observation만 포함한다", () => {
  const snapshot = createSimulatedPageSnapshot(createMinimalPlan(), {
    finalUrl: "https://example.com/product?token=secret-token",
    title: "Checkout mvp.tester@example.com",
    interactiveComponents: [
      {
        text: "Checkout for mvp.tester@example.com",
        selector: "#checkout",
        role: "link",
        href: "https://checkout.example/session?token=checkout-secret",
        tag: "a",
        clickable: true,
        clicked_in_scenario: false,
        is_cta_candidate: true,
        is_primary_like: true,
        bounds: {
          x: 0,
          y: 0,
          width: 100,
          height: 40,
          unit: "css_px"
        }
      }
    ]
  });

  const input = {
    runId: "00000000-0000-4000-8000-000000000302",
    goal: "Find checkout for mvp.tester@example.com",
    startUrl: "https://example.com/product?token=secret-token",
    state: {
      ...createInitialAgentState(),
      started: true
    },
    maxScrolls: 1,
    observation: {
      snapshot
    }
  };
  const payload = createMcpDecisionGatewayPayload(
    input,
    createLlmCandidateReferences(snapshot.interactiveComponents)
  );
  const serializedPayload = JSON.stringify(payload);

  assert.equal(payload.runId, "00000000-0000-4000-8000-000000000302");
  assert.deepEqual(payload.allowedActions, ["click", "scroll", "checkpoint", "finish"]);
  assert.match(serializedPayload, /candidate_001/);
  assert.doesNotMatch(serializedPayload, /selector/);
  assert.doesNotMatch(serializedPayload, /href/);
  assert.doesNotMatch(serializedPayload, /cookie|localStorage|sessionStorage|javascript|evaluate/i);
  assert.doesNotMatch(serializedPayload, /mvp\.tester@example\.com/);
  assert.doesNotMatch(serializedPayload, /checkout-secret|secret-token/);
});

test("[Agent MCP Decision] fetch transport는 API Server ApiResponse data를 decision payload로 unwrap한다", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({
    data: {
      decision: {
        kind: "checkpoint",
        actionType: "checkpoint",
        reason: "API Server wrapped response.",
        confidence: 0.7
      }
    },
    meta: {
      requestId: "req-1"
    }
  }), {
    status: 200,
    headers: {
      "Content-Type": "application/json"
    }
  })) as typeof fetch;

  try {
    const response = await createFetchMcpDecisionGatewayTransport().decide({
      gatewayUrl: "http://api-server:8080/internal/agent/mcp/decision",
      timeoutMs: 1_000,
      payload: {
        runId: "00000000-0000-4000-8000-000000000303",
        goal: "Find checkout",
        startUrl: "https://example.com",
        state: {
          started: true,
          scrollCount: 0,
          clickedTargetKeys: []
        },
        page: {
          finalUrl: "https://example.com",
          title: "Example",
          candidates: []
        },
        allowedActions: ["checkpoint"],
        outputSchema: {
          kind: "act|checkpoint|finish",
          actionType: "goto|click|scroll|checkpoint",
          targetKey: "opaque candidate targetKey for click, null otherwise",
          scrollY: "number, only for scroll",
          stage: "FIRST_VIEW|VALUE|CTA|INPUT|COMMIT",
          reason: "short reason",
          confidence: "0..1"
        }
      }
    });

    assert.deepEqual(response, {
      decision: {
        kind: "checkpoint",
        actionType: "checkpoint",
        reason: "API Server wrapped response.",
        confidence: 0.7
      }
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
