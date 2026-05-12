import type { ScenarioAuthoringExecuteMessage } from "../../shared/contracts.ts";
import { isRecord } from "../../shared/utils.ts";
import {
  assertBoolean,
  assertLiteralString,
  assertNonEmptyString,
  assertOneOf,
  assertOptionalIntegerMin,
  assertOptionalNullableNonEmptyString,
  assertOptionalOneOf,
  assertScenarioEnvironment,
  assertScenarioSafety,
  RunnerMessageValidationError
} from "./common.ts";

const SCENARIO_AUTHORING_MESSAGE_TYPE = "scenario-authoring.execute.request";
const DISCOVERY_FLOW_TYPES = [
  "LANDING_CTA",
  "SIGNUP_LEAD_FORM",
  "PRICING",
  "PURCHASE_CHECKOUT",
  "CONTACT",
  "CONTENT_ONLY"
] as const;
const DISCOVERY_RECOMMENDATION_LEVELS = ["HIGH", "MEDIUM", "LOW", "NOT_AVAILABLE"] as const;
const AUTHORING_PROVIDER_TYPES = ["CODEX", "CLAUDE_CODE", "INTERNAL_LLM", "RULE_BASED", "SERVICE_ACCOUNT", "OTHER"] as const;

export function assertScenarioAuthoringExecuteMessage(value: unknown): asserts value is ScenarioAuthoringExecuteMessage {
  if (!isRecord(value)) {
    throw new RunnerMessageValidationError("scenario authoring message must be a JSON object");
  }

  assertLiteralString(value.messageType, SCENARIO_AUTHORING_MESSAGE_TYPE, "scenario authoring messageType");
  assertNonEmptyString(value.messageId, "scenario authoring messageId");
  assertNonEmptyString(value.schemaVersion, "scenario authoring schemaVersion");
  assertNonEmptyString(value.createdAt, "scenario authoring createdAt");
  assertNonEmptyString(value.producer, "scenario authoring producer");
  assertScenarioAuthoringExecutePayload(value.payload);
}

function assertScenarioAuthoringExecutePayload(value: unknown): asserts value is ScenarioAuthoringExecuteMessage["payload"] {
  if (!isRecord(value)) {
    throw new RunnerMessageValidationError("scenario authoring payload must be an object");
  }

  assertNonEmptyString(value.authoringJobId, "scenario authoring payload.authoringJobId");
  assertNonEmptyString(value.projectId, "scenario authoring payload.projectId");
  assertNonEmptyString(value.sourceDiscoveryId, "scenario authoring payload.sourceDiscoveryId");
  assertNonEmptyString(value.requestedGoal, "scenario authoring payload.requestedGoal");
  assertScenarioAuthoringInput(value.input);
  assertScenarioAuthoringProviderPolicy(value.providerPolicy);
}

function assertScenarioAuthoringInput(value: unknown): void {
  if (!isRecord(value)) {
    throw new RunnerMessageValidationError("scenario authoring payload.input must be an object");
  }

  assertSiteDiscoveryResult(value.site_discovery_result);
  assertNonEmptyString(value.requested_goal, "scenario authoring payload.input.requested_goal");
  assertOptionalOneOf(value.preferred_scenario_type, DISCOVERY_FLOW_TYPES, "scenario authoring payload.input.preferred_scenario_type");
  assertSelectedRecommendation(value.selected_recommendation);
  if (value.constraints !== undefined && !isRecord(value.constraints)) {
    throw new RunnerMessageValidationError("scenario authoring payload.input.constraints must be an object");
  }
  assertScenarioEnvironment(value.environment);
  assertScenarioSafety(value.safety);
}

function assertSiteDiscoveryResult(value: unknown): void {
  if (!isRecord(value)) {
    throw new RunnerMessageValidationError("scenario authoring payload.input.site_discovery_result must be an object");
  }

  assertNonEmptyString(value.schema_version, "scenario authoring site_discovery_result.schema_version");
  assertNonEmptyString(value.discovery_id, "scenario authoring site_discovery_result.discovery_id");
  assertNonEmptyString(value.input_url, "scenario authoring site_discovery_result.input_url");
  assertNonEmptyString(value.final_url, "scenario authoring site_discovery_result.final_url");
  if (!Array.isArray(value.checkpoints)) {
    throw new RunnerMessageValidationError("scenario authoring site_discovery_result.checkpoints must be an array");
  }
  assertStringArray(value.detected_flow_types, "scenario authoring site_discovery_result.detected_flow_types");
  if (value.missing_flow_types !== undefined) {
    assertStringArray(value.missing_flow_types, "scenario authoring site_discovery_result.missing_flow_types");
  }
  if (!Array.isArray(value.scenario_recommendations)) {
    throw new RunnerMessageValidationError("scenario authoring site_discovery_result.scenario_recommendations must be an array");
  }
}

function assertSelectedRecommendation(value: unknown): void {
  if (value === undefined || value === null) {
    return;
  }
  if (!isRecord(value)) {
    throw new RunnerMessageValidationError("scenario authoring payload.input.selected_recommendation must be an object or null");
  }

  assertOneOf(value.scenario_type, DISCOVERY_FLOW_TYPES, "scenario authoring selected_recommendation.scenario_type");
  assertOptionalNullableNonEmptyString(value.recommendation_id, "scenario authoring selected_recommendation.recommendation_id");
  assertOneOf(value.recommendation_level, DISCOVERY_RECOMMENDATION_LEVELS, "scenario authoring selected_recommendation.recommendation_level");
  if (typeof value.confidence !== "number" || value.confidence < 0 || value.confidence > 1) {
    throw new RunnerMessageValidationError("scenario authoring selected_recommendation.confidence must be between 0 and 1");
  }
  assertStringArray(value.evidence_refs, "scenario authoring selected_recommendation.evidence_refs");
  if (value.suggested_start_url !== undefined && value.suggested_start_url !== null) {
    assertNonEmptyString(value.suggested_start_url, "scenario authoring selected_recommendation.suggested_start_url");
  }
  if (value.suggested_target !== undefined && value.suggested_target !== null && !isRecord(value.suggested_target)) {
    throw new RunnerMessageValidationError("scenario authoring selected_recommendation.suggested_target must be an object or null");
  }
}

function assertScenarioAuthoringProviderPolicy(value: unknown): void {
  if (!isRecord(value)) {
    throw new RunnerMessageValidationError("scenario authoring payload.providerPolicy must be an object");
  }

  assertProviderTypeArray(value.allowed_provider_types, "scenario authoring providerPolicy.allowed_provider_types");
  assertProviderTypeArray(value.provider_order, "scenario authoring providerPolicy.provider_order");
  assertOptionalIntegerMin(value.timeout_ms, "scenario authoring providerPolicy.timeout_ms", 1_000);
  assertBoolean(value.fallback_allowed, "scenario authoring providerPolicy.fallback_allowed");
  assertBoolean(value.approval_required, "scenario authoring providerPolicy.approval_required");
  assertOptionalIntegerMin(value.max_attempts, "scenario authoring providerPolicy.max_attempts", 1);
}

function assertProviderTypeArray(value: unknown, fieldName: string): void {
  if (!Array.isArray(value) || value.length === 0) {
    throw new RunnerMessageValidationError(`${fieldName} must be a non-empty array`);
  }
  for (const item of value) {
    assertOneOf(item, AUTHORING_PROVIDER_TYPES, fieldName);
  }
}

function assertStringArray(value: unknown, fieldName: string): void {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.length === 0)) {
    throw new RunnerMessageValidationError(`${fieldName} must be an array of non-empty strings`);
  }
}
