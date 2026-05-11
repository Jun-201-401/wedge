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
        selector: "#pay-now",
        href: "https://example.com/checkout?token=secret-token"
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
    max_visible_text_chars: 120
  });

  assert.equal(summary.finalUrl, "https://example.com/cart?email=%5BREDACTED_EMAIL%5D");
  assert.equal(summary.title, "Checkout for [REDACTED_EMAIL]");
  assert.equal(summary.candidateCount, 2);
  assert.equal(summary.candidates?.length, 1);
  assert.match(summary.candidates?.[0]?.candidateFingerprint ?? "", /^candidate:[a-f0-9]{16}$/);
  assert.equal(summary.candidates?.[0]?.candidateId, "candidate_001");
  assert.equal(summary.candidates?.[0]?.riskHint, "PAYMENT_COMMIT");
  assert.equal(summary.candidates?.[0]?.hrefOrigin, "https://example.com");
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
