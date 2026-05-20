import type {
  DiscoveryEntrypointType,
  DiscoveryFlowType,
  DiscoveryScenarioRecommendation,
  ScenarioAuthoringCandidate,
  ScenarioAuthoringExecuteMessage,
  ScenarioAuthoringProviderTraceEntry,
  ScenarioAuthoringSelectedRecommendation,
  ScenarioPlan,
  ScenarioStage
} from "../shared/contracts.ts";
import { isRecord } from "../shared/utils.ts";
import { redactSensitiveValue } from "../agent/redaction.ts";
import { recordAiRequestMetrics, type AiRequestErrorType } from "../observability/metrics.ts";
import {
  aggregateValidation,
  resolveScenarioDepthId,
  validateScenarioPlanCandidate,
  type ScenarioAuthoringProviderResult
} from "./rule-based-provider.ts";

export const SCENARIO_AUTHORING_LLM_PROMPT_VERSION = "scenario-authoring-llm-v1";
const SUPPORTED_SETTLE_STRATEGY_TYPES = [
  "network_idle",
  "locator_visible",
  "response",
  "url_change",
  "spinner_hidden",
  "item_count_change",
  "fixed_short",
  "none"
] as const satisfies readonly ScenarioPlan["steps"][number]["settle_strategy"]["type"][];

type ScenarioPlanStep = ScenarioPlan["steps"][number];
type ScenarioSettleStrategy = ScenarioPlanStep["settle_strategy"];
type ScenarioSettleStrategyType = ScenarioSettleStrategy["type"];

export interface ScenarioAuthoringLlmRequest {
  endpoint: string;
  apiKey?: string;
  model: string;
  timeoutMs: number;
  payload: Record<string, unknown>;
}

export interface ScenarioAuthoringLlmTransport {
  complete: (request: ScenarioAuthoringLlmRequest) => Promise<unknown>;
}

export interface ScenarioAuthoringLlmProviderOptions {
  endpoint?: string;
  apiKey?: string;
  model: string;
  timeoutMs: number;
  transport?: ScenarioAuthoringLlmTransport;
}

export class ScenarioAuthoringLlmProvider {
  private readonly options: ScenarioAuthoringLlmProviderOptions;
  private readonly transport: ScenarioAuthoringLlmTransport;

  constructor(options: ScenarioAuthoringLlmProviderOptions) {
    this.options = options;
    this.transport = options.transport ?? createFetchScenarioAuthoringLlmTransport();
  }

  async create(message: ScenarioAuthoringExecuteMessage): Promise<ScenarioAuthoringProviderResult> {
    if (!this.options.endpoint) {
      throw new Error("ScenarioAuthoring INTERNAL_LLM endpoint is not configured");
    }

    const startedAt = new Date();
    const context = resolveAuthoringContext(message);
    const rawResponse = await this.transport.complete({
      endpoint: this.options.endpoint,
      apiKey: this.options.apiKey,
      model: this.options.model,
      timeoutMs: Math.min(this.options.timeoutMs, message.payload.providerPolicy.timeout_ms),
      payload: createScenarioAuthoringLlmRequestPayload(message, context, this.options.model, this.options.endpoint)
    });
    const candidate = parseScenarioAuthoringCandidate(rawResponse, message, context);
    const validation = aggregateValidation([candidate]);
    const finishedAt = new Date();

    if (!validation.schema_valid || !validation.safety_valid || !validation.fit_requirements_valid) {
      throw new ScenarioAuthoringLlmValidationError(validation.errors[0]?.message ?? "ScenarioAuthoring INTERNAL_LLM candidate failed validation");
    }

    return {
      providerTrace: [
        {
          provider_type: "INTERNAL_LLM",
          provider_name: "runner-gms-scenario-authoring",
          provider_version: SCENARIO_AUTHORING_LLM_PROMPT_VERSION,
          model_or_agent: this.options.model,
          status: "SUCCEEDED",
          confidence: candidate.confidence,
          started_at: startedAt.toISOString(),
          finished_at: finishedAt.toISOString()
        }
      ],
      candidates: [candidate],
      validation,
      provenance: {
        source_discovery_id: message.payload.sourceDiscoveryId,
        source_recommendation_refs: candidate.source_recommendation_refs ?? [],
        source_evidence_refs: candidate.evidence_refs,
        prompt_version: SCENARIO_AUTHORING_LLM_PROMPT_VERSION,
        input_summary: `GMS authored ${context.scenarioType} ScenarioPlan candidate from Discovery ${message.payload.sourceDiscoveryId}.`,
        generated_at: finishedAt.toISOString()
      }
    };
  }
}

export class ScenarioAuthoringLlmValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScenarioAuthoringLlmValidationError";
  }
}

export function createFailedInternalLlmTrace(
  options: Pick<ScenarioAuthoringLlmProviderOptions, "model">,
  startedAt: Date,
  error: unknown
): ScenarioAuthoringProviderTraceEntry {
  return {
    provider_type: "INTERNAL_LLM",
    provider_name: "runner-gms-scenario-authoring",
    provider_version: SCENARIO_AUTHORING_LLM_PROMPT_VERSION,
    model_or_agent: options.model,
    status: error instanceof DOMException && error.name === "AbortError" ? "TIMED_OUT" : "FAILED",
    fallback_reason: error instanceof Error ? error.message : String(error),
    started_at: startedAt.toISOString(),
    finished_at: new Date().toISOString()
  };
}

export function createFetchScenarioAuthoringLlmTransport(): ScenarioAuthoringLlmTransport {
  return {
    async complete(request) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), request.timeoutMs);
      const startedAt = performance.now();

      try {
        const response = await fetch(request.endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(request.apiKey ? { authorization: `Bearer ${request.apiKey}` } : {})
          },
          body: JSON.stringify(request.payload),
          signal: controller.signal
        });

        if (!response.ok) {
          throw new ScenarioAuthoringLlmHttpError(response.status);
        }

        try {
          const payload = await response.json();
          recordScenarioAuthoringLlmMetric(request, startedAt, "none");
          return payload;
        } catch (error) {
          throw new ScenarioAuthoringLlmInvalidJsonError("ScenarioAuthoring LLM response body must be valid JSON", { cause: error });
        }
      } catch (error) {
        recordScenarioAuthoringLlmMetric(request, startedAt, classifyScenarioAuthoringLlmError(error));
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    }
  };
}

class ScenarioAuthoringLlmHttpError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`ScenarioAuthoring LLM request failed with status ${status}`);
    this.name = "ScenarioAuthoringLlmHttpError";
    this.status = status;
  }
}

class ScenarioAuthoringLlmInvalidJsonError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ScenarioAuthoringLlmInvalidJsonError";
  }
}

interface AuthoringContext {
  selectedRecommendation: DiscoveryScenarioRecommendation | ScenarioAuthoringSelectedRecommendation | null;
  scenarioType: DiscoveryFlowType;
  startUrl: string;
  evidenceRefs: string[];
  recommendationRefs: string[];
}

function resolveAuthoringContext(message: ScenarioAuthoringExecuteMessage): AuthoringContext {
  const selectedRecommendation = message.payload.input.selected_recommendation ?? selectRecommendation(message);
  const scenarioType = selectedRecommendation?.scenario_type ?? message.payload.input.preferred_scenario_type ?? "LANDING_CTA";
  const startUrl = resolveStartUrl(message, selectedRecommendation?.suggested_start_url ?? null);
  const evidenceRefs = selectedRecommendation?.evidence_refs ?? [];
  const recommendationRefs = [
    readRecommendationId(selectedRecommendation) ?? `${message.payload.sourceDiscoveryId}.recommendation.${scenarioType}`
  ];

  return {
    selectedRecommendation,
    scenarioType,
    startUrl,
    evidenceRefs,
    recommendationRefs
  };
}

function createScenarioAuthoringLlmRequestPayload(
  message: ScenarioAuthoringExecuteMessage,
  context: AuthoringContext,
  model: string,
  endpoint: string
): Record<string, unknown> {
  const userPayload = redactSensitiveValue({
    authoringJobId: message.payload.authoringJobId,
    projectId: message.payload.projectId,
    sourceDiscoveryId: message.payload.sourceDiscoveryId,
    requestedGoal: message.payload.requestedGoal,
    scenarioType: context.scenarioType,
    startUrl: context.startUrl,
    evidenceRefs: context.evidenceRefs,
    selectedRecommendation: context.selectedRecommendation,
    environment: message.payload.input.environment,
    safety: {
      ...message.payload.input.safety,
      allow_payment_commit: false,
      allow_destructive_action: false,
      stop_before_real_payment: true
    },
    constraints: message.payload.input.constraints ?? {},
    depthRequirement: describeDepthRequirement(message),
    outputContract: {
      candidate: {
        scenario_plan: {
          schema_version: "0.5",
          plan_id: `${message.payload.authoringJobId}_internal_llm_001`,
          scenario_type: "custom_compiled",
          source_discovery_id: message.payload.sourceDiscoveryId,
          goal: message.payload.requestedGoal,
          start_url: context.startUrl,
          environment: message.payload.input.environment,
          safety: "copy the supplied hardened safety object exactly",
          fit_requirements: {
            required_flow_type: context.scenarioType,
            required_entrypoint_types: requiredEntrypoints(context.scenarioType),
            fallback_allowed: true,
            minimum_confidence: 0.5,
            required_evidence_refs: context.evidenceRefs
          },
          steps: [
            {
              step_id: "step_001_goto",
              stage: "FIRST_VIEW",
              description: "open the recommended start URL",
              action: { type: "goto", target: context.startUrl },
              settle_strategy: { type: "network_idle", timeout_ms: 3000 },
              checkpoint: true
            }
          ],
          settle_strategy_allowed_types: SUPPORTED_SETTLE_STRATEGY_TYPES,
          settle_strategy_rules: [
            "Use only settle_strategy.type values from settle_strategy_allowed_types.",
            "Do not invent wait_for_cta, wait_for_selector, page_load, dom_stable, load, or similar custom settle types.",
            "Use network_idle after goto or ordinary click navigation, locator_visible only when a concrete target locator is supplied, fixed_short for scroll or generic wait, and none for checkpoint/stop_when."
          ]
        },
        confidence: "0..1",
        rationale: "short Korean or English rationale",
        evidence_refs: context.evidenceRefs
      }
    }
  });

  const instructions = [
    "Return only JSON for a Wedge ScenarioAuthoring candidate.",
    "Create one safe, deterministic ScenarioPlan candidate from Discovery evidence and user goal.",
    "Use only ScenarioPlan actions: goto, click, scroll, fill, select, wait_for, checkpoint, stop_when.",
    `Use only ScenarioPlan settle_strategy.type values: ${SUPPORTED_SETTLE_STRATEGY_TYPES.join(", ")}.`,
    "Never emit custom settle_strategy.type values such as wait_for_cta, wait_for_selector, page_load, dom_stable, load, or settled.",
    "Never include credentials, real payment commit, destructive actions, arbitrary JavaScript, shell commands, or invented external URLs.",
    "Prefer evidence-backed targets from selectedRecommendation.suggested_target.",
    "For purchase or form flows, stop before real payment or real submit.",
    "Honor constraints.depthId: hero-only stays on the first view, next-screen must advance and checkpoint, form-depth must advance to INPUT or COMMIT and checkpoint before submit/payment."
  ].join(" ");

  if (isResponsesEndpoint(endpoint)) {
    return {
      model,
      text: {
        format: {
          type: "json_object"
        }
      },
      input: [
        {
          role: "system",
          content: instructions
        },
        {
          role: "user",
          content: JSON.stringify(userPayload)
        }
      ]
    };
  }

  return {
    model,
    temperature: 0,
    response_format: {
      type: "json_object"
    },
    messages: [
      {
        role: "system",
        content: instructions
      },
      {
        role: "user",
        content: JSON.stringify(userPayload)
      }
    ]
  };
}

function parseScenarioAuthoringCandidate(
  rawResponse: unknown,
  message: ScenarioAuthoringExecuteMessage,
  context: AuthoringContext
): ScenarioAuthoringCandidate {
  const record = asRecord(extractJsonCandidate(rawResponse), "ScenarioAuthoring LLM response");
  const candidateRecord = asRecord(record.candidate ?? record, "ScenarioAuthoring LLM candidate");
  const rawScenarioPlan = asRecord(candidateRecord.scenario_plan, "ScenarioAuthoring LLM candidate.scenario_plan");
  const scenarioPlan = normalizeScenarioPlan(rawScenarioPlan, message, context);
  const validation = validateScenarioPlanCandidate(
    scenarioPlan,
    context.startUrl,
    message.payload.input.environment.device,
    resolveScenarioDepthId(message)
  );

  return {
    candidate_id: readString(candidateRecord, "candidate_id") ?? `internal_llm_${context.scenarioType.toLowerCase()}_001`,
    scenario_plan: scenarioPlan,
    confidence: clampConfidence(readNumber(candidateRecord, "confidence") ?? 0.75),
    rationale: readString(candidateRecord, "rationale") ?? `GMS authored a ${context.scenarioType} ScenarioPlan candidate from Discovery evidence.`,
    evidence_refs: readStringArray(candidateRecord.evidence_refs) ?? context.evidenceRefs,
    source_recommendation_refs: context.recommendationRefs,
    validation
  };
}

function normalizeScenarioPlan(
  rawPlan: Record<string, unknown>,
  message: ScenarioAuthoringExecuteMessage,
  context: AuthoringContext
): ScenarioPlan {
  const rawSteps = rawPlan.steps;
  if (!Array.isArray(rawSteps) || rawSteps.length === 0) {
    throw new ScenarioAuthoringLlmValidationError("ScenarioAuthoring LLM scenario_plan.steps must be a non-empty array");
  }
  const steps = normalizeScenarioSteps(rawSteps);

  const plan = {
    ...rawPlan,
    schema_version: "0.5",
    plan_id: readString(rawPlan, "plan_id") ?? `${message.payload.authoringJobId}_internal_llm_001`,
    scenario_type: "custom_compiled",
    source_discovery_id: message.payload.sourceDiscoveryId,
    goal: message.payload.requestedGoal,
    start_url: context.startUrl,
    environment: message.payload.input.environment,
    safety: {
      ...message.payload.input.safety,
      allow_payment_commit: false,
      allow_destructive_action: false,
      stop_before_real_payment: true
    },
    fit_requirements: normalizeFitRequirements(rawPlan.fit_requirements, context),
    steps
  };

  return plan as ScenarioPlan;
}

function normalizeScenarioSteps(rawSteps: unknown[]): ScenarioPlanStep[] {
  return rawSteps.map((rawStep) => {
    if (!isRecord(rawStep)) {
      return rawStep as ScenarioPlanStep;
    }

    const action = isRecord(rawStep.action) ? rawStep.action : {};
    const actionType = typeof action.type === "string" ? action.type : null;
    const settleStrategy = normalizeSettleStrategy(rawStep.settle_strategy, actionType);

    return {
      ...rawStep,
      settle_strategy: settleStrategy
    } as ScenarioPlanStep;
  });
}

function normalizeSettleStrategy(value: unknown, actionType: string | null): ScenarioSettleStrategy {
  const raw = isRecord(value) ? value : {};
  const rawType = typeof raw.type === "string" ? raw.type : null;
  const type = resolveSettleStrategyType(rawType, raw, actionType);
  const timeoutMs = typeof raw.timeout_ms === "number" && raw.timeout_ms >= 0
    ? raw.timeout_ms
    : defaultSettleTimeoutMs(type);

  return {
    ...raw,
    type,
    timeout_ms: timeoutMs
  } as ScenarioSettleStrategy;
}

function resolveSettleStrategyType(
  rawType: string | null,
  rawSettleStrategy: Record<string, unknown>,
  actionType: string | null
): ScenarioSettleStrategyType {
  if (rawType && isSupportedSettleStrategyType(rawType)) {
    return rawType;
  }

  const normalized = (rawType ?? "").trim().toLowerCase().replaceAll(/[\s-]+/g, "_");
  if (normalized === "wait_for_cta"
    || normalized === "wait_for_selector"
    || normalized === "selector_visible"
    || normalized === "element_visible"
    || normalized === "visible"
    || normalized === "wait_until_visible") {
    return isRecord(rawSettleStrategy.target) || typeof rawSettleStrategy.target === "string"
      ? "locator_visible"
      : fallbackSettleStrategyType(actionType);
  }
  if (normalized === "wait_for_url" || normalized === "url_changed" || normalized === "url") {
    return "url_change";
  }
  if (normalized === "page_load" || normalized === "load" || normalized === "loaded") {
    return "network_idle";
  }
  if (normalized === "dom_stable"
    || normalized === "settled"
    || normalized === "sleep"
    || normalized === "delay"
    || normalized === "wait") {
    return "fixed_short";
  }

  return fallbackSettleStrategyType(actionType);
}

function isSupportedSettleStrategyType(value: string): value is ScenarioSettleStrategyType {
  return SUPPORTED_SETTLE_STRATEGY_TYPES.includes(value as ScenarioSettleStrategyType);
}

function fallbackSettleStrategyType(actionType: string | null): ScenarioSettleStrategyType {
  if (actionType === "checkpoint" || actionType === "stop_when") {
    return "none";
  }
  if (actionType === "scroll" || actionType === "wait_for") {
    return "fixed_short";
  }
  return "network_idle";
}

function defaultSettleTimeoutMs(type: ScenarioSettleStrategyType): number {
  return type === "none" ? 0 : 3_000;
}

function normalizeFitRequirements(value: unknown, context: AuthoringContext): NonNullable<ScenarioPlan["fit_requirements"]> {
  const raw = isRecord(value) ? value : {};
  return {
    ...raw,
    required_flow_type: context.scenarioType,
    required_entrypoint_types: readEntrypointArray(raw.required_entrypoint_types) ?? requiredEntrypoints(context.scenarioType),
    fallback_allowed: true,
    minimum_confidence: typeof raw.minimum_confidence === "number" ? raw.minimum_confidence : 0.5,
    required_evidence_refs: readStringArray(raw.required_evidence_refs) ?? context.evidenceRefs
  };
}

function extractJsonCandidate(rawResponse: unknown): unknown {
  const responseRecord = isRecord(rawResponse) ? rawResponse : null;
  const choices = responseRecord?.choices;
  if (Array.isArray(choices)) {
    const firstChoice = choices[0] as { message?: { content?: unknown } } | undefined;
    const content = firstChoice?.message?.content;
    if (typeof content === "string") {
      try {
        return JSON.parse(content) as unknown;
      } catch (error) {
        throw new ScenarioAuthoringLlmInvalidJsonError("ScenarioAuthoring LLM message content must be valid JSON", { cause: error });
      }
    }
  }

  const outputText = responseRecord?.output_text;
  if (typeof outputText === "string") {
    return parseJsonResponseText(outputText, "ScenarioAuthoring LLM output_text");
  }

  const responseOutputText = extractResponsesOutputText(responseRecord?.output);
  if (responseOutputText) {
    return parseJsonResponseText(responseOutputText, "ScenarioAuthoring LLM output content");
  }

  return rawResponse;
}

function isResponsesEndpoint(endpoint: string): boolean {
  try {
    return new URL(endpoint).pathname.endsWith("/responses");
  } catch {
    return endpoint.endsWith("/responses");
  }
}

function extractResponsesOutputText(output: unknown): string | null {
  if (!Array.isArray(output)) {
    return null;
  }

  for (const item of output) {
    if (!isRecord(item)) {
      continue;
    }
    const content = item.content;
    if (!Array.isArray(content)) {
      continue;
    }
    for (const part of content) {
      if (!isRecord(part)) {
        continue;
      }
      if (part.type === "output_text" && typeof part.text === "string") {
        return part.text;
      }
    }
  }

  return null;
}

function parseJsonResponseText(text: string, label: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new ScenarioAuthoringLlmInvalidJsonError(`${label} must be valid JSON`, { cause: error });
  }
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (isRecord(value)) {
    return value;
  }
  throw new ScenarioAuthoringLlmValidationError(`${label} must be an object`);
}

function selectRecommendation(message: ScenarioAuthoringExecuteMessage) {
  const preferredScenarioType = message.payload.input.preferred_scenario_type;
  const recommendations = message.payload.input.site_discovery_result.scenario_recommendations;
  return recommendations.find((recommendation) => recommendation.scenario_type === preferredScenarioType)
    ?? recommendations[0]
    ?? null;
}

function readRecommendationId(
  recommendation: DiscoveryScenarioRecommendation | ScenarioAuthoringSelectedRecommendation | null
): string | null {
  if (!recommendation || !("recommendation_id" in recommendation)) {
    return null;
  }
  return typeof recommendation.recommendation_id === "string" && recommendation.recommendation_id.length > 0
    ? recommendation.recommendation_id
    : null;
}

function resolveStartUrl(message: ScenarioAuthoringExecuteMessage, suggestedStartUrl: string | null): string {
  if (suggestedStartUrl && suggestedStartUrl.length > 0) {
    return suggestedStartUrl;
  }

  const { site_discovery_result: siteDiscoveryResult } = message.payload.input;
  return siteDiscoveryResult.final_url || siteDiscoveryResult.input_url;
}

function requiredEntrypoints(scenarioType: DiscoveryFlowType): DiscoveryEntrypointType[] {
  if (scenarioType === "SIGNUP_LEAD_FORM") {
    return ["signup", "form"];
  }
  if (scenarioType === "PRICING") {
    return ["pricing"];
  }
  if (scenarioType === "PURCHASE_CHECKOUT") {
    return ["cta", "pricing", "cart", "checkout"];
  }
  if (scenarioType === "CONTACT") {
    return ["contact", "form"];
  }
  if (scenarioType === "CONTENT_ONLY") {
    return ["content"];
  }
  return ["cta"];
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readNumber(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readStringArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : null;
}

function readEntrypointArray(value: unknown): DiscoveryEntrypointType[] | null {
  const strings = readStringArray(value);
  return strings ? strings as DiscoveryEntrypointType[] : null;
}

function describeDepthRequirement(message: ScenarioAuthoringExecuteMessage): string {
  const depthId = resolveScenarioDepthId(message);
  if (depthId === "hero-only") {
    return "depthId=hero-only: stay on the first view; use goto/checkpoint only and do not click, scroll, fill, select, or wait for a later screen.";
  }
  if (depthId === "next-screen") {
    return "depthId=next-screen: include an advancing click or scroll and a later checkpoint that records the destination/context.";
  }
  if (depthId === "form-depth") {
    return "depthId=form-depth: include an advancing action to a form/checkout/input stage and a checkpoint before real submit or payment.";
  }
  return "No explicit depthId constraint was supplied; follow the requestedGoal depth wording if present.";
}

function clampConfidence(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function recordScenarioAuthoringLlmMetric(
  request: ScenarioAuthoringLlmRequest,
  startedAt: number,
  errorType: AiRequestErrorType
): void {
  recordAiRequestMetrics({
    service: "runner",
    feature: "scenario_authoring",
    model: request.model,
    status: errorType === "none" ? "success" : "error",
    errorType,
    durationMs: performance.now() - startedAt
  });
}

function classifyScenarioAuthoringLlmError(error: unknown): AiRequestErrorType {
  if (error instanceof ScenarioAuthoringLlmHttpError) {
    return "http_error";
  }
  if (error instanceof ScenarioAuthoringLlmInvalidJsonError || error instanceof ScenarioAuthoringLlmValidationError) {
    return "invalid_json";
  }
  if (error instanceof DOMException && error.name === "AbortError") {
    return "timeout";
  }
  if (error instanceof TypeError) {
    return "network_error";
  }
  return "unknown";
}
