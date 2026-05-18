import {
  scenarioActionTypes,
  settleStrategyTypes,
  type AgentExecuteMessage,
  type AgentTask
} from "../../shared/contracts.ts";
import { isRecord } from "../../shared/utils.ts";
import {
  assertAllowedObjectKeys,
  assertBoolean,
  assertIntegerRange,
  assertLiteralString,
  assertNonEmptyString,
  assertOneOf,
  assertOptionalBoolean,
  assertOptionalIntegerMin,
  assertOptionalIntegerRange,
  assertOptionalNullableNonEmptyString,
  assertOptionalNullableRecord,
  assertOptionalNonEmptyString,
  assertOptionalOneOf,
  assertOptionalStringArray,
  assertScenarioEnvironment,
  RunnerMessageValidationError,
  SCREENSHOT_MODES
} from "./common.ts";

const AGENT_MESSAGE_TYPE = "agent.execute.request";
const AGENT_GOAL_TYPES = [
  "LANDING_CTA_VERIFICATION",
  "SIGNUP_LEAD_FORM_VERIFICATION",
  "PRICING_FLOW_VERIFICATION",
  "CHECKOUT_ENTRY_VERIFICATION",
  "CONTACT_FLOW_VERIFICATION",
  "CONTENT_ONLY_REVIEW"
] as const;
const PRODUCT_SELECTION_MODES = ["PROVIDED_OR_OBVIOUS_ONLY"] as const;
const REQUIRED_OPTION_STRATEGIES = ["FIRST_AVAILABLE"] as const;

export function assertAgentExecuteMessage(value: unknown): asserts value is AgentExecuteMessage {
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
  assertAgentObservationBudget(value.observation_budget);
  assertAgentAllowedNavigation(value.allowed_navigation);
  assertAgentProductSelectionPolicy(value.product_selection_policy);
  assertAgentRiskPolicy(value.risk_policy);
  assertAgentTestData(value.test_data);
  assertAgentArtifactPolicy(value.artifact_policy);
  assertAgentReplayHints(value.replay_hints);
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

function assertAgentObservationBudget(value: unknown): void {
  if (value === undefined) {
    return;
  }
  if (!isRecord(value)) {
    throw new RunnerMessageValidationError("agentTask.observation_budget must be an object");
  }
  assertAllowedObjectKeys(value, "agentTask.observation_budget", [
    "max_candidates",
    "max_visible_text_chars",
    "max_nearby_text_chars_per_candidate",
    "max_dom_snapshot_bytes",
    "max_ax_tree_bytes",
    "max_artifacts_per_run",
    "max_artifact_bytes_per_run"
  ]);
  assertOptionalIntegerRange(value.max_candidates, "agentTask.observation_budget.max_candidates", 1, 500);
  assertOptionalIntegerRange(value.max_visible_text_chars, "agentTask.observation_budget.max_visible_text_chars", 0, 100_000);
  assertOptionalIntegerRange(value.max_nearby_text_chars_per_candidate, "agentTask.observation_budget.max_nearby_text_chars_per_candidate", 0, 5_000);
  assertOptionalIntegerMin(value.max_dom_snapshot_bytes, "agentTask.observation_budget.max_dom_snapshot_bytes", 0);
  assertOptionalIntegerMin(value.max_ax_tree_bytes, "agentTask.observation_budget.max_ax_tree_bytes", 0);
  assertOptionalIntegerMin(value.max_artifacts_per_run, "agentTask.observation_budget.max_artifacts_per_run", 0);
  assertOptionalIntegerMin(value.max_artifact_bytes_per_run, "agentTask.observation_budget.max_artifact_bytes_per_run", 0);
}

function assertAgentAllowedNavigation(value: unknown): void {
  if (!isRecord(value)) {
    throw new RunnerMessageValidationError("agentTask.allowed_navigation must be an object");
  }
  assertBoolean(value.allow_external_navigation, "agentTask.allowed_navigation.allow_external_navigation");
  assertOptionalStringArray(value.allowed_origins, "agentTask.allowed_navigation.allowed_origins");
  assertOptionalStringArray(value.allowed_checkout_redirect_origins, "agentTask.allowed_navigation.allowed_checkout_redirect_origins");
}

function assertAgentProductSelectionPolicy(value: unknown): void {
  if (value === undefined) {
    return;
  }
  if (!isRecord(value)) {
    throw new RunnerMessageValidationError("agentTask.product_selection_policy must be an object");
  }
  assertAllowedObjectKeys(value, "agentTask.product_selection_policy", [
    "mode",
    "provided_product_url",
    "required_option_strategy",
    "allow_quantity_change",
    "max_add_to_cart_attempts"
  ]);
  assertOneOf(value.mode, PRODUCT_SELECTION_MODES, "agentTask.product_selection_policy.mode");
  assertOptionalNullableNonEmptyString(value.provided_product_url, "agentTask.product_selection_policy.provided_product_url");
  assertOptionalOneOf(value.required_option_strategy, REQUIRED_OPTION_STRATEGIES, "agentTask.product_selection_policy.required_option_strategy");
  assertOptionalBoolean(value.allow_quantity_change, "agentTask.product_selection_policy.allow_quantity_change");
  assertOptionalIntegerRange(value.max_add_to_cart_attempts, "agentTask.product_selection_policy.max_add_to_cart_attempts", 0, 10);
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

function assertAgentTestData(value: unknown): void {
  if (value === undefined) {
    return;
  }
  if (!isRecord(value)) {
    throw new RunnerMessageValidationError("agentTask.test_data must be an object");
  }
  assertAllowedObjectKeys(value, "agentTask.test_data", [
    "email",
    "name",
    "phone",
    "shipping_address",
    "postal_code",
    "country",
    "coupon_code",
    "sandbox_payment"
  ]);
  assertOptionalNullableNonEmptyString(value.email, "agentTask.test_data.email");
  assertOptionalNullableNonEmptyString(value.name, "agentTask.test_data.name");
  assertOptionalNullableNonEmptyString(value.phone, "agentTask.test_data.phone");
  assertOptionalNullableRecord(value.shipping_address, "agentTask.test_data.shipping_address");
  assertOptionalNullableNonEmptyString(value.postal_code, "agentTask.test_data.postal_code");
  assertOptionalNullableNonEmptyString(value.country, "agentTask.test_data.country");
  assertOptionalNullableNonEmptyString(value.coupon_code, "agentTask.test_data.coupon_code");
  assertOptionalNullableRecord(value.sandbox_payment, "agentTask.test_data.sandbox_payment");
}

function assertAgentArtifactPolicy(value: unknown): void {
  if (value === undefined) {
    return;
  }
  if (!isRecord(value)) {
    throw new RunnerMessageValidationError("agentTask.artifact_policy must be an object");
  }
  assertAllowedObjectKeys(value, "agentTask.artifact_policy", [
    "capture_screenshots",
    "screenshot_mode",
    "capture_dom_snapshots",
    "capture_ax_tree",
    "capture_trace",
    "capture_har",
    "capture_performance"
  ]);
  assertOptionalBoolean(value.capture_screenshots, "agentTask.artifact_policy.capture_screenshots");
  assertOptionalOneOf(value.screenshot_mode, SCREENSHOT_MODES, "agentTask.artifact_policy.screenshot_mode");
  assertOptionalBoolean(value.capture_dom_snapshots, "agentTask.artifact_policy.capture_dom_snapshots");
  assertOptionalBoolean(value.capture_ax_tree, "agentTask.artifact_policy.capture_ax_tree");
  assertOptionalBoolean(value.capture_trace, "agentTask.artifact_policy.capture_trace");
  assertOptionalBoolean(value.capture_har, "agentTask.artifact_policy.capture_har");
  assertOptionalBoolean(value.capture_performance, "agentTask.artifact_policy.capture_performance");
}

function assertAgentReplayHints(value: unknown): void {
  if (value === undefined) {
    return;
  }
  if (!isRecord(value)) {
    throw new RunnerMessageValidationError("agentTask.replay_hints must be an object");
  }
  assertAllowedObjectKeys(value, "agentTask.replay_hints", [
    "source_trace_id",
    "source_plan_id",
    "steps"
  ]);
  assertOptionalNullableNonEmptyString(value.source_trace_id, "agentTask.replay_hints.source_trace_id");
  assertOptionalNullableNonEmptyString(value.source_plan_id, "agentTask.replay_hints.source_plan_id");

  if (!Array.isArray(value.steps)) {
    throw new RunnerMessageValidationError("agentTask.replay_hints.steps must be an array");
  }

  value.steps.forEach((step, index) => {
    assertAgentReplayHintStep(step, `agentTask.replay_hints.steps[${index}]`);
  });
}

function assertAgentReplayHintStep(value: unknown, fieldName: string): void {
  if (!isRecord(value)) {
    throw new RunnerMessageValidationError(`${fieldName} must be an object`);
  }
  assertAllowedObjectKeys(value, fieldName, [
    "step_id",
    "stage",
    "description",
    "action",
    "settle_strategy",
    "target_key",
    "confidence"
  ]);
  assertOptionalNonEmptyString(value.step_id, `${fieldName}.step_id`);
  assertOptionalOneOf(value.stage, ["FIRST_VIEW", "VALUE", "CTA", "INPUT", "COMMIT"], `${fieldName}.stage`);
  assertOptionalNonEmptyString(value.description, `${fieldName}.description`);
  assertOptionalNullableNonEmptyString(value.target_key, `${fieldName}.target_key`);
  assertOptionalNumberRange(value.confidence, `${fieldName}.confidence`, 0, 1);

  if (!isRecord(value.action)) {
    throw new RunnerMessageValidationError(`${fieldName}.action must be an object`);
  }
  assertOneOf(value.action.type, scenarioActionTypes, `${fieldName}.action.type`);

  if (value.settle_strategy !== undefined) {
    if (!isRecord(value.settle_strategy)) {
      throw new RunnerMessageValidationError(`${fieldName}.settle_strategy must be an object`);
    }
    assertOneOf(value.settle_strategy.type, settleStrategyTypes, `${fieldName}.settle_strategy.type`);
    assertNumberRange(value.settle_strategy.timeout_ms, `${fieldName}.settle_strategy.timeout_ms`, 0, Number.MAX_SAFE_INTEGER);
  }
}

function assertNumberRange(value: unknown, fieldName: string, min: number, max: number): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new RunnerMessageValidationError(`${fieldName} must be a number between ${min} and ${max}`);
  }
}

function assertOptionalNumberRange(value: unknown, fieldName: string, min: number, max: number): void {
  if (value === undefined) {
    return;
  }
  assertNumberRange(value, fieldName, min, max);
}
