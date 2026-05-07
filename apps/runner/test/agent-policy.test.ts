import assert from "node:assert/strict";
import test from "node:test";
import { evaluateAgentPolicy } from "../src/agent/policy.ts";
import type { AgentDecision } from "../src/agent/planner.ts";
import { createAgentRuntimePlan } from "../src/agent/runtime-plan.ts";
import { cloneAgentMessage, createSimulatedPageSnapshot, loadAgentExampleMessage } from "./support.ts";

test("[Agent Policy] external navigation is blocked unless allowed by AgentTask navigation policy", async () => {
  const message = cloneAgentMessage(await loadAgentExampleMessage());
  const task = message.payload.agentTask;
  const snapshot = createSimulatedPageSnapshot(createAgentRuntimePlan(task), {
    finalUrl: task.start_url
  });

  const result = evaluateAgentPolicy({
    task,
    snapshot,
    decision: createDecision({
      type: "goto",
      target: {
        url: "https://external.example/checkout"
      }
    })
  });

  assert.equal(result.allowed, false);
  assert.equal(result.riskClass, "EXTERNAL_NAVIGATION");
});

test("[Agent Policy] allowed checkout redirect origins permit external navigation", async () => {
  const message = cloneAgentMessage(await loadAgentExampleMessage());
  const task = message.payload.agentTask;
  task.allowed_navigation.allowed_checkout_redirect_origins = ["https://checkout.example"];
  const snapshot = createSimulatedPageSnapshot(createAgentRuntimePlan(task), {
    finalUrl: task.start_url
  });

  const result = evaluateAgentPolicy({
    task,
    snapshot,
    decision: createDecision({
      type: "goto",
      target: {
        url: "https://checkout.example/session"
      }
    })
  });

  assert.equal(result.allowed, true);
  assert.equal(result.riskClass, "EXTERNAL_NAVIGATION");
});

test("[Agent Policy] final payment semantics override allowed external checkout redirects", async () => {
  const message = cloneAgentMessage(await loadAgentExampleMessage());
  const task = message.payload.agentTask;
  task.allowed_navigation.allowed_checkout_redirect_origins = ["https://checkout.example"];
  task.risk_policy.allow_final_payment_submit = false;
  task.risk_policy.allow_final_order_commit = false;
  const snapshot = createSimulatedPageSnapshot(createAgentRuntimePlan(task), {
    finalUrl: task.start_url
  });

  const result = evaluateAgentPolicy({
    task,
    snapshot,
    decision: createDecision({
      type: "click",
      target: {
        text: "Pay now",
        role: "button",
        url: "https://checkout.example/pay"
      }
    })
  });

  assert.equal(result.allowed, false);
  assert.equal(result.riskClass, "PAYMENT_COMMIT");
});

test("[Agent Policy] destructive semantics override allowed external navigation", async () => {
  const message = cloneAgentMessage(await loadAgentExampleMessage());
  const task = message.payload.agentTask;
  task.allowed_navigation.allow_external_navigation = true;
  task.risk_policy.allow_destructive_action = false;
  const snapshot = createSimulatedPageSnapshot(createAgentRuntimePlan(task), {
    finalUrl: task.start_url
  });

  const result = evaluateAgentPolicy({
    task,
    snapshot,
    decision: createDecision({
      type: "click",
      target: {
        text: "Delete account",
        role: "button",
        url: "https://external.example/delete-account"
      }
    })
  });

  assert.equal(result.allowed, false);
  assert.equal(result.riskClass, "DESTRUCTIVE_ACTION");
});

test("[Agent Policy] cart mutation respects allow_cart_mutation", async () => {
  const message = cloneAgentMessage(await loadAgentExampleMessage());
  const task = message.payload.agentTask;
  task.risk_policy.allow_cart_mutation = false;

  const result = evaluateAgentPolicy({
    task,
    snapshot: createSimulatedPageSnapshot(createAgentRuntimePlan(task)),
    decision: createDecision({
      type: "click",
      target: {
        text: "장바구니 담기",
        role: "button"
      }
    })
  });

  assert.equal(result.allowed, false);
  assert.equal(result.riskClass, "CART_MUTATION");
});

test("[Agent Policy] shipping and payment form entry use separate risk flags", async () => {
  const message = cloneAgentMessage(await loadAgentExampleMessage());
  const task = message.payload.agentTask;
  task.risk_policy.allow_shipping_form_entry = false;
  task.risk_policy.allow_payment_info_entry = false;
  const snapshot = createSimulatedPageSnapshot(createAgentRuntimePlan(task));

  const shipping = evaluateAgentPolicy({
    task,
    snapshot,
    decision: createDecision({
      type: "fill",
      target: {
        label: "배송 주소"
      },
      value: "서울시 테스트로 1"
    })
  });

  const payment = evaluateAgentPolicy({
    task,
    snapshot,
    decision: createDecision({
      type: "fill",
      target: {
        label: "카드 번호"
      },
      value: "4242424242424242"
    })
  });

  assert.equal(shipping.allowed, false);
  assert.equal(shipping.riskClass, "SHIPPING_FORM_ENTRY");
  assert.equal(payment.allowed, false);
  assert.equal(payment.riskClass, "PAYMENT_INFO_ENTRY");
});

function createDecision(action: AgentDecision["action"]): AgentDecision {
  return {
    kind: "act",
    description: "test decision",
    reason: "test policy classification",
    confidence: 1,
    action,
    settleStrategy: {
      type: "none",
      timeout_ms: 0
    },
    stage: "CTA",
    targetKey: "test"
  };
}
