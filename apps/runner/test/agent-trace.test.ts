import assert from "node:assert/strict";
import test from "node:test";
import { createAgentTrace, createAgentTraceArtifact, summarizeObservation } from "../src/agent/trace/index.ts";
import type { InteractiveComponentObservationItem } from "../src/shared/contracts.ts";
import { createMinimalPlan, createSimulatedPageSnapshot, loadAgentExampleMessage } from "./support.ts";

test("[Agent Trace] AgentTask attempt_index를 trace와 TRACE artifact에 보존한다", async () => {
  const message = await loadAgentExampleMessage();
  const task = message.payload.agentTask;
  task.attempt_index = 7;

  const trace = createAgentTrace(task);
  const artifact = createAgentTraceArtifact(trace);

  assert.equal(trace.attempt_id, task.attempt_id);
  assert.equal(trace.attempt_index, 7);
  assert.match(artifact.content, /"attempt_index": 7/);
});

test("[Agent Trace] observation summary는 후보/텍스트/위험 신호를 bounded metadata로 남긴다", () => {
  const snapshot = createSimulatedPageSnapshot(createMinimalPlan(), {
    finalUrl: "https://example.com/cart?email=user@example.com",
    title: "Checkout for user@example.com",
    breadcrumb: ["Home", "Cart"],
    toastTexts: ["Added to cart"],
    visiblePrices: ["₩10,000"],
    fields: {
      email: "user@example.com"
    },
    selectedOptions: {
      size: "M"
    },
    consoleErrors: ["minor error"],
    networkErrors: ["api failed"],
    cartCount: 1,
    interactiveComponents: [
      component({
        text: "결제하기",
        visible_text: "결제하기",
        accessible_name: "최종 결제하기",
        selector: "#pay-now",
        href: "https://example.com/checkout?token=secret-token",
        container_role: "form",
        container_bounds: {
          x: 0,
          y: 0,
          width: 320,
          height: 240,
          unit: "css_px"
        },
        container_heading: "결제 정보",
        nearby_text: ["결제 정보", "user@example.com 주문 요약"],
        nearest_target_spacing_px: 8,
        visibility: {
          visible: true,
          in_viewport: true,
          above_fold: true,
          area_px: 4800,
          viewport_coverage_ratio: 1
        },
        layout: {
          center_x: 60,
          center_y: 20,
          viewport_position: "inside",
          css_position: "fixed",
          z_index: "10",
          is_fixed: true,
          is_sticky: false,
          overlay_candidate: false
        }
      }),
      component({
        text: "Continue shopping",
        selector: "#continue",
        is_cta_candidate: false
      })
    ]
  });

  const summary = summarizeObservation(snapshot, {
    max_candidates: 1,
    max_visible_text_chars: 120,
    max_nearby_text_chars_per_candidate: 24
  });

  assert.equal(summary.finalUrl, "https://example.com/cart?email=%5BREDACTED_EMAIL%5D");
  assert.equal(summary.title, "Checkout for [REDACTED_EMAIL]");
  assert.equal(summary.candidateCount, 2);
  assert.equal(summary.candidates?.length, 1);
  assert.match(summary.candidates?.[0]?.candidateFingerprint ?? "", /^candidate:[a-f0-9]{16}$/);
  assert.equal(summary.candidates?.[0]?.candidateId, "candidate_001");
  assert.equal(summary.candidates?.[0]?.riskHint, "PAYMENT_COMMIT");
  assert.equal(summary.candidates?.[0]?.hrefOrigin, "https://example.com");
  assert.equal(summary.candidates?.[0]?.visibleText, "결제하기");
  assert.equal(summary.candidates?.[0]?.accessibleName, "최종 결제하기");
  assert.equal(summary.candidates?.[0]?.containerRole, "form");
  assert.equal(summary.candidates?.[0]?.containerHeading, "결제 정보");
  assert.deepEqual(summary.candidates?.[0]?.containerBounds, {
    x: 0,
    y: 0,
    width: 320,
    height: 240,
    unit: "css_px"
  });
  assert.equal(summary.candidates?.[0]?.nearestTargetSpacingPx, 8);
  assert.deepEqual(summary.candidates?.[0]?.nearbyText, ["결제 정보", "[REDACTED_EMAIL] 주문"]);
  assert.equal(summary.candidates?.[0]?.visibility?.above_fold, true);
  assert.equal(summary.candidates?.[0]?.layout?.viewport_position, "inside");
  assert.equal(summary.formControls?.length, 2);
  assert.deepEqual(summary.formControls?.map((control) => control.controlType), ["field", "select"]);
  assert.equal(summary.pageSignals?.consoleErrorCount, 1);
  assert.equal(summary.pageSignals?.networkErrorCount, 1);
  assert.equal(summary.pageSignals?.cartCount, 1);
  assert.equal(summary.pageSignals?.hasPaymentOrCommitSignal, true);
  assert.ok(summary.visibleTextSample?.some((sample) => sample.includes("[REDACTED_EMAIL]")));
});

function component(overrides: Partial<InteractiveComponentObservationItem> = {}): InteractiveComponentObservationItem {
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
      width: 120,
      height: 40,
      unit: "css_px"
    },
    ...overrides
  };
}
