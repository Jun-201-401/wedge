import assert from "node:assert/strict";
import test from "node:test";
import { decideNextAction } from "../src/agent/planner.ts";
import { createInitialAgentState } from "../src/agent/state.ts";
import type { InteractiveComponentObservationItem } from "../src/shared/contracts.ts";
import { createMinimalPlan, createSimulatedPageSnapshot } from "./support.ts";

test("[Agent Planner] checkout 목표에서는 일반 CTA보다 장바구니 담기를 우선 클릭한다", () => {
  const state = createInitialAgentState();
  state.started = true;

  const decision = decideNextAction({
    goal: "checkout 진입 여부를 확인한다",
    startUrl: "https://example.com/product",
    state,
    maxScrolls: 0,
    observation: {
      snapshot: createSimulatedPageSnapshot(createMinimalPlan(), {
        interactiveComponents: [
          component({
            text: "Learn more",
            selector: "#learn-more",
            is_primary_like: true
          }),
          component({
            text: "장바구니 담기",
            selector: "#add-to-cart",
            is_primary_like: false
          })
        ]
      })
    }
  });

  assert.equal(decision.action.type, "click");
  assert.deepEqual(decision.action.target, {
    selector: "#add-to-cart",
    role: "button",
    text: "장바구니 담기"
  });
  assert.match(decision.replayHint?.candidate_fingerprint ?? "", /^candidate:[a-f0-9]{16}$/);
  assert.deepEqual(decision.replayHint?.locator_recipe[0], {
    strategy: "selector",
    selector: "#add-to-cart",
    confidence: 0.9
  });
  assert.match(decision.reason, /cart/);
});

test("[Agent Planner] checkout 목표에서는 cart 다음 checkout 후보를 순서대로 고른다", () => {
  const state = createInitialAgentState();
  state.started = true;
  state.clickedTargetKeys.add("#add-to-cart");

  const cartDecision = decideNextAction({
    goal: "Find checkout entry",
    startUrl: "https://example.com/product",
    state,
    maxScrolls: 0,
    observation: {
      snapshot: createSimulatedPageSnapshot(createMinimalPlan(), {
        interactiveComponents: [
          component({
            text: "장바구니",
            selector: "#cart"
          }),
          component({
            text: "계속 쇼핑",
            selector: "#continue"
          })
        ]
      })
    }
  });

  assert.deepEqual(cartDecision.action.target, {
    selector: "#cart",
    role: "button",
    text: "장바구니"
  });

  state.clickedTargetKeys.add("#cart");
  const checkoutDecision = decideNextAction({
    goal: "Find checkout entry",
    startUrl: "https://example.com/product",
    state,
    maxScrolls: 0,
    observation: {
      snapshot: createSimulatedPageSnapshot(createMinimalPlan(), {
        interactiveComponents: [
          component({
            text: "Checkout",
            selector: "#checkout"
          }),
          component({
            text: "Remove item",
            selector: "#remove"
          })
        ]
      })
    }
  });

  assert.deepEqual(checkoutDecision.action.target, {
    selector: "#checkout",
    role: "button",
    text: "Checkout"
  });
  assert.equal(checkoutDecision.stage, "COMMIT");
});

function component(overrides: Partial<InteractiveComponentObservationItem>): InteractiveComponentObservationItem {
  return {
    text: "Button",
    selector: "#button",
    role: "button",
    tag: "button",
    clickable: true,
    clicked_in_scenario: false,
    is_cta_candidate: true,
    is_primary_like: false,
    bounds: {
      x: 0,
      y: 0,
      width: 100,
      height: 40,
      unit: "css_px"
    },
    ...overrides
  };
}
