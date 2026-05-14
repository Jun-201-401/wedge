import assert from "node:assert/strict";
import test from "node:test";
import { createCapturePipeline } from "../src/capture/index.ts";
import { createMinimalPlan, createSettledResult, createSimulatedPageSnapshot } from "./support.ts";

test("[capture] page_ready_timing observation captures route and readiness signals", async () => {
  const plan = createMinimalPlan();
  const step = {
    step_id: "step_001_checkout",
    stage: "COMMIT" as const,
    description: "결제 페이지로 이동",
    action: {
      type: "click" as const,
      target: {
        selector: "#checkout"
      }
    },
    settle_strategy: {
      type: "network_idle" as const,
      timeout_ms: 3_000
    },
    checkpoint: true
  };
  const beforeSnapshot = createSimulatedPageSnapshot(plan, {
    finalUrl: "https://example.com/cart",
    domSignature: "cart"
  });
  const pageSnapshot = createSimulatedPageSnapshot(plan, {
    finalUrl: "https://example.com/checkout",
    title: "Checkout",
    domSignature: "checkout",
    checkoutContext: {
      is_checkout_flow: true,
      flow_subtype: "payment",
      has_order_summary: true,
      has_editable_summary: false,
      has_final_submit: true,
      order_summary_text: ["Total $10"],
      final_submit_text: "Pay now",
      checkout_keywords: ["payment"],
      final_submit_relation: {
        related: true,
        relation_type: "same_form",
        summary_selector: "#summary",
        submit_selector: "#pay"
      }
    }
  });

  const collection = await createCapturePipeline().collectCheckpoint({
    step,
    stepOrder: 1,
    plan,
    beforeSnapshot,
    pageSnapshot,
    actionResult: {
      actionType: "click",
      targetSummary: "selector=#checkout",
      stopRequested: false,
      details: {
        clickedText: "Checkout",
        elementRole: "link"
      }
    },
    settleResult: createSettledResult({
      strategy: "network_idle",
      durationMs: 1_250
    })
  });

  const observation = collection.checkpoint.observations.find((candidate) => candidate.type === "page_ready_timing");

  assert.ok(observation);
  assert.equal(observation.route_changed, true);
  assert.equal(observation.main_content_changed, true);
  assert.equal(observation.same_origin, true);
  assert.equal(observation.duration_ms, 1_250);
  assert.deepEqual(observation.target_page_signals, {
    has_permission_prompt: false,
    has_streaming_response: false,
    has_map: false,
    has_webgl: false,
    has_payment_form: true,
    has_auth_redirect: false
  });
});
