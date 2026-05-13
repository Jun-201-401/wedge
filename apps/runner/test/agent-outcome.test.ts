import assert from "node:assert/strict";
import test from "node:test";
import { reasonCodeFromPolicy, reasonCodeFromVerification } from "../src/agent/outcome.ts";
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
