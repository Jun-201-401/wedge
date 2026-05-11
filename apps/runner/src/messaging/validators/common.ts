import {
  settleStrategyTypes,
  scenarioActionTypes,
  type RunExecuteMessage,
  type ScenarioPlan,
  type ScenarioStep
} from "../../shared/contracts.ts";
import { isRecord } from "../../shared/utils.ts";

export const PAYLOAD_DEVICE_PRESETS = ["desktop", "tablet", "mobile"] as const;
export const SCENARIO_TYPES = ["template", "custom_compiled"] as const;
export const SCENARIO_STEP_STAGES = ["FIRST_VIEW", "VALUE", "CTA", "INPUT", "COMMIT"] as const;
export const ENVIRONMENT_DEVICES = ["desktop", "mobile", "tablet"] as const;
export const AUTH_STATES = ["anonymous", "test_account", "stored_state"] as const;

export class RunnerMessageValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunnerMessageValidationError";
  }
}

export function assertScenarioPlan(value: unknown): asserts value is ScenarioPlan {
  if (!isRecord(value)) {
    throw new RunnerMessageValidationError("scenarioPlan must be an object");
  }

  assertNonEmptyString(value.schema_version, "scenarioPlan.schema_version");
  assertNonEmptyString(value.plan_id, "scenarioPlan.plan_id");
  assertOneOf(value.scenario_type, SCENARIO_TYPES, "scenarioPlan.scenario_type", "must be template or custom_compiled");
  assertNonEmptyString(value.goal, "scenarioPlan.goal");
  assertNonEmptyString(value.start_url, "scenarioPlan.start_url");
  assertScenarioEnvironment(value.environment);
  assertScenarioSafety(value.safety);
  assertScenarioArtifactPolicy(value.artifact_policy);

  if (!Array.isArray(value.steps) || value.steps.length === 0) {
    throw new RunnerMessageValidationError("scenarioPlan.steps must contain at least one step");
  }

  for (const step of value.steps) {
    assertScenarioStep(step);
  }
}

function assertScenarioArtifactPolicy(value: unknown): void {
  if (value === undefined) {
    return;
  }
  if (!isRecord(value)) {
    throw new RunnerMessageValidationError("scenarioPlan.artifact_policy must be an object");
  }
  assertAllowedObjectKeys(value, "scenarioPlan.artifact_policy", [
    "capture_screenshots",
    "capture_dom_snapshots",
    "capture_ax_tree",
    "capture_trace"
  ]);
  assertOptionalBoolean(value.capture_screenshots, "scenarioPlan.artifact_policy.capture_screenshots");
  assertOptionalBoolean(value.capture_dom_snapshots, "scenarioPlan.artifact_policy.capture_dom_snapshots");
  assertOptionalBoolean(value.capture_ax_tree, "scenarioPlan.artifact_policy.capture_ax_tree");
  assertOptionalBoolean(value.capture_trace, "scenarioPlan.artifact_policy.capture_trace");
}

export function assertScenarioStep(value: unknown): asserts value is ScenarioStep {
  if (!isRecord(value)) {
    throw new RunnerMessageValidationError("scenario step must be an object");
  }

  if (typeof value.step_id !== "string" || value.step_id.length === 0) {
    throw new RunnerMessageValidationError("scenario step.step_id is required");
  }

  assertOneOf(value.stage, SCENARIO_STEP_STAGES, `scenario step ${value.step_id} stage`);
  assertNonEmptyString(value.description, `scenario step ${value.step_id} description`);

  if (!isRecord(value.action) || typeof value.action.type !== "string") {
    throw new RunnerMessageValidationError(`scenario step ${value.step_id} action.type is required`);
  }

  if (!isScenarioActionType(value.action.type)) {
    throw new RunnerMessageValidationError(`scenario step ${value.step_id} action.type is unsupported`);
  }

  if (!isRecord(value.settle_strategy) || typeof value.settle_strategy.type !== "string") {
    throw new RunnerMessageValidationError(`scenario step ${value.step_id} settle_strategy.type is required`);
  }

  if (!isSettleStrategyType(value.settle_strategy.type)) {
    throw new RunnerMessageValidationError(`scenario step ${value.step_id} settle_strategy.type is unsupported`);
  }

  if (typeof value.settle_strategy.timeout_ms !== "number" || value.settle_strategy.timeout_ms < 0) {
    throw new RunnerMessageValidationError(`scenario step ${value.step_id} settle_strategy.timeout_ms must be >= 0`);
  }

  if (typeof value.checkpoint !== "boolean") {
    throw new RunnerMessageValidationError(`scenario step ${value.step_id} checkpoint must be boolean`);
  }
}

export function assertScenarioEnvironment(value: unknown): void {
  if (!isRecord(value)) {
    throw new RunnerMessageValidationError("scenarioPlan.environment must be an object");
  }

  assertOneOf(value.device, ENVIRONMENT_DEVICES, "scenarioPlan.environment.device");
  if (!isRecord(value.viewport)) {
    throw new RunnerMessageValidationError("scenarioPlan.environment.viewport must be an object");
  }

  if (typeof value.viewport.width !== "number" || value.viewport.width < 320) {
    throw new RunnerMessageValidationError("scenarioPlan.environment.viewport.width must be >= 320");
  }

  if (typeof value.viewport.height !== "number" || value.viewport.height < 480) {
    throw new RunnerMessageValidationError("scenarioPlan.environment.viewport.height must be >= 480");
  }

  assertNonEmptyString(value.locale, "scenarioPlan.environment.locale");
  assertNonEmptyString(value.timezone, "scenarioPlan.environment.timezone");
  assertOneOf(value.auth_state, AUTH_STATES, "scenarioPlan.environment.auth_state");
}

export function assertScenarioSafety(value: unknown): void {
  if (!isRecord(value)) {
    throw new RunnerMessageValidationError("scenarioPlan.safety must be an object");
  }

  assertBoolean(value.allow_external_navigation, "scenarioPlan.safety.allow_external_navigation");
  assertBoolean(value.allow_payment_commit, "scenarioPlan.safety.allow_payment_commit");
  assertBoolean(value.allow_destructive_action, "scenarioPlan.safety.allow_destructive_action");
  assertBoolean(value.use_synthetic_inputs, "scenarioPlan.safety.use_synthetic_inputs");
}

export function assertScenarioPlanConsistency(
  payload: Pick<RunExecuteMessage["payload"], "startUrl" | "goal" | "devicePreset">,
  scenarioPlan: ScenarioPlan
): void {
  if (payload.startUrl !== scenarioPlan.start_url) {
    throw new RunnerMessageValidationError("runner payload.startUrl must match scenarioPlan.start_url");
  }

  if (payload.goal !== scenarioPlan.goal) {
    throw new RunnerMessageValidationError("runner payload.goal must match scenarioPlan.goal");
  }

  if (payload.devicePreset !== scenarioPlan.environment.device) {
    throw new RunnerMessageValidationError("runner payload.devicePreset must match scenarioPlan.environment.device");
  }
}

export function assertNonEmptyString(value: unknown, fieldName: string): void {
  if (typeof value !== "string" || value.length === 0) {
    throw new RunnerMessageValidationError(`${fieldName} is required`);
  }
}

export function assertOptionalNonEmptyString(value: unknown, fieldName: string): void {
  if (value !== undefined && (typeof value !== "string" || value.length === 0)) {
    throw new RunnerMessageValidationError(`${fieldName} must be a non-empty string`);
  }
}

export function assertOptionalNullableNonEmptyString(value: unknown, fieldName: string): void {
  if (value === undefined || value === null) {
    return;
  }

  if (typeof value !== "string" || value.length === 0) {
    throw new RunnerMessageValidationError(`${fieldName} must be a non-empty string or null`);
  }
}

export function assertLiteralString(value: unknown, expected: string, fieldName: string): void {
  if (value !== expected) {
    throw new RunnerMessageValidationError(`${fieldName} must be ${expected}`);
  }
}

export function assertBoolean(value: unknown, fieldName: string): void {
  if (typeof value !== "boolean") {
    throw new RunnerMessageValidationError(`${fieldName} must be boolean`);
  }
}

export function assertOptionalBoolean(value: unknown, fieldName: string): void {
  if (value !== undefined && typeof value !== "boolean") {
    throw new RunnerMessageValidationError(`${fieldName} must be boolean`);
  }
}

export function assertIntegerRange(value: unknown, fieldName: string, min: number, max: number): void {
  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) {
    throw new RunnerMessageValidationError(`${fieldName} must be an integer between ${min} and ${max}`);
  }
}

export function assertOptionalIntegerRange(value: unknown, fieldName: string, min: number, max: number): void {
  if (value === undefined) {
    return;
  }

  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) {
    throw new RunnerMessageValidationError(`${fieldName} must be an integer between ${min} and ${max}`);
  }
}

export function assertOptionalIntegerMin(value: unknown, fieldName: string, min: number): void {
  if (value === undefined) {
    return;
  }

  if (!Number.isInteger(value) || Number(value) < min) {
    throw new RunnerMessageValidationError(`${fieldName} must be an integer >= ${min}`);
  }
}

export function assertOneOf(value: unknown, allowedValues: readonly string[], fieldName: string, customMessage?: string): void {
  if (typeof value !== "string" || !allowedValues.includes(value)) {
    throw new RunnerMessageValidationError(customMessage ? `${fieldName} ${customMessage}` : `${fieldName} is invalid`);
  }
}

export function assertOptionalOneOf(value: unknown, allowedValues: readonly string[], fieldName: string): void {
  if (value === undefined) {
    return;
  }

  assertOneOf(value, allowedValues, fieldName);
}

export function assertOptionalNullableRecord(value: unknown, fieldName: string): void {
  if (value === undefined || value === null) {
    return;
  }

  if (!isRecord(value)) {
    throw new RunnerMessageValidationError(`${fieldName} must be an object or null`);
  }
}

export function assertOptionalStringArray(value: unknown, fieldName: string): void {
  if (value === undefined) {
    return;
  }

  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.length === 0)) {
    throw new RunnerMessageValidationError(`${fieldName} must be an array of non-empty strings`);
  }
}

export function assertAllowedObjectKeys(value: Record<string, unknown>, fieldName: string, allowedKeys: readonly string[]): void {
  const allowed = new Set(allowedKeys);
  const unexpectedKey = Object.keys(value).find((key) => !allowed.has(key));

  if (unexpectedKey) {
    throw new RunnerMessageValidationError(`${fieldName}.${unexpectedKey} is not supported`);
  }
}

function isScenarioActionType(value: string): boolean {
  return (scenarioActionTypes as readonly string[]).includes(value);
}

function isSettleStrategyType(value: string): boolean {
  return (settleStrategyTypes as readonly string[]).includes(value);
}
