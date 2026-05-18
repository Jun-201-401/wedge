import { randomUUID } from "node:crypto";
import type { BrowserActionResult, BrowserCapturedArtifacts, BrowserPageSnapshot, BrowserSettleResult } from "../browser/playwright/index.ts";
import { meaningfulTokens, normalizeSearchQuery, normalizeSearchText } from "./text-normalization.ts";
import type {
  ArtifactDraft,
  AccordionStateObservation,
  AxTreeObservation,
  LayoutCollectorObservation,
  NetworkTimelineObservation,
  CheckoutContextObservation,
  PerformanceMetricObservation,
  CategoryFilterSignalObservation,
  Checkpoint,
  DepthFromDiscoveryObservation,
  GoalActionCandidateObservation,
  GoalActionResultObservation,
  InteractiveComponentsObservation,
  JourneyActionRawObservation,
  KeyboardFocusStateObservation,
  LoadingStateObservation,
  PageReadyTimingObservation,
  PathNavigationObservation,
  ProductCardObservation,
  ProductDetailSignalObservation,
  RunnerActionKind,
  RunnerExpectedOutcomeHint,
  ScenarioPlan,
  ScenarioStep,
  TextBlockMetricsObservation
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
      const axTreeArtifact = createAxTreeArtifact(step.step_id, capturedArtifacts);
      const harArtifact = createHarArtifact(step.step_id, pageSnapshot, plan);
      const performanceArtifact = createPerformanceArtifact(step.step_id, pageSnapshot, plan);
      const runtimeTraceArtifact = createRuntimeTraceArtifact({
        step,
        stepOrder,
        pageSnapshot,
        actionResult,
        settleResult,
        plan
      });

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
          state: createCheckpointState(pageSnapshot, capturedArtifacts),
          observations: createCheckpointObservations({
            step,
            stepOrder,
            beforeSnapshot,
            pageSnapshot,
            actionResult,
            settleResult,
            screenshotArtifactId: screenshotArtifact.artifactId,
            axTreeArtifactId: axTreeArtifact?.artifactId,
            harArtifactId: harArtifact?.artifactId,
            performanceArtifactId: performanceArtifact?.artifactId,
            capturePerformance: plan.artifact_policy?.capture_performance === true,
            capturedArtifacts,
            journeyDepthContext
          }),
          deltas: createCheckpointDeltas(pageSnapshot)
        },
        artifacts: buildCheckpointArtifacts(screenshotArtifact, domArtifact, consoleLogArtifact, axTreeArtifact, harArtifact, performanceArtifact, runtimeTraceArtifact)
      };
    }
  };
}

function buildCheckpointArtifacts(
  screenshotArtifact: ArtifactDraft,
  domArtifact: ArtifactDraft,
  consoleLogArtifact: ArtifactDraft | null,
  axTreeArtifact: ArtifactDraft | null,
  harArtifact: ArtifactDraft | null,
  performanceArtifact: ArtifactDraft | null,
  runtimeTraceArtifact: ArtifactDraft | null
): ArtifactDraft[] {
  return [
    screenshotArtifact,
    domArtifact,
    ...(consoleLogArtifact ? [consoleLogArtifact] : []),
    ...(axTreeArtifact ? [axTreeArtifact] : []),
    ...(harArtifact ? [harArtifact] : []),
    ...(performanceArtifact ? [performanceArtifact] : []),
    ...(runtimeTraceArtifact ? [runtimeTraceArtifact] : [])
  ];
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

function createAxTreeArtifact(
  stepKey: string,
  capturedArtifacts?: BrowserCapturedArtifacts
): ArtifactDraft | null {
  if (!capturedArtifacts?.axTree) {
    return null;
  }

  return {
    artifactId: randomUUID(),
    artifactType: "AX_TREE",
    stepKey,
    mimeType: capturedArtifacts.axTree.mimeType,
    fileExtension: capturedArtifacts.axTree.fileExtension,
    content: capturedArtifacts.axTree.content
  };
}

function createHarArtifact(
  stepKey: string,
  pageSnapshot: BrowserPageSnapshot,
  plan: ScenarioPlan
): ArtifactDraft | null {
  if (plan.artifact_policy?.capture_har !== true || pageSnapshot.networkEvents.length === 0) {
    return null;
  }

  return {
    artifactId: randomUUID(),
    artifactType: "HAR",
    stepKey,
    mimeType: "application/json",
    fileExtension: "har.json",
    content: JSON.stringify(createHarPayload(pageSnapshot), null, 2)
  };
}

function createPerformanceArtifact(
  stepKey: string,
  pageSnapshot: BrowserPageSnapshot,
  plan: ScenarioPlan
): ArtifactDraft | null {
  if (plan.artifact_policy?.capture_performance !== true || !pageSnapshot.performanceSummary) {
    return null;
  }

  return {
    artifactId: randomUUID(),
    artifactType: "OTHER",
    stepKey,
    mimeType: "application/json",
    fileExtension: "web-vitals.json",
    content: JSON.stringify({
      schema_version: "0.1",
      artifact_type: "web_vitals_json",
      source: pageSnapshot.performanceSummary.web_vitals_source ?? "browser_performance_api",
      url: pageSnapshot.finalUrl,
      title: pageSnapshot.title,
      summary: pageSnapshot.performanceSummary,
      lighthouse_compatible_metrics: {
        first_contentful_paint_ms: pageSnapshot.performanceSummary.first_contentful_paint_ms,
        largest_contentful_paint_ms: pageSnapshot.performanceSummary.largest_contentful_paint_ms ?? null,
        cumulative_layout_shift: pageSnapshot.performanceSummary.cumulative_layout_shift ?? null,
        interaction_to_next_paint_ms: pageSnapshot.performanceSummary.interaction_to_next_paint_ms ?? null,
        render_blocking_resource_count: pageSnapshot.performanceSummary.render_blocking_resource_count ?? 0
      }
    }, null, 2)
  };
}

function createRuntimeTraceArtifact({
  step,
  stepOrder,
  pageSnapshot,
  actionResult,
  settleResult,
  plan
}: {
  step: ScenarioStep;
  stepOrder: number;
  pageSnapshot: BrowserPageSnapshot;
  actionResult?: BrowserActionResult;
  settleResult: BrowserSettleResult;
  plan: ScenarioPlan;
}): ArtifactDraft | null {
  if (plan.artifact_policy?.capture_trace !== true) {
    return null;
  }

  return {
    artifactId: randomUUID(),
    artifactType: "TRACE",
    stepKey: step.step_id,
    mimeType: "application/json",
    fileExtension: "json",
    content: JSON.stringify({
      schema_version: "0.1",
      trace_type: "runner_checkpoint_runtime_trace",
      step_order: stepOrder,
      step_key: step.step_id,
      stage: step.stage,
      action: {
        type: step.action.type,
        target: actionResult?.targetSummary ?? null
      },
      settle: settleResult,
      url: pageSnapshot.finalUrl,
      title: pageSnapshot.title,
      dom_summary: pageSnapshot.domSummary,
      layout_summary: pageSnapshot.layoutSummary,
      performance_summary: pageSnapshot.performanceSummary,
      network_event_count: pageSnapshot.networkEvents.length,
      failed_network_event_count: pageSnapshot.networkEvents.filter((event) => event.failed === true).length,
      cdp_session: pageSnapshot.cdpSession
    }, null, 2)
  };
}

function createHarPayload(pageSnapshot: BrowserPageSnapshot): Record<string, unknown> {
  return {
    log: {
      version: "1.2",
      creator: {
        name: "wedge-runner",
        version: "0.1"
      },
      pages: [
        {
          startedDateTime: pageSnapshot.networkEvents[0]?.occurredAt ?? new Date().toISOString(),
          id: "page_1",
          title: pageSnapshot.title,
          pageTimings: {
            onContentLoad: pageSnapshot.performanceSummary?.dom_content_loaded_ms ?? -1,
            onLoad: pageSnapshot.performanceSummary?.load_event_ms ?? -1
          }
        }
      ],
      entries: pageSnapshot.networkEvents.map((event) => ({
        startedDateTime: event.occurredAt ?? new Date().toISOString(),
        time: event.durationMs ?? 0,
        request: {
          method: event.method,
          url: event.url,
          httpVersion: "HTTP/1.1",
          headers: [],
          queryString: [],
          cookies: [],
          headersSize: -1,
          bodySize: -1
        },
        response: {
          status: event.status ?? 0,
          statusText: event.failed ? event.errorText ?? "request failed" : "",
          httpVersion: "HTTP/1.1",
          headers: [],
          cookies: [],
          content: {
            size: event.encodedBodySizeBytes ?? -1,
            mimeType: "application/octet-stream"
          },
          redirectURL: "",
          headersSize: -1,
          bodySize: event.transferSizeBytes ?? -1
        },
        cache: {},
        timings: {
          blocked: -1,
          dns: -1,
          connect: -1,
          send: 0,
          wait: event.durationMs ?? 0,
          receive: 0,
          ssl: -1
        },
        _resourceType: event.resourceType ?? null,
        _failed: event.failed === true
      }))
    }
  };
}

function statusCodeCounts(events: BrowserPageSnapshot["networkEvents"]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const event of events) {
    const key = event.status === undefined
      ? event.failed === true ? "failed" : "unknown"
      : String(event.status);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function inferFlowStepCount(stepIndicators: BrowserPageSnapshot["stepIndicators"]): number | null {
  const counts = stepIndicators
    .map((indicator) => indicator.total_steps)
    .filter((value): value is number => typeof value === "number" && Number.isInteger(value) && value > 1);
  return counts.length > 0 ? Math.max(...counts) : null;
}

function createCheckpointState(
  pageSnapshot: BrowserPageSnapshot,
  capturedArtifacts?: BrowserCapturedArtifacts
): Checkpoint["state"] {
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
    dom_summary: pageSnapshot.domSummary,
    layout_summary: pageSnapshot.layoutSummary,
    selectedFilters: pageSnapshot.selectedFilters,
    searchQuery: pageSnapshot.searchQuery,
    loading_state: pageSnapshot.loadingState,
    step_indicator: pageSnapshot.stepIndicators,
    back_link_candidate: pageSnapshot.backLinkCandidates,
    flow_step_count: inferFlowStepCount(pageSnapshot.stepIndicators),
    accordion_state: pageSnapshot.accordionStates,
    checkout_context: pageSnapshot.checkoutContext,
    keyboard_focus_state: pageSnapshot.keyboardFocusState,
    repeated_generic_link_grouping: pageSnapshot.repeatedGenericLinkGrouping,
    network_summary: {
      event_count: pageSnapshot.networkEvents.length,
      failed_request_count: pageSnapshot.networkEvents.filter((event) => event.failed).length
    },
    layout_collector_summary: pageSnapshot.layoutSummary,
    performance_summary: pageSnapshot.performanceSummary,
    browser_health: pageSnapshot.browserHealth,
    ...(capturedArtifacts?.screenshot ? {
      screenshot_capture: {
        capture_mode: capturedArtifacts.screenshot.captureMode,
        requested_mode: capturedArtifacts.screenshot.requestedMode,
        width: capturedArtifacts.screenshot.width,
        height: capturedArtifacts.screenshot.height
      }
    } : {}),
    ...(capturedArtifacts?.axTree ? { ax_tree_summary: capturedArtifacts.axTree.summary } : {}),
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
  axTreeArtifactId,
  harArtifactId,
  performanceArtifactId,
  capturePerformance,
  capturedArtifacts,
  journeyDepthContext
}: {
  step: ScenarioStep;
  stepOrder: number;
  beforeSnapshot?: BrowserPageSnapshot;
  pageSnapshot: BrowserPageSnapshot;
  actionResult?: BrowserActionResult;
  settleResult: BrowserSettleResult;
  screenshotArtifactId: string;
  axTreeArtifactId?: string;
  harArtifactId?: string;
  performanceArtifactId?: string;
  capturePerformance: boolean;
  capturedArtifacts?: BrowserCapturedArtifacts;
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
  const productDetailSignalObservation = createProductDetailSignalObservation({
    step,
    stepOrder,
    beforeSnapshot,
    pageSnapshot,
    actionResult,
    screenshotArtifactId,
    matchedProductCard: journeyActionObservation?.matched_product_card ?? null
  });
  const goalActionResultObservation = createGoalActionResultObservation({
    step,
    stepOrder,
    beforeSnapshot,
    pageSnapshot,
    actionResult,
    settleResult,
    matchedProductCard: journeyActionObservation?.matched_product_card ?? null
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
    ...(productDetailSignalObservation ? [{ ...productDetailSignalObservation }] : []),
    ...(goalActionResultObservation ? [{ ...goalActionResultObservation }] : []),
    ...(depthFromDiscoveryObservation ? [{ ...depthFromDiscoveryObservation }] : []),
    ...createAxTreeObservations(step, capturedArtifacts, axTreeArtifactId).map((observation) => ({ ...observation })),
    ...createLayoutCollectorObservations(step, pageSnapshot).map((observation) => ({ ...observation })),
    ...createNetworkTimelineObservations(step, pageSnapshot, harArtifactId).map((observation) => ({ ...observation })),
    ...(capturePerformance ? createPerformanceMetricObservations(step, pageSnapshot, performanceArtifactId).map((observation) => ({ ...observation })) : []),
    ...createLoadingStateObservations({
      step,
      beforeSnapshot,
      pageSnapshot,
      actionResult,
      settleResult
    }).map((observation) => ({ ...observation })),
    ...createPageReadyTimingObservations({
      step,
      beforeSnapshot,
      pageSnapshot,
      actionResult,
      settleResult
    }).map((observation) => ({ ...observation })),
    ...createPathNavigationObservations(step, pageSnapshot).map((observation) => ({ ...observation })),
    ...createAccordionStateObservations(step, pageSnapshot).map((observation) => ({ ...observation })),
    ...createCheckoutContextObservations(step, pageSnapshot).map((observation) => ({ ...observation })),
    ...createKeyboardFocusStateObservations(step, pageSnapshot).map((observation) => ({ ...observation })),
    ...createVisibleTextBlockObservations(step, pageSnapshot),
    ...createTextBlockMetricsObservations(step, pageSnapshot).map((observation) => ({ ...observation })),
    ...createInteractiveComponentsObservations(step, stepOrder, pageSnapshot).map((observation) => ({ ...observation })),
    ...createFormFieldObservations(stepOrder, pageSnapshot),
    ...createCtaCandidateObservations(step, pageSnapshot),
    ...createProductCardObservations(step, pageSnapshot, screenshotArtifactId).map((observation) => ({ ...observation })),
    ...createGoalActionCandidateObservations(step, pageSnapshot).map((observation) => ({ ...observation })),
    ...pageSnapshot.consoleErrors.filter(isActionableConsoleError).map((message) => ({
      type: "console_error",
      message
    })),
    ...pageSnapshot.networkErrors.filter(isActionableNetworkFailure).map((message) => ({
      type: "network_failure",
      message
    })),
    ...(pageSnapshot.browserHealth.status === "ok"
      ? []
      : [{
          type: "browser_health",
          status: pageSnapshot.browserHealth.status,
          reason: pageSnapshot.browserHealth.reason,
          observed_at: pageSnapshot.browserHealth.observedAt
        }]),
    ...createSettleObservations(settleResult)
  ];
}

function isActionableConsoleError(message: string): boolean {
  const normalizedMessage = message.trim();
  if (normalizedMessage.length === 0) {
    return false;
  }

  if (normalizedMessage.includes("net::ERR_UNKNOWN_URL_SCHEME")) {
    return false;
  }

  return true;
}

function isActionableNetworkFailure(message: string): boolean {
  const normalizedMessage = message.trim();
  if (normalizedMessage.length === 0) {
    return false;
  }

  if (normalizedMessage.includes("chrome-extension://") && normalizedMessage.includes("net::ERR_UNKNOWN_URL_SCHEME")) {
    return false;
  }

  if (normalizedMessage.includes("bc.ad.daum.net") && normalizedMessage.includes("net::ERR_ABORTED")) {
    return false;
  }

  return true;
}

function createPageReadyTimingObservations({
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
}): PageReadyTimingObservation[] {
  if (!beforeSnapshot && !actionResult && step.action.type === "checkpoint") {
    return [];
  }

  const baselineSnapshot = beforeSnapshot ?? pageSnapshot;
  const actionDetails = actionResult?.details ?? {};
  const actionKind = inferActionKind({
    step,
    beforeSnapshot: baselineSnapshot,
    pageSnapshot,
    clickedText: readOptionalString(actionDetails, "clickedText") ?? pageSnapshot.lastAction?.clickedText ?? null,
    elementRole: readOptionalString(actionDetails, "elementRole") ?? pageSnapshot.lastAction?.elementRole ?? null
  });
  const urlChanged = baselineSnapshot.finalUrl !== pageSnapshot.finalUrl;
  const routeChanged = routeChangedBetween(baselineSnapshot.finalUrl, pageSnapshot.finalUrl);
  const mainContentChanged = domChangedBetween(baselineSnapshot, pageSnapshot);
  const targetPageSignals = inferTargetPageSignals(pageSnapshot);

  if (!urlChanged && !mainContentChanged && settleResult.status === "settled" && settleResult.durationMs < 1_000) {
    return [];
  }

  return [
    {
      observation_id: `${step.step_id}.obs_page_ready_timing`,
      type: "page_ready_timing",
      stage: step.stage,
      source: ["browser", "performance", "dom", "scenario_log"],
      confidence: settleResult.status === "timeout" ? 0.82 : 0.74,
      trigger_type: settleResult.strategy,
      action_kind: actionKind,
      settle_status: settleResult.status,
      duration_ms: settleResult.durationMs,
      url_changed: urlChanged,
      route_changed: routeChanged,
      main_content_changed: mainContentChanged,
      same_origin: sameOrigin(baselineSnapshot.finalUrl, pageSnapshot.finalUrl),
      target_page_signals: targetPageSignals
    }
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
  const actionKind = inferActionKind({ step, beforeSnapshot: baselineSnapshot, pageSnapshot, clickedText, elementRole });
  const expectedOutcomeHint = inferExpectedOutcomeHints({ actionKind, beforeSnapshot: baselineSnapshot, pageSnapshot });
  const matchedProductCard = matchProductCardAcrossSnapshots({
    snapshots: [beforeSnapshot, pageSnapshot],
    clickedText,
    clickedSelector,
    bbox
  });

  return {
    observation_id: `${step.step_id}.obs_journey_action_raw`,
    type: "journey_action_raw",
    stage: step.stage,
    source: ["scenario_log", "dom", "browser", "network"],
    confidence: actionResult ? 0.82 : 0.72,
    step_order: stepOrder,
    step_key: step.step_id,
    action_type: step.action.type,
    action_kind: actionKind,
    expected_outcome_hint: expectedOutcomeHint,
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
    dom_changed: domChangedBetween(baselineSnapshot, pageSnapshot),
    network_result: networkResult,
    settle_status: settleResult.status,
    screenshot_artifact_id: screenshotArtifactId,
    bbox,
    matched_product_card: matchedProductCard
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

function createProductDetailSignalObservation({
  step,
  stepOrder,
  beforeSnapshot,
  pageSnapshot,
  actionResult,
  screenshotArtifactId,
  matchedProductCard
}: {
  step: ScenarioStep;
  stepOrder: number;
  beforeSnapshot?: BrowserPageSnapshot;
  pageSnapshot: BrowserPageSnapshot;
  actionResult?: BrowserActionResult;
  screenshotArtifactId: string;
  matchedProductCard: JourneyActionRawObservation["matched_product_card"];
}): ProductDetailSignalObservation | null {
  if (!beforeSnapshot || step.action.type === "checkpoint" || !actionResult || !matchedProductCard) {
    return null;
  }

  const actionDetails = actionResult.details ?? {};
  const clickedText = readOptionalString(actionDetails, "clickedText") ?? clickedComponent(pageSnapshot)?.text ?? null;
  const clickedSelector = readOptionalString(actionDetails, "clickedSelector") ?? clickedComponent(pageSnapshot)?.selector ?? null;
  const goalActionCandidateCount = pageSnapshot.interactiveComponents.filter((component) => component.is_cta_candidate).length;
  const addToCartLikeButtonCount = pageSnapshot.interactiveComponents.filter((component) => isAddToCartLike(component.text)).length;
  const domChanged = domChangedBetween(beforeSnapshot, pageSnapshot);
  const evidence = collectProductDetailEvidence({
    beforeSnapshot,
    pageSnapshot,
    goalActionCandidateCount,
    addToCartLikeButtonCount,
    domChanged
  });

  if (!isLikelyProductDetailTransition(evidence)) {
    return null;
  }

  return {
    observation_id: `${step.step_id}.obs_product_detail_signal`,
    type: "product_detail_signal",
    stage: step.stage,
    source: ["scenario_log", "dom", "browser", "screenshot"],
    confidence: productDetailConfidence(evidence),
    step_order: stepOrder,
    step_key: step.step_id,
    action_type: step.action.type,
    clicked_text: clickedText,
    clicked_selector: clickedSelector,
    matched_product_card: matchedProductCard,
    url_before: beforeSnapshot.finalUrl,
    url_after: pageSnapshot.finalUrl,
    title_before: beforeSnapshot.title,
    title_after: pageSnapshot.title,
    breadcrumb_before: beforeSnapshot.breadcrumb,
    breadcrumb_after: pageSnapshot.breadcrumb,
    visible_price: pageSnapshot.visiblePrices,
    visible_product_image: pageSnapshot.productImages.map((image) => ({ ...image })),
    goal_action_candidate_count: goalActionCandidateCount,
    add_to_cart_like_button_count: addToCartLikeButtonCount,
    dom_changed: domChanged,
    screenshot_artifact_id: screenshotArtifactId,
    evidence
  };
}

function createGoalActionResultObservation({
  step,
  stepOrder,
  beforeSnapshot,
  pageSnapshot,
  actionResult,
  settleResult,
  matchedProductCard
}: {
  step: ScenarioStep;
  stepOrder: number;
  beforeSnapshot?: BrowserPageSnapshot;
  pageSnapshot: BrowserPageSnapshot;
  actionResult?: BrowserActionResult;
  settleResult: BrowserSettleResult;
  matchedProductCard: JourneyActionRawObservation["matched_product_card"];
}): GoalActionResultObservation | null {
  if (step.action.type === "checkpoint" || !actionResult) {
    return null;
  }

  const baselineSnapshot = beforeSnapshot ?? pageSnapshot;
  const actionDetails = actionResult.details ?? {};
  const clickedText = readOptionalString(actionDetails, "clickedText") ?? clickedComponent(pageSnapshot)?.text ?? null;
  const clickedSelector = readOptionalString(actionDetails, "clickedSelector") ?? clickedComponent(pageSnapshot)?.selector ?? null;
  const result = createGoalActionResultSignal({
    step,
    beforeSnapshot,
    pageSnapshot,
    actionResult,
    settleResult
  });
  const successEvidence = collectGoalActionSuccessEvidence(result);
  const goalActionLike = result.add_to_cart_like_button || isAddToCartLike(step.description);
  const strongResultEvidence = (result.cart_count_delta ?? 0) > 0 ||
    result.toast_present ||
    (step.stage === "COMMIT" && (result.network_success || result.url_changed));

  if (!goalActionLike && !strongResultEvidence) {
    return null;
  }

  return {
    observation_id: `${step.step_id}.obs_goal_action_result`,
    type: "goal_action_result",
    stage: step.stage,
    source: ["scenario_log", "dom", "browser", "network"],
    confidence: goalActionLike && successEvidence.length > 0 ? 0.84 : 0.7,
    step_order: stepOrder,
    step_key: step.step_id,
    action_type: step.action.type,
    clicked_text: clickedText,
    clicked_selector: clickedSelector,
    url_before: baselineSnapshot.finalUrl,
    url_after: pageSnapshot.finalUrl,
    goal_action_like: goalActionLike,
    success_evidence: successEvidence,
    result,
    matched_product_card: matchedProductCard
  };
}

function createAxTreeObservations(
  step: ScenarioStep,
  capturedArtifacts?: BrowserCapturedArtifacts,
  axTreeArtifactId?: string
): AxTreeObservation[] {
  if (!capturedArtifacts?.axTree || !axTreeArtifactId) {
    return [];
  }

  return [
    {
      observation_id: `${step.step_id}.obs_ax_tree`,
      type: "ax_tree",
      stage: step.stage,
      source: ["accessibility"],
      confidence: 0.72,
      ax_artifact_id: axTreeArtifactId,
      summary: capturedArtifacts.axTree.summary
    }
  ];
}

function createLayoutCollectorObservations(
  step: ScenarioStep,
  pageSnapshot: BrowserPageSnapshot
): LayoutCollectorObservation[] {
  if (pageSnapshot.interactiveComponents.length === 0 && pageSnapshot.visibleTextBlocks.length === 0) {
    return [];
  }

  return [
    {
      observation_id: `${step.step_id}.obs_layout_collector`,
      type: "layout_collector",
      stage: step.stage,
      source: ["layout", "dom"],
      confidence: 0.7,
      summary: pageSnapshot.layoutSummary,
      top_interactive_components: pageSnapshot.interactiveComponents
        .slice()
        .sort((left, right) => (right.visibility?.area_px ?? right.bounds.width * right.bounds.height) - (left.visibility?.area_px ?? left.bounds.width * left.bounds.height))
        .slice(0, 10)
        .map((component) => ({
          text: component.text,
          role: component.role,
          selector: component.selector,
          bounds: component.bounds,
          visibility: component.visibility,
          layout: component.layout
        }))
    }
  ];
}

function createNetworkTimelineObservations(
  step: ScenarioStep,
  pageSnapshot: BrowserPageSnapshot,
  harArtifactId?: string
): NetworkTimelineObservation[] {
  if (pageSnapshot.networkEvents.length === 0) {
    return [];
  }

  return [
    {
      observation_id: `${step.step_id}.obs_network_timeline`,
      type: "network_timeline",
      stage: step.stage,
      source: ["network"],
      confidence: pageSnapshot.networkEvents.some((event) => event.status !== undefined || event.failed === true) ? 0.78 : 0.62,
      har_artifact_id: harArtifactId ?? null,
      event_count: pageSnapshot.networkEvents.length,
      failed_request_count: pageSnapshot.networkEvents.filter((event) => event.failed === true).length,
      status_code_counts: statusCodeCounts(pageSnapshot.networkEvents),
      events: pageSnapshot.networkEvents.slice(-20).map((event) => ({ ...event }))
    }
  ];
}

function createPerformanceMetricObservations(
  step: ScenarioStep,
  pageSnapshot: BrowserPageSnapshot,
  performanceArtifactId?: string
): PerformanceMetricObservation[] {
  if (!pageSnapshot.performanceSummary) {
    return [];
  }

  return [
    {
      observation_id: `${step.step_id}.obs_performance_metric`,
      type: "performance_metric",
      stage: step.stage,
      source: ["performance"],
      confidence: 0.72,
      web_vitals_artifact_id: performanceArtifactId ?? null,
      summary: pageSnapshot.performanceSummary
    }
  ];
}

function createLoadingStateObservations({
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
}): LoadingStateObservation[] {
  const actionDetails = actionResult?.details ?? {};
  const actionKind = inferActionKind({
    step,
    beforeSnapshot,
    pageSnapshot,
    clickedText: readOptionalString(actionDetails, "clickedText") ?? pageSnapshot.lastAction?.clickedText ?? null,
    elementRole: readOptionalString(actionDetails, "elementRole") ?? pageSnapshot.lastAction?.elementRole ?? null
  });
  const expectedOutcomeHint = inferExpectedOutcomeHints({
    actionKind,
    beforeSnapshot,
    pageSnapshot
  });
  const hasLoadingSignal = pageSnapshot.loadingState.has_spinner ||
    pageSnapshot.loadingState.has_progressbar ||
    pageSnapshot.loadingState.status_text.length > 0 ||
    pageSnapshot.loadingState.clicked_submit_disabled === true ||
    pageSnapshot.loadingState.aria_busy;

  if (!hasLoadingSignal && actionKind !== "submit" && actionKind !== "checkout_submit" && actionKind !== "payment_submit" && settleResult.status !== "timeout") {
    return [];
  }

  return [
    {
      observation_id: `${step.step_id}.obs_loading_state`,
      type: "loading_state",
      stage: step.stage,
      source: ["dom", "browser"],
      confidence: hasLoadingSignal ? 0.78 : 0.58,
      action_kind: actionKind,
      expected_outcome_hint: expectedOutcomeHint,
      settle_status: settleResult.status,
      duration_ms: settleResult.durationMs,
      loading_state: pageSnapshot.loadingState
    }
  ];
}

function createKeyboardFocusStateObservations(
  step: ScenarioStep,
  pageSnapshot: BrowserPageSnapshot
): KeyboardFocusStateObservation[] {
  const focusState = pageSnapshot.keyboardFocusState;
  if (!focusState.sampled || focusState.focus_order.length === 0) {
    return [];
  }

  return [
    {
      observation_id: `${step.step_id}.obs_keyboard_focus_state`,
      type: "keyboard_focus_state",
      stage: step.stage,
      source: ["browser", "dom"],
      confidence: focusState.keyboard_trap_candidate || focusState.modal_open ? 0.78 : 0.68,
      focus_state: focusState
    }
  ];
}

function createVisibleTextBlockObservations(
  step: ScenarioStep,
  pageSnapshot: BrowserPageSnapshot
): Record<string, unknown>[] {
  if (pageSnapshot.visibleTextBlocks.length === 0) {
    return [];
  }

  return [
    {
      observation_id: `${step.step_id}.obs_visible_text_blocks`,
      type: "visible_text_blocks",
      stage: step.stage,
      source: ["dom", "layout"],
      confidence: 0.68,
      dom_summary: pageSnapshot.domSummary,
      layout_summary: pageSnapshot.layoutSummary,
      blocks: pageSnapshot.visibleTextBlocks.slice(0, 20)
    }
  ];
}

function createTextBlockMetricsObservations(
  step: ScenarioStep,
  pageSnapshot: BrowserPageSnapshot
): TextBlockMetricsObservation[] {
  const metricBlocks = pageSnapshot.visibleTextBlocks.filter((block) =>
    block.line_count !== undefined ||
    block.font_size_px !== undefined ||
    block.nearby_cta_ref !== undefined ||
    (block.mobile_line_break_segments?.length ?? 0) > 0
  );

  if (metricBlocks.length === 0) {
    return [];
  }

  return [
    {
      observation_id: `${step.step_id}.obs_text_block_metrics`,
      type: "text_block_metrics",
      stage: step.stage,
      source: ["dom", "layout"],
      confidence: 0.7,
      viewport: pageSnapshot.viewport,
      blocks: metricBlocks.slice(0, 20)
    }
  ];
}

function createPathNavigationObservations(
  step: ScenarioStep,
  pageSnapshot: BrowserPageSnapshot
): PathNavigationObservation[] {
  if (pageSnapshot.stepIndicators.length === 0 && pageSnapshot.backLinkCandidates.length === 0 && pageSnapshot.visitedUrls.length <= 1) {
    return [];
  }

  return [
    {
      observation_id: `${step.step_id}.obs_path_navigation`,
      type: "path_navigation",
      stage: step.stage,
      source: ["dom", "browser"],
      confidence: pageSnapshot.stepIndicators.length > 0 || pageSnapshot.backLinkCandidates.length > 0 ? 0.74 : 0.52,
      step_indicator: pageSnapshot.stepIndicators,
      back_link_candidate: pageSnapshot.backLinkCandidates,
      visited_url_count: pageSnapshot.visitedUrls.length,
      browser_history_back_available: pageSnapshot.visitedUrls.length > 1,
      flow_step_count: inferFlowStepCount(pageSnapshot.stepIndicators)
    }
  ];
}

function createAccordionStateObservations(
  step: ScenarioStep,
  pageSnapshot: BrowserPageSnapshot
): AccordionStateObservation[] {
  if (pageSnapshot.accordionStates.length === 0) {
    return [];
  }

  return [
    {
      observation_id: `${step.step_id}.obs_accordion_state`,
      type: "accordion_state",
      stage: step.stage,
      source: ["dom"],
      confidence: 0.72,
      accordions: pageSnapshot.accordionStates
    }
  ];
}

function createCheckoutContextObservations(
  step: ScenarioStep,
  pageSnapshot: BrowserPageSnapshot
): CheckoutContextObservation[] {
  const context = pageSnapshot.checkoutContext;
  if (!context.is_checkout_flow && !context.has_order_summary && !context.has_final_submit) {
    return [];
  }

  return [
    {
      observation_id: `${step.step_id}.obs_checkout_context`,
      type: "checkout_context",
      stage: step.stage,
      source: ["dom", "browser"],
      confidence: context.is_checkout_flow ? 0.78 : 0.6,
      checkout_context: context
    }
  ];
}

function createInteractiveComponentsObservations(
  step: ScenarioStep,
  stepOrder: number,
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
      repeated_generic_link_grouping: pageSnapshot.repeatedGenericLinkGrouping,
      components: pageSnapshot.interactiveComponents.map((component) => withInteractionOrder(component, stepOrder))
    }
  ];
}

function withInteractionOrder(
  component: BrowserPageSnapshot["interactiveComponents"][number],
  stepOrder: number
): BrowserPageSnapshot["interactiveComponents"][number] {
  const interacted = component.clicked_in_scenario ||
    component.typed_in_scenario === true ||
    component.filled_in_scenario === true ||
    component.selected_in_scenario === true;
  return {
    ...component,
    interaction_order: interacted ? stepOrder : component.interaction_order ?? null
  };
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

function createFormFieldObservations(stepOrder: number, pageSnapshot: BrowserPageSnapshot): Record<string, unknown>[] {
  const fieldValueLengths = Object.fromEntries(
    Object.entries(pageSnapshot.fields).map(([fieldKey, value]) => [fieldKey, value.length])
  );
  const componentFieldKeys = new Set<string>();

  const componentFields = pageSnapshot.interactiveComponents
    .filter((component) => component.is_form_control === true)
    .map((component) => {
      const fieldKey = component.name ?? component.selector ?? component.label_text ?? component.placeholder ?? component.text;
      componentFieldKeys.add(fieldKey);
      return {
        type: "form_field",
        field_key: fieldKey,
        value_length: component.name ? fieldValueLengths[component.name] ?? 0 : 0,
        label_text: component.label_text ?? null,
        accessible_name: component.accessible_name ?? null,
        visible_text: component.visible_text ?? null,
        placeholder: component.placeholder ?? null,
        required: component.required === true,
        input_type: component.input_type ?? null,
        describedby_text: component.describedby_text ?? null,
        help_text: component.help_text ?? null,
        input_format_hint: component.input_format_hint ?? null,
        pattern: component.pattern ?? null,
        min: component.min ?? null,
        max: component.max ?? null,
        maxlength: component.maxlength ?? null,
        visible_required_marker: component.visible_required_marker ?? null,
        visible_optional_marker: component.visible_optional_marker ?? null,
        group_level_required_state: component.group_level_required_state ?? null,
        submit_required_error: component.submit_required_error ?? null,
        typed_in_scenario: component.typed_in_scenario === true,
        filled_in_scenario: component.filled_in_scenario === true,
        selected_in_scenario: component.selected_in_scenario === true,
        interaction_order: component.filled_in_scenario === true || component.typed_in_scenario === true || component.selected_in_scenario === true
          ? stepOrder
          : component.interaction_order ?? null,
        visual_prominence: component.visual_prominence ?? null,
        bounds: component.bounds,
        visibility: component.visibility
      };
    });
  const fieldOnlyEntries = Object.entries(pageSnapshot.fields)
    .filter(([fieldKey]) => !componentFieldKeys.has(fieldKey))
    .map(([fieldKey, value]) => ({
      type: "form_field",
      field_key: fieldKey,
      value_length: value.length
    }));

  return [...componentFields, ...fieldOnlyEntries];
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

function inferActionKind({
  step,
  beforeSnapshot,
  pageSnapshot,
  clickedText,
  elementRole
}: {
  step: ScenarioStep;
  beforeSnapshot?: BrowserPageSnapshot;
  pageSnapshot: BrowserPageSnapshot;
  clickedText?: string | null;
  elementRole?: string | null;
}): RunnerActionKind {
  if (step.action.type === "goto") {
    return "navigation";
  }
  if (step.action.type === "fill" || step.action.type === "select") {
    return "form_input";
  }
  if (step.action.type !== "click") {
    return "other";
  }

  const text = normalizeSearchText([
    clickedText,
    elementRole,
    pageSnapshot.lastAction?.target,
    clickedComponent(pageSnapshot)?.input_type,
    clickedComponent(pageSnapshot)?.href
  ].filter(Boolean).join(" "));

  if (/결제|payment|pay now|place order|order now|주문|구매/.test(text)) {
    return "payment_submit";
  }
  if (/checkout|예약|신청|submit|제출|가입|create account|sign up/.test(text)) {
    return "checkout_submit";
  }
  if (/add to cart|add to basket|장바구니|카트|담기/.test(text)) {
    return "submit";
  }
  if (elementRole === "link" || clickedComponent(pageSnapshot)?.href) {
    return "navigation";
  }
  if (clickedComponent(pageSnapshot)?.input_type === "submit" || elementRole === "button" || /submit|button|제출/.test(text)) {
    return "submit";
  }
  if (beforeSnapshot?.finalUrl !== pageSnapshot.finalUrl) {
    return "navigation";
  }
  if (/tab|탭/.test(text)) {
    return "tab_change";
  }
  if (/menu|메뉴/.test(text)) {
    return "menu_open";
  }
  if (/filter|sort|category|필터|정렬|카테고리/.test(text)) {
    return "filter_change";
  }
  return "other";
}

function inferExpectedOutcomeHints({
  actionKind,
  beforeSnapshot,
  pageSnapshot
}: {
  actionKind: RunnerActionKind;
  beforeSnapshot?: BrowserPageSnapshot;
  pageSnapshot: BrowserPageSnapshot;
}): RunnerExpectedOutcomeHint[] {
  const hints = new Set<RunnerExpectedOutcomeHint>();
  const urlChanged = Boolean(beforeSnapshot && beforeSnapshot.finalUrl !== pageSnapshot.finalUrl);
  const domChanged = beforeSnapshot ? domChangedBetween(beforeSnapshot, pageSnapshot) : false;
  const cartChanged = typeof beforeSnapshot?.cartCount === "number" &&
    typeof pageSnapshot.cartCount === "number" &&
    beforeSnapshot.cartCount !== pageSnapshot.cartCount;

  if (urlChanged || actionKind === "navigation") {
    hints.add("url_change");
  }
  if (domChanged) {
    hints.add("dom_change");
  }
  if (pageSnapshot.toastTexts.length > 0) {
    hints.add("toast_show");
  }
  if (cartChanged) {
    hints.add("item_count_change");
  }
  if (actionKind === "form_input" || actionKind === "submit") {
    hints.add("form_submit");
  }
  if (actionKind === "checkout_submit" || actionKind === "payment_submit") {
    hints.add("checkout_processing");
  }
  if (hints.size === 0 && (actionKind === "tab_change" || actionKind === "menu_open")) {
    hints.add("no_visible_change_expected");
  }
  if (hints.size === 0) {
    hints.add("dom_change");
  }

  return [...hints];
}

function sameJsonArray(left: unknown[], right: unknown[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameStringArray(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
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

function routeChangedBetween(beforeUrl: string, afterUrl: string): boolean {
  try {
    const before = new URL(beforeUrl);
    const after = new URL(afterUrl);
    return before.origin !== after.origin || before.pathname !== after.pathname;
  } catch {
    return beforeUrl !== afterUrl;
  }
}

function sameOrigin(beforeUrl: string, afterUrl: string): boolean {
  try {
    return new URL(beforeUrl).origin === new URL(afterUrl).origin;
  } catch {
    return beforeUrl === afterUrl;
  }
}

function inferTargetPageSignals(pageSnapshot: BrowserPageSnapshot): PageReadyTimingObservation["target_page_signals"] {
  const pageText = normalizeSearchText([
    pageSnapshot.title,
    pageSnapshot.finalUrl,
    ...pageSnapshot.visibleTextBlocks.map((block) => block.text),
    ...pageSnapshot.toastTexts,
    ...pageSnapshot.loadingState.status_text,
    ...pageSnapshot.interactiveComponents.map((component) => `${component.text} ${component.accessible_name ?? ""} ${component.input_type ?? ""}`)
  ].join(" "));

  return {
    has_permission_prompt: /allow|permission|권한|허용|위치|알림|마이크|카메라/.test(pageText),
    has_streaming_response: /streaming|generating|loading|생성 중|불러오는 중|처리 중/.test(pageText) || pageSnapshot.loadingState.aria_busy,
    has_map: /map|지도|매장 찾기|location|위치/.test(pageText),
    has_webgl: /webgl|canvas|3d|ar\b|vr\b/.test(pageText),
    has_payment_form: pageSnapshot.checkoutContext.has_final_submit ||
      pageSnapshot.checkoutContext.flow_subtype === "payment" ||
      pageSnapshot.interactiveComponents.some((component) => /card|카드|cvc|cvv|expiry|만료|payment|결제/i.test([
        component.name,
        component.label_text,
        component.placeholder,
        component.accessible_name,
        component.input_type
      ].filter(Boolean).join(" "))),
    has_auth_redirect: /login|signin|sign-in|auth|oauth|로그인|인증/.test(pageText)
  };
}

function isCategoryFilterSearchText(text: string): boolean {
  return /category|categories|collection|filter|sort|search|카테고리|분류|필터|정렬|검색|상품|제품/i.test(text);
}

function domChangedBetween(beforeSnapshot: BrowserPageSnapshot, pageSnapshot: BrowserPageSnapshot): boolean {
  return Boolean(beforeSnapshot.domSignature && pageSnapshot.domSignature)
    ? beforeSnapshot.domSignature !== pageSnapshot.domSignature
    : beforeSnapshot.finalUrl !== pageSnapshot.finalUrl || beforeSnapshot.title !== pageSnapshot.title;
}

function collectProductDetailEvidence({
  beforeSnapshot,
  pageSnapshot,
  goalActionCandidateCount,
  addToCartLikeButtonCount,
  domChanged
}: {
  beforeSnapshot: BrowserPageSnapshot;
  pageSnapshot: BrowserPageSnapshot;
  goalActionCandidateCount: number;
  addToCartLikeButtonCount: number;
  domChanged: boolean;
}): ProductDetailSignalObservation["evidence"] {
  return [
    "matched_product_card",
    ...(beforeSnapshot.finalUrl !== pageSnapshot.finalUrl ? ["url_changed" as const] : []),
    ...(beforeSnapshot.title !== pageSnapshot.title ? ["title_changed" as const] : []),
    ...(!sameStringArray(beforeSnapshot.breadcrumb, pageSnapshot.breadcrumb) ? ["breadcrumb_changed" as const] : []),
    ...(pageSnapshot.visiblePrices.length > 0 ? ["price_visible" as const] : []),
    ...(pageSnapshot.productImages.length > 0 ? ["product_image_visible" as const] : []),
    ...(goalActionCandidateCount > 0 || addToCartLikeButtonCount > 0 ? ["goal_action_candidate_visible" as const] : []),
    ...(domChanged ? ["dom_changed" as const] : [])
  ];
}

function isLikelyProductDetailTransition(evidence: ProductDetailSignalObservation["evidence"]): boolean {
  const transitionEvidenceCount = [
    "url_changed",
    "title_changed",
    "breadcrumb_changed",
    "dom_changed"
  ].filter((candidate) => evidence.includes(candidate as ProductDetailSignalObservation["evidence"][number])).length;
  const detailEvidenceCount = [
    "price_visible",
    "product_image_visible",
    "goal_action_candidate_visible"
  ].filter((candidate) => evidence.includes(candidate as ProductDetailSignalObservation["evidence"][number])).length;

  return transitionEvidenceCount > 0 && detailEvidenceCount > 0;
}

function productDetailConfidence(evidence: ProductDetailSignalObservation["evidence"]): number {
  const evidenceCount = evidence.length;
  if (evidenceCount >= 6) {
    return 0.84;
  }
  if (evidenceCount >= 4) {
    return 0.76;
  }
  return 0.68;
}

function matchProductCardAcrossSnapshots({
  snapshots,
  clickedText,
  clickedSelector,
  bbox
}: {
  snapshots: Array<BrowserPageSnapshot | undefined>;
  clickedText: string | null;
  clickedSelector: string | null;
  bbox: BrowserPageSnapshot["interactiveComponents"][number]["bounds"] | null;
}): JourneyActionRawObservation["matched_product_card"] {
  for (const snapshot of snapshots) {
    if (!snapshot || snapshot.productCards.length === 0) {
      continue;
    }

    const match = matchProductCard({
      pageSnapshot: snapshot,
      clickedText,
      clickedSelector,
      bbox
    });
    if (match) {
      return match;
    }
  }

  return null;
}

function matchProductCard({
  pageSnapshot,
  clickedText,
  clickedSelector,
  bbox
}: {
  pageSnapshot: BrowserPageSnapshot;
  clickedText: string | null;
  clickedSelector: string | null;
  bbox: BrowserPageSnapshot["interactiveComponents"][number]["bounds"] | null;
}): JourneyActionRawObservation["matched_product_card"] {
  const matches = pageSnapshot.productCards
    .map((card) => {
      const selectorScore = matchSelectorScore(clickedSelector, card.clicked_selector);
      const textScore = matchTextScore(clickedText, card.element_text);
      const bboxScore = bbox ? boundsOverlapRatio(bbox, card.bbox) : 0;
      const bestScore = Math.max(selectorScore, textScore, bboxScore);
      return {
        card,
        bestScore,
        matchReason: matchReason({ selectorScore, textScore, bboxScore })
      };
    })
    .filter((candidate) => candidate.bestScore >= 0.48)
    .sort((left, right) => right.bestScore - left.bestScore);

  const bestMatch = matches[0];
  if (!bestMatch) {
    return null;
  }

  return {
    ...bestMatch.card,
    match_reason: bestMatch.matchReason,
    match_confidence: Number(bestMatch.bestScore.toFixed(2))
  };
}

function matchSelectorScore(clickedSelector: string | null, cardSelector: string | null): number {
  if (!clickedSelector || !cardSelector) {
    return 0;
  }

  if (clickedSelector === cardSelector) {
    return 0.94;
  }

  return clickedSelector.includes(cardSelector) || cardSelector.includes(clickedSelector) ? 0.72 : 0;
}

function matchTextScore(clickedText: string | null, cardText: string): number {
  const clickedTokens = meaningfulTokens(clickedText ?? "");
  const cardTokens = meaningfulTokens(cardText);
  if (clickedTokens.length === 0 || cardTokens.length === 0) {
    return 0;
  }

  const matchingTokenCount = clickedTokens.filter((token) => cardTokens.includes(token)).length;
  const overlapRatio = matchingTokenCount / clickedTokens.length;
  return overlapRatio >= 0.5 ? Math.min(0.86, 0.42 + overlapRatio * 0.44) : 0;
}

function boundsOverlapRatio(
  left: BrowserPageSnapshot["interactiveComponents"][number]["bounds"],
  right: BrowserPageSnapshot["interactiveComponents"][number]["bounds"]
): number {
  const overlapLeft = Math.max(left.x, right.x);
  const overlapTop = Math.max(left.y, right.y);
  const overlapRight = Math.min(left.x + left.width, right.x + right.width);
  const overlapBottom = Math.min(left.y + left.height, right.y + right.height);
  const overlapWidth = Math.max(0, overlapRight - overlapLeft);
  const overlapHeight = Math.max(0, overlapBottom - overlapTop);
  const overlapArea = overlapWidth * overlapHeight;
  const leftArea = left.width * left.height;

  if (leftArea <= 0) {
    return 0;
  }

  const ratio = overlapArea / leftArea;
  return ratio >= 0.5 ? Math.min(0.84, 0.36 + ratio * 0.48) : 0;
}

function matchReason({
  selectorScore,
  textScore,
  bboxScore
}: {
  selectorScore: number;
  textScore: number;
  bboxScore: number;
}): NonNullable<JourneyActionRawObservation["matched_product_card"]>["match_reason"] {
  const bestScore = Math.max(selectorScore, textScore, bboxScore);
  if (bestScore === selectorScore && selectorScore >= 0.9) {
    return "selector_exact";
  }
  if (bestScore === selectorScore) {
    return "selector_related";
  }
  if (bestScore === textScore) {
    return "text_overlap";
  }
  return "bbox_overlap";
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
  const domChanged = domChangedBetween(baselineSnapshot, pageSnapshot);

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

function collectGoalActionSuccessEvidence(
  result: DepthFromDiscoveryObservation["goal_action_result"]
): GoalActionResultObservation["success_evidence"] {
  return [
    ...((result.cart_count_delta ?? 0) > 0 ? ["cart_count_increased" as const] : []),
    ...(result.toast_present ? ["toast_present" as const] : []),
    ...(result.network_success ? ["network_success" as const] : []),
    ...(result.url_changed ? ["url_changed" as const] : []),
    ...(result.dom_changed ? ["dom_changed" as const] : [])
  ];
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
