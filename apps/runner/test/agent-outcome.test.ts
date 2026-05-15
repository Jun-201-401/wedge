import assert from "node:assert/strict";
import test from "node:test";
import {
  createScenarioSafetyBlock,
  createSafetyBlockedOutcome,
  reasonCodeFromPolicy,
  reasonCodeFromScenarioSafetyBlock,
  reasonCodeFromVerification
} from "../src/agent/outcome.ts";
import type { AgentPolicyResult } from "../src/agent/policy.ts";

test("[Agent Outcome] blocker verification outcomes map to stable reason codes", () => {
  assert.equal(reasonCodeFromVerification("BLOCKED_LOGIN"), "LOGIN_REQUIRED");
  assert.equal(reasonCodeFromVerification("BLOCKED_CAPTCHA"), "CAPTCHA_DETECTED");
  assert.equal(reasonCodeFromVerification("POLICY_BLOCKED"), "FINAL_COMMIT_VISIBLE");
  assert.equal(reasonCodeFromVerification("SUCCESS"), "GOAL_REACHED");
});

test("[Agent Outcome] policy risk classes map to stable blocked reason codes", () => {
  const cases: Array<[AgentPolicyResult["riskClass"], string]> = [
    ["EXTERNAL_NAVIGATION", "POLICY_EXTERNAL_NAVIGATION_BLOCKED"],
    ["CHECKOUT_NAVIGATION", "POLICY_CHECKOUT_NAVIGATION_BLOCKED"],
    ["CART_MUTATION", "POLICY_CART_MUTATION_BLOCKED"],
    ["SHIPPING_FORM_ENTRY", "POLICY_SHIPPING_FORM_ENTRY_BLOCKED"],
    ["PAYMENT_INFO_ENTRY", "POLICY_PAYMENT_INFO_ENTRY_BLOCKED"],
    ["PAYMENT_COMMIT", "POLICY_PAYMENT_COMMIT_BLOCKED"],
    ["DESTRUCTIVE_ACTION", "POLICY_DESTRUCTIVE_ACTION_BLOCKED"],
    ["EXTERNAL_MESSAGE_SEND", "POLICY_EXTERNAL_MESSAGE_BLOCKED"]
  ];

  for (const [riskClass, reasonCode] of cases) {
    assert.equal(reasonCodeFromPolicy({ allowed: false, riskClass, reason: "blocked" }), reasonCode);
  }
});

test("[Agent Outcome] scenario safety block codes map to policy-blocked reason codes", () => {
  assert.equal(reasonCodeFromScenarioSafetyBlock("SYNTHETIC_INPUT_BLOCKED"), "POLICY_SYNTHETIC_INPUT_BLOCKED");
  assert.equal(reasonCodeFromScenarioSafetyBlock("EXTERNAL_NAVIGATION_BLOCKED"), "POLICY_EXTERNAL_NAVIGATION_BLOCKED");
  assert.equal(reasonCodeFromScenarioSafetyBlock("EXTERNAL_VISIT_BLOCKED"), "POLICY_EXTERNAL_NAVIGATION_BLOCKED");
  assert.equal(reasonCodeFromScenarioSafetyBlock("PAYMENT_COMMIT_BLOCKED"), "POLICY_PAYMENT_COMMIT_BLOCKED");
  assert.equal(reasonCodeFromScenarioSafetyBlock("DESTRUCTIVE_ACTION_BLOCKED"), "POLICY_DESTRUCTIVE_ACTION_BLOCKED");
});

test("[Agent Outcome] scenario safety block creates a policy-blocked trace outcome", () => {
  const outcome = createSafetyBlockedOutcome(
    "SYNTHETIC_INPUT_BLOCKED",
    "Scenario safety forbids synthetic fill actions when use_synthetic_inputs=false"
  );

  assert.equal(outcome.status, "POLICY_BLOCKED");
  assert.equal(outcome.reason_code, "POLICY_SYNTHETIC_INPUT_BLOCKED");
  assert.match(outcome.reason, /use_synthetic_inputs=false/);
});

test("[Agent Outcome] scenario safety block trace payload keeps stable source and reason code", () => {
  const safetyBlock = createScenarioSafetyBlock({
    safetyCode: "PAYMENT_COMMIT_BLOCKED",
    riskClass: "PAYMENT_COMMIT",
    reason: "Scenario safety forbids payment-commit click targets",
    details: {
      actionType: "click"
    }
  });

  assert.equal(safetyBlock.source, "scenario_safety");
  assert.equal(safetyBlock.safetyCode, "PAYMENT_COMMIT_BLOCKED");
  assert.equal(safetyBlock.riskClass, "PAYMENT_COMMIT");
  assert.equal(safetyBlock.reasonCode, "POLICY_PAYMENT_COMMIT_BLOCKED");
  assert.deepEqual(safetyBlock.details, {
    actionType: "click"
  });
});
