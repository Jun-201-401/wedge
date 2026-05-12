import type { BrowserPageSnapshot } from "../browser/playwright/index.ts";
import type { AgentTask } from "../shared/contracts.ts";
import type { AgentDecision } from "./planner.ts";
import { policySemantics } from "./semantics.ts";

export interface AgentPolicyResult {
  allowed: boolean;
  reason: string;
  riskClass:
    | "LOW"
    | "EXTERNAL_NAVIGATION"
    | "CHECKOUT_NAVIGATION"
    | "CART_MUTATION"
    | "SHIPPING_FORM_ENTRY"
    | "PAYMENT_INFO_ENTRY"
    | "PAYMENT_COMMIT"
    | "DESTRUCTIVE_ACTION"
    | "EXTERNAL_MESSAGE_SEND";
}


export function evaluateAgentPolicy(input: {
  task: AgentTask;
  decision: AgentDecision;
  snapshot: BrowserPageSnapshot;
}): AgentPolicyResult {
  const targetText = describeDecisionTarget(input.decision);

  if (input.decision.action.type === "click" && policySemantics.finalCommit.test(targetText)) {
    const allowed = input.task.risk_policy.allow_final_payment_submit || input.task.risk_policy.allow_final_order_commit;
    return {
      allowed,
      riskClass: "PAYMENT_COMMIT",
      reason: allowed
        ? "AgentTask risk policy permits final payment/order commit actions."
        : "AgentTask risk policy blocks final payment/order commit actions."
    };
  }

  if (input.decision.action.type === "fill" || input.decision.action.type === "select") {
    if (policySemantics.paymentInfo.test(targetText)) {
      return {
        allowed: input.task.risk_policy.allow_payment_info_entry,
        riskClass: "PAYMENT_INFO_ENTRY",
        reason: input.task.risk_policy.allow_payment_info_entry
          ? "AgentTask risk policy permits payment information entry."
          : "AgentTask risk policy blocks payment information entry."
      };
    }

    if (policySemantics.shippingForm.test(targetText)) {
      return {
        allowed: input.task.risk_policy.allow_shipping_form_entry,
        riskClass: "SHIPPING_FORM_ENTRY",
        reason: input.task.risk_policy.allow_shipping_form_entry
          ? "AgentTask risk policy permits shipping/contact form entry."
          : "AgentTask risk policy blocks shipping/contact form entry."
      };
    }
  }

  if (input.decision.action.type === "click" && policySemantics.destructive.test(targetText)) {
    return {
      allowed: input.task.risk_policy.allow_destructive_action,
      riskClass: "DESTRUCTIVE_ACTION",
      reason: input.task.risk_policy.allow_destructive_action
        ? "AgentTask risk policy permits destructive actions."
        : "AgentTask risk policy blocks destructive actions."
    };
  }

  if (input.decision.action.type === "click" && policySemantics.externalMessage.test(targetText)) {
    return {
      allowed: input.task.risk_policy.allow_external_message_send,
      riskClass: "EXTERNAL_MESSAGE_SEND",
      reason: input.task.risk_policy.allow_external_message_send
        ? "AgentTask risk policy permits external message sending."
        : "AgentTask risk policy blocks external message sending."
    };
  }

  const navigationPolicy = evaluateNavigationPolicy(input.task, input.decision, input.snapshot);
  if (navigationPolicy) {
    return navigationPolicy;
  }

  if (input.decision.action.type === "click" && policySemantics.cartMutation.test(targetText)) {
    return {
      allowed: input.task.risk_policy.allow_cart_mutation,
      riskClass: "CART_MUTATION",
      reason: input.task.risk_policy.allow_cart_mutation
        ? "AgentTask risk policy permits cart mutation actions."
        : "AgentTask risk policy blocks cart mutation actions."
    };
  }

  if (input.decision.action.type === "click" && policySemantics.checkoutNavigation.test(targetText)) {
    return {
      allowed: input.task.risk_policy.allow_checkout_navigation,
      riskClass: "CHECKOUT_NAVIGATION",
      reason: input.task.risk_policy.allow_checkout_navigation
        ? "AgentTask risk policy permits checkout navigation."
        : "AgentTask risk policy blocks checkout navigation."
    };
  }

  return {
    allowed: true,
    riskClass: "LOW",
    reason: `No high-risk agent policy rule matched for ${input.snapshot.finalUrl}.`
  };
}

function evaluateNavigationPolicy(
  task: AgentTask,
  decision: AgentDecision,
  snapshot: BrowserPageSnapshot
): AgentPolicyResult | null {
  const nextUrl = resolveDecisionNavigationUrl(decision, snapshot.finalUrl);
  if (!nextUrl) {
    return null;
  }

  const currentOrigin = resolveOrigin(snapshot.finalUrl);
  const nextOrigin = resolveOrigin(nextUrl);
  if (!currentOrigin || !nextOrigin || currentOrigin === nextOrigin) {
    return null;
  }

  const allowedOrigins = new Set([
    ...task.allowed_navigation.allowed_origins ?? [],
    ...task.allowed_navigation.allowed_checkout_redirect_origins ?? []
  ].map((origin) => normalizeOrigin(origin)).filter((origin): origin is string => origin !== null));

  const allowed = task.allowed_navigation.allow_external_navigation || allowedOrigins.has(nextOrigin);
  return {
    allowed,
    riskClass: "EXTERNAL_NAVIGATION",
    reason: allowed
      ? `AgentTask navigation policy permits external navigation to ${nextOrigin}.`
      : `AgentTask navigation policy blocks external navigation from ${currentOrigin} to ${nextOrigin}.`
  };
}

function resolveDecisionNavigationUrl(decision: AgentDecision, baseUrl: string): string | null {
  if (decision.action.type !== "goto" && decision.action.type !== "click") {
    return null;
  }

  const target = decision.action.target;
  if (!target || typeof target !== "object" || !("url" in target) || typeof target.url !== "string") {
    return null;
  }

  try {
    return new URL(target.url, baseUrl).href;
  } catch {
    return null;
  }
}

function resolveOrigin(url: string): string | null {
  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return null;
    }
    return parsedUrl.origin === "null" ? null : parsedUrl.origin;
  } catch {
    return null;
  }
}

function normalizeOrigin(value: string): string | null {
  try {
    const parsedUrl = new URL(value);
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return null;
    }
    return parsedUrl.origin === "null" ? null : parsedUrl.origin;
  } catch {
    return null;
  }
}

function describeDecisionTarget(decision: AgentDecision): string {
  const target = decision.action.target;

  if (typeof target === "string") {
    return target;
  }

  if (!target || typeof target !== "object") {
    return "";
  }

  return [
    "text" in target ? target.text : null,
    "role" in target ? target.role : null,
    "label" in target ? target.label : null,
    "placeholder" in target ? target.placeholder : null,
    "name" in target ? target.name : null,
    "href_contains" in target ? target.href_contains : null,
    "url" in target ? target.url : null,
    "selector" in target ? target.selector : null
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
}
