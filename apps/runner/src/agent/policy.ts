import type {
  AgentFinalOutcome,
  AgentRiskClass,
  AgentTask,
  ScenarioAction
} from "../shared/contracts.ts";
import { describeTarget } from "../shared/utils.ts";
import type { AgentDecision } from "./planner.ts";

export interface AgentPolicyEvaluationInput {
  task: AgentTask;
  currentUrl: string;
  decision: AgentDecision;
}

export interface AgentPolicyEvaluation {
  riskClass: AgentRiskClass;
  decision: "ALLOW" | "BLOCK";
  reason: string;
  matchedSignals: string[];
  finalOutcome: AgentFinalOutcome | null;
}

export function evaluateAgentPolicy(input: AgentPolicyEvaluationInput): AgentPolicyEvaluation {
  const risk = classifyAgentRisk(input);
  const blockOutcome = blockedOutcomeForRisk(input.task, risk.riskClass);

  if (blockOutcome) {
    return {
      riskClass: risk.riskClass,
      decision: "BLOCK",
      reason: blockReason(risk.riskClass),
      matchedSignals: risk.matchedSignals,
      finalOutcome: blockOutcome
    };
  }

  return {
    riskClass: risk.riskClass,
    decision: "ALLOW",
    reason: allowReason(risk.riskClass),
    matchedSignals: risk.matchedSignals,
    finalOutcome: null
  };
}

function classifyAgentRisk(input: AgentPolicyEvaluationInput): {
  riskClass: AgentRiskClass;
  matchedSignals: string[];
} {
  const action = input.decision.action;
  const text = actionText(action, input.decision).toLowerCase();
  const matchedSignals: string[] = [];

  const navigationUrl = actionNavigationUrl(action);
  if (navigationUrl && isExternalNavigation(input.task, input.currentUrl, navigationUrl)) {
    matchedSignals.push(`external_navigation:${readOrigin(input.currentUrl)}->${readOrigin(navigationUrl)}`);
    return { riskClass: "UNKNOWN_HIGH_RISK", matchedSignals };
  }

  if (action.type === "goto") {
    matchedSignals.push("tool:goto");
    return { riskClass: "SAFE_NAVIGATION", matchedSignals };
  }

  if (containsAny(text, FINAL_PAYMENT_SIGNALS)) {
    matchedSignals.push(...matchingKeywords(text, FINAL_PAYMENT_SIGNALS));
    return { riskClass: "FINAL_PAYMENT_SUBMIT", matchedSignals };
  }

  if (containsAny(text, FINAL_ORDER_SIGNALS)) {
    matchedSignals.push(...matchingKeywords(text, FINAL_ORDER_SIGNALS));
    return { riskClass: "FINAL_ORDER_COMMIT", matchedSignals };
  }

  if (containsAny(text, DESTRUCTIVE_SIGNALS)) {
    matchedSignals.push(...matchingKeywords(text, DESTRUCTIVE_SIGNALS));
    return { riskClass: "DESTRUCTIVE_ACCOUNT_ACTION", matchedSignals };
  }

  if (containsAny(text, CART_REMOVE_SIGNALS)) {
    matchedSignals.push(...matchingKeywords(text, CART_REMOVE_SIGNALS));
    return { riskClass: "CART_REMOVE_ITEM", matchedSignals };
  }

  if (containsAny(text, CART_ADD_SIGNALS)) {
    matchedSignals.push(...matchingKeywords(text, CART_ADD_SIGNALS));
    return { riskClass: "CART_ADD_ITEM", matchedSignals };
  }

  if (action.type === "fill" || action.type === "select") {
    if (containsAny(text, PAYMENT_INFO_SIGNALS)) {
      matchedSignals.push(...matchingKeywords(text, PAYMENT_INFO_SIGNALS));
      return { riskClass: "PAYMENT_INFO_ENTRY", matchedSignals };
    }
    if (containsAny(text, SHIPPING_SIGNALS)) {
      matchedSignals.push(...matchingKeywords(text, SHIPPING_SIGNALS));
      return { riskClass: "SHIPPING_FORM_ENTRY", matchedSignals };
    }
    matchedSignals.push(`tool:${action.type}`);
    return { riskClass: "NON_PAYMENT_FORM_ENTRY", matchedSignals };
  }

  if (containsAny(text, CHECKOUT_NAVIGATION_SIGNALS)) {
    matchedSignals.push(...matchingKeywords(text, CHECKOUT_NAVIGATION_SIGNALS));
    return { riskClass: "CHECKOUT_NAVIGATION", matchedSignals };
  }

  matchedSignals.push(`tool:${action.type}`);
  return { riskClass: action.type === "click" ? "UNKNOWN_LOW_RISK" : "SAFE_NAVIGATION", matchedSignals };
}

function blockedOutcomeForRisk(task: AgentTask, riskClass: AgentRiskClass): AgentFinalOutcome | null {
  switch (riskClass) {
    case "FINAL_PAYMENT_SUBMIT":
      return task.risk_policy.allow_final_payment_submit ? null : "POLICY_BLOCKED_FINAL_PAYMENT_SUBMIT";
    case "FINAL_ORDER_COMMIT":
      return task.risk_policy.allow_final_order_commit ? null : "POLICY_BLOCKED_FINAL_ORDER_COMMIT";
    case "DESTRUCTIVE_ACCOUNT_ACTION":
      return task.risk_policy.allow_destructive_action ? null : "POLICY_BLOCKED_DESTRUCTIVE_ACTION";
    case "UNKNOWN_HIGH_RISK":
      return task.allowed_navigation.allow_external_navigation ? null : "POLICY_BLOCKED_EXTERNAL_NAVIGATION";
    case "PAYMENT_INFO_ENTRY":
      return task.risk_policy.allow_payment_info_entry ? null : "BLOCKED_TEST_DATA_REQUIRED";
    case "SHIPPING_FORM_ENTRY":
      return task.risk_policy.allow_shipping_form_entry && task.test_data?.shipping_address
        ? null
        : "BLOCKED_TEST_DATA_REQUIRED";
    case "CART_ADD_ITEM":
      return task.risk_policy.allow_cart_mutation ? null : "POLICY_BLOCKED_DESTRUCTIVE_ACTION";
    case "CART_REMOVE_ITEM":
    case "CART_QUANTITY_INCREASE":
    case "CART_QUANTITY_DECREASE":
      return task.risk_policy.allow_destructive_action ? null : "POLICY_BLOCKED_DESTRUCTIVE_ACTION";
    case "CHECKOUT_NAVIGATION":
      return task.risk_policy.allow_checkout_navigation ? null : "POLICY_BLOCKED_EXTERNAL_NAVIGATION";
    default:
      return null;
  }
}

function actionText(action: ScenarioAction, decision: AgentDecision): string {
  return [
    action.type,
    describeTarget(action.target),
    typeof action.value === "string" ? action.value : null,
    decision.description,
    decision.reason,
    decision.stage,
    decision.targetKey
  ]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(" ");
}

function actionNavigationUrl(action: ScenarioAction): string | null {
  if (action.type !== "goto") {
    return null;
  }
  if (typeof action.target === "object" && action.target !== null && typeof action.target.url === "string") {
    return action.target.url;
  }
  return typeof action.target === "string" ? action.target : null;
}

function isExternalNavigation(task: AgentTask, currentUrl: string, nextUrl: string): boolean {
  if (task.allowed_navigation.allow_external_navigation) {
    return false;
  }

  const nextOrigin = readOrigin(nextUrl);
  const currentOrigin = readOrigin(currentUrl || task.start_url);
  const startOrigin = readOrigin(task.start_url);
  const allowedOrigins = [
    startOrigin,
    currentOrigin,
    ...(task.allowed_navigation.allowed_origins ?? []).map(readOrigin),
    ...(task.allowed_navigation.allowed_checkout_redirect_origins ?? []).map(readOrigin)
  ].filter((origin): origin is string => origin !== null);

  return nextOrigin !== null && !allowedOrigins.includes(nextOrigin);
}

function readOrigin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function allowReason(riskClass: AgentRiskClass): string {
  return `Agent policy allowed ${riskClass}.`;
}

function blockReason(riskClass: AgentRiskClass): string {
  return `Agent policy blocked ${riskClass}.`;
}

function containsAny(value: string, keywords: string[]): boolean {
  return keywords.some((keyword) => value.includes(keyword));
}

function matchingKeywords(value: string, keywords: string[]): string[] {
  return keywords.filter((keyword) => value.includes(keyword)).map((keyword) => `keyword:${keyword}`);
}

const CHECKOUT_NAVIGATION_SIGNALS = [
  "checkout",
  "cart",
  "order",
  "payment",
  "장바구니",
  "주문",
  "결제",
  "구매"
];

const CART_ADD_SIGNALS = [
  "add to cart",
  "add cart",
  "담기",
  "장바구니 담기"
];

const CART_REMOVE_SIGNALS = [
  "remove item",
  "remove from cart",
  "delete item",
  "삭제",
  "제거"
];

const PAYMENT_INFO_SIGNALS = [
  "card number",
  "credit card",
  "cvc",
  "cvv",
  "expiry",
  "카드번호",
  "신용카드",
  "유효기간"
];

const SHIPPING_SIGNALS = [
  "shipping",
  "address",
  "postal",
  "배송",
  "주소",
  "우편번호"
];

const FINAL_PAYMENT_SIGNALS = [
  "pay now",
  "submit payment",
  "complete payment",
  "confirm payment",
  "final payment",
  "결제 완료",
  "최종 결제",
  "결제 확정"
];

const FINAL_ORDER_SIGNALS = [
  "place order",
  "submit order",
  "complete order",
  "confirm order",
  "confirm purchase",
  "주문 완료",
  "주문 확정",
  "구매 확정"
];

const DESTRUCTIVE_SIGNALS = [
  "delete account",
  "cancel account",
  "remove account",
  "destroy",
  "회원 탈퇴",
  "계정 삭제",
  "삭제하기"
];
