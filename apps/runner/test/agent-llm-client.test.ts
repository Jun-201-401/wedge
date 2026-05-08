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
  assert.match(decision.replayHint?.candidate_fingerprint ?? "", /^candidate:[a-f0-9]{16}$/);
  assert.deepEqual(decision.replayHint?.locator_recipe[0], {
    strategy: "selector",
    selector: "#checkout",
    confidence: 0.9
  });
});

test("[Agent LLM Decision] selector 없는 민감 텍스트 후보는 opaque candidate id로 선택한다", async () => {
  let capturedPayload: Record<string, unknown> | null = null;
  const transport: AgentLlmDecisionTransport = {
    complete: async (request) => {
      capturedPayload = request.payload;

      return {
        decision: {
          kind: "act",
          actionType: "click",
          targetKey: "candidate_001",
          stage: "COMMIT",
          reason: "Opaque candidate selected.",
          confidence: 0.88
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
        interactiveComponents: [
          {
            text: "Checkout for mvp.tester@example.com",
            selector: null,
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

  const serializedPayload = JSON.stringify(capturedPayload);
  assert.match(serializedPayload, /candidate_001/);
  assert.doesNotMatch(serializedPayload, /link:Checkout for mvp\\.tester@example\\.com/);
  assert.doesNotMatch(serializedPayload, /mvp\\.tester@example\\.com/);
  assert.equal(decision.action.type, "click");
  assert.deepEqual(decision.action.target, {
    role: "link",
    text: "Checkout for mvp.tester@example.com"
  });
  assert.equal(decision.targetKey, "link:Checkout for mvp.tester@example.com");
});

test("[Agent LLM Decision] transport 실패는 heuristic으로 fallback한다", async () => {
  const transport: AgentLlmDecisionTransport = {
    complete: async () => {
      throw new Error("LLM timeout");
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


test("[Agent LLM Decision] invalid JSON 응답만 재시도한다", async () => {
  let callCount = 0;
  const transport: AgentLlmDecisionTransport = {
    complete: async () => {
      callCount += 1;
      return callCount === 1
        ? {
            choices: [
              {
                message: {
                  content: "{not-json"
                }
              }
            ]
          }
        : {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    decision: {
                      kind: "checkpoint",
                      actionType: "checkpoint",
                      reason: "Retry returned parseable JSON.",
                      confidence: 0.7
                    }
                  })
                }
              }
            ]
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
      snapshot: createSimulatedPageSnapshot(createMinimalPlan())
    }
  });

  assert.equal(callCount, 2);
  assert.equal(decision.kind, "checkpoint");
  assert.equal(decision.action.type, "checkpoint");
});

test("[Agent LLM Decision] unsafe decision은 재시도나 heuristic fallback 없이 거부한다", async () => {
  let callCount = 0;
  const transport: AgentLlmDecisionTransport = {
    complete: async () => {
      callCount += 1;
      return callCount === 1
        ? {
            decision: {
              kind: "act",
              actionType: "click",
              targetKey: "#invented",
              reason: "Invented target",
              confidence: 0.9
            }
          }
        : {
            decision: {
              kind: "checkpoint",
              actionType: "checkpoint",
              reason: "Should not be used",
              confidence: 0.5
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

  await assert.rejects(
    () => client.decide({
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
    }),
    /targetKey must match an observed component/
  );

  assert.equal(callCount, 1);
});

test("[Agent LLM Decision] checkpoint 응답은 heuristic click으로 변환하지 않는다", async () => {
  const transport: AgentLlmDecisionTransport = {
    complete: async () => ({
      decision: {
        kind: "checkpoint",
        actionType: "checkpoint",
        reason: "Pause and verify the current page before another browser action.",
        confidence: 0.72
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

  assert.equal(decision.kind, "checkpoint");
  assert.equal(decision.action.type, "checkpoint");
  assert.equal(decision.targetKey, null);
});

test("[Agent LLM Decision] prompt payload는 민감 문자열을 redaction 후 전송한다", async () => {
  let capturedPayload: Record<string, unknown> | null = null;
  const transport: AgentLlmDecisionTransport = {
    complete: async (request) => {
      capturedPayload = request.payload;
      return {
        decision: {
          kind: "checkpoint",
          actionType: "checkpoint",
          reason: "Stop before using mvp.tester@example.com",
          confidence: 0.6
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

  await client.decide({
    goal: "Find checkout for mvp.tester@example.com and 010-1234-5678 near 123 Main Street coupon code SAVE-SECRET-50",
    startUrl: "https://example.com/product?email=mvp.tester@example.com&token=secret-token&session_id=session-secret&coupon_code=SAVE-SECRET-50",
    state: {
      ...createInitialAgentState(),
      started: true
    },
    maxScrolls: 1,
    observation: {
      snapshot: createSimulatedPageSnapshot(createMinimalPlan(), {
        finalUrl: "https://example.com/product?phone=01012345678",
        title: "Account mvp.tester@example.com",
        interactiveComponents: [
          {
            text: "Checkout with card 4242 4242 4242 4242 at 123 Main Street coupon code SAVE-SECRET-50",
            selector: "#checkout-session-secret-SAVE-SECRET-50",
            role: "link",
            href: "https://checkout.example/session/checkout-secret?token=checkout-secret&email=mvp.tester@example.com&coupon_code=SAVE-SECRET-50",
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

  const serializedPayload = JSON.stringify(capturedPayload);
  assert.doesNotMatch(serializedPayload, /mvp\.tester@example\.com/);
  assert.doesNotMatch(serializedPayload, /010-?1234-?5678/);
  assert.doesNotMatch(serializedPayload, /4242 4242 4242 4242/);
  assert.doesNotMatch(serializedPayload, /checkout-secret|secret-token/);
  assert.doesNotMatch(serializedPayload, /session-secret|SAVE-SECRET-50|123 Main Street/);
  assert.doesNotMatch(serializedPayload, /checkout-session-secret-SAVE-SECRET-50/);
  assert.match(serializedPayload, /REDACTED_EMAIL/);
  assert.match(serializedPayload, /REDACTED_PHONE/);
  assert.match(serializedPayload, /REDACTED_CARD/);
  assert.match(serializedPayload, /REDACTED_SECRET/);
  assert.match(serializedPayload, /REDACTED_ADDRESS/);
  assert.match(serializedPayload, /REDACTED_COUPON/);
  assert.match(serializedPayload, /selectorHint/);
});
