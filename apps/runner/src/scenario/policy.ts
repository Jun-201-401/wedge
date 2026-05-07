import type { ScenarioAction, ScenarioPlan } from "../shared/contracts.ts";
import { describeTarget } from "../shared/utils.ts";

export class RunnerExecutionPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunnerExecutionPolicyError";
  }
}

export function assertScenarioActionAllowed(
  plan: ScenarioPlan,
  currentUrl: string,
  action: ScenarioAction,
  resolvedNavigationUrl?: string | null
): void {
  if ((action.type === "fill" || action.type === "select") && !plan.safety.use_synthetic_inputs) {
    throw new RunnerExecutionPolicyError(
      `Scenario safety forbids synthetic ${action.type} actions when use_synthetic_inputs=false`
    );
  }

  const targetSummary = describeTarget(action.target)?.toLowerCase() ?? "";

  if (action.type === "click") {
    if (looksLikePaymentTarget(targetSummary) && (plan.safety.stop_before_real_payment || !plan.safety.allow_payment_commit)) {
      throw new RunnerExecutionPolicyError("Scenario safety forbids payment-commit click targets");
    }

    if (looksLikeDestructiveTarget(targetSummary) && !plan.safety.allow_destructive_action) {
      throw new RunnerExecutionPolicyError("Scenario safety forbids destructive click targets");
    }
  }

  const nextUrl =
    action.type === "goto"
      ? resolvedNavigationUrl ?? currentUrl
      : action.type === "click"
        ? resolvedNavigationUrl
        : null;

  if (nextUrl) {
    assertNavigationAllowed(plan, currentUrl, nextUrl);
  }
}

export function assertNavigationAllowed(plan: ScenarioPlan, currentUrl: string, nextUrl: string): void {
  if (plan.safety.allow_external_navigation) {
    return;
  }

  const currentOrigin = resolveOrigin(currentUrl, plan.start_url);
  const nextOrigin = resolveOrigin(nextUrl, currentUrl);

  if (currentOrigin && nextOrigin && currentOrigin !== nextOrigin) {
    const allowedExternalOrigins = new Set((plan.safety.allowed_external_origins ?? [])
      .map((origin) => resolveOrigin(origin, plan.start_url))
      .filter((origin): origin is string => origin !== null));
    if (allowedExternalOrigins.has(nextOrigin)) {
      return;
    }

    throw new RunnerExecutionPolicyError(
      `Scenario safety forbids external navigation from ${currentOrigin} to ${nextOrigin}`
    );
  }
}

export function assertVisitedUrlAllowed(plan: ScenarioPlan, currentUrl: string): void {
  if (plan.safety.allow_external_navigation) {
    return;
  }

  const allowedOrigin = resolveOrigin(plan.start_url, plan.start_url);
  const currentOrigin = resolveOrigin(currentUrl, plan.start_url);

  if (allowedOrigin && currentOrigin && allowedOrigin !== currentOrigin) {
    const allowedExternalOrigins = new Set((plan.safety.allowed_external_origins ?? [])
      .map((origin) => resolveOrigin(origin, plan.start_url))
      .filter((origin): origin is string => origin !== null));
    if (allowedExternalOrigins.has(currentOrigin)) {
      return;
    }

    throw new RunnerExecutionPolicyError(
      `Scenario safety forbids visiting external origin ${currentOrigin} from start origin ${allowedOrigin}`
    );
  }
}

function resolveOrigin(candidateUrl: string, baseUrl: string): string | null {
  try {
    return new URL(candidateUrl, baseUrl).origin;
  } catch {
    return null;
  }
}

function looksLikePaymentTarget(targetSummary: string): boolean {
  return containsAny(targetSummary, ["pay", "purchase", "buy", "order", "결제", "구매", "주문"]);
}

function looksLikeDestructiveTarget(targetSummary: string): boolean {
  return containsAny(targetSummary, ["delete", "remove", "destroy", "삭제", "탈퇴", "회원 탈퇴"]);
}

function containsAny(value: string, keywords: string[]): boolean {
  return keywords.some((keyword) => value.includes(keyword));
}
