import { readFile } from "node:fs/promises";
import {
  settleStrategyTypes,
  scenarioActionTypes,
  type DiscoveryExecuteMessage,
  type RunExecuteMessage,
  type ScenarioPlan,
  type ScenarioStep
} from "../shared/contracts.ts";
import { isRecord } from "../shared/utils.ts";

const RUNNER_MESSAGE_TYPE = "run.execute.request";
const DISCOVERY_MESSAGE_TYPE = "discovery.execute.request";
const PAYLOAD_DEVICE_PRESETS = ["desktop", "tablet", "mobile"] as const;
const SCENARIO_TYPES = ["template", "custom_compiled"] as const;
const SCENARIO_STEP_STAGES = ["FIRST_VIEW", "VALUE", "CTA", "INPUT", "COMMIT"] as const;
const ENVIRONMENT_DEVICES = ["desktop", "mobile", "tablet"] as const;
const AUTH_STATES = ["anonymous", "test_account", "stored_state"] as const;

export class RunnerMessageValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunnerMessageValidationError";
  }
}

export async function readRunExecuteMessage(messageFile: string): Promise<RunExecuteMessage> {
  const rawMessage = await readFile(messageFile, "utf8");
  return parseRunExecuteMessage(rawMessage);
}

export async function readDiscoveryExecuteMessage(messageFile: string): Promise<DiscoveryExecuteMessage> {
  const rawMessage = await readFile(messageFile, "utf8");
  return parseDiscoveryExecuteMessage(rawMessage);
}

export function parseRunExecuteMessage(rawMessage: string): RunExecuteMessage {
  let parsed: unknown;

  try {
    parsed = JSON.parse(rawMessage) as unknown;
  } catch {
    throw new RunnerMessageValidationError("runner message must be valid JSON");
  }

  assertRunExecuteMessage(parsed);
  return parsed;
}

export function parseDiscoveryExecuteMessage(rawMessage: string): DiscoveryExecuteMessage {
  let parsed: unknown;

  try {
    parsed = JSON.parse(rawMessage) as unknown;
  } catch {
    throw new RunnerMessageValidationError("discovery message must be valid JSON");
  }

  assertDiscoveryExecuteMessage(parsed);
  return parsed;
}

function assertRunExecuteMessage(value: unknown): asserts value is RunExecuteMessage {
  if (!isRecord(value)) {
    throw new RunnerMessageValidationError("runner message must be a JSON object");
  }

  assertLiteralString(value.messageType, RUNNER_MESSAGE_TYPE, "runner messageType");

  assertNonEmptyString(value.messageId, "runner messageId");
  assertNonEmptyString(value.schemaVersion, "runner schemaVersion");
  assertNonEmptyString(value.createdAt, "runner createdAt");
  assertNonEmptyString(value.producer, "runner producer");
  assertRunExecutePayload(value.payload);
}

function assertDiscoveryExecuteMessage(value: unknown): asserts value is DiscoveryExecuteMessage {
  if (!isRecord(value)) {
    throw new RunnerMessageValidationError("discovery message must be a JSON object");
  }

  assertLiteralString(value.messageType, DISCOVERY_MESSAGE_TYPE, "discovery messageType");

  assertNonEmptyString(value.messageId, "discovery messageId");
  assertNonEmptyString(value.schemaVersion, "discovery schemaVersion");
  assertNonEmptyString(value.createdAt, "discovery createdAt");
  assertNonEmptyString(value.producer, "discovery producer");
  assertDiscoveryExecutePayload(value.payload);
}

function assertRunExecutePayload(value: unknown): asserts value is RunExecuteMessage["payload"] {
  if (!isRecord(value)) {
    throw new RunnerMessageValidationError("runner payload must be an object");
  }

  assertNonEmptyString(value.runId, "runner payload.runId");
  assertNonEmptyString(value.projectId, "runner payload.projectId");
  assertNonEmptyString(value.startUrl, "runner payload.startUrl");
  assertNonEmptyString(value.goal, "runner payload.goal");
  assertOneOf(value.devicePreset, PAYLOAD_DEVICE_PRESETS, "runner payload.devicePreset");
  assertNonEmptyString(value.scenarioTemplateVersionId, "runner payload.scenarioTemplateVersionId");
  assertScenarioPlan(value.scenarioPlan);
  assertScenarioPlanConsistency(
    {
      startUrl: value.startUrl,
      goal: value.goal,
      devicePreset: value.devicePreset
    },
    value.scenarioPlan
  );
}

function assertDiscoveryExecutePayload(value: unknown): asserts value is DiscoveryExecuteMessage["payload"] {
  if (!isRecord(value)) {
    throw new RunnerMessageValidationError("discovery payload must be an object");
  }

  assertNonEmptyString(value.discoveryId, "discovery payload.discoveryId");
  assertNonEmptyString(value.projectId, "discovery payload.projectId");
  assertNonEmptyString(value.url, "discovery payload.url");
  assertOneOf(value.devicePreset, PAYLOAD_DEVICE_PRESETS, "discovery payload.devicePreset");

  if (!isRecord(value.viewport)) {
    throw new RunnerMessageValidationError("discovery payload.viewport must be an object");
  }

  if (typeof value.viewport.width !== "number" || value.viewport.width < 1) {
    throw new RunnerMessageValidationError("discovery payload.viewport.width must be >= 1");
  }

  if (typeof value.viewport.height !== "number" || value.viewport.height < 1) {
    throw new RunnerMessageValidationError("discovery payload.viewport.height must be >= 1");
  }

  if (typeof value.maxDurationMs !== "number" || value.maxDurationMs < 1_000) {
    throw new RunnerMessageValidationError("discovery payload.maxDurationMs must be >= 1000");
  }

  if (typeof value.maxScrollCount !== "number" || value.maxScrollCount < 0) {
    throw new RunnerMessageValidationError("discovery payload.maxScrollCount must be >= 0");
  }
}

function assertScenarioPlan(value: unknown): asserts value is ScenarioPlan {
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

  if (!Array.isArray(value.steps) || value.steps.length === 0) {
    throw new RunnerMessageValidationError("scenarioPlan.steps must contain at least one step");
  }

  for (const step of value.steps) {
    assertScenarioStep(step);
  }
}

function assertScenarioStep(value: unknown): asserts value is ScenarioStep {
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

function assertScenarioEnvironment(value: unknown): void {
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

function assertScenarioSafety(value: unknown): void {
  if (!isRecord(value)) {
    throw new RunnerMessageValidationError("scenarioPlan.safety must be an object");
  }

  assertBoolean(value.allow_external_navigation, "scenarioPlan.safety.allow_external_navigation");
  assertBoolean(value.allow_payment_commit, "scenarioPlan.safety.allow_payment_commit");
  assertBoolean(value.allow_destructive_action, "scenarioPlan.safety.allow_destructive_action");
  assertBoolean(value.use_synthetic_inputs, "scenarioPlan.safety.use_synthetic_inputs");
}

function assertScenarioPlanConsistency(
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

function assertNonEmptyString(value: unknown, fieldName: string): void {
  if (typeof value !== "string" || value.length === 0) {
    throw new RunnerMessageValidationError(`${fieldName} is required`);
  }
}

function assertLiteralString(value: unknown, expected: string, fieldName: string): void {
  if (value !== expected) {
    throw new RunnerMessageValidationError(`${fieldName} must be ${expected}`);
  }
}

function assertBoolean(value: unknown, fieldName: string): void {
  if (typeof value !== "boolean") {
    throw new RunnerMessageValidationError(`${fieldName} must be boolean`);
  }
}

function assertOneOf(
  value: unknown,
  allowedValues: readonly string[],
  fieldName: string,
  customMessage?: string
): void {
  if (typeof value !== "string" || !allowedValues.includes(value)) {
    throw new RunnerMessageValidationError(customMessage ? `${fieldName} ${customMessage}` : `${fieldName} is invalid`);
  }
}

function isScenarioActionType(value: string): boolean {
  return (scenarioActionTypes as readonly string[]).includes(value);
}

function isSettleStrategyType(value: string): boolean {
  return (settleStrategyTypes as readonly string[]).includes(value);
}
