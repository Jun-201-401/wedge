import assert from "node:assert/strict";
import test from "node:test";
import { AgentLlmDecisionClient, createAgentDecisionClient, type AgentLlmDecisionTransport } from "../src/agent/llm-client.ts";
import { HeuristicDecisionClient, type AgentDecisionInput } from "../src/agent/planner.ts";
import { createInitialAgentState } from "../src/agent/state.ts";
import type { InteractiveComponentObservationItem, ScenarioStage } from "../src/shared/contracts.ts";
import { createMinimalPlan, createRunnerTestConfig, createSimulatedPageSnapshot } from "./support.ts";

function requireCapturedPayload(payload: Record<string, unknown> | null): Record<string, unknown> {
  assert.ok(payload);
  return payload;
}

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
    runId: "00000000-0000-4000-8000-000000000401",
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
  assert.match(decision.metadata?.decisionId ?? "", /^[0-9a-f-]{36}$/);
  assert.equal(decision.metadata?.decisionSource, "llm");
  assert.equal(decision.metadata?.model, "agent-model");
  assert.deepEqual(decision.metadata?.promptMetadata, {
    payloadShapeVersion: "llm-prompt-v1",
    candidateCount: 1,
    redacted: true,
    rawPromptStored: false,
    rawCandidateSelectorsIncluded: false,
    rawCandidateHrefsIncluded: false
  });
  assert.match(decision.replayHint?.candidate_fingerprint ?? "", /^candidate:[a-f0-9]{16}$/);
  assert.deepEqual(decision.replayHint?.locator_recipe[0], {
    strategy: "selector",
    selector: "#checkout",
    confidence: 0.9
  });
});

test("[Agent LLM Decision] Responses API endpoint는 responses payload와 output_text를 사용한다", async () => {
  let capturedPayload: Record<string, unknown> | null = null;
  const transport: AgentLlmDecisionTransport = {
    complete: async (request) => {
      capturedPayload = request.payload;

      return {
        output: [
          {
            type: "message",
            role: "assistant",
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  decision: {
                    kind: "act",
                    actionType: "click",
                    targetKey: "candidate_001",
                    stage: "CTA",
                    reason: "Responses API selected the visible CTA.",
                    confidence: 0.87
                  }
                })
              }
            ]
          }
        ]
      };
    }
  };
  const client = new AgentLlmDecisionClient({
    endpoint: "https://gms.example/v1/responses",
    model: "gpt-5.2-pro",
    timeoutMs: 1_000,
    transport
  });

  const decision = await client.decide({
    runId: "00000000-0000-4000-8000-000000000499",
    goal: "Find checkout",
    startUrl: "https://example.com/product",
    state: {
      ...createInitialAgentState(),
      started: true
    },
    maxScrolls: 1,
    observation: {
      snapshot: createSimulatedPageSnapshot(createMinimalPlan(), {
        finalUrl: "https://example.com/product",
        interactiveComponents: [
          {
            text: "Buy now",
            selector: "#buy",
            role: "button",
            href: null,
            tag: "button",
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

  const payload = requireCapturedPayload(capturedPayload);
  assert.equal(payload.model, "gpt-5.2-pro");
  assert.equal("response_format" in payload, false);
  assert.equal("messages" in payload, false);
  assert.equal("temperature" in payload, false);
  assert.deepEqual(payload.text, { format: { type: "json_object" } });
  assert.ok(Array.isArray(payload.input));
  assert.equal(decision.action.type, "click");
  assert.equal(decision.metadata?.decisionSource, "llm");
  assert.equal(decision.metadata?.model, "gpt-5.2-pro");
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
    runId: "00000000-0000-4000-8000-000000000402",
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
    runId: "00000000-0000-4000-8000-000000000403",
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

test("[Agent LLM Decision] broader checkout fixture에서 LLM 선택은 heuristic 기준선과 일치한다", async () => {
  const heuristic = new HeuristicDecisionClient();
  const fixtures: Array<{
    name: string;
    clickedTargetKeys?: string[];
    expectedText: string;
    expectedTargetKey: string;
    expectedStage: ScenarioStage;
    components: InteractiveComponentObservationItem[];
  }> = [
    {
      name: "product page add-to-cart beats generic CTA",
      expectedText: "Add to cart",
      expectedTargetKey: "#add-to-cart",
      expectedStage: "CTA",
      components: [
        component({ text: "Learn more", selector: "#learn-more", role: "link", href: "https://example.com/product#details", tag: "a" }),
        component({ text: "Add to cart", selector: "#add-to-cart", role: "button", tag: "button", primary: true })
      ]
    },
    {
      name: "cart link follows completed add-to-cart",
      clickedTargetKeys: ["#add-to-cart"],
      expectedText: "View cart",
      expectedTargetKey: "#cart-link",
      expectedStage: "CTA",
      components: [
        component({ text: "Add to cart", selector: "#add-to-cart", role: "button", tag: "button" }),
        component({ text: "View cart", selector: "#cart-link", role: "link", href: "https://example.com/cart", tag: "a", primary: true })
      ]
    },
    {
      name: "checkout link is the terminal checkout-entry candidate",
      clickedTargetKeys: ["#add-to-cart", "#cart-link"],
      expectedText: "Proceed to checkout",
      expectedTargetKey: "#checkout-link",
      expectedStage: "COMMIT",
      components: [
        component({ text: "Continue shopping", selector: "#continue-shopping", role: "link", href: "https://example.com/product", tag: "a" }),
        component({ text: "Proceed to checkout", selector: "#checkout-link", role: "link", href: "https://example.com/checkout", tag: "a", primary: true })
      ]
    }
  ];

  for (const fixture of fixtures) {
    const input = createFixtureDecisionInput(fixture.components, fixture.clickedTargetKeys);
    const llm = new AgentLlmDecisionClient({
      endpoint: "https://llm.example/decision",
      model: "agent-model",
      timeoutMs: 1_000,
      transport: {
        complete: async (request) => ({
          decision: {
            kind: "act",
            actionType: "click",
            targetKey: selectPromptCandidateId(request.payload, fixture.expectedText),
            stage: fixture.expectedStage,
            reason: `Fixture ${fixture.name}`,
            confidence: 0.9
          }
        })
      }
    });

    const heuristicDecision = heuristic.decide(input);
    const llmDecision = await llm.decide(input);

    assert.equal(heuristicDecision.action.type, "click", fixture.name);
    assert.equal(llmDecision.action.type, "click", fixture.name);
    assert.equal(heuristicDecision.targetKey, fixture.expectedTargetKey, fixture.name);
    assert.equal(llmDecision.targetKey, heuristicDecision.targetKey, fixture.name);
    assert.equal(llmDecision.stage, heuristicDecision.stage, fixture.name);
  }
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
    runId: "00000000-0000-4000-8000-000000000406",
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


test("[Agent LLM Decision] 가입/리드 목표에서 의미가 맞지 않는 LLM click은 heuristic으로 검증 fallback한다", async () => {
  let callCount = 0;
  const transport: AgentLlmDecisionTransport = {
    complete: async () => {
      callCount += 1;
      return {
        decision: {
          kind: "act",
          actionType: "click",
          targetKey: "#products",
          stage: "CTA",
          reason: "The product category looks prominent.",
          confidence: 0.9
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
    runId: "00000000-0000-4000-8000-000000000409",
    goal: "SIGNUP_LEAD_FORM_VERIFICATION",
    startUrl: "https://example.com",
    state: {
      ...createInitialAgentState(),
      started: true
    },
    maxScrolls: 0,
    observation: {
      snapshot: createSimulatedPageSnapshot(createMinimalPlan(), {
        interactiveComponents: [
          component({ text: "상품 보기", selector: "#products", role: "link", href: "https://example.com/products", tag: "a", primary: true }),
          component({ text: "회원가입", selector: "#signup", role: "link", href: "https://example.com/signup", tag: "a" })
        ]
      })
    }
  });

  assert.equal(callCount, 1);
  assert.equal(decision.metadata?.decisionSource, "heuristic");
  assert.equal(decision.targetKey, "#signup");
});

test("[Agent LLM Decision] unsafe decision은 재시도하지 않고 heuristic으로 fallback한다", async () => {
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

  const decision = await client.decide({
    runId: "00000000-0000-4000-8000-000000000407",
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

  assert.equal(callCount, 1);
  assert.equal(decision.metadata?.decisionSource, "heuristic");
  assert.equal(decision.action.type, "click");
  assert.equal(decision.targetKey, "#real-checkout");
});

test("[Agent LLM Decision] started 이후 LLM goto는 run 실패 대신 heuristic으로 fallback한다", async () => {
  let callCount = 0;
  const transport: AgentLlmDecisionTransport = {
    complete: async () => {
      callCount += 1;
      return {
        decision: {
          kind: "act",
          actionType: "goto",
          reason: "Navigate again even though the page is already loaded.",
          confidence: 1
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
    runId: "00000000-0000-4000-8000-000000000408",
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

  assert.equal(callCount, 1);
  assert.equal(decision.metadata?.decisionSource, "heuristic");
  assert.equal(decision.action.type, "click");
  assert.equal(decision.targetKey, "#real-checkout");
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
    runId: "00000000-0000-4000-8000-000000000404",
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
    runId: "00000000-0000-4000-8000-000000000405",
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

function createFixtureDecisionInput(
  components: InteractiveComponentObservationItem[],
  clickedTargetKeys: string[] = []
): AgentDecisionInput {
  return {
    runId: "00000000-0000-4000-8000-000000000499",
    goal: "Find the checkout entry path without submitting payment or final order.",
    startUrl: "https://example.com/product",
    state: {
      ...createInitialAgentState(),
      started: true,
      clickedTargetKeys: new Set(clickedTargetKeys)
    },
    maxScrolls: 1,
    observation: {
      snapshot: createSimulatedPageSnapshot(createMinimalPlan(), {
        finalUrl: "https://example.com/product",
        interactiveComponents: components
      })
    }
  };
}

function component(input: {
  text: string;
  selector: string;
  role: string;
  tag: string;
  href?: string;
  primary?: boolean;
}): InteractiveComponentObservationItem {
  return {
    text: input.text,
    selector: input.selector,
    role: input.role,
    href: input.href,
    tag: input.tag,
    clickable: true,
    clicked_in_scenario: false,
    is_cta_candidate: true,
    is_primary_like: input.primary ?? false,
    bounds: {
      x: 0,
      y: 0,
      width: 100,
      height: 40,
      unit: "css_px"
    }
  };
}

function selectPromptCandidateId(payload: Record<string, unknown>, expectedText: string): string {
  const messages = payload.messages;
  assert.ok(Array.isArray(messages));
  const userMessage = messages.find((message) =>
    typeof message === "object" &&
    message !== null &&
    (message as Record<string, unknown>).role === "user"
  ) as { content?: unknown } | undefined;
  if (typeof userMessage?.content !== "string") {
    throw new Error("User prompt message was not captured.");
  }
  const userMessageContent = userMessage.content;

  const parsed = JSON.parse(userMessageContent) as {
    page?: {
      candidates?: Array<{
        targetKey?: string;
        text?: string;
      }>;
    };
  };
  const candidate = parsed.page?.candidates?.find((entry) => entry.text === expectedText);
  if (typeof candidate?.targetKey !== "string") {
    throw new Error(`Prompt candidate was not found for text: ${expectedText}`);
  }
  const targetKey = candidate.targetKey;
  return targetKey;
}
