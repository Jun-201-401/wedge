import type { BrowserPageSnapshot } from "../browser/playwright/index.ts";
import type { AgentTask } from "../shared/contracts.ts";
import type { AgentDecision } from "./planner.ts";

export interface AgentPolicyResult {
  allowed: boolean;
  reason: string;
  riskClass: "LOW" | "PAYMENT_COMMIT" | "DESTRUCTIVE_ACTION";
}

const FINAL_PAYMENT_PATTERN = /pay now|place order|complete order|submit order|결제하기|주문하기|구매하기|최종 결제/i;
const DESTRUCTIVE_PATTERN = /delete|remove account|cancel subscription|탈퇴|삭제|구독 취소/i;

export function evaluateAgentPolicy(input: {
  task: AgentTask;
  decision: AgentDecision;
  snapshot: BrowserPageSnapshot;
}): AgentPolicyResult {
  const targetText = describeDecisionTarget(input.decision);

  if (input.decision.action.type === "click" && FINAL_PAYMENT_PATTERN.test(targetText)) {
    const allowed = input.task.risk_policy.allow_final_payment_submit || input.task.risk_policy.allow_final_order_commit;
    return {
      allowed,
      riskClass: "PAYMENT_COMMIT",
      reason: allowed
        ? "AgentTask risk policy permits final payment/order commit actions."
        : "AgentTask risk policy blocks final payment/order commit actions."
    };
  }

  if (input.decision.action.type === "click" && DESTRUCTIVE_PATTERN.test(targetText)) {
    return {
      allowed: input.task.risk_policy.allow_destructive_action,
      riskClass: "DESTRUCTIVE_ACTION",
      reason: input.task.risk_policy.allow_destructive_action
        ? "AgentTask risk policy permits destructive actions."
        : "AgentTask risk policy blocks destructive actions."
    };
  }

  return {
    allowed: true,
    riskClass: "LOW",
    reason: `No high-risk agent policy rule matched for ${input.snapshot.finalUrl}.`
  };
}

function describeDecisionTarget(decision: AgentDecision): string {
  const target = decision.action.target;

  if (!target || typeof target !== "object") {
    return "";
  }

  return [
    "text" in target ? target.text : null,
    "role" in target ? target.role : null,
    "label" in target ? target.label : null,
    "selector" in target ? target.selector : null
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
}
