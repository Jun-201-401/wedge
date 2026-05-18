import type { ScenarioAction, ScenarioPlan } from "../shared/contracts.ts";
import { describeTarget } from "../shared/utils.ts";

export type ScenarioSafetyBlockCode =
  | "SYNTHETIC_INPUT_BLOCKED"
  | "PAYMENT_COMMIT_BLOCKED"
  | "DESTRUCTIVE_ACTION_BLOCKED"
  | "EXTERNAL_NAVIGATION_BLOCKED"
  | "EXTERNAL_VISIT_BLOCKED";

export type ScenarioSafetyRiskClass =
  | "SYNTHETIC_INPUT"
  | "PAYMENT_COMMIT"
  | "DESTRUCTIVE_ACTION"
  | "EXTERNAL_NAVIGATION";

export type ScenarioSafetyReasonCode =
  | "POLICY_SYNTHETIC_INPUT_BLOCKED"
  | "POLICY_EXTERNAL_NAVIGATION_BLOCKED"
  | "POLICY_PAYMENT_COMMIT_BLOCKED"
  | "POLICY_DESTRUCTIVE_ACTION_BLOCKED";

export type ScenarioSafetyRecoveryBlockReason =
  | "RECOVERABLE_EXTERNAL_NAVIGATION"
  | "NON_RECOVERABLE_SAFETY_BLOCK"
  | "STEP_RECOVERY_LIMIT_REACHED"
  | "RUN_RECOVERY_LIMIT_REACHED"
  | "DUPLICATE_SAFETY_BLOCK";

export type ScenarioSafetyRecoveryStrategy = "RETURN_TO_SAFE_ANCHOR";

export interface ScenarioSafetyRecoveryLimits {
  maxAttemptsPerStep: number;
  maxAttemptsPerRun: number;
}

export interface ScenarioSafetyRecoveryState {
  totalAttempts: number;
  attemptsByStepKey: Record<string, number>;
  blockedFingerprints: string[];
}

export interface ScenarioSafetyRecoveryDecisionInput {
  safetyCode: ScenarioSafetyBlockCode;
  stepKey: string;
  details?: Record<string, unknown>;
  state: ScenarioSafetyRecoveryState;
  limits?: Partial<ScenarioSafetyRecoveryLimits>;
}

export type ScenarioSafetyRecoveryDecision =
  | {
      recoverable: true;
      strategy: ScenarioSafetyRecoveryStrategy;
      reason: "RECOVERABLE_EXTERNAL_NAVIGATION";
      fingerprint: string;
      limits: ScenarioSafetyRecoveryLimits;
    }
  | {
      recoverable: false;
      reason: Exclude<ScenarioSafetyRecoveryBlockReason, "RECOVERABLE_EXTERNAL_NAVIGATION">;
      fingerprint: string;
      limits: ScenarioSafetyRecoveryLimits;
    };

export const DEFAULT_SCENARIO_SAFETY_RECOVERY_LIMITS: ScenarioSafetyRecoveryLimits = {
  maxAttemptsPerStep: 1,
  maxAttemptsPerRun: 3
};

export interface RunnerExecutionPolicyErrorInput {
  safetyCode: ScenarioSafetyBlockCode;
  riskClass: ScenarioSafetyRiskClass;
  message: string;
  details?: Record<string, unknown>;
}

export class RunnerExecutionPolicyError extends Error {
  readonly safetyCode: ScenarioSafetyBlockCode;
  readonly riskClass: ScenarioSafetyRiskClass;
  readonly details: Record<string, unknown>;

  constructor(input: RunnerExecutionPolicyErrorInput) {
    super(input.message);
    this.name = "RunnerExecutionPolicyError";
    this.safetyCode = input.safetyCode;
    this.riskClass = input.riskClass;
    this.details = input.details ?? {};
  }
}

export function assertScenarioActionAllowed(
  plan: ScenarioPlan,
  currentUrl: string,
  action: ScenarioAction,
  resolvedNavigationUrl?: string | null
): void {
  if ((action.type === "fill" || action.type === "select") && !plan.safety.use_synthetic_inputs) {
    throw new RunnerExecutionPolicyError({
      safetyCode: "SYNTHETIC_INPUT_BLOCKED",
      riskClass: "SYNTHETIC_INPUT",
      message: `Scenario safety forbids synthetic ${action.type} actions when use_synthetic_inputs=false`,
      details: {
        actionType: action.type,
        useSyntheticInputs: plan.safety.use_synthetic_inputs
      }
    });
  }

  const targetSummary = describeTarget(action.target)?.toLowerCase() ?? "";

  if (action.type === "click") {
    if (looksLikePaymentCommitTarget(targetSummary) && (plan.safety.stop_before_real_payment || !plan.safety.allow_payment_commit)) {
      throw new RunnerExecutionPolicyError({
        safetyCode: "PAYMENT_COMMIT_BLOCKED",
        riskClass: "PAYMENT_COMMIT",
        message: "Scenario safety forbids payment-commit click targets",
        details: {
          actionType: action.type,
          targetSummary,
          allowPaymentCommit: plan.safety.allow_payment_commit,
          stopBeforeRealPayment: plan.safety.stop_before_real_payment ?? false
        }
      });
    }

    if (looksLikeDestructiveTarget(targetSummary) && !plan.safety.allow_destructive_action) {
      throw new RunnerExecutionPolicyError({
        safetyCode: "DESTRUCTIVE_ACTION_BLOCKED",
        riskClass: "DESTRUCTIVE_ACTION",
        message: "Scenario safety forbids destructive click targets",
        details: {
          actionType: action.type,
          targetSummary,
          allowDestructiveAction: plan.safety.allow_destructive_action
        }
      });
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

    throw new RunnerExecutionPolicyError({
      safetyCode: "EXTERNAL_NAVIGATION_BLOCKED",
      riskClass: "EXTERNAL_NAVIGATION",
      message: `Scenario safety forbids external navigation from ${currentOrigin} to ${nextOrigin}`,
      details: {
        currentOrigin,
        nextOrigin,
        allowedExternalOrigins: [...allowedExternalOrigins]
      }
    });
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

    throw new RunnerExecutionPolicyError({
      safetyCode: "EXTERNAL_VISIT_BLOCKED",
      riskClass: "EXTERNAL_NAVIGATION",
      message: `Scenario safety forbids visiting external origin ${currentOrigin} from start origin ${allowedOrigin}`,
      details: {
        allowedOrigin,
        currentOrigin,
        allowedExternalOrigins: [...allowedExternalOrigins]
      }
    });
  }
}

export function reasonCodeFromScenarioSafetyBlock(safetyCode: ScenarioSafetyBlockCode): ScenarioSafetyReasonCode {
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

export function createScenarioSafetyRecoveryState(): ScenarioSafetyRecoveryState {
  return {
    totalAttempts: 0,
    attemptsByStepKey: {},
    blockedFingerprints: []
  };
}

export function evaluateScenarioSafetyRecovery(
  input: ScenarioSafetyRecoveryDecisionInput
): ScenarioSafetyRecoveryDecision {
  const limits = scenarioSafetyRecoveryLimits(input.limits);
  const fingerprint = scenarioSafetyBlockFingerprint({
    safetyCode: input.safetyCode,
    stepKey: input.stepKey,
    details: input.details
  });

  if (!isRecoverableScenarioSafetyBlock(input.safetyCode)) {
    return {
      recoverable: false,
      reason: "NON_RECOVERABLE_SAFETY_BLOCK",
      fingerprint,
      limits
    };
  }

  if (input.state.totalAttempts >= limits.maxAttemptsPerRun) {
    return {
      recoverable: false,
      reason: "RUN_RECOVERY_LIMIT_REACHED",
      fingerprint,
      limits
    };
  }

  if ((input.state.attemptsByStepKey[input.stepKey] ?? 0) >= limits.maxAttemptsPerStep) {
    return {
      recoverable: false,
      reason: "STEP_RECOVERY_LIMIT_REACHED",
      fingerprint,
      limits
    };
  }

  if (input.state.blockedFingerprints.includes(fingerprint)) {
    return {
      recoverable: false,
      reason: "DUPLICATE_SAFETY_BLOCK",
      fingerprint,
      limits
    };
  }

  return {
    recoverable: true,
    strategy: "RETURN_TO_SAFE_ANCHOR",
    reason: "RECOVERABLE_EXTERNAL_NAVIGATION",
    fingerprint,
    limits
  };
}

export function recordScenarioSafetyRecoveryAttempt(
  state: ScenarioSafetyRecoveryState,
  input: {
    stepKey: string;
    fingerprint: string;
  }
): ScenarioSafetyRecoveryState {
  return {
    totalAttempts: state.totalAttempts + 1,
    attemptsByStepKey: {
      ...state.attemptsByStepKey,
      [input.stepKey]: (state.attemptsByStepKey[input.stepKey] ?? 0) + 1
    },
    blockedFingerprints: [...state.blockedFingerprints, input.fingerprint]
  };
}

export function isRecoverableScenarioSafetyBlock(safetyCode: ScenarioSafetyBlockCode): boolean {
  return safetyCode === "EXTERNAL_NAVIGATION_BLOCKED" || safetyCode === "EXTERNAL_VISIT_BLOCKED";
}

export function scenarioSafetyBlockFingerprint(input: {
  safetyCode: ScenarioSafetyBlockCode;
  stepKey: string;
  details?: Record<string, unknown>;
}): string {
  const details = input.details ?? {};
  const fromOrigin = stringDetail(details, "currentOrigin") ?? stringDetail(details, "allowedOrigin") ?? "";
  const toOrigin = stringDetail(details, "nextOrigin") ?? stringDetail(details, "currentOrigin") ?? "";
  const targetSummary = stringDetail(details, "targetSummary") ?? "";
  return [input.stepKey, input.safetyCode, fromOrigin, toOrigin, targetSummary].join("|");
}

function scenarioSafetyRecoveryLimits(limits?: Partial<ScenarioSafetyRecoveryLimits>): ScenarioSafetyRecoveryLimits {
  return {
    maxAttemptsPerStep: positiveIntegerOrDefault(
      limits?.maxAttemptsPerStep,
      DEFAULT_SCENARIO_SAFETY_RECOVERY_LIMITS.maxAttemptsPerStep
    ),
    maxAttemptsPerRun: positiveIntegerOrDefault(
      limits?.maxAttemptsPerRun,
      DEFAULT_SCENARIO_SAFETY_RECOVERY_LIMITS.maxAttemptsPerRun
    )
  };
}

function positiveIntegerOrDefault(value: unknown, fallback: number): number {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : fallback;
}

function stringDetail(details: Record<string, unknown>, key: string): string | null {
  const value = details[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function resolveOrigin(candidateUrl: string, baseUrl: string): string | null {
  try {
    const parsedUrl = new URL(candidateUrl, baseUrl);
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return null;
    }
    return parsedUrl.origin === "null" ? null : parsedUrl.origin;
  } catch {
    return null;
  }
}

function looksLikePaymentCommitTarget(targetSummary: string): boolean {
  if (looksLikeCartOrCheckoutEntryTarget(targetSummary)) {
    return false;
  }

  return containsAny(targetSummary, [
    "pay now",
    "payment submit",
    "place order",
    "complete order",
    "confirm order",
    "submit order",
    "finalize purchase",
    "purchase now",
    "buy now",
    "결제하기",
    "결제 진행",
    "결제 완료",
    "주문하기",
    "주문 확정",
    "구매 확정",
    "구매하기"
  ]);
}

function looksLikeCartOrCheckoutEntryTarget(targetSummary: string): boolean {
  return containsAny(targetSummary, [
    "cart",
    "basket",
    "bag",
    "장바구니",
    "카트",
    "바구니",
    "checkout",
    "주문서"
  ]);
}

function looksLikeDestructiveTarget(targetSummary: string): boolean {
  return containsAny(targetSummary, ["delete", "remove", "destroy", "삭제", "탈퇴", "회원 탈퇴"]);
}

function containsAny(value: string, keywords: string[]): boolean {
  return keywords.some((keyword) => value.includes(keyword));
}
