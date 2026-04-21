import { readFile } from "node:fs/promises";
import type { RunExecuteMessage, ScenarioPlan, ScenarioStep } from "../shared/contracts.ts";
import { isRecord } from "../shared/utils.ts";

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

function assertRunExecuteMessage(value: unknown): asserts value is RunExecuteMessage {
  if (!isRecord(value)) {
    throw new RunnerMessageValidationError("runner message must be a JSON object");
  }

  if (value.messageType !== "run.execute.request") {
    throw new RunnerMessageValidationError("runner messageType must be run.execute.request");
  }

  assertNonEmptyString(value.messageId, "runner messageId");
  assertNonEmptyString(value.schemaVersion, "runner schemaVersion");
  assertNonEmptyString(value.createdAt, "runner createdAt");
  assertNonEmptyString(value.producer, "runner producer");

  if (!isRecord(value.payload)) {
    throw new RunnerMessageValidationError("runner payload must be an object");
  }

  if (typeof value.payload.runId !== "string" || value.payload.runId.length === 0) {
    throw new RunnerMessageValidationError("runner payload.runId is required");
  }

  if (typeof value.payload.projectId !== "string" || value.payload.projectId.length === 0) {
    throw new RunnerMessageValidationError("runner payload.projectId is required");
  }

  if (typeof value.payload.startUrl !== "string" || value.payload.startUrl.length === 0) {
    throw new RunnerMessageValidationError("runner payload.startUrl is required");
  }

  if (typeof value.payload.goal !== "string" || value.payload.goal.length === 0) {
    throw new RunnerMessageValidationError("runner payload.goal is required");
  }

  if (
    value.payload.devicePreset !== "desktop" &&
    value.payload.devicePreset !== "tablet" &&
    value.payload.devicePreset !== "mobile"
  ) {
    throw new RunnerMessageValidationError("runner payload.devicePreset is invalid");
  }

  assertNonEmptyString(value.payload.scenarioTemplateVersionId, "runner payload.scenarioTemplateVersionId");
  assertScenarioPlan(value.payload.scenarioPlan);
  assertScenarioPlanConsistency(
    {
      startUrl: value.payload.startUrl,
      goal: value.payload.goal,
      devicePreset: value.payload.devicePreset
    },
    value.payload.scenarioPlan
  );
}

function assertScenarioPlan(value: unknown): asserts value is ScenarioPlan {
  if (!isRecord(value)) {
    throw new RunnerMessageValidationError("scenarioPlan must be an object");
  }

  assertNonEmptyString(value.schema_version, "scenarioPlan.schema_version");
  assertNonEmptyString(value.plan_id, "scenarioPlan.plan_id");

  if (value.scenario_type !== "template" && value.scenario_type !== "custom_compiled") {
    throw new RunnerMessageValidationError("scenarioPlan.scenario_type must be template or custom_compiled");
  }

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

  if (
    value.stage !== "FIRST_VIEW" &&
    value.stage !== "VALUE" &&
    value.stage !== "CTA" &&
    value.stage !== "INPUT" &&
    value.stage !== "COMMIT"
  ) {
    throw new RunnerMessageValidationError(`scenario step ${value.step_id} stage is invalid`);
  }

  assertNonEmptyString(value.description, `scenario step ${value.step_id} description`);

  if (!isRecord(value.action) || typeof value.action.type !== "string") {
    throw new RunnerMessageValidationError(`scenario step ${value.step_id} action.type is required`);
  }

  if (!isRecord(value.settle_strategy) || typeof value.settle_strategy.type !== "string") {
    throw new RunnerMessageValidationError(`scenario step ${value.step_id} settle_strategy.type is required`);
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

  if (value.device !== "desktop" && value.device !== "mobile" && value.device !== "tablet") {
    throw new RunnerMessageValidationError("scenarioPlan.environment.device is invalid");
  }

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

  if (
    value.auth_state !== "anonymous" &&
    value.auth_state !== "test_account" &&
    value.auth_state !== "stored_state"
  ) {
    throw new RunnerMessageValidationError("scenarioPlan.environment.auth_state is invalid");
  }
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

function assertBoolean(value: unknown, fieldName: string): void {
  if (typeof value !== "boolean") {
    throw new RunnerMessageValidationError(`${fieldName} must be boolean`);
  }
}
