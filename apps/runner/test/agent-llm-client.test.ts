import assert from "node:assert/strict";
import test from "node:test";
import { AgentLlmDecisionClient, createAgentDecisionClient, type AgentLlmDecisionTransport } from "../src/agent/llm-client.ts";
import { createInitialAgentState } from "../src/agent/state.ts";
import { createMinimalPlan, createRunnerTestConfig, createSimulatedPageSnapshot } from "./support.ts";

test("[Agent LLM Decision] config가 heuristic이면 LLM endpoint가 있어도 heuristic client를 사용한다", () => {
  const client = createAgentDecisionClient(createRunnerTestConfig({
    agentDecisionMode: "heuristic",
    agentLlmEndpoint: "https://llm.example/decision"
  }));

  assert.equal(client.constructor.name, "HeuristicDecisionClient");
});

test("[Agent LLM Decision] LLM 응답 targetKey를 관찰된 click target으로만 변환한다", async () => {
  const requests: unknown[] = [];
  const transport: AgentLlmDecisionTransport = {
    complete: async (request) => {
      requests.push(request);

      return {
        decision: {
          kind: "act",
          actionType: "click",
          targetKey: "#checkout",
          stage: "COMMIT",
          reason: "Checkout candidate is visible.",
          confidence: 0.91
        }
      };
    }
  };
  const client = new AgentLlmDecisionClient({
    endpoint: "https://llm.example/decision",
    model: "agent-model",
    timeoutMs: 1_000,
    transport
  });

  const decision = await client.decide({
    goal: "Find checkout",
    startUrl: "https://example.com/product",
    state: {
      ...createInitialAgentState(),
      started: true
    },
    maxScrolls: 1,
    observation: {
      snapshot: createSimulatedPageSnapshot(createMinimalPlan(), {
        finalUrl: "https://example.com/cart",
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

  assert.equal(requests.length, 1);
  assert.equal(decision.action.type, "click");
  assert.deepEqual(decision.action.target, {
    selector: "#checkout",
    role: "link",
    text: "Checkout",
    url: "https://checkout.example/session"
  });
  assert.equal(decision.targetKey, "#checkout");
  assert.equal(decision.stage, "COMMIT");
});

test("[Agent LLM Decision] 유효하지 않은 LLM action은 heuristic으로 fallback한다", async () => {
  const transport: AgentLlmDecisionTransport = {
    complete: async () => ({
      decision: {
        kind: "act",
        actionType: "click",
        targetKey: "#invented",
        reason: "Invented target",
        confidence: 0.9
      }
    })
  };
  const client = new AgentLlmDecisionClient({
    endpoint: "https://llm.example/decision",
    model: "agent-model",
    timeoutMs: 1_000,
    transport
  });

  const decision = await client.decide({
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
            text: "Proceed to checkout",
            selector: "#real-checkout",
            role: "link",
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

  assert.equal(decision.action.type, "click");
  assert.equal(decision.targetKey, "#real-checkout");
});
