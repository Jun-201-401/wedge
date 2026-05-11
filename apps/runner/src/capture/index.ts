import { randomUUID } from "node:crypto";
import type { BrowserActionResult, BrowserCapturedArtifacts, BrowserPageSnapshot, BrowserSettleResult } from "../browser/playwright/index.ts";
import type {
  ArtifactDraft,
  CategoryFilterSignalObservation,
  Checkpoint,
  DepthFromDiscoveryObservation,
  GoalActionCandidateObservation,
  InteractiveComponentsObservation,
  JourneyActionRawObservation,
  ProductCardObservation,
  ScenarioPlan,
  ScenarioStep
} from "../shared/contracts.ts";

export interface CheckpointCollection {
  checkpoint: Omit<Checkpoint, "artifactRefs">;
  artifacts: ArtifactDraft[];
}

export interface JourneyDepthContext {
  discoveryStepOrder?: number;
  discoveryStepKey?: string;
  discoveryStage?: ScenarioStep["stage"];
  discoveryUrl?: string;
  productCardCountAtDiscovery?: number;
}

export interface CapturePipeline {
  collectCheckpoint: (input: {
    step: ScenarioStep;
    stepOrder: number;
    plan: ScenarioPlan;
    beforeSnapshot?: BrowserPageSnapshot;
    pageSnapshot: BrowserPageSnapshot;
    actionResult?: BrowserActionResult;
    settleResult: BrowserSettleResult;
    capturedArtifacts?: BrowserCapturedArtifacts;
    journeyDepthContext?: JourneyDepthContext;
  }) => Promise<CheckpointCollection>;
}

export function createCapturePipeline(): CapturePipeline {
  return {
    async collectCheckpoint({
      step,
      stepOrder,
      plan,
      beforeSnapshot,
      pageSnapshot,
      actionResult,
      settleResult,
      capturedArtifacts,
      journeyDepthContext
    }) {
      const screenshotArtifact = createScreenshotArtifact({
        artifactId: randomUUID(),
        pageSnapshot,
        stepOrder,
        goal: plan.goal,
        stepKey: step.step_id,
        capturedArtifacts
      });
      const domArtifact = createDomSnapshotArtifact({
        artifactId: randomUUID(),
        pageSnapshot,
        goal: plan.goal,
        stepKey: step.step_id,
        capturedArtifacts
      });
      const consoleLogArtifact = createConsoleLogArtifact(step.step_id, pageSnapshot.consoleErrors);

      return {
        checkpoint: {
          checkpointId: randomUUID(),
          stepKey: step.step_id,
          stage: step.stage,
          trigger: {
            stepOrder,
            actionType: step.action.type,
            description: step.description
          },
          settle: {
            strategy: settleResult.strategy,
            durationMs: settleResult.durationMs,
            status: settleResult.status
          },
          state: createCheckpointState(pageSnapshot),
          observations: createCheckpointObservations({
            step,
            stepOrder,
            beforeSnapshot,
            pageSnapshot,
            actionResult,
            settleResult,
            screenshotArtifactId: screenshotArtifact.artifactId,
            journeyDepthContext
          }),
          deltas: createCheckpointDeltas(pageSnapshot)
        },
        artifacts: buildCheckpointArtifacts(screenshotArtifact, domArtifact, consoleLogArtifact)
      };
    }
  };
}

function buildCheckpointArtifacts(
  screenshotArtifact: ArtifactDraft,
  domArtifact: ArtifactDraft,
  consoleLogArtifact: ArtifactDraft | null
): ArtifactDraft[] {
  return consoleLogArtifact
    ? [screenshotArtifact, domArtifact, consoleLogArtifact]
    : [screenshotArtifact, domArtifact];
}

function createConsoleLogArtifact(stepKey: string, consoleErrors: string[]): ArtifactDraft | null {
  if (consoleErrors.length === 0) {
    return null;
  }

  return {
    artifactId: randomUUID(),
    artifactType: "CONSOLE_LOG",
    stepKey,
    mimeType: "application/json",
    fileExtension: "json",
    content: JSON.stringify(
      {
        consoleErrors
      },
      null,
      2
    )
  };
}

function createCheckpointState(pageSnapshot: BrowserPageSnapshot): Checkpoint["state"] {
  return {
    url: pageSnapshot.finalUrl,
    title: pageSnapshot.title,
    viewport: pageSnapshot.viewport,
    locale: pageSnapshot.locale,
    timezone: pageSnapshot.timezone,
    scrollY: pageSnapshot.scrollY,
    visitedUrls: pageSnapshot.visitedUrls,
    fields: pageSnapshot.fields,
    selectedOptions: pageSnapshot.selectedOptions,
    breadcrumb: pageSnapshot.breadcrumb,
    toastTexts: pageSnapshot.toastTexts,
    cartCount: pageSnapshot.cartCount,
    visiblePrices: pageSnapshot.visiblePrices,
    selectedFilters: pageSnapshot.selectedFilters,
    searchQuery: pageSnapshot.searchQuery,
    network_summary: {
      event_count: pageSnapshot.networkEvents.length,
      failed_request_count: pageSnapshot.networkEvents.filter((event) => event.failed).length
    },
    cdpSession: pageSnapshot.cdpSession
  };
}

function createCheckpointObservations({
  step,
  stepOrder,
  beforeSnapshot,
  pageSnapshot,
  actionResult,
  settleResult,
  screenshotArtifactId,
  journeyDepthContext
}: {
  step: ScenarioStep;
  stepOrder: number;
  beforeSnapshot?: BrowserPageSnapshot;
  pageSnapshot: BrowserPageSnapshot;
  actionResult?: BrowserActionResult;
  settleResult: BrowserSettleResult;
  screenshotArtifactId: string;
  journeyDepthContext?: JourneyDepthContext;
}): Record<string, unknown>[] {
  const journeyActionObservation = createJourneyActionRawObservation({
    step,
    stepOrder,
    beforeSnapshot,
    pageSnapshot,
    actionResult,
    settleResult,
    screenshotArtifactId
  });
  const categoryFilterObservation = createCategoryFilterSignalObservation({
    step,
    stepOrder,
    beforeSnapshot,
    pageSnapshot,
    actionResult
  });
  const depthFromDiscoveryObservation = createDepthFromDiscoveryObservation({
    step,
    stepOrder,
    beforeSnapshot,
    pageSnapshot,
    actionResult,
    settleResult,
    categoryFilterObservation,
    journeyDepthContext
  });

  return [
    ...(journeyActionObservation ? [{ ...journeyActionObservation }] : []),
    ...(categoryFilterObservation ? [{ ...categoryFilterObservation }] : []),
    ...(depthFromDiscoveryObservation ? [{ ...depthFromDiscoveryObservation }] : []),
    ...createInteractiveComponentsObservations(step, pageSnapshot).map((observation) => ({ ...observation })),
    ...createFormFieldObservations(pageSnapshot.fields),
    ...createCtaCandidateObservations(step, pageSnapshot),
    ...createProductCardObservations(step, pageSnapshot, screenshotArtifactId).map((observation) => ({ ...observation })),
    ...createGoalActionCandidateObservations(step, pageSnapshot).map((observation) => ({ ...observation })),
    ...pageSnapshot.consoleErrors.map((message) => ({
      type: "console_error",
      message
    })),
    ...pageSnapshot.networkErrors.map((message) => ({
      type: "network_failure",
      message
    })),
    ...createSettleObservations(settleResult)
  ];
}

function createJourneyActionRawObservation({
  step,
  stepOrder,
  beforeSnapshot,
  pageSnapshot,
  actionResult,
  settleResult,
  screenshotArtifactId
}: {
  step: ScenarioStep;
  stepOrder: number;
  beforeSnapshot?: BrowserPageSnapshot;
  pageSnapshot: BrowserPageSnapshot;
  actionResult?: BrowserActionResult;
  settleResult: BrowserSettleResult;
  screenshotArtifactId: string;
}): JourneyActionRawObservation | null {
  if (!beforeSnapshot && !actionResult) {
    return null;
  }

  const baselineSnapshot = beforeSnapshot ?? pageSnapshot;
  const actionDetails = actionResult?.details ?? {};
  const clickedText = readOptionalString(actionDetails, "clickedText") ?? clickedComponent(pageSnapshot)?.text ?? null;
  const clickedSelector = readOptionalString(actionDetails, "clickedSelector") ?? clickedComponent(pageSnapshot)?.selector ?? null;
  const elementRole = readOptionalString(actionDetails, "elementRole") ?? clickedComponent(pageSnapshot)?.role ?? null;
  const bbox = readBounds(actionDetails.bbox) ?? clickedComponent(pageSnapshot)?.bounds ?? null;
  const networkResult = createNetworkResult(pageSnapshot, settleResult);

  return {
    observation_id: `${step.step_id}.obs_journey_action_raw`,
    type: "journey_action_raw",
    stage: step.stage,
    source: ["scenario_log", "dom", "browser", "network"],
    confidence: actionResult ? 0.82 : 0.72,
    step_order: stepOrder,
    step_key: step.step_id,
    action_type: step.action.type,
    clicked_text: clickedText,
    clicked_selector: clickedSelector,
    element_role: elementRole,
    element_text: readOptionalString(actionDetails, "elementText") ?? clickedText,
    aria_label: readOptionalString(actionDetails, "ariaLabel"),
    url_before: baselineSnapshot.finalUrl,
    url_after: pageSnapshot.finalUrl,
    title_before: baselineSnapshot.title,
    title_after: pageSnapshot.title,
    breadcrumb_before: baselineSnapshot.breadcrumb,
    breadcrumb_after: pageSnapshot.breadcrumb,
    cart_count_before: baselineSnapshot.cartCount,
    cart_count_after: pageSnapshot.cartCount,
    toast_text: pageSnapshot.toastTexts,
    visible_price: pageSnapshot.visiblePrices,
    visible_product_image: pageSnapshot.productImages.map((image) => ({ ...image })),
    add_to_cart_like_button: isAddToCartLike(clickedText),
    dom_changed: Boolean(baselineSnapshot.domSignature && pageSnapshot.domSignature)
      ? baselineSnapshot.domSignature !== pageSnapshot.domSignature
      : baselineSnapshot.finalUrl !== pageSnapshot.finalUrl || baselineSnapshot.title !== pageSnapshot.title,
    network_result: networkResult,
    settle_status: settleResult.status,
    screenshot_artifact_id: screenshotArtifactId,
    bbox
  };
}

function createCategoryFilterSignalObservation({
  step,
  stepOrder,
  beforeSnapshot,
  pageSnapshot,
  actionResult
}: {
  step: ScenarioStep;
  stepOrder: number;
  beforeSnapshot?: BrowserPageSnapshot;
  pageSnapshot: BrowserPageSnapshot;
  actionResult?: BrowserActionResult;
}): CategoryFilterSignalObservation | null {
  if (!beforeSnapshot) {
    return null;
  }

  const actionDetails = actionResult?.details ?? {};
  const clickedText = readOptionalString(actionDetails, "clickedText") ?? clickedComponent(pageSnapshot)?.text ?? null;
  const clickedSelector = readOptionalString(actionDetails, "clickedSelector") ?? clickedComponent(pageSnapshot)?.selector ?? null;
  const filterChanged = !sameJsonArray(beforeSnapshot.selectedFilters, pageSnapshot.selectedFilters);
  const searchSubmitted = normalizeSearchQuery(beforeSnapshot.searchQuery) !== normalizeSearchQuery(pageSnapshot.searchQuery);
  const categoryUrlChanged = categoryUrlSignalChanged(beforeSnapshot.finalUrl, pageSnapshot.finalUrl);
  const breadcrumbChanged = !sameStringArray(beforeSnapshot.breadcrumb, pageSnapshot.breadcrumb);
  const actionLooksCategoryLike = isCategoryFilterSearchText(clickedText ?? step.description ?? "");

  if (!filterChanged && !searchSubmitted && !categoryUrlChanged && !(breadcrumbChanged && actionLooksCategoryLike)) {
    return null;
  }

  return {
    observation_id: `${step.step_id}.obs_category_filter_signal`,
    type: "category_filter_signal",
    stage: step.stage,
    source: ["scenario_log", "dom", "browser"],
    confidence: filterChanged || searchSubmitted ? 0.82 : 0.68,
    step_order: stepOrder,
    step_key: step.step_id,
    action_type: step.action.type,
    clicked_text: clickedText,
    clicked_selector: clickedSelector,
    url_before: beforeSnapshot.finalUrl,
    url_after: pageSnapshot.finalUrl,
    breadcrumb_before: beforeSnapshot.breadcrumb,
    breadcrumb_after: pageSnapshot.breadcrumb,
    selected_filter_before: beforeSnapshot.selectedFilters.map((filter) => ({ ...filter })),
    selected_filter_after: pageSnapshot.selectedFilters.map((filter) => ({ ...filter })),
    search_query_before: beforeSnapshot.searchQuery,
    search_query_after: pageSnapshot.searchQuery,
    filter_changed: filterChanged,
    search_submitted: searchSubmitted,
    category_url_changed: categoryUrlChanged
  };
}

function createDepthFromDiscoveryObservation({
  step,
  stepOrder,
  beforeSnapshot,
  pageSnapshot,
  actionResult,
  settleResult,
  categoryFilterObservation,
  journeyDepthContext
}: {
  step: ScenarioStep;
  stepOrder: number;
  beforeSnapshot?: BrowserPageSnapshot;
  pageSnapshot: BrowserPageSnapshot;
  actionResult?: BrowserActionResult;
  settleResult: BrowserSettleResult;
  categoryFilterObservation: CategoryFilterSignalObservation | null;
  journeyDepthContext?: JourneyDepthContext;
}): DepthFromDiscoveryObservation | null {
  if (!journeyDepthContext) {
    return null;
  }

  if (!journeyDepthContext.discoveryStepOrder && pageSnapshot.productCards.length > 0) {
    journeyDepthContext.discoveryStepOrder = stepOrder;
    journeyDepthContext.discoveryStepKey = step.step_id;
    journeyDepthContext.discoveryStage = step.stage;
    journeyDepthContext.discoveryUrl = pageSnapshot.finalUrl;
    journeyDepthContext.productCardCountAtDiscovery = pageSnapshot.productCards.length;
  }

  if (!journeyDepthContext.discoveryStepOrder) {
    return null;
  }

  const categoryChanged = categoryFilterObservation?.category_url_changed ?? false;
  const filterChanged = categoryFilterObservation?.filter_changed ?? false;
  const searchSubmitted = categoryFilterObservation?.search_submitted ?? false;
  const goalActionResult = createGoalActionResultSignal({
    step,
    beforeSnapshot,
    pageSnapshot,
    actionResult,
    settleResult
  });
  const intentCandidate = inferJourneyIntentCandidate({
    stepOrder,
    discoveryStepOrder: journeyDepthContext.discoveryStepOrder,
    pageSnapshot,
    categoryChanged,
    filterChanged,
    searchSubmitted,
    goalActionResult
  });

  return {
    observation_id: `${step.step_id}.obs_depth_from_discovery`,
    type: "depth_from_discovery",
    stage: step.stage,
    source: ["scenario_log", "dom", "browser", "network"],
    confidence: intentCandidate === "goal_action" || filterChanged || searchSubmitted || categoryChanged ? 0.78 : 0.66,
    step_order: stepOrder,
    step_key: step.step_id,
    action_type: step.action.type,
    discovery_step_order: journeyDepthContext.discoveryStepOrder,
    discovery_step_key: journeyDepthContext.discoveryStepKey ?? step.step_id,
    discovery_stage: journeyDepthContext.discoveryStage ?? step.stage,
    discovery_url: journeyDepthContext.discoveryUrl ?? pageSnapshot.finalUrl,
    depth_from_discovery: Math.max(0, stepOrder - journeyDepthContext.discoveryStepOrder),
    intent_candidate: intentCandidate,
    is_detour_candidate: isDetourCandidate({
      intentCandidate,
      categoryChanged,
      filterChanged,
      searchSubmitted,
      goalActionResult,
      beforeSnapshot,
      pageSnapshot
    }),
    category_changed: categoryChanged,
    filter_changed: filterChanged,
    search_submitted: searchSubmitted,
    goal_action_result: goalActionResult,
    current_url: pageSnapshot.finalUrl,
    current_product_card_count: pageSnapshot.productCards.length,
    product_card_count_at_discovery: journeyDepthContext.productCardCountAtDiscovery ?? pageSnapshot.productCards.length
  };
}

function createInteractiveComponentsObservations(
  step: ScenarioStep,
  pageSnapshot: BrowserPageSnapshot
): InteractiveComponentsObservation[] {
  if (pageSnapshot.interactiveComponents.length === 0) {
    return [];
  }

  const primaryLikeComponentCount = pageSnapshot.interactiveComponents.filter((component) => component.is_primary_like).length;
  return [
    {
      observation_id: `${step.step_id}.obs_interactive_components`,
      type: "interactive_components",
      stage: "CTA",
      source: ["dom", "layout", "screenshot"],
      confidence: primaryLikeComponentCount > 0 ? 0.82 : 0.65,
      primary_like_component_count: primaryLikeComponentCount,
      components: pageSnapshot.interactiveComponents
    }
  ];
}

function createProductCardObservations(
  step: ScenarioStep,
  pageSnapshot: BrowserPageSnapshot,
  screenshotArtifactId: string
): ProductCardObservation[] {
  if (pageSnapshot.productCards.length === 0) {
    return [];
  }

  return [
    {
      observation_id: `${step.step_id}.obs_product_cards`,
      type: "product_card",
      stage: "VALUE",
      source: ["dom", "layout", "screenshot"],
      confidence: 0.66,
      cards: pageSnapshot.productCards.map((card) => ({
        ...card,
        screenshot_artifact_id: screenshotArtifactId
      }))
    }
  ];
}

function createGoalActionCandidateObservations(
  step: ScenarioStep,
  pageSnapshot: BrowserPageSnapshot
): GoalActionCandidateObservation[] {
  const candidates = pageSnapshot.interactiveComponents
    .filter((component) => component.is_cta_candidate)
    .slice(0, 10)
    .map((component) => ({
      element_text: component.text,
      element_role: component.role,
      clicked_selector: component.selector,
      add_to_cart_like_button: isAddToCartLike(component.text),
      bbox: component.bounds
    }));

  if (candidates.length === 0) {
    return [];
  }

  return [
    {
      observation_id: `${step.step_id}.obs_goal_action_candidates`,
      type: "goal_action_candidate",
      stage: "CTA",
      source: ["dom", "layout"],
      confidence: 0.7,
      candidates
    }
  ];
}

function createFormFieldObservations(fields: BrowserPageSnapshot["fields"]): Record<string, unknown>[] {
  return Object.entries(fields).map(([fieldKey, value]) => ({
    type: "form_field",
    field_key: fieldKey,
    value_length: value.length
  }));
}

function createCtaCandidateObservations(
  step: ScenarioStep,
  pageSnapshot: BrowserPageSnapshot
): Record<string, unknown>[] {
  return step.stage === "CTA" && step.action.type === "click"
    ? [
        {
          type: "cta_candidate",
          target: pageSnapshot.lastAction?.target
        }
      ]
    : [];
}

function createCheckpointDeltas(pageSnapshot: BrowserPageSnapshot): Record<string, unknown>[] {
  return pageSnapshot.lastAction
    ? [
        {
          type: "last_action",
          action: pageSnapshot.lastAction.type,
          target: pageSnapshot.lastAction.target
        }
      ]
    : [];
}

function createSettleObservations(settleResult: BrowserSettleResult): Record<string, unknown>[] {
  if (!settleResult.details || typeof settleResult.details !== "object") {
    return [];
  }

  if (settleResult.strategy === "response") {
    return [
      createResponseSettleObservation(settleResult)
    ];
  }

  if (settleResult.strategy === "item_count_change") {
    return [
      createItemCountSettleObservation(settleResult)
    ];
  }

  return [];
}

function readStringDetail(details: Record<string, unknown>, key: string): string | null {
  const value = details[key];
  return typeof value === "string" ? value : null;
}

function readNumberDetail(details: Record<string, unknown>, key: string): number | null {
  const value = details[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function createResponseSettleObservation(settleResult: BrowserSettleResult): Record<string, unknown> {
  const details = settleResult.details ?? {};

  return {
    type: "settle_response",
    settle_status: settleResult.status,
    target: settleResult.targetSummary ?? null,
    matched_url: readStringDetail(details, "matchedUrl"),
    method: readStringDetail(details, "method"),
    status_code: readNumberDetail(details, "status"),
    url_includes: readStringDetail(details, "urlIncludes")
  };
}

function createItemCountSettleObservation(settleResult: BrowserSettleResult): Record<string, unknown> {
  const details = settleResult.details ?? {};

  return {
    type: "settle_item_count_change",
    settle_status: settleResult.status,
    target: settleResult.targetSummary ?? null,
    baseline_count: readNumberDetail(details, "baselineCount"),
    current_count: readNumberDetail(details, "currentCount"),
    expected_count: readNumberDetail(details, "expectedCount"),
    min_count: readNumberDetail(details, "minCount"),
    max_count: readNumberDetail(details, "maxCount"),
    count_delta: readNumberDetail(details, "countDelta")
  };
}

function clickedComponent(pageSnapshot: BrowserPageSnapshot): BrowserPageSnapshot["interactiveComponents"][number] | null {
  return pageSnapshot.interactiveComponents.find((component) => component.clicked_in_scenario) ?? null;
}

function readOptionalString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readBounds(value: unknown): BrowserPageSnapshot["interactiveComponents"][number]["bounds"] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Partial<BrowserPageSnapshot["interactiveComponents"][number]["bounds"]>;
  return typeof candidate.x === "number" &&
    typeof candidate.y === "number" &&
    typeof candidate.width === "number" &&
    typeof candidate.height === "number" &&
    typeof candidate.unit === "string"
    ? {
        x: candidate.x,
        y: candidate.y,
        width: candidate.width,
        height: candidate.height,
        unit: candidate.unit
      }
    : null;
}

function isAddToCartLike(text: string | null | undefined): boolean {
  return /add to cart|add to basket|장바구니|카트|담기|신청|예약|문의|결제|무료 체험|다운로드|가입/i.test(text ?? "");
}

function sameJsonArray(left: unknown[], right: unknown[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameStringArray(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function normalizeSearchQuery(value: string | null | undefined): string {
  return (value ?? "").trim().replaceAll(/\s+/g, " ").toLowerCase();
}

function categoryUrlSignalChanged(beforeUrl: string, afterUrl: string): boolean {
  const before = parseCategoryUrlSignal(beforeUrl);
  const after = parseCategoryUrlSignal(afterUrl);
  return Boolean(before || after) && before !== after;
}

function parseCategoryUrlSignal(urlString: string): string | null {
  try {
    const url = new URL(urlString);
    const categoryParams = [
      "category",
      "cat",
      "filter",
      "facet",
      "sort",
      "q",
      "query",
      "keyword",
      "search"
    ];
    const matchedParams = categoryParams
      .flatMap((key) => url.searchParams.getAll(key).map((value) => `${key}=${value}`))
      .join("&");
    const categoryPath = url.pathname.match(/(?:category|categories|collections|products|shop|search|filter)\/?[^?]*/i)?.[0] ?? "";
    const signal = `${categoryPath}?${matchedParams}`;
    return signal === "?" ? null : signal;
  } catch {
    return null;
  }
}

function isCategoryFilterSearchText(text: string): boolean {
  return /category|categories|collection|filter|sort|search|카테고리|분류|필터|정렬|검색|상품|제품/i.test(text);
}

function createGoalActionResultSignal({
  step,
  beforeSnapshot,
  pageSnapshot,
  actionResult,
  settleResult
}: {
  step: ScenarioStep;
  beforeSnapshot?: BrowserPageSnapshot;
  pageSnapshot: BrowserPageSnapshot;
  actionResult?: BrowserActionResult;
  settleResult: BrowserSettleResult;
}): DepthFromDiscoveryObservation["goal_action_result"] {
  const baselineSnapshot = beforeSnapshot ?? pageSnapshot;
  const actionDetails = actionResult?.details ?? {};
  const clickedText = readOptionalString(actionDetails, "clickedText") ?? clickedComponent(pageSnapshot)?.text ?? step.description;
  const cartCountDelta = typeof baselineSnapshot.cartCount === "number" && typeof pageSnapshot.cartCount === "number"
    ? pageSnapshot.cartCount - baselineSnapshot.cartCount
    : null;
  const domChanged = Boolean(baselineSnapshot.domSignature && pageSnapshot.domSignature)
    ? baselineSnapshot.domSignature !== pageSnapshot.domSignature
    : baselineSnapshot.finalUrl !== pageSnapshot.finalUrl || baselineSnapshot.title !== pageSnapshot.title;

  return {
    action_attempted: step.action.type !== "checkpoint",
    add_to_cart_like_button: isAddToCartLike(clickedText),
    cart_count_delta: cartCountDelta,
    toast_present: pageSnapshot.toastTexts.length > 0,
    url_changed: baselineSnapshot.finalUrl !== pageSnapshot.finalUrl,
    dom_changed: domChanged,
    network_success: hasSuccessfulNetworkSignal(pageSnapshot, settleResult),
    settle_status: settleResult.status
  };
}

function inferJourneyIntentCandidate({
  stepOrder,
  discoveryStepOrder,
  pageSnapshot,
  categoryChanged,
  filterChanged,
  searchSubmitted,
  goalActionResult
}: {
  stepOrder: number;
  discoveryStepOrder: number;
  pageSnapshot: BrowserPageSnapshot;
  categoryChanged: boolean;
  filterChanged: boolean;
  searchSubmitted: boolean;
  goalActionResult: DepthFromDiscoveryObservation["goal_action_result"];
}): DepthFromDiscoveryObservation["intent_candidate"] {
  if (stepOrder === discoveryStepOrder && pageSnapshot.productCards.length > 0) {
    return "product_discovery";
  }
  if (searchSubmitted) {
    return "search_submitted";
  }
  if (filterChanged) {
    return "filter_changed";
  }
  if (categoryChanged) {
    return "category_changed";
  }
  if (
    goalActionResult.add_to_cart_like_button ||
    (goalActionResult.cart_count_delta ?? 0) > 0 ||
    goalActionResult.toast_present
  ) {
    return "goal_action";
  }
  if (goalActionResult.url_changed) {
    return "navigation";
  }
  return "other";
}

function isDetourCandidate({
  intentCandidate,
  categoryChanged,
  filterChanged,
  searchSubmitted,
  goalActionResult,
  beforeSnapshot,
  pageSnapshot
}: {
  intentCandidate: DepthFromDiscoveryObservation["intent_candidate"];
  categoryChanged: boolean;
  filterChanged: boolean;
  searchSubmitted: boolean;
  goalActionResult: DepthFromDiscoveryObservation["goal_action_result"];
  beforeSnapshot?: BrowserPageSnapshot;
  pageSnapshot: BrowserPageSnapshot;
}): boolean {
  if (
    intentCandidate === "product_discovery" ||
    intentCandidate === "goal_action" ||
    categoryChanged ||
    filterChanged ||
    searchSubmitted
  ) {
    return false;
  }

  const baselineSnapshot = beforeSnapshot ?? pageSnapshot;
  const changedAfterDiscovery = goalActionResult.url_changed ||
    goalActionResult.dom_changed ||
    !sameStringArray(baselineSnapshot.breadcrumb, pageSnapshot.breadcrumb);

  return changedAfterDiscovery;
}

function hasSuccessfulNetworkSignal(pageSnapshot: BrowserPageSnapshot, settleResult: BrowserSettleResult): boolean {
  const settledStatus = readNumberDetail(settleResult.details ?? {}, "status");
  if (typeof settledStatus === "number" && settledStatus >= 200 && settledStatus < 400) {
    return true;
  }

  return pageSnapshot.networkEvents.some((event) =>
    event.failed !== true && typeof event.status === "number" && event.status >= 200 && event.status < 400
  );
}

function createNetworkResult(
  pageSnapshot: BrowserPageSnapshot,
  settleResult: BrowserSettleResult
): Record<string, unknown>[] {
  const networkEvents = pageSnapshot.networkEvents.map((event) => ({ ...event }));
  if (settleResult.strategy !== "response" || !settleResult.details) {
    return networkEvents;
  }

  return [
    ...networkEvents,
    {
      type: "settle_response",
      settle_status: settleResult.status,
      target: settleResult.targetSummary ?? null,
      matched_url: readStringDetail(settleResult.details, "matchedUrl"),
      method: readStringDetail(settleResult.details, "method"),
      status_code: readNumberDetail(settleResult.details, "status"),
      url_includes: readStringDetail(settleResult.details, "urlIncludes")
    }
  ];
}

function createScreenshotArtifact({
  artifactId,
  pageSnapshot,
  stepOrder,
  goal,
  stepKey,
  capturedArtifacts
}: {
  artifactId: string;
  pageSnapshot: BrowserPageSnapshot;
  stepOrder: number;
  goal: string;
  stepKey: string;
  capturedArtifacts?: BrowserCapturedArtifacts;
}): ArtifactDraft {
  if (capturedArtifacts?.screenshot) {
    return {
      artifactId,
      artifactType: "SCREENSHOT",
      stepKey,
      mimeType: capturedArtifacts.screenshot.mimeType,
      fileExtension: capturedArtifacts.screenshot.fileExtension,
      content: capturedArtifacts.screenshot.contentBase64,
      contentEncoding: "base64",
      width: capturedArtifacts.screenshot.width,
      height: capturedArtifacts.screenshot.height
    };
  }

  return {
    artifactId,
    artifactType: "SCREENSHOT",
    stepKey,
    mimeType: "image/svg+xml",
    fileExtension: "svg",
    content: createScreenshotSvg(pageSnapshot, stepOrder, goal),
    width: pageSnapshot.viewport.width,
    height: pageSnapshot.viewport.height
  };
}

function createDomSnapshotArtifact({
  artifactId,
  pageSnapshot,
  goal,
  stepKey,
  capturedArtifacts
}: {
  artifactId: string;
  pageSnapshot: BrowserPageSnapshot;
  goal: string;
  stepKey: string;
  capturedArtifacts?: BrowserCapturedArtifacts;
}): ArtifactDraft {
  if (capturedArtifacts?.domSnapshot) {
    return {
      artifactId,
      artifactType: "DOM_SNAPSHOT",
      stepKey,
      mimeType: capturedArtifacts.domSnapshot.mimeType,
      fileExtension: capturedArtifacts.domSnapshot.fileExtension,
      content: capturedArtifacts.domSnapshot.content
    };
  }

  return {
    artifactId,
    artifactType: "DOM_SNAPSHOT",
    stepKey,
    mimeType: "text/html",
    fileExtension: "html",
    content: createHtmlSnapshot(pageSnapshot, goal)
  };
}

function createScreenshotSvg(pageSnapshot: BrowserPageSnapshot, stepOrder: number, goal: string): string {
  const lines = [
    `Step ${stepOrder}`,
    pageSnapshot.title,
    pageSnapshot.finalUrl,
    goal
  ];

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${pageSnapshot.viewport.width}" height="${pageSnapshot.viewport.height}">`,
    `<rect width="100%" height="100%" fill="#f4f1ea" />`,
    `<rect x="32" y="32" width="${pageSnapshot.viewport.width - 64}" height="120" rx="16" fill="#16324f" />`,
    ...lines.map(
      (line, index) =>
        `<text x="56" y="${80 + index * 28}" fill="#fffdf6" font-size="20" font-family="monospace">${escapeHtml(
          line
        )}</text>`
    ),
    `</svg>`
  ].join("");
}

function createHtmlSnapshot(pageSnapshot: BrowserPageSnapshot, goal: string): string {
  const fieldMarkup = Object.entries(pageSnapshot.fields)
    .map(([fieldKey, value]) => `<li><strong>${escapeHtml(fieldKey)}</strong>: ${escapeHtml(value)}</li>`)
    .join("");

  return [
    "<!doctype html>",
    "<html lang=\"ko\">",
    "<head><meta charset=\"utf-8\" /><title>Wedge Runner Snapshot</title></head>",
    "<body>",
    `<h1>${escapeHtml(pageSnapshot.title)}</h1>`,
    `<p data-goal>${escapeHtml(goal)}</p>`,
    `<p data-url>${escapeHtml(pageSnapshot.finalUrl)}</p>`,
    `<ul>${fieldMarkup}</ul>`,
    "</body>",
    "</html>"
  ].join("");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}
