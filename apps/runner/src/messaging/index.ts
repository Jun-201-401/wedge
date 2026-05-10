import { readFile } from "node:fs/promises";
import {
  settleStrategyTypes,
  scenarioActionTypes,
  type AgentExecuteMessage,
  type AgentTask,
  type DiscoveryExecuteMessage,
  type RunExecuteMessage,
  type ScenarioPlan,
  type ScenarioStep
} from "../shared/contracts.ts";
import { isRecord } from "../shared/utils.ts";

const RUNNER_MESSAGE_TYPE = "run.execute.request";
const AGENT_MESSAGE_TYPE = "agent.execute.request";
const DISCOVERY_MESSAGE_TYPE = "discovery.execute.request";
const PAYLOAD_DEVICE_PRESETS = ["desktop", "tablet", "mobile"] as const;
const AGENT_GOAL_TYPES = ["CHECKOUT_ENTRY_VERIFICATION"] as const;
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

export async function readAgentExecuteMessage(messageFile: string): Promise<AgentExecuteMessage> {
  const rawMessage = await readFile(messageFile, "utf8");
  return parseAgentExecuteMessage(rawMessage);
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

export function parseAgentExecuteMessage(rawMessage: string): AgentExecuteMessage {
  let parsed: unknown;

  try {
    parsed = JSON.parse(rawMessage) as unknown;
  } catch {
    throw new RunnerMessageValidationError("agent message must be valid JSON");
  }

  assertAgentExecuteMessage(parsed);
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

function assertAgentExecuteMessage(value: unknown): asserts value is AgentExecuteMessage {
  if (!isRecord(value)) {
    throw new RunnerMessageValidationError("agent message must be a JSON object");
  }

  assertLiteralString(value.messageType, AGENT_MESSAGE_TYPE, "agent messageType");

  assertNonEmptyString(value.messageId, "agent messageId");
  assertNonEmptyString(value.schemaVersion, "agent schemaVersion");
  assertNonEmptyString(value.createdAt, "agent createdAt");
  assertNonEmptyString(value.producer, "agent producer");
  assertAgentExecutePayload(value.payload);
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

function assertAgentExecutePayload(value: unknown): asserts value is AgentExecuteMessage["payload"] {
  if (!isRecord(value)) {
    throw new RunnerMessageValidationError("agent payload must be an object");
  }

  assertAgentTask(value.agentTask);
}

function assertAgentTask(value: unknown): asserts value is AgentTask {
  if (!isRecord(value)) {
    throw new RunnerMessageValidationError("agent payload.agentTask must be an object");
  }

  assertLiteralString(value.schema_version, "0.1", "agentTask.schema_version");
  assertNonEmptyString(value.task_id, "agentTask.task_id");
  assertNonEmptyString(value.attempt_id, "agentTask.attempt_id");
  assertIntegerRange(value.attempt_index, "agentTask.attempt_index", 1, 1_000_000);
  assertNonEmptyString(value.run_id, "agentTask.run_id");
  assertNonEmptyString(value.project_id, "agentTask.project_id");
  assertOneOf(value.goal_type, AGENT_GOAL_TYPES, "agentTask.goal_type");
  assertOptionalNonEmptyString(value.goal, "agentTask.goal");
  assertNonEmptyString(value.start_url, "agentTask.start_url");
  assertScenarioEnvironment(value.environment);
  assertAgentBudget(value.budget);
  assertAgentAllowedNavigation(value.allowed_navigation);
  assertAgentRiskPolicy(value.risk_policy);
  assertAgentReplayHints(value.replay_hints);
}

function assertAgentReplayHints(value: unknown): void {
  if (value === undefined) {
    return;
  }

  if (!isRecord(value)) {
    throw new RunnerMessageValidationError("agentTask.replay_hints must be an object");
  }

  assertOptionalNullableNonEmptyString(value.source_trace_id, "agentTask.replay_hints.source_trace_id");
  assertOptionalNullableNonEmptyString(value.source_plan_id, "agentTask.replay_hints.source_plan_id");

  if (!Array.isArray(value.steps) || value.steps.length === 0 || value.steps.length > 50) {
    throw new RunnerMessageValidationError("agentTask.replay_hints.steps must contain between 1 and 50 steps");
  }

  for (const [index, step] of value.steps.entries()) {
    assertAgentReplayHintStep(step, index);
  }
}

function assertAgentReplayHintStep(value: unknown, index: number): void {
  const fieldName = `agentTask.replay_hints.steps[${index}]`;

  if (!isRecord(value)) {
    throw new RunnerMessageValidationError(`${fieldName} must be an object`);
  }

  assertOptionalNonEmptyString(value.step_id, `${fieldName}.step_id`);
  if (value.stage !== undefined) {
    assertOneOf(value.stage, SCENARIO_STEP_STAGES, `${fieldName}.stage`);
  }
  assertOptionalNonEmptyString(value.description, `${fieldName}.description`);

  if (!isRecord(value.action) || typeof value.action.type !== "string") {
    throw new RunnerMessageValidationError(`${fieldName}.action.type is required`);
  }

  if (!isScenarioActionType(value.action.type)) {
    throw new RunnerMessageValidationError(`${fieldName}.action.type is unsupported`);
  }

  if (value.settle_strategy !== undefined) {
    if (!isRecord(value.settle_strategy) || typeof value.settle_strategy.type !== "string") {
      throw new RunnerMessageValidationError(`${fieldName}.settle_strategy.type is required`);
    }

    if (!isSettleStrategyType(value.settle_strategy.type)) {
      throw new RunnerMessageValidationError(`${fieldName}.settle_strategy.type is unsupported`);
    }

    if (typeof value.settle_strategy.timeout_ms !== "number" || value.settle_strategy.timeout_ms < 0) {
      throw new RunnerMessageValidationError(`${fieldName}.settle_strategy.timeout_ms must be >= 0`);
    }
  }

  if (value.target_key !== undefined && value.target_key !== null && (typeof value.target_key !== "string" || value.target_key.length === 0)) {
    throw new RunnerMessageValidationError(`${fieldName}.target_key must be a non-empty string or null`);
  }

  if (value.confidence !== undefined && (typeof value.confidence !== "number" || value.confidence < 0 || value.confidence > 1)) {
    throw new RunnerMessageValidationError(`${fieldName}.confidence must be between 0 and 1`);
  }
}

function assertAgentBudget(value: unknown): void {
  if (!isRecord(value)) {
    throw new RunnerMessageValidationError("agentTask.budget must be an object");
  }

  assertIntegerRange(value.max_steps, "agentTask.budget.max_steps", 1, 50);
  assertIntegerRange(value.max_duration_ms, "agentTask.budget.max_duration_ms", 1_000, 600_000);
  assertOptionalIntegerRange(value.max_recovery_attempts, "agentTask.budget.max_recovery_attempts", 0, 10);
  assertOptionalIntegerRange(value.max_same_page_attempts, "agentTask.budget.max_same_page_attempts", 0, 10);
  assertOptionalIntegerRange(value.max_external_redirects, "agentTask.budget.max_external_redirects", 0, 10);
}

function assertAgentAllowedNavigation(value: unknown): void {
  if (!isRecord(value)) {
    throw new RunnerMessageValidationError("agentTask.allowed_navigation must be an object");
  }

  assertBoolean(value.allow_external_navigation, "agentTask.allowed_navigation.allow_external_navigation");
  assertOptionalStringArray(value.allowed_origins, "agentTask.allowed_navigation.allowed_origins");
  assertOptionalStringArray(
    value.allowed_checkout_redirect_origins,
    "agentTask.allowed_navigation.allowed_checkout_redirect_origins"
  );
}

function assertAgentRiskPolicy(value: unknown): void {
  if (!isRecord(value)) {
    throw new RunnerMessageValidationError("agentTask.risk_policy must be an object");
  }

  assertBoolean(value.allow_checkout_navigation, "agentTask.risk_policy.allow_checkout_navigation");
  assertBoolean(value.allow_cart_mutation, "agentTask.risk_policy.allow_cart_mutation");
  assertBoolean(value.allow_shipping_form_entry, "agentTask.risk_policy.allow_shipping_form_entry");
  assertBoolean(value.allow_payment_info_entry, "agentTask.risk_policy.allow_payment_info_entry");
  assertBoolean(value.allow_final_payment_submit, "agentTask.risk_policy.allow_final_payment_submit");
  assertBoolean(value.allow_final_order_commit, "agentTask.risk_policy.allow_final_order_commit");
  assertBoolean(value.allow_destructive_action, "agentTask.risk_policy.allow_destructive_action");
  assertBoolean(value.allow_external_message_send, "agentTask.risk_policy.allow_external_message_send");
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

function assertOptionalNonEmptyString(value: unknown, fieldName: string): void {
  if (value !== undefined && (typeof value !== "string" || value.length === 0)) {
    throw new RunnerMessageValidationError(`${fieldName} must be a non-empty string`);
  }
}

function assertOptionalNullableNonEmptyString(value: unknown, fieldName: string): void {
  if (value !== undefined && value !== null && (typeof value !== "string" || value.length === 0)) {
    throw new RunnerMessageValidationError(`${fieldName} must be a non-empty string or null`);
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

function assertOptionalBoolean(value: unknown, fieldName: string): void {
  if (value !== undefined && typeof value !== "boolean") {
    throw new RunnerMessageValidationError(`${fieldName} must be boolean`);
  }
}

function assertIntegerRange(value: unknown, fieldName: string, min: number, max: number): void {
  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) {
    throw new RunnerMessageValidationError(`${fieldName} must be an integer between ${min} and ${max}`);
  }
}

function assertOptionalIntegerRange(value: unknown, fieldName: string, min: number, max: number): void {
  if (value === undefined) {
    return;
  }

  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) {
    throw new RunnerMessageValidationError(`${fieldName} must be an integer between ${min} and ${max}`);
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

function assertOptionalStringArray(value: unknown, fieldName: string): void {
  if (value === undefined) {
    return;
  }

  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.length === 0)) {
    throw new RunnerMessageValidationError(`${fieldName} must be an array of non-empty strings`);
  }
}

function isScenarioActionType(value: string): boolean {
  return (scenarioActionTypes as readonly string[]).includes(value);
}

function isSettleStrategyType(value: string): boolean {
  return (settleStrategyTypes as readonly string[]).includes(value);
}
