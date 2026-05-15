import type { AgentOutcomeReasonCode, AgentSafetyBlock } from "../shared/contracts.ts";
import type { AgentPolicyResult } from "./policy.ts";
import type { ScenarioSafetyBlockCode, ScenarioSafetyRiskClass } from "../scenario/policy.ts";
import type { AgentTrace } from "./trace/index.ts";
import type { AgentVerificationOutcome } from "./verifier.ts";

export type AgentSafetyBlockedReasonCode = Extract<
  AgentOutcomeReasonCode,
  | "POLICY_SYNTHETIC_INPUT_BLOCKED"
  | "POLICY_EXTERNAL_NAVIGATION_BLOCKED"
  | "POLICY_PAYMENT_COMMIT_BLOCKED"
  | "POLICY_DESTRUCTIVE_ACTION_BLOCKED"
>;

export type AgentSafetyBlockedOutcome = AgentTrace["outcome"] & {
  status: "POLICY_BLOCKED";
  reason_code: AgentSafetyBlockedReasonCode;
};

export function traceStatusFromVerification(outcome: AgentVerificationOutcome): AgentTrace["outcome"]["status"] {
  switch (outcome) {
    case "SUCCESS":
      return "SUCCESS";
    case "POLICY_BLOCKED":
      return "POLICY_BLOCKED";
    case "BLOCKED_LOGIN":
    case "BLOCKED_CAPTCHA":
      return "BLOCKED";
    case "EXHAUSTED":
      return "EXHAUSTED";
    case "CONTINUE":
      return "RUNNING";
  }
}

export function shouldReportStopped(trace: AgentTrace): boolean {
  return trace.outcome.status === "POLICY_BLOCKED" || trace.outcome.status === "BLOCKED";
}

export function reasonCodeFromVerification(outcome: AgentVerificationOutcome): AgentOutcomeReasonCode {
  switch (outcome) {
    case "SUCCESS":
      return "GOAL_REACHED";
    case "BLOCKED_LOGIN":
      return "LOGIN_REQUIRED";
    case "BLOCKED_CAPTCHA":
      return "CAPTCHA_DETECTED";
    case "POLICY_BLOCKED":
      return "FINAL_COMMIT_VISIBLE";
    case "EXHAUSTED":
      return "FINISH_DECISION";
    case "CONTINUE":
      return "IN_PROGRESS";
  }
}

export function reasonCodeFromPolicy(policy: AgentPolicyResult): AgentOutcomeReasonCode {
  switch (policy.riskClass) {
    case "EXTERNAL_NAVIGATION":
      return "POLICY_EXTERNAL_NAVIGATION_BLOCKED";
    case "CHECKOUT_NAVIGATION":
      return "POLICY_CHECKOUT_NAVIGATION_BLOCKED";
    case "CART_MUTATION":
      return "POLICY_CART_MUTATION_BLOCKED";
    case "SHIPPING_FORM_ENTRY":
      return "POLICY_SHIPPING_FORM_ENTRY_BLOCKED";
    case "PAYMENT_INFO_ENTRY":
      return "POLICY_PAYMENT_INFO_ENTRY_BLOCKED";
    case "PAYMENT_COMMIT":
      return "POLICY_PAYMENT_COMMIT_BLOCKED";
    case "DESTRUCTIVE_ACTION":
      return "POLICY_DESTRUCTIVE_ACTION_BLOCKED";
    case "EXTERNAL_MESSAGE_SEND":
      return "POLICY_EXTERNAL_MESSAGE_BLOCKED";
    case "LOW":
      return "IN_PROGRESS";
  }
}

export function reasonCodeFromScenarioSafetyBlock(
  safetyCode: ScenarioSafetyBlockCode
): AgentSafetyBlockedReasonCode {
  switch (safetyCode) {
    case "SYNTHETIC_INPUT_BLOCKED":
      return "POLICY_SYNTHETIC_INPUT_BLOCKED";
    case "EXTERNAL_NAVIGATION_BLOCKED":
    case "EXTERNAL_VISIT_BLOCKED":
      return "POLICY_EXTERNAL_NAVIGATION_BLOCKED";
    case "PAYMENT_COMMIT_BLOCKED":
      return "POLICY_PAYMENT_COMMIT_BLOCKED";
    case "DESTRUCTIVE_ACTION_BLOCKED":
      return "POLICY_DESTRUCTIVE_ACTION_BLOCKED";
  }
}

export function createSafetyBlockedOutcome(
  safetyCode: ScenarioSafetyBlockCode,
  reason: string
): AgentSafetyBlockedOutcome {
  return {
    status: "POLICY_BLOCKED",
    reason_code: reasonCodeFromScenarioSafetyBlock(safetyCode),
    reason
  };
}

export function createScenarioSafetyBlock(input: {
  safetyCode: ScenarioSafetyBlockCode;
  riskClass: ScenarioSafetyRiskClass;
  reason: string;
  details?: Record<string, unknown>;
}): AgentSafetyBlock {
  return {
    source: "scenario_safety",
    safetyCode: input.safetyCode,
    riskClass: input.riskClass,
    reasonCode: reasonCodeFromScenarioSafetyBlock(input.safetyCode),
    reason: input.reason,
    details: input.details
  };
}

export function createTraceOutcome(
  status: AgentTrace["outcome"]["status"],
  reason: string,
  reasonCode: AgentOutcomeReasonCode
): AgentTrace["outcome"] {
  return {
    status,
    reason_code: reasonCode,
    reason
  };
}
