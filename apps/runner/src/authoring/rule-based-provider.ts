import type {
  DiscoveryEntrypointType,
  DiscoveryFlowType,
  DiscoveryScenarioRecommendation,
  ScenarioAuthoringCandidate,
  ScenarioAuthoringExecuteMessage,
  ScenarioAuthoringProvenance,
  ScenarioAuthoringProviderTraceEntry,
  ScenarioAuthoringSelectedRecommendation,
  ScenarioAuthoringValidation,
  ScenarioPlan,
  ScenarioStage,
  ScenarioStep,
  TargetDescriptorMap
} from "../shared/contracts.ts";
import { assertScenarioPlan } from "../messaging/validators/common.ts";

export interface ScenarioAuthoringProviderResult {
  providerTrace: ScenarioAuthoringProviderTraceEntry[];
  candidates: ScenarioAuthoringCandidate[];
  validation: ScenarioAuthoringValidation;
  provenance: ScenarioAuthoringProvenance;
}

export function createRuleBasedScenarioAuthoringResult(
  message: ScenarioAuthoringExecuteMessage,
  now: Date = new Date()
): ScenarioAuthoringProviderResult {
  const startedAt = now.toISOString();
  const selectedRecommendation = message.payload.input.selected_recommendation ?? selectRecommendation(message);
  const scenarioType = selectedRecommendation?.scenario_type ?? message.payload.input.preferred_scenario_type ?? "LANDING_CTA";
  const startUrl = resolveStartUrl(message, selectedRecommendation?.suggested_start_url ?? null);
  const evidenceRefs = selectedRecommendation?.evidence_refs ?? [];
  const candidateId = `rule_based_${scenarioType.toLowerCase()}_001`;
  const depthId = resolveScenarioDepthId(message);
  const scenarioPlan = createScenarioPlan({
    message,
    scenarioType,
    startUrl,
    candidateId,
    evidenceRefs,
    suggestedTarget: selectedRecommendation?.suggested_target ?? null,
    firstViewOnly: isFirstViewOnlyDepth(depthId, message.payload.requestedGoal)
  });
  const candidateValidation = validateScenarioPlanCandidate(
    scenarioPlan,
    startUrl,
    message.payload.input.environment.device,
    depthId
  );
  const candidates: ScenarioAuthoringCandidate[] = [
    {
      candidate_id: candidateId,
      scenario_plan: scenarioPlan,
      confidence: selectedRecommendation?.confidence ?? 0.72,
      rationale: `RULE_BASED provider compiled a conservative ${scenarioType} ScenarioPlan candidate from the selected Discovery recommendation.`,
      evidence_refs: evidenceRefs,
      source_recommendation_refs: [
        readRecommendationId(selectedRecommendation) ?? `${message.payload.sourceDiscoveryId}.recommendation.${scenarioType}`
      ],
      validation: candidateValidation
    }
  ];
  const validation = aggregateValidation(candidates);
  const finishedAt = new Date(now.getTime() + 1).toISOString();

  return {
    providerTrace: [
      {
        provider_type: "RULE_BASED",
        provider_name: "runner-rule-based-scenario-authoring",
        provider_version: "scenario-authoring-v1",
        model_or_agent: null,
        status: validation.schema_valid && validation.safety_valid && validation.fit_requirements_valid ? "SUCCEEDED" : "FAILED",
        confidence: candidates[0]?.confidence ?? null,
        started_at: startedAt,
        finished_at: finishedAt
      }
    ],
    candidates,
    validation,
    provenance: {
      source_discovery_id: message.payload.sourceDiscoveryId,
      source_recommendation_refs: candidates[0]?.source_recommendation_refs ?? [],
      source_evidence_refs: evidenceRefs,
      prompt_version: "scenario-authoring-v1",
      input_summary: `Runner compiled ${scenarioType} from Discovery ${message.payload.sourceDiscoveryId}.`,
      generated_at: finishedAt
    }
  };
}

function createScenarioPlan({
  message,
  scenarioType,
  startUrl,
  candidateId,
  evidenceRefs,
  suggestedTarget,
  firstViewOnly
}: {
  message: ScenarioAuthoringExecuteMessage;
  scenarioType: DiscoveryFlowType;
  startUrl: string;
  candidateId: string;
  evidenceRefs: string[];
  suggestedTarget: TargetDescriptorMap | null;
  firstViewOnly: boolean;
}): ScenarioPlan {
  return {
    schema_version: "0.5",
    plan_id: `${message.payload.authoringJobId}_${candidateId}`,
    scenario_type: "custom_compiled",
    source_discovery_id: message.payload.sourceDiscoveryId,
    goal: message.payload.requestedGoal,
    start_url: startUrl,
    environment: message.payload.input.environment,
    safety: {
      ...message.payload.input.safety,
      allow_payment_commit: false,
      allow_destructive_action: false,
      stop_before_real_payment: true
    },
    fit_requirements: {
      required_flow_type: scenarioType,
      required_entrypoint_types: requiredEntrypoints(scenarioType),
      fallback_allowed: true,
      minimum_confidence: 0.5,
      required_evidence_refs: evidenceRefs
    },
    steps: stepsFor(scenarioType, startUrl, suggestedTarget, firstViewOnly)
  };
}

function stepsFor(
  scenarioType: DiscoveryFlowType,
  startUrl: string,
  suggestedTarget: TargetDescriptorMap | null,
  firstViewOnly: boolean
): ScenarioStep[] {
  const steps: ScenarioStep[] = [
    step("step_001_goto", "FIRST_VIEW", "추천된 시작 화면을 열어 첫 화면을 확인한다.", { type: "goto", target: startUrl }, "network_idle", true),
    step("step_002_first_view_checkpoint", "FIRST_VIEW", "첫 화면에서 핵심 맥락과 주요 진입점을 기록한다.", { type: "checkpoint" }, "none", true)
  ];

  if (firstViewOnly) {
    steps.push(
      step(
        "step_003_first_view_only_checkpoint",
        "FIRST_VIEW",
        "첫 화면만 보기 요청이므로 추천 진입점을 클릭하지 않고 현재 화면 근거를 기록한다.",
        { type: "checkpoint", target: suggestedTarget ?? undefined },
        "none",
        true
      )
    );
  } else if (scenarioType === "PURCHASE_CHECKOUT" && suggestedTarget && Object.keys(suggestedTarget).length > 0) {
    steps.push(
      step(
        "step_003_probe_checkout_target",
        "CTA",
        "추천된 장바구니/결제 진입점까지 이동 가능성을 확인한다.",
        { type: "click", target: suggestedTarget },
        "network_idle",
        false
      ),
      step(
        "step_004_checkout_destination_checkpoint",
        "INPUT",
        "결제/구매 commit 전 도착 화면의 맥락과 위험 신호를 기록한다.",
        { type: "checkpoint" },
        "none",
        true
      )
    );
  } else if (scenarioType === "SIGNUP_LEAD_FORM" || scenarioType === "CONTACT") {
    if (suggestedTarget && Object.keys(suggestedTarget).length > 0) {
      steps.push(
        step(
          "step_003_probe_form_target",
          "INPUT",
          scenarioType === "CONTACT"
            ? "추천된 문의/상담 신청 진입점까지 이동 가능성을 확인한다."
            : "추천된 가입/리드 양식 진입점까지 이동 가능성을 확인한다.",
          { type: "click", target: suggestedTarget },
          "network_idle",
          false
        ),
        step(
          "step_004_form_destination_checkpoint",
          "INPUT",
          "실제 제출 전 도착 화면의 입력 부담과 신뢰 요소를 기록한다.",
          { type: "checkpoint" },
          "none",
          true
        )
      );
    } else {
      steps.push(
        step(
          "step_003_scan_for_form_entrypoint",
          "CTA",
          scenarioType === "CONTACT"
            ? "추천 target이 없으므로 문의/상담 신청 진입점을 찾기 위해 다음 화면 영역을 탐색한다."
            : "추천 target이 없으므로 가입/리드 양식 진입점을 찾기 위해 다음 화면 영역을 탐색한다.",
          { type: "scroll", value: 700 },
          "fixed_short",
          false
        ),
        step(
          "step_004_form_scan_checkpoint",
          "INPUT",
          "탐색 후 화면에서 입력 양식 후보와 제출 전 신뢰 요소를 기록한다.",
          { type: "checkpoint" },
          "none",
          true
        )
      );
    }
  } else if (suggestedTarget && Object.keys(suggestedTarget).length > 0 && scenarioType !== "CONTENT_ONLY") {
    if (shouldClickSuggestedTarget(scenarioType, suggestedTarget)) {
      steps.push(
        step(
          "step_003_probe_recommended_target",
          stageFor(scenarioType),
          "추천된 진입점으로 다음 화면 이동 가능성을 확인한다.",
          { type: "click", target: suggestedTarget },
          "network_idle",
          false
        ),
        step(
          "step_004_destination_checkpoint",
          stageFor(scenarioType),
          "이동 후 도착 화면의 맥락과 다음 행동을 기록한다.",
          { type: "checkpoint" },
          "none",
          true
        )
      );
    } else {
      steps.push(
        step(
          "step_003_recommended_target_checkpoint",
          stageFor(scenarioType),
          "자동 선택하지 않고 추천 진입점의 대상 근거만 기록한다.",
          { type: "checkpoint", target: suggestedTarget },
          "none",
          true
        )
      );
    }
  } else if (scenarioType === "LANDING_CTA" || scenarioType === "PRICING" || scenarioType === "PURCHASE_CHECKOUT") {
    steps.push(
      step(
        "step_003_scan_for_goal_entrypoint",
        stageFor(scenarioType),
        "추천 target이 없으므로 목표와 맞는 진입점을 찾기 위해 다음 화면 영역을 탐색한다.",
        { type: "scroll", value: 700 },
        "fixed_short",
        false
      ),
      step(
        "step_004_goal_scan_checkpoint",
        stageFor(scenarioType),
        "탐색 후 화면에서 목표 관련 진입점과 다음 행동 후보를 기록한다.",
        { type: "checkpoint" },
        "none",
        true
      )
    );
  } else {
    steps.push(
      step(
        "step_003_context_checkpoint",
        stageFor(scenarioType),
        "추천 흐름 실행 전 현재 화면 맥락을 기록한다.",
        { type: "checkpoint" },
        "none",
        true
      )
    );
  }

  if (scenarioType === "PURCHASE_CHECKOUT") {
    steps.push(stopStep("step_005_stop_before_payment", "실제 결제/구매 commit 전에 중단한다.", "before_payment_commit"));
  }
  if (scenarioType === "SIGNUP_LEAD_FORM" || scenarioType === "CONTACT") {
    steps.push(stopStep("step_005_stop_before_submit", "실제 form 제출 전에 중단한다.", "before_real_submit"));
  }

  return steps;
}

export type ScenarioDepthId = "hero-only" | "next-screen" | "form-depth";

export function resolveScenarioDepthId(message: ScenarioAuthoringExecuteMessage): ScenarioDepthId | null {
  const depthId = message.payload.input.constraints?.depthId;
  return depthId === "hero-only" || depthId === "next-screen" || depthId === "form-depth" ? depthId : null;
}

function isFirstViewOnlyDepth(depthId: ScenarioDepthId | null, goal: string): boolean {
  return depthId === "hero-only" || (depthId === null && isFirstViewOnlyGoal(goal));
}

function isFirstViewOnlyGoal(goal: string): boolean {
  const normalized = goal.toLowerCase().replaceAll(/\s+/g, "");
  return normalized.includes("첫화면만")
    || normalized.includes("첫화면보기")
    || normalized.includes("firstviewonly")
    || normalized.includes("firstscreenonly")
    || normalized.includes("above-the-foldonly")
    || normalized.includes("abovethefoldonly");
}

function step(
  stepId: string,
  stage: ScenarioStage,
  description: string,
  action: ScenarioStep["action"],
  settleType: ScenarioStep["settle_strategy"]["type"],
  checkpoint: boolean
): ScenarioStep {
  return {
    step_id: stepId,
    stage,
    description,
    action,
    settle_strategy: {
      type: settleType,
      timeout_ms: settleType === "none" ? 0 : 3_000
    },
    checkpoint
  };
}

function stopStep(stepId: string, description: string, condition: string): ScenarioStep {
  return {
    ...step(stepId, "COMMIT", description, { type: "stop_when" }, "none", false),
    stop_condition: { condition }
  };
}

function allowsRuleBasedClick(scenarioType: DiscoveryFlowType): boolean {
  return scenarioType === "LANDING_CTA" || scenarioType === "PRICING";
}

function shouldClickSuggestedTarget(scenarioType: DiscoveryFlowType, target: TargetDescriptorMap): boolean {
  if (!allowsRuleBasedClick(scenarioType)) {
    return false;
  }

  if (scenarioType !== "LANDING_CTA") {
    return true;
  }

  const searchable = normalizeTargetText(target);
  if (isVolatileContentTarget(searchable)) {
    return false;
  }

  return hasAny(searchable, [
    "get started",
    "sign up",
    "signup",
    "register",
    "trial",
    "start",
    "시작",
    "회원가입",
    "가입",
    "체험"
  ]);
}

function isVolatileContentTarget(searchable: string): boolean {
  return /(^|[^0-9])\d+\s*위/.test(searchable)
    || hasAny(searchable, [
      "화 무료",
      "회 무료",
      "webtoon",
      "novel",
      "series.naver.com",
      "originalproductid"
    ]);
}

function normalizeTargetText(target: TargetDescriptorMap): string {
  return [
    target.text,
    target.selector,
    target.href_contains,
    target.name,
    target.placeholder,
    target.label,
    target.aria_label
  ]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(" ")
    .replaceAll(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function hasAny(value: string, keywords: string[]): boolean {
  return keywords.some((keyword) => value.includes(keyword));
}

function stageFor(scenarioType: DiscoveryFlowType): ScenarioStage {
  if (scenarioType === "PRICING") {
    return "VALUE";
  }
  if (scenarioType === "PURCHASE_CHECKOUT") {
    return "COMMIT";
  }
  if (scenarioType === "SIGNUP_LEAD_FORM") {
    return "INPUT";
  }
  return "CTA";
}

function requiredEntrypoints(scenarioType: DiscoveryFlowType): DiscoveryEntrypointType[] {
  if (scenarioType === "SIGNUP_LEAD_FORM") {
    return ["signup", "form"];
  }
  if (scenarioType === "PRICING") {
    return ["pricing"];
  }
  if (scenarioType === "PURCHASE_CHECKOUT") {
    return ["pricing", "cart", "checkout"];
  }
  if (scenarioType === "CONTACT") {
    return ["contact", "form"];
  }
  if (scenarioType === "CONTENT_ONLY") {
    return ["content"];
  }
  return ["cta"];
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

export function validateScenarioPlanCandidate(
  scenarioPlan: ScenarioPlan,
  expectedStartUrl: string,
  expectedDevice: string,
  depthId: ScenarioDepthId | null = null
): ScenarioAuthoringValidation {
  try {
    assertScenarioPlan(scenarioPlan);
    new URL(scenarioPlan.start_url);
    if (scenarioPlan.start_url !== expectedStartUrl) {
      throw new Error("scenarioPlan.start_url must match selected Discovery start URL");
    }
    if (scenarioPlan.environment.device !== expectedDevice) {
      throw new Error("scenarioPlan.environment.device must match ScenarioAuthoring input environment.device");
    }
    if (scenarioPlan.safety.allow_payment_commit || scenarioPlan.safety.allow_destructive_action) {
      throw new Error("scenarioPlan safety must block payment commit and destructive action");
    }
    validateScenarioDepthFit(scenarioPlan, depthId);

    return {
      schema_valid: true,
      safety_valid: true,
      fit_requirements_valid: true,
      errors: [],
      warnings: []
    };
  } catch (error) {
    return {
      schema_valid: false,
      safety_valid: false,
      fit_requirements_valid: false,
      errors: [
        {
          code: "scenario_plan_invalid",
          message: error instanceof Error ? error.message : String(error),
          path: "$.candidates[0].scenario_plan"
        }
      ],
      warnings: []
    };
  }
}

function validateScenarioDepthFit(scenarioPlan: ScenarioPlan, depthId: ScenarioDepthId | null): void {
  if (!depthId) {
    return;
  }

  const steps = scenarioPlan.steps;
  const firstAdvancingActionIndex = steps.findIndex((step) => isAdvancingAction(step.action.type));
  const hasCheckpointAfterAdvancingAction = firstAdvancingActionIndex >= 0 && steps
    .slice(firstAdvancingActionIndex + 1)
    .some((step) => step.checkpoint === true || step.action.type === "checkpoint");

  if (depthId === "hero-only") {
    const advancingStep = steps.find((step) => isAdvancingAction(step.action.type));
    if (advancingStep) {
      throw new Error(`scenarioPlan must not advance beyond the first view for depthId=hero-only; found ${advancingStep.action.type}`);
    }
    return;
  }

  if (depthId === "next-screen") {
    if (firstAdvancingActionIndex < 0 || !hasCheckpointAfterAdvancingAction) {
      throw new Error("scenarioPlan must include an advancing action and later checkpoint for depthId=next-screen");
    }
    return;
  }

  if (depthId === "form-depth") {
    const reachesFormStage = steps.some((step) => step.stage === "INPUT" || step.stage === "COMMIT");
    if (firstAdvancingActionIndex < 0 || !hasCheckpointAfterAdvancingAction || !reachesFormStage) {
      throw new Error("scenarioPlan must advance to an INPUT/COMMIT stage and checkpoint before submit/payment for depthId=form-depth");
    }
  }
}

function isAdvancingAction(actionType: ScenarioStep["action"]["type"]): boolean {
  return actionType === "click"
    || actionType === "scroll"
    || actionType === "fill"
    || actionType === "select"
    || actionType === "wait_for";
}

export function aggregateValidation(candidates: ScenarioAuthoringCandidate[]): ScenarioAuthoringValidation {
  const errors = candidates.flatMap((candidate) => candidate.validation.errors);
  const warnings = candidates.flatMap((candidate) => candidate.validation.warnings);
  return {
    schema_valid: candidates.length > 0 && candidates.every((candidate) => candidate.validation.schema_valid),
    safety_valid: candidates.length > 0 && candidates.every((candidate) => candidate.validation.safety_valid),
    fit_requirements_valid: candidates.length > 0 && candidates.every((candidate) => candidate.validation.fit_requirements_valid),
    errors,
    warnings
  };
}
