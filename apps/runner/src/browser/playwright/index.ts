import { randomUUID } from "node:crypto";
import {
  chromium,
  firefox,
  webkit,
  type Browser,
  type BrowserContext,
  type Frame,
  type Locator,
  type BrowserType,
  type Page,
  type Request
} from "playwright";
import { createCdpSession, type CdpSessionMetadata } from "../cdp/index.ts";
import type { RunnerBrowserName, RunnerConfig } from "../../config/index.ts";
import type {
  AgentArtifactPolicy,
  AxTreeSummary,
  BrowserAccordionState,
  BrowserBackLinkCandidateSignal,
  BrowserCheckoutContext,
  BrowserKeyboardFocusState,
  BrowserFormGroupRequiredState,
  BrowserPerformanceSummary,
  BrowserLoadingState,
  BrowserRepeatedGenericLinkGroup,
  BrowserStepIndicatorSignal,
  InteractiveComponentBounds,
  InteractiveComponentLayout,
  InteractiveComponentVisibility,
  ScenarioAction,
  ScenarioPlan,
  ScenarioStep,
  SettleStrategy,
  TargetDescriptor,
  InteractiveComponentObservationItem,
  VisibleTextBlockObservationItem,
  DomVisibilitySummary,
  LayoutVisibilitySummary
} from "../../shared/contracts.ts";
import {
  assertScenarioActionAllowed,
  assertVisitedUrlAllowed
} from "../../scenario/policy.ts";
import { describeTarget, errorMessage, sleep, toIsoTimestamp } from "../../shared/utils.ts";
import { capturePageScreenshot, preparePageForScreenshot } from "./screenshot.ts";
import { inferFieldKey, inferGotoUrl, inferNavigationUrl } from "./action-targets.ts";

export interface BrowserActionResult {
  actionType: ScenarioAction["type"];
  targetSummary: string | null;
  stopRequested: boolean;
  details: Record<string, unknown>;
}

export interface BrowserSettleResult {
  strategy: string;
  durationMs: number;
  status: "settled" | "timeout" | "failed";
  targetSummary?: string | null;
  details?: Record<string, unknown>;
}

export interface BrowserProductImageSignal {
  src: string | null;
  alt: string | null;
  bounds: InteractiveComponentBounds;
}

export interface BrowserProductCardSignal {
  element_text: string;
  clicked_selector: string | null;
  visible_price: string | null;
  visible_product_image: boolean;
  bbox: InteractiveComponentBounds;
}

export interface BrowserFilterSignal {
  key: string;
  value: string;
  selector: string | null;
}

export interface BrowserNetworkEventSignal {
  method: string;
  url: string;
  status?: number;
  failed?: boolean;
  errorText?: string;
  occurredAt?: string;
  resourceType?: string;
  requestStartMs?: number | null;
  responseEndMs?: number | null;
  durationMs?: number | null;
  transferSizeBytes?: number | null;
  encodedBodySizeBytes?: number | null;
}

export interface BrowserPageSnapshot {
  currentUrl: string;
  finalUrl: string;
  title: string;
  viewport: ScenarioPlan["environment"]["viewport"];
  locale: string;
  timezone: string;
  visitedUrls: string[];
  fields: Record<string, string>;
  selectedOptions: Record<string, string>;
  scrollY: number;
  lastAction: {
    type: ScenarioAction["type"];
    target: string | null;
    at: string;
    clickedText?: string | null;
    clickedSelector?: string | null;
    elementRole?: string | null;
    elementText?: string | null;
    ariaLabel?: string | null;
    bbox?: InteractiveComponentBounds | null;
  } | null;
  interactiveComponents: InteractiveComponentObservationItem[];
  visibleTextBlocks: VisibleTextBlockObservationItem[];
  domSummary: DomVisibilitySummary;
  layoutSummary: LayoutVisibilitySummary;
  consoleErrors: string[];
  networkErrors: string[];
  networkEvents: BrowserNetworkEventSignal[];
  performanceSummary: BrowserPerformanceSummary | null;
  breadcrumb: string[];
  toastTexts: string[];
  loadingState: BrowserLoadingState;
  stepIndicators: BrowserStepIndicatorSignal[];
  backLinkCandidates: BrowserBackLinkCandidateSignal[];
  accordionStates: BrowserAccordionState[];
  checkoutContext: BrowserCheckoutContext;
  keyboardFocusState: BrowserKeyboardFocusState;
  repeatedGenericLinkGrouping: BrowserRepeatedGenericLinkGroup[];
  cartCount: number | null;
  visiblePrices: string[];
  productImages: BrowserProductImageSignal[];
  productCards: BrowserProductCardSignal[];
  selectedFilters: BrowserFilterSignal[];
  searchQuery: string | null;
  domSignature: string | null;
  browserHealth: BrowserHealthState;
  cdpSession: CdpSessionMetadata;
}

export interface BrowserHealthState {
  status: "ok" | "crashed" | "closed";
  reason: string | null;
  observedAt: string | null;
}

export interface BrowserCapturedArtifacts {
  screenshot?: {
    contentBase64: string;
    mimeType: "image/png";
    fileExtension: "png";
    width: number;
    height: number;
  };
  domSnapshot?: {
    content: string;
    mimeType: "text/html";
    fileExtension: "html";
  };
  axTree?: {
    content: string;
    mimeType: "application/json";
    fileExtension: "json";
    summary: AxTreeSummary;
  };
}

export interface BrowserCaptureOptions {
  screenshotMode?: NonNullable<AgentArtifactPolicy["screenshot_mode"]>;
  captureAxTree?: boolean;
  captureHar?: boolean;
  captureTrace?: boolean;
  capturePerformance?: boolean;
}

export interface PreparedBrowserSettle {
  settle: () => Promise<BrowserSettleResult>;
  cancel: () => Promise<void>;
}

export type BrowserSafetyRecoveryMethod = "none" | "history_back" | "safe_url";

export interface BrowserSafetyRecoveryRequest {
  safeUrl: string;
  timeoutMs?: number;
}

export interface BrowserSafetyRecoveryResult {
  recovered: boolean;
  method: BrowserSafetyRecoveryMethod;
  urlBefore: string;
  urlAfter: string;
  failureMessage?: string;
}

export interface BrowserSession {
  id: string;
  plan: ScenarioPlan;
  execute: (action: ScenarioAction, step: ScenarioStep) => Promise<BrowserActionResult>;
  recoverToSafeUrl: (request: BrowserSafetyRecoveryRequest) => Promise<BrowserSafetyRecoveryResult>;
  prepareSettle?: (strategy: SettleStrategy) => Promise<PreparedBrowserSettle | null>;
  settle: (strategy: SettleStrategy) => Promise<BrowserSettleResult>;
  snapshot: () => BrowserPageSnapshot;
  captureArtifacts: (options?: BrowserCaptureOptions) => Promise<BrowserCapturedArtifacts>;
  close: () => Promise<void>;
}

export interface BrowserSessionFactory {
  kind: "simulated-playwright" | "playwright";
  createSession: (input: { runId: string; plan: ScenarioPlan }) => Promise<BrowserSession>;
}

const DEFAULT_LOCATOR_TIMEOUT_MS = 1_500;
const DEFAULT_LOCATOR_METADATA_TIMEOUT_MS = 100;
const DEFAULT_WAIT_FOR_TIMEOUT_MS = 1_500;
const DEFAULT_SAFE_RECOVERY_TIMEOUT_MS = 1_500;
const ITEM_COUNT_POLL_INTERVAL_MS = 50;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

type SettleTimeoutDetails = Record<string, unknown> | ((error: unknown) => Record<string, unknown>);

interface SettleAttempt {
  attempt: () => Promise<Record<string, unknown>>;
  timeoutDetails: SettleTimeoutDetails;
}

interface RawAxTreeNode {
  role?: { value?: unknown };
  name?: { value?: unknown };
  ignored?: boolean;
  properties?: Array<{
    name?: string;
    value?: { value?: unknown };
  }>;
}

type ReplayHintLocatorRecipeEntry =
  | {
      strategy: "selector";
      selector: string;
      confidence?: number;
      frame_id?: string;
    }
  | {
      strategy: "role_text";
      role: string;
      text: string;
      confidence?: number;
      frame_id?: string;
    }
  | {
      strategy: "href";
      href: string;
      confidence?: number;
      frame_id?: string;
    }
  | {
      strategy: "tag_text";
      tag: string;
      text: string;
      confidence?: number;
      frame_id?: string;
    };

class SettleTimeoutError extends Error {
  readonly details: Record<string, unknown>;

  constructor(message: string, details: Record<string, unknown>) {
    super(message);
    this.name = "SettleTimeoutError";
    this.details = details;
  }
}

interface MutableBrowserState {
  currentUrl: string;
  finalUrl: string;
  title: string;
  visitedUrls: string[];
  fields: Record<string, string>;
  selectedOptions: Record<string, string>;
  scrollY: number;
  lastAction: BrowserPageSnapshot["lastAction"];
  interactiveComponents: InteractiveComponentObservationItem[];
  visibleTextBlocks: VisibleTextBlockObservationItem[];
  consoleErrors: string[];
  networkErrors: string[];
  networkEvents: BrowserNetworkEventSignal[];
  performanceSummary: BrowserPerformanceSummary | null;
  breadcrumb: string[];
  toastTexts: string[];
  loadingState: BrowserLoadingState;
  stepIndicators: BrowserStepIndicatorSignal[];
  backLinkCandidates: BrowserBackLinkCandidateSignal[];
  accordionStates: BrowserAccordionState[];
  checkoutContext: BrowserCheckoutContext;
  keyboardFocusState: BrowserKeyboardFocusState;
  repeatedGenericLinkGrouping: BrowserRepeatedGenericLinkGroup[];
  cartCount: number | null;
  visiblePrices: string[];
  productImages: BrowserProductImageSignal[];
  productCards: BrowserProductCardSignal[];
  selectedFilters: BrowserFilterSignal[];
  searchQuery: string | null;
  domSignature: string | null;
  browserHealth: BrowserHealthState;
}

function readPngDimensions(buffer: Buffer) {
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return null;
  }

  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20)
  };
}

function createEmptyAxTreeSummary(): AxTreeSummary {
  return {
    node_count: 0,
    ignored_node_count: 0,
    named_node_count: 0,
    interactive_role_count: 0,
    form_control_role_count: 0,
    heading_count: 0,
    landmark_count: 0,
    button_count: 0,
    link_count: 0,
    focusable_count: 0,
    role_counts: {},
    root_role: null,
    truncated: false
  };
}

function summarizeAxTree(nodes: RawAxTreeNode[], truncated: boolean): AxTreeSummary {
  const summary = createEmptyAxTreeSummary();
  const interactiveRoles = new Set([
    "button",
    "link",
    "textbox",
    "searchbox",
    "checkbox",
    "radio",
    "combobox",
    "listbox",
    "menuitem",
    "option",
    "slider",
    "spinbutton",
    "switch",
    "tab"
  ]);
  const formControlRoles = new Set([
    "textbox",
    "searchbox",
    "checkbox",
    "radio",
    "combobox",
    "listbox",
    "option",
    "slider",
    "spinbutton",
    "switch"
  ]);
  const landmarkRoles = new Set(["banner", "main", "navigation", "contentinfo", "complementary", "region", "search", "form"]);

  summary.node_count = nodes.length;
  summary.root_role = axStringValue(nodes[0]?.role?.value);
  summary.truncated = truncated;

  for (const node of nodes) {
    const role = axStringValue(node.role?.value) ?? "unknown";
    summary.role_counts[role] = (summary.role_counts[role] ?? 0) + 1;

    if (node.ignored === true) {
      summary.ignored_node_count += 1;
    }
    if (axStringValue(node.name?.value)) {
      summary.named_node_count += 1;
    }
    if (interactiveRoles.has(role)) {
      summary.interactive_role_count += 1;
    }
    if (formControlRoles.has(role)) {
      summary.form_control_role_count += 1;
    }
    if (role === "heading") {
      summary.heading_count += 1;
    }
    if (landmarkRoles.has(role)) {
      summary.landmark_count += 1;
    }
    if (role === "button") {
      summary.button_count += 1;
    }
    if (role === "link") {
      summary.link_count += 1;
    }
    if (hasAxBooleanProperty(node, "focusable")) {
      summary.focusable_count += 1;
    }
  }

  summary.role_counts = Object.fromEntries(
    Object.entries(summary.role_counts)
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, 30)
  );

  return summary;
}

function axStringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function hasAxBooleanProperty(node: RawAxTreeNode, propertyName: string): boolean {
  return node.properties?.some((property) => property.name === propertyName && property.value?.value === true) ?? false;
}

class SimulatedPlaywrightSession implements BrowserSession {
  readonly id: string;
  readonly plan: ScenarioPlan;
  readonly cdpSession: CdpSessionMetadata;
  readonly delayCapMs: number;
  readonly state: MutableBrowserState;

  constructor(plan: ScenarioPlan, delayCapMs: number) {
    this.id = randomUUID();
    this.plan = plan;
    this.cdpSession = createCdpSession();
    this.delayCapMs = delayCapMs;
    this.state = createInitialBrowserState(plan);
  }

  async execute(action: ScenarioAction, step: ScenarioStep): Promise<BrowserActionResult> {
    const targetSummary = describeTarget(action.target);
    recordLastAction(this.state, action, targetSummary);

    switch (action.type) {
      case "goto": {
        const nextUrl = inferGotoUrl(action.target, this.plan.start_url);
        assertScenarioActionAllowed(this.plan, this.state.currentUrl, action, nextUrl);
        this.navigate(nextUrl);
        break;
      }
      case "click": {
        const nextUrl = inferNavigationUrl(this.state.currentUrl, action.target);
        assertScenarioActionAllowed(this.plan, this.state.currentUrl, action, nextUrl);
        if (nextUrl) {
          this.navigate(nextUrl);
        }
        break;
      }
      case "fill": {
        assertScenarioActionAllowed(this.plan, this.state.currentUrl, action);
        const fieldKey = inferFieldKey(action.target, step.step_id);
        this.state.fields[fieldKey] = stringifyValue(action.value);
        break;
      }
      case "select": {
        assertScenarioActionAllowed(this.plan, this.state.currentUrl, action);
        const fieldKey = inferFieldKey(action.target, step.step_id);
        this.state.selectedOptions[fieldKey] = stringifyValue(action.value);
        break;
      }
      case "scroll": {
        const requested = Number(action.value ?? 640);
        this.state.scrollY += Number.isFinite(requested) ? requested : 640;
        break;
      }
      case "hover":
      case "wait_for":
      case "checkpoint": {
        assertScenarioActionAllowed(this.plan, this.state.currentUrl, action);
        break;
      }
      case "stop_when": {
        return {
          actionType: action.type,
          targetSummary,
          stopRequested: shouldStop(step.stop_condition, this.state.finalUrl),
          details: {
            description: step.description
          }
        };
      }
    }

    await sleep(5);
    assertVisitedUrlAllowed(this.plan, this.state.finalUrl);

    return {
      actionType: action.type,
      targetSummary,
      stopRequested: false,
      details: {
        currentUrl: this.state.currentUrl,
        finalUrl: this.state.finalUrl,
        title: this.state.title
      }
    };
  }

  async settle(strategy: SettleStrategy): Promise<BrowserSettleResult> {
    const durationMs = Math.min(strategy.timeout_ms, this.delayCapMs);
    await sleep(durationMs);

    return {
      strategy: strategy.type,
      durationMs,
      status: "settled",
      targetSummary: describeTarget(strategy.target)
    };
  }

  async recoverToSafeUrl(request: BrowserSafetyRecoveryRequest): Promise<BrowserSafetyRecoveryResult> {
    const urlBefore = this.state.currentUrl;
    if (isVisitedUrlSafe(this.plan, urlBefore)) {
      return {
        recovered: true,
        method: "none",
        urlBefore,
        urlAfter: urlBefore
      };
    }

    const previousSafeUrl = [...this.state.visitedUrls]
      .slice(0, -1)
      .reverse()
      .find((visitedUrl) => isVisitedUrlSafe(this.plan, visitedUrl));
    if (previousSafeUrl) {
      this.navigate(previousSafeUrl);
      return {
        recovered: true,
        method: "history_back",
        urlBefore,
        urlAfter: this.state.currentUrl
      };
    }

    const safeUrlCheck = checkVisitedUrlSafety(this.plan, request.safeUrl);
    if (!safeUrlCheck.safe) {
      return {
        recovered: false,
        method: "safe_url",
        urlBefore,
        urlAfter: this.state.currentUrl,
        failureMessage: safeUrlCheck.failureMessage
      };
    }

    this.navigate(request.safeUrl);
    return {
      recovered: true,
      method: "safe_url",
      urlBefore,
      urlAfter: this.state.currentUrl
    };
  }

  snapshot(): BrowserPageSnapshot {
    return createBrowserPageSnapshot(this.plan, this.state, this.cdpSession);
  }

  async captureArtifacts(options: BrowserCaptureOptions = {}): Promise<BrowserCapturedArtifacts> {
    if (!options.captureAxTree) {
      return {};
    }

    const summary = createEmptyAxTreeSummary();
    return {
      axTree: {
        content: JSON.stringify({
          source: "simulated",
          truncated: false,
          nodes: [],
          summary
        }, null, 2),
        mimeType: "application/json",
        fileExtension: "json",
        summary
      }
    };
  }

  async close(): Promise<void> {
    await sleep(1);
  }

  private navigate(url: string): void {
    this.state.currentUrl = url;
    this.state.finalUrl = url;
    this.state.title = createTitleFromUrl(url);
    appendVisitedUrl(this.state.visitedUrls, url);
  }
}

export function createPlaywrightSessionFactory(config: RunnerConfig): BrowserSessionFactory {
  if (config.browserMode === "playwright") {
    return createRealPlaywrightSessionFactory(config);
  }

  return {
    kind: "simulated-playwright",
    createSession: async ({ plan }) => new SimulatedPlaywrightSession(plan, config.simulatedDelayCapMs)
  };
}

class RealPlaywrightSession implements BrowserSession {
  readonly id: string;
  readonly plan: ScenarioPlan;
  readonly browser: Browser;
  readonly context: BrowserContext;
  readonly page: Page;
  readonly cdpSession: CdpSessionMetadata;
  readonly state: MutableBrowserState;
  private closing = false;

  private constructor(plan: ScenarioPlan, browser: Browser, context: BrowserContext, page: Page) {
    this.id = randomUUID();
    this.plan = plan;
    this.browser = browser;
    this.context = context;
    this.page = page;
    this.cdpSession = createCdpSession();
    this.state = createInitialBrowserState(plan);
  }

  static async create(plan: ScenarioPlan, config: RunnerConfig): Promise<RealPlaywrightSession> {
    const browserType = resolveBrowserType(config.browserName);
    const browser = await browserType.launch({
      headless: config.browserHeadless,
      slowMo: config.playwrightSlowMoMs,
      timeout: config.browserLaunchTimeoutMs
    });
    const context = await browser.newContext({
      viewport: plan.environment.viewport,
      locale: plan.environment.locale,
      timezoneId: plan.environment.timezone,
      geolocation: parseGeolocation(plan.environment.geolocation)
    });
    const page = await context.newPage();
    page.setDefaultNavigationTimeout(config.browserNavigationTimeoutMs);

    const session = new RealPlaywrightSession(plan, browser, context, page);
    await session.initializeContext(plan);
    session.attachPageObservers();
    await session.refreshPageState();

    return session;
  }

  async execute(action: ScenarioAction, step: ScenarioStep): Promise<BrowserActionResult> {
    assertBrowserHealthy(this.state);
    const targetSummary = describeTarget(action.target);
    recordLastAction(this.state, action, targetSummary);

    switch (action.type) {
      case "goto": {
        const nextUrl = inferGotoUrl(action.target, this.plan.start_url);
        assertScenarioActionAllowed(this.plan, this.state.currentUrl, action, nextUrl);
        await this.page.goto(nextUrl, {
          waitUntil: "domcontentloaded"
        });
        await this.refreshPageState(nextUrl);
        break;
      }
      case "click": {
        assertScenarioActionAllowed(this.plan, this.state.currentUrl, action);
        const clickDetails = await this.tryClickTarget(action);
        if (!clickDetails.clicked) {
          const nextUrl = inferNavigationUrl(this.state.currentUrl, action.target);
          assertScenarioActionAllowed(this.plan, this.state.currentUrl, action, nextUrl);
          if (!nextUrl) {
            throwUnresolvedTarget("click", targetSummary);
          }

          await this.page.goto(nextUrl, {
            waitUntil: "domcontentloaded"
          });
          await this.refreshPageState(nextUrl);
        }
        break;
      }
      case "fill": {
        assertScenarioActionAllowed(this.plan, this.state.currentUrl, action);
        const filled = await this.tryFillTarget(action.target, action.value, step.step_id);
        if (!filled) {
          throwUnresolvedTarget("fill", targetSummary);
        }
        break;
      }
      case "select": {
        assertScenarioActionAllowed(this.plan, this.state.currentUrl, action);
        const selected = await this.trySelectTarget(action.target, action.value, step.step_id);
        if (!selected) {
          throwUnresolvedTarget("select", targetSummary);
        }
        break;
      }
      case "scroll": {
        assertScenarioActionAllowed(this.plan, this.state.currentUrl, action);
        const requested = Number(action.value ?? 640);
        const scrollDelta = Number.isFinite(requested) ? requested : 640;
        await this.page.evaluate((delta) => {
          const scope = globalThis as typeof globalThis & {
            scrollBy?: (x: number, y: number) => void;
          };
          scope.scrollBy?.(0, delta);
        }, scrollDelta);
        break;
      }
      case "checkpoint": {
        assertScenarioActionAllowed(this.plan, this.state.currentUrl, action);
        break;
      }
      case "hover": {
        assertScenarioActionAllowed(this.plan, this.state.currentUrl, action);
        const hovered = await this.tryHoverTarget(action.target);
        if (!hovered) {
          throwUnresolvedTarget("hover", targetSummary);
        }
        break;
      }
      case "wait_for": {
        assertScenarioActionAllowed(this.plan, this.state.currentUrl, action);
        await this.waitForAction(action);
        break;
      }
      case "stop_when": {
        await this.refreshPageState();

        return {
          actionType: action.type,
          targetSummary,
          stopRequested: shouldStop(step.stop_condition, this.state.finalUrl),
          details: {
            description: step.description
          }
        };
      }
    }

    await this.refreshPageState();
    assertVisitedUrlAllowed(this.plan, this.state.finalUrl);

    return {
      actionType: action.type,
      targetSummary,
      stopRequested: false,
      details: {
        currentUrl: this.state.currentUrl,
        finalUrl: this.state.finalUrl,
        title: this.state.title,
        ...(action.type === "click" ? readLastClickedDetails(this.state) : {}),
        executionMode: "playwright"
      }
    };
  }

  async recoverToSafeUrl(request: BrowserSafetyRecoveryRequest): Promise<BrowserSafetyRecoveryResult> {
    assertBrowserHealthy(this.state);

    const timeoutMs = request.timeoutMs ?? DEFAULT_SAFE_RECOVERY_TIMEOUT_MS;
    const urlBefore = this.state.currentUrl;
    if (isVisitedUrlSafe(this.plan, urlBefore)) {
      return {
        recovered: true,
        method: "none",
        urlBefore,
        urlAfter: urlBefore
      };
    }

    const historyResult = await this.tryRecoverByHistoryBack(urlBefore, timeoutMs);
    if (historyResult.recovered) {
      return historyResult;
    }

    const safeUrlResult = await this.tryRecoverBySafeUrl(request.safeUrl, urlBefore, timeoutMs);
    if (safeUrlResult.recovered) {
      return safeUrlResult;
    }

    return {
      recovered: false,
      method: safeUrlResult.method,
      urlBefore,
      urlAfter: safeUrlResult.urlAfter,
      failureMessage: safeUrlResult.failureMessage ?? historyResult.failureMessage
    };
  }

  async prepareSettle(strategy: SettleStrategy): Promise<PreparedBrowserSettle | null> {
    assertBrowserHealthy(this.state);
    if (strategy.type === "response") {
      return this.createPreparedSettle(strategy, this.createResponseSettleAttempt(strategy));
    }

    if (strategy.type === "url_change") {
      return this.createPreparedSettle(strategy, this.createUrlChangeSettleAttempt(strategy, this.page.url()));
    }

    if (strategy.type === "item_count_change") {
      const preparedItemCount = await this.prepareItemCountChange(strategy);
      return this.createPreparedSettle(strategy, this.createItemCountSettleAttempt(strategy, preparedItemCount));
    }

    return null;
  }

  async settle(strategy: SettleStrategy): Promise<BrowserSettleResult> {
    assertBrowserHealthy(this.state);
    const startedAt = Date.now();
    const targetSummary = describeTarget(strategy.target);

    if (strategy.type === "item_count_change") {
      const { attempt, timeoutDetails } = this.createItemCountSettleAttempt(strategy);
      return this.settleWithAttempt(
        strategy.type,
        startedAt,
        targetSummary,
        attempt,
        timeoutDetails
      );
    }

    await this.refreshPageState();

    if (strategy.type === "none") {
      await this.refreshPageState();
      return this.createSettleResult(strategy.type, startedAt, targetSummary, "settled", {
        mode: "no_wait"
      });
    }

    if (strategy.type === "network_idle") {
      return this.settleWithAttempt(
        strategy.type,
        startedAt,
        targetSummary,
        async () => {
          await this.page.waitForLoadState("networkidle", {
            timeout: strategy.timeout_ms
          });
          return {
            mode: "load_state",
            loadState: "networkidle"
          };
        },
        {
          mode: "load_state",
          loadState: "networkidle"
        }
      );
    }

    if (strategy.type === "locator_visible" || strategy.type === "spinner_hidden") {
      const locatorState = strategy.type === "locator_visible" ? "visible" : "hidden";

      return this.settleWithAttempt(
        strategy.type,
        startedAt,
        targetSummary,
        async () => {
          await this.waitForTargetLocatorState(strategy.target, locatorState, strategy.timeout_ms);
          return {
            mode: "locator_state",
            locatorState
          };
        },
        {
          mode: "locator_state",
          locatorState
        }
      );
    }

    if (strategy.type === "url_change") {
      const { attempt, timeoutDetails } = this.createUrlChangeSettleAttempt(strategy);
      return this.settleWithAttempt(
        strategy.type,
        startedAt,
        targetSummary,
        attempt,
        timeoutDetails
      );
    }

    if (strategy.type === "response") {
      const { attempt, timeoutDetails } = this.createResponseSettleAttempt(strategy);
      return this.settleWithAttempt(
        strategy.type,
        startedAt,
        targetSummary,
        attempt,
        timeoutDetails
      );
    }

    const durationMs = resolveFallbackSettleDuration(strategy.timeout_ms);
    await sleep(durationMs);
    await this.refreshPageState();

    return this.createSettleResult(strategy.type, startedAt, targetSummary, "settled", {
      mode: "fallback_short_wait"
    }, durationMs);
  }

  snapshot(): BrowserPageSnapshot {
    return createBrowserPageSnapshot(this.plan, this.state, this.cdpSession);
  }

  async captureArtifacts(options: BrowserCaptureOptions = {}): Promise<BrowserCapturedArtifacts> {
    assertBrowserHealthy(this.state);
    const originalScroll = await readScrollPosition(this.page);
    try {
      await preparePageForScreenshot(this.page);

      const screenshotBuffer = await capturePageScreenshot(this.page, options.screenshotMode ?? "auto");
      const screenshotDimensions = readPngDimensions(screenshotBuffer) ?? this.plan.environment.viewport;
      const domSnapshot = await this.page.content();
      const axTree = options.captureAxTree ? await this.captureAxTree() : undefined;

      return {
        screenshot: {
          contentBase64: screenshotBuffer.toString("base64"),
          mimeType: "image/png",
          fileExtension: "png",
          width: screenshotDimensions.width,
          height: screenshotDimensions.height
        },
        domSnapshot: {
          content: domSnapshot,
          mimeType: "text/html",
          fileExtension: "html"
        },
        ...(axTree ? { axTree } : {})
      };
    } finally {
      await restoreScrollPosition(this.page, originalScroll);
    }
  }

  async close(): Promise<void> {
    this.closing = true;
    await this.context.close().catch(() => {});
    await this.browser.close().catch(() => {});
  }

  private async initializeContext(plan: ScenarioPlan): Promise<void> {
    if (Array.isArray(plan.environment.permissions) && plan.environment.permissions.length > 0) {
      await this.context.grantPermissions(plan.environment.permissions);
    }
  }

  private async captureAxTree(): Promise<NonNullable<BrowserCapturedArtifacts["axTree"]> | undefined> {
    try {
      const client = await this.context.newCDPSession(this.page);
      try {
        const result = await client.send("Accessibility.getFullAXTree");
        const nodes = Array.isArray((result as { nodes?: unknown }).nodes)
          ? ((result as { nodes: RawAxTreeNode[] }).nodes)
          : [];
        const truncated = nodes.length > 500;
        const summary = summarizeAxTree(nodes, truncated);
        return {
          content: JSON.stringify({
            source: "cdp.Accessibility.getFullAXTree",
            truncated,
            node_count: nodes.length,
            nodes: nodes.slice(0, 500),
            summary
          }, null, 2),
          mimeType: "application/json",
          fileExtension: "json",
          summary
        };
      } finally {
        await client.detach().catch(() => {});
      }
    } catch {
      return undefined;
    }
  }

  private attachPageObservers(): void {
    this.browser.on("disconnected", () => {
      if (!this.closing) {
        markBrowserUnhealthy(this.state, "closed", "browser_disconnected");
      }
    });

    this.context.on("close", () => {
      if (!this.closing) {
        markBrowserUnhealthy(this.state, "closed", "context_closed");
      }
    });

    this.page.on("crash", () => {
      markBrowserUnhealthy(this.state, "crashed", "page_crash");
    });

    this.page.on("close", () => {
      if (!this.closing) {
        markBrowserUnhealthy(this.state, "closed", "page_closed");
      }
    });

    this.page.on("console", (message) => {
      if (message.type() === "error") {
        this.state.consoleErrors.push(message.text());
      }
    });

    this.page.on("pageerror", (error) => {
      this.state.consoleErrors.push(error.message);
    });

    this.page.on("requestfailed", (request) => {
      const failureText = request.failure()?.errorText ?? "request failed";
      this.state.networkErrors.push(`${request.method()} ${request.url()} ${failureText}`);
      appendNetworkEvent(this.state, {
        method: request.method(),
        url: request.url(),
        failed: true,
        errorText: failureText,
        occurredAt: toIsoTimestamp(),
        resourceType: request.resourceType(),
        ...networkTimingDetails(request)
      });
    });

    this.page.on("response", (response) => {
      const request = response.request();
      appendNetworkEvent(this.state, {
        method: request.method(),
        url: response.url(),
        status: response.status(),
        failed: false,
        occurredAt: toIsoTimestamp(),
        resourceType: request.resourceType(),
        ...networkTimingDetails(request)
      });
    });

    this.page.on("framenavigated", (frame) => {
      if (frame === this.page.mainFrame()) {
        void this.refreshPageState(frame.url());
      }
    });
  }

  private async tryClickTarget(action: ScenarioAction): Promise<{ clicked: boolean }> {
    let clickedDetails: Record<string, unknown> = {};
    const clicked = await tryCandidateLocators(this.page, action.target, action.options, async (locator) => {
      const candidateLocator = locator.first();
      const nextClickedDetails = await safeLocatorElementDetails(candidateLocator);
      await candidateLocator.click({
        timeout: DEFAULT_LOCATOR_TIMEOUT_MS
      });
      clickedDetails = nextClickedDetails;
    });

    if (clicked) {
      mergeLastActionDetails(this.state, clickedDetails);
      await this.refreshPageState();
    }

    return { clicked };
  }

  private async tryFillTarget(target: TargetDescriptor | undefined, value: unknown, fallbackKey: string): Promise<boolean> {
    const nextValue = stringifyValue(value);
    const filled = await tryCandidateLocators(this.page, target, undefined, async (locator) => {
      await locator.fill(nextValue, {
        timeout: DEFAULT_LOCATOR_TIMEOUT_MS
      });
    });

    if (filled) {
      this.state.fields[inferFieldKey(target, fallbackKey)] = nextValue;
      await this.refreshPageState();
    }

    return filled;
  }

  private async trySelectTarget(target: TargetDescriptor | undefined, value: unknown, fallbackKey: string): Promise<boolean> {
    const nextValue = stringifyValue(value);
    const selected = await tryCandidateLocators(this.page, target, undefined, async (locator) => {
      try {
        await locator.selectOption(nextValue, {
          timeout: DEFAULT_LOCATOR_TIMEOUT_MS
        });
      } catch {
        await locator.selectOption(
          {
            label: nextValue
          },
          {
            timeout: DEFAULT_LOCATOR_TIMEOUT_MS
          }
        );
      }
    });

    if (selected) {
      this.state.selectedOptions[inferFieldKey(target, fallbackKey)] = nextValue;
      await this.refreshPageState();
    }

    return selected;
  }

  private async tryHoverTarget(target: TargetDescriptor | undefined): Promise<boolean> {
    const hovered = await tryCandidateLocators(this.page, target, undefined, async (locator) => {
      await locator.hover({
        timeout: DEFAULT_LOCATOR_TIMEOUT_MS
      });
    });

    if (hovered) {
      await this.refreshPageState();
    }

    return hovered;
  }

  private async waitForAction(action: ScenarioAction): Promise<void> {
    const timeoutMs = resolveWaitForTimeoutMs(action);
    const locatorState = resolveWaitForLocatorState(action);
    const matched = await tryCandidateLocators(this.page, action.target, undefined, async (locator) => {
      await locator.waitFor({
        state: locatorState,
        timeout: timeoutMs
      });
    });

    if (matched) {
      await this.refreshPageState();
      return;
    }

    const urlIncludes = resolveWaitForUrlIncludes(action);
    if (typeof urlIncludes === "string" && urlIncludes.length > 0) {
      try {
        await this.page.waitForURL((url) => url.toString().includes(urlIncludes), {
          timeout: timeoutMs
        });
        await this.refreshPageState();
        return;
      } catch {
        // fall through to bounded sleep fallback for scaffold compatibility
      }
    }

    await this.refreshPageState();
    throw new Error(`Unable to satisfy wait_for action: ${describeTarget(action.target) ?? "unknown target"}`);
  }

  private async waitForTargetLocatorState(
    target: TargetDescriptor | undefined,
    state: "visible" | "hidden",
    timeoutMs: number
  ): Promise<void> {
    const settled = await tryCandidateLocators(this.page, target, undefined, async (locator) => {
      await locator.waitFor({
        state,
        timeout: timeoutMs
      });
    });

    if (settled) {
      return;
    }

    throw new Error(`Unable to settle target locator in state ${state}`);
  }

  private async waitForUrlChange(
    strategy: SettleStrategy,
    baselineUrl: string = this.page.url()
  ): Promise<Record<string, unknown>> {
    const timeoutMs = strategy.timeout_ms;
    const urlIncludes = resolveSettleUrlIncludes(strategy);

    if (typeof urlIncludes === "string" && urlIncludes.length > 0) {
      await this.page.waitForURL((url) => url.toString().includes(urlIncludes), {
        timeout: timeoutMs
      });
      return {
        mode: "url_change",
        baselineUrl,
        matchedUrl: this.page.url(),
        urlIncludes
      };
    }

    await this.page.waitForURL((url) => url.toString() !== baselineUrl, {
      timeout: timeoutMs
    });

    return {
      mode: "url_change",
      baselineUrl,
      matchedUrl: this.page.url()
    };
  }

  private async waitForResponse(strategy: SettleStrategy): Promise<Record<string, unknown>> {
    const timeoutMs = strategy.timeout_ms;
    const expectedStatus = resolveSettleResponseStatus(strategy);
    const expectedMethod = resolveSettleResponseMethod(strategy);
    const urlIncludes = resolveSettleResponseUrlIncludes(strategy);

    const response = await this.page.waitForResponse(
      (response) => {
        if (typeof urlIncludes === "string" && urlIncludes.length > 0 && !response.url().includes(urlIncludes)) {
          return false;
        }

        if (typeof expectedMethod === "string" && response.request().method().toUpperCase() !== expectedMethod) {
          return false;
        }

        if (typeof expectedStatus === "number" && response.status() !== expectedStatus) {
          return false;
        }

        return true;
      },
      {
        timeout: timeoutMs
      }
    );

    return {
      mode: "response_wait",
      matchedUrl: response.url(),
      method: response.request().method().toUpperCase(),
      status: response.status(),
      urlIncludes,
      timeoutMs: timeoutMs
    };
  }

  private async waitForItemCountChange(
    strategy: SettleStrategy,
    prepared?: PreparedItemCountWait
  ): Promise<Record<string, unknown>> {
    const nextPrepared = prepared ?? (await this.prepareItemCountChange(strategy));
    const { locator, baselineCount, startedAt } = nextPrepared;
    const timeoutMs = strategy.timeout_ms;
    const expectedCount = resolveSettleExpectedCount(strategy);
    const minCount = resolveSettleMinCount(strategy);
    const maxCount = resolveSettleMaxCount(strategy);
    const countDelta = resolveSettleCountDelta(strategy);
    let lastObservedCount = baselineCount;

    while (Date.now() - startedAt <= timeoutMs) {
      const currentCount = await locator.count();
      lastObservedCount = currentCount;

      if (isExpectedItemCountReached(currentCount, baselineCount, { expectedCount, minCount, maxCount, countDelta })) {
        return {
          mode: "item_count_poll",
          baselineCount,
          currentCount,
          expectedCount,
          minCount,
          maxCount,
          countDelta,
          timeoutMs
        };
      }

      await sleep(ITEM_COUNT_POLL_INTERVAL_MS);
    }

    throw new SettleTimeoutError("Timed out waiting for item count change", {
      mode: "item_count_poll",
      baselineCount,
      currentCount: lastObservedCount,
      expectedCount,
      minCount,
      maxCount,
      countDelta,
      timeoutMs
    });
  }

  private async prepareItemCountChange(strategy: SettleStrategy): Promise<PreparedItemCountWait> {
    const locator = resolveTargetLocator(this.page, strategy.target);
    return {
      locator,
      baselineCount: await locator.count(),
      startedAt: Date.now()
    };
  }

  private async refreshPageState(nextUrl?: string): Promise<void> {
    const currentUrl = nextUrl ?? this.page.url() ?? this.state.currentUrl;
    this.state.currentUrl = currentUrl;
    this.state.finalUrl = currentUrl;

    if (this.page.isClosed()) {
      return;
    }

    this.state.title = await safePageTitle(this.page, currentUrl);
    this.state.scrollY = await safeScrollY(this.page, this.state.scrollY);
    this.state.interactiveComponents = await safeInteractiveComponents(this.page, this.state.lastAction, this.state.interactiveComponents);
    this.state.visibleTextBlocks = await safeVisibleTextBlocks(this.page, this.state.visibleTextBlocks);
    this.state.breadcrumb = await safeBreadcrumb(this.page, this.state.breadcrumb);
    this.state.toastTexts = await safeToastTexts(this.page, this.state.toastTexts);
    this.state.loadingState = await safeLoadingState(this.page, this.state.lastAction, this.state.loadingState);
    this.state.stepIndicators = await safeStepIndicators(this.page, this.state.stepIndicators);
    this.state.backLinkCandidates = await safeBackLinkCandidates(this.page, this.state.backLinkCandidates);
    this.state.accordionStates = await safeAccordionStates(this.page, this.state.accordionStates);
    this.state.checkoutContext = await safeCheckoutContext(this.page, this.state.checkoutContext);
    this.state.keyboardFocusState = await safeKeyboardFocusState(this.page, this.state.keyboardFocusState);
    this.state.repeatedGenericLinkGrouping = await safeRepeatedGenericLinkGrouping(this.page, this.state.repeatedGenericLinkGrouping);
    this.state.cartCount = await safeCartCount(this.page, this.state.cartCount);
    this.state.visiblePrices = await safeVisiblePrices(this.page, this.state.visiblePrices);
    this.state.productImages = await safeProductImages(this.page, this.state.productImages);
    this.state.productCards = await safeProductCards(this.page, this.state.productCards);
    this.state.selectedFilters = await safeSelectedFilters(this.page, this.state.selectedFilters);
    this.state.searchQuery = await safeSearchQuery(this.page, this.state.searchQuery);
    this.state.domSignature = await safeDomSignature(this.page, this.state.domSignature);
    this.state.performanceSummary = await safePerformanceSummary(this.page, this.state.performanceSummary);
    appendVisitedUrl(this.state.visitedUrls, currentUrl);
  }

  private async tryRecoverByHistoryBack(
    urlBefore: string,
    timeoutMs: number
  ): Promise<BrowserSafetyRecoveryResult> {
    try {
      const response = await this.page.goBack({
        waitUntil: "domcontentloaded",
        timeout: timeoutMs
      });
      await this.refreshPageState();

      if (response === null) {
        return {
          recovered: false,
          method: "history_back",
          urlBefore,
          urlAfter: this.state.currentUrl,
          failureMessage: "Browser history has no previous entry."
        };
      }

      const safetyCheck = checkVisitedUrlSafety(this.plan, this.state.currentUrl);
      return {
        recovered: safetyCheck.safe,
        method: "history_back",
        urlBefore,
        urlAfter: this.state.currentUrl,
        ...(safetyCheck.safe ? {} : { failureMessage: safetyCheck.failureMessage })
      };
    } catch (error) {
      await this.refreshPageStateIfPossible();
      return {
        recovered: false,
        method: "history_back",
        urlBefore,
        urlAfter: this.state.currentUrl,
        failureMessage: errorMessage(error)
      };
    }
  }

  private async tryRecoverBySafeUrl(
    safeUrl: string,
    urlBefore: string,
    timeoutMs: number
  ): Promise<BrowserSafetyRecoveryResult> {
    const safeUrlCheck = checkVisitedUrlSafety(this.plan, safeUrl);
    if (!safeUrlCheck.safe) {
      return {
        recovered: false,
        method: "safe_url",
        urlBefore,
        urlAfter: this.state.currentUrl,
        failureMessage: safeUrlCheck.failureMessage
      };
    }

    try {
      await this.page.goto(safeUrl, {
        waitUntil: "domcontentloaded",
        timeout: timeoutMs
      });
      await this.refreshPageState();

      const finalUrlCheck = checkVisitedUrlSafety(this.plan, this.state.currentUrl);
      return {
        recovered: finalUrlCheck.safe,
        method: "safe_url",
        urlBefore,
        urlAfter: this.state.currentUrl,
        ...(finalUrlCheck.safe ? {} : { failureMessage: finalUrlCheck.failureMessage })
      };
    } catch (error) {
      await this.refreshPageStateIfPossible();
      return {
        recovered: false,
        method: "safe_url",
        urlBefore,
        urlAfter: this.state.currentUrl,
        failureMessage: errorMessage(error)
      };
    }
  }

  private async refreshPageStateIfPossible(): Promise<void> {
    try {
      await this.refreshPageState();
    } catch {
      // Preserve the original recovery failure as the result reason.
    }
  }

  private createSettleResult(
    strategy: string,
    startedAt: number,
    targetSummary: string | null | undefined,
    status: BrowserSettleResult["status"],
    details: Record<string, unknown>,
    durationMs: number = Date.now() - startedAt
  ): BrowserSettleResult {
    return {
      strategy,
      durationMs,
      status,
      targetSummary,
      details
    };
  }

  private async settleWithAttempt(
    strategy: string,
    startedAt: number,
    targetSummary: string | null | undefined,
    attempt: () => Promise<Record<string, unknown>>,
    timeoutDetails: SettleTimeoutDetails
  ): Promise<BrowserSettleResult> {
    try {
      const details = await attempt();
      await this.refreshPageState();
      return this.createSettleResult(strategy, startedAt, targetSummary, "settled", details);
    } catch (error) {
      await this.refreshPageState();
      return this.createSettleResult(
        strategy,
        startedAt,
        targetSummary,
        "timeout",
        typeof timeoutDetails === "function" ? timeoutDetails(error) : timeoutDetails
      );
    }
  }

  private createPreparedSettle(
    strategy: SettleStrategy,
    { attempt, timeoutDetails }: SettleAttempt
  ): PreparedBrowserSettle {
    const startedAt = Date.now();
    const targetSummary = describeTarget(strategy.target);
    const pendingResult = attempt();
    void pendingResult.catch(() => {});

    return {
      settle: async () => this.settleWithAttempt(strategy.type, startedAt, targetSummary, () => pendingResult, timeoutDetails),
      cancel: async () => {
        void pendingResult.catch(() => {});
      }
    };
  }

  private createUrlChangeSettleAttempt(strategy: SettleStrategy, baselineUrl?: string): SettleAttempt {
    return {
      attempt: () => this.waitForUrlChange(strategy, baselineUrl),
      timeoutDetails: {
        mode: "url_change"
      }
    };
  }

  private createResponseSettleAttempt(strategy: SettleStrategy): SettleAttempt {
    return {
      attempt: () => this.waitForResponse(strategy),
      timeoutDetails: {
        mode: "response_wait",
        urlIncludes: resolveSettleResponseUrlIncludes(strategy),
        method: resolveSettleResponseMethod(strategy),
        status: resolveSettleResponseStatus(strategy),
        timeoutMs: strategy.timeout_ms
      }
    };
  }

  private createItemCountSettleAttempt(strategy: SettleStrategy, prepared?: PreparedItemCountWait): SettleAttempt {
    return {
      attempt: () => this.waitForItemCountChange(strategy, prepared),
      timeoutDetails: (error) =>
        error instanceof SettleTimeoutError
          ? error.details
          : {
              mode: "item_count_poll",
              expectedCount: resolveSettleExpectedCount(strategy),
              minCount: resolveSettleMinCount(strategy),
              maxCount: resolveSettleMaxCount(strategy),
              countDelta: resolveSettleCountDelta(strategy),
              timeoutMs: strategy.timeout_ms
            }
    };
  }
}

interface PreparedItemCountWait {
  locator: Locator;
  baselineCount: number;
  startedAt: number;
}

function createRealPlaywrightSessionFactory(config: RunnerConfig): BrowserSessionFactory {
  return {
    kind: "playwright",
    createSession: async ({ plan }) => RealPlaywrightSession.create(plan, config)
  };
}

function createInitialBrowserState(plan: ScenarioPlan): MutableBrowserState {
  return {
    currentUrl: plan.start_url,
    finalUrl: plan.start_url,
    title: createTitleFromUrl(plan.start_url),
    visitedUrls: [plan.start_url],
    fields: {},
    selectedOptions: {},
    scrollY: 0,
    lastAction: null,
    interactiveComponents: [],
    visibleTextBlocks: [],
    consoleErrors: [],
    networkErrors: [],
    networkEvents: [],
    performanceSummary: null,
    breadcrumb: [],
    toastTexts: [],
    loadingState: emptyLoadingState(),
    stepIndicators: [],
    backLinkCandidates: [],
    accordionStates: [],
    checkoutContext: emptyCheckoutContext(),
    keyboardFocusState: emptyKeyboardFocusState("not_sampled"),
    repeatedGenericLinkGrouping: [],
    cartCount: null,
    visiblePrices: [],
    productImages: [],
    productCards: [],
    selectedFilters: [],
    searchQuery: null,
    domSignature: null,
    browserHealth: {
      status: "ok",
      reason: null,
      observedAt: null
    }
  };
}

function emptyKeyboardFocusState(reason: string | null = null): BrowserKeyboardFocusState {
  return {
    sampled: false,
    tab_stop_count: 0,
    modal_open: false,
    keyboard_trap_candidate: false,
    focus_order: [],
    reason
  };
}

function emptyLoadingState(): BrowserLoadingState {
  return {
    has_spinner: false,
    has_progressbar: false,
    status_text: [],
    clicked_submit_disabled: null,
    aria_busy: false
  };
}

function emptyCheckoutContext(): BrowserCheckoutContext {
  return {
    is_checkout_flow: false,
    flow_subtype: "unknown",
    has_order_summary: false,
    has_editable_summary: false,
    has_final_submit: false,
    order_summary_text: [],
    final_submit_text: null,
    checkout_keywords: [],
    final_submit_relation: null
  };
}

function createBrowserPageSnapshot(
  plan: ScenarioPlan,
  state: MutableBrowserState,
  cdpSession: CdpSessionMetadata
): BrowserPageSnapshot {
  return {
    currentUrl: state.currentUrl,
    finalUrl: state.finalUrl,
    title: state.title,
    viewport: plan.environment.viewport,
    locale: plan.environment.locale,
    timezone: plan.environment.timezone,
    visitedUrls: [...state.visitedUrls],
    fields: { ...state.fields },
    selectedOptions: { ...state.selectedOptions },
    scrollY: state.scrollY,
    lastAction: state.lastAction ? { ...state.lastAction } : null,
    interactiveComponents: state.interactiveComponents.map((component) => ({
      ...component,
      bounds: { ...component.bounds },
      container_bounds: component.container_bounds ? { ...component.container_bounds } : component.container_bounds,
      visibility: component.visibility ? { ...component.visibility } : undefined,
      layout: component.layout ? { ...component.layout } : undefined
    })),
    visibleTextBlocks: state.visibleTextBlocks.map((block) => ({
      ...block,
      nearby_cta_ref: block.nearby_cta_ref ? { ...block.nearby_cta_ref } : block.nearby_cta_ref,
      mobile_line_break_segments: block.mobile_line_break_segments ? [...block.mobile_line_break_segments] : undefined,
      bounds: { ...block.bounds },
      visibility: { ...block.visibility }
    })),
    domSummary: createDomVisibilitySummary(state),
    layoutSummary: createLayoutVisibilitySummary(plan, state),
    consoleErrors: [...state.consoleErrors],
    networkErrors: [...state.networkErrors],
    networkEvents: state.networkEvents.map((event) => ({ ...event })),
    performanceSummary: state.performanceSummary ? { ...state.performanceSummary } : null,
    breadcrumb: [...state.breadcrumb],
    toastTexts: [...state.toastTexts],
    loadingState: {
      ...state.loadingState,
      status_text: [...state.loadingState.status_text]
    },
    stepIndicators: state.stepIndicators.map((indicator) => ({
      ...indicator,
      bounds: { ...indicator.bounds }
    })),
    backLinkCandidates: state.backLinkCandidates.map((candidate) => ({
      ...candidate,
      bounds: { ...candidate.bounds }
    })),
    accordionStates: state.accordionStates.map((accordion) => ({
      ...accordion,
      panel_text_sample: [...accordion.panel_text_sample],
      bounds: { ...accordion.bounds }
    })),
    checkoutContext: {
      ...state.checkoutContext,
      order_summary_text: [...state.checkoutContext.order_summary_text],
      checkout_keywords: [...state.checkoutContext.checkout_keywords],
      final_submit_relation: state.checkoutContext.final_submit_relation
        ? { ...state.checkoutContext.final_submit_relation }
        : state.checkoutContext.final_submit_relation
    },
    keyboardFocusState: {
      ...state.keyboardFocusState,
      focus_order: state.keyboardFocusState.focus_order.map((step) => ({
        ...step,
        bounds: step.bounds ? { ...step.bounds } : null
      }))
    },
    repeatedGenericLinkGrouping: state.repeatedGenericLinkGrouping.map((group) => ({
      ...group,
      nearby_text: [...group.nearby_text],
      selectors: [...group.selectors]
    })),
    cartCount: state.cartCount,
    visiblePrices: [...state.visiblePrices],
    productImages: state.productImages.map((image) => ({
      ...image,
      bounds: { ...image.bounds }
    })),
    productCards: state.productCards.map((card) => ({
      ...card,
      bbox: { ...card.bbox }
    })),
    selectedFilters: state.selectedFilters.map((filter) => ({ ...filter })),
    searchQuery: state.searchQuery,
    domSignature: state.domSignature,
    browserHealth: { ...state.browserHealth },
    cdpSession
  };
}

function markBrowserUnhealthy(
  state: MutableBrowserState,
  status: Exclude<BrowserHealthState["status"], "ok">,
  reason: string
): void {
  if (state.browserHealth.status !== "ok") {
    return;
  }

  state.browserHealth = {
    status,
    reason,
    observedAt: toIsoTimestamp()
  };
  state.consoleErrors.push(`browser ${status}: ${reason}`);
}

function assertBrowserHealthy(state: MutableBrowserState): void {
  if (state.browserHealth.status === "ok") {
    return;
  }

  const error = new Error(`browser ${state.browserHealth.status}: ${state.browserHealth.reason ?? "unknown"}`);
  error.name = "BrowserCrashError";
  throw error;
}

function createDomVisibilitySummary(state: MutableBrowserState): DomVisibilitySummary {
  return {
    visible_text_block_count: state.visibleTextBlocks.length,
    heading_count: state.visibleTextBlocks.filter((block) => block.is_heading).length,
    link_count: state.interactiveComponents.filter((component) => component.tag === "a" || component.role === "link").length,
    button_count: state.interactiveComponents.filter((component) => component.tag === "button" || component.role === "button").length,
    form_control_count: state.interactiveComponents.filter((component) => component.is_form_control === true).length,
    required_field_count: state.interactiveComponents.filter((component) => component.required === true).length,
    disabled_control_count: state.interactiveComponents.filter((component) => component.disabled === true).length,
    cta_candidate_count: state.interactiveComponents.filter((component) => component.is_cta_candidate).length
  };
}

function createLayoutVisibilitySummary(
  plan: ScenarioPlan,
  state: MutableBrowserState
): LayoutVisibilitySummary {
  const zIndexes = state.interactiveComponents
    .map((component) => parseZIndex(component.layout?.z_index))
    .filter((value): value is number => value !== null);

  return {
    viewport_width: plan.environment.viewport.width,
    viewport_height: plan.environment.viewport.height,
    scroll_y: state.scrollY,
    interactive_component_count: state.interactiveComponents.length,
    above_fold_interactive_count: state.interactiveComponents.filter((component) => component.visibility?.above_fold === true).length,
    primary_like_component_count: state.interactiveComponents.filter((component) => component.is_primary_like).length,
    fixed_or_sticky_count: state.interactiveComponents.filter((component) => component.layout?.is_fixed === true || component.layout?.is_sticky === true).length,
    overlay_candidate_count: state.interactiveComponents.filter((component) => component.layout?.overlay_candidate === true).length,
    max_z_index: zIndexes.length > 0 ? Math.max(...zIndexes) : null
  };
}

function parseZIndex(value: string | null | undefined): number | null {
  if (!value || value === "auto") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function recordLastAction(state: MutableBrowserState, action: ScenarioAction, targetSummary: string | null): void {
  state.lastAction = {
    type: action.type,
    target: targetSummary,
    at: toIsoTimestamp()
  };
}

function mergeLastActionDetails(state: MutableBrowserState, details: Record<string, unknown>): void {
  if (!state.lastAction) {
    return;
  }

  state.lastAction = {
    ...state.lastAction,
    clickedText: readNullableString(details.clickedText),
    clickedSelector: readNullableString(details.clickedSelector),
    elementRole: readNullableString(details.elementRole),
    elementText: readNullableString(details.elementText),
    ariaLabel: readNullableString(details.ariaLabel),
    bbox: isBounds(details.bbox) ? details.bbox : null
  };
}

function readLastClickedDetails(state: MutableBrowserState): Record<string, unknown> {
  if (!state.lastAction || state.lastAction.type !== "click") {
    return {};
  }

  return {
    clickedText: state.lastAction.clickedText ?? null,
    clickedSelector: state.lastAction.clickedSelector ?? null,
    elementRole: state.lastAction.elementRole ?? null,
    elementText: state.lastAction.elementText ?? null,
    ariaLabel: state.lastAction.ariaLabel ?? null,
    bbox: state.lastAction.bbox ?? null
  };
}

function readNullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isBounds(value: unknown): value is InteractiveComponentBounds {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Partial<InteractiveComponentBounds>;
  return typeof candidate.x === "number" &&
    typeof candidate.y === "number" &&
    typeof candidate.width === "number" &&
    typeof candidate.height === "number" &&
    typeof candidate.unit === "string";
}

function appendNetworkEvent(state: MutableBrowserState, event: BrowserNetworkEventSignal): void {
  state.networkEvents.push(event);
  if (state.networkEvents.length > 50) {
    state.networkEvents.shift();
  }
}

function networkTimingDetails(request: Request): Pick<
  BrowserNetworkEventSignal,
  "requestStartMs" | "responseEndMs" | "durationMs" | "transferSizeBytes" | "encodedBodySizeBytes"
> {
  try {
    const timing = request.timing();
    const requestStartMs = normalizeTimingValue(timing.startTime);
    const responseEndMs = normalizeTimingValue(timing.responseEnd);
    const durationMs = requestStartMs !== null && responseEndMs !== null && responseEndMs >= requestStartMs
      ? Math.round((responseEndMs - requestStartMs) * 100) / 100
      : null;

    return {
      requestStartMs,
      responseEndMs,
      durationMs,
      transferSizeBytes: null,
      encodedBodySizeBytes: null
    };
  } catch {
    return {
      requestStartMs: null,
      responseEndMs: null,
      durationMs: null,
      transferSizeBytes: null,
      encodedBodySizeBytes: null
    };
  }
}

function normalizeTimingValue(value: number): number | null {
  return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) / 100 : null;
}

function checkVisitedUrlSafety(
  plan: ScenarioPlan,
  url: string
): { safe: true } | { safe: false; failureMessage: string } {
  try {
    assertVisitedUrlAllowed(plan, url);
    return { safe: true };
  } catch (error) {
    return {
      safe: false,
      failureMessage: errorMessage(error)
    };
  }
}

function isVisitedUrlSafe(plan: ScenarioPlan, url: string): boolean {
  return checkVisitedUrlSafety(plan, url).safe;
}

function appendVisitedUrl(visitedUrls: string[], url: string): void {
  if (!isRecordableVisitedUrl(url)) {
    return;
  }

  if (visitedUrls[visitedUrls.length - 1] !== url) {
    visitedUrls.push(url);
  }
}

function isRecordableVisitedUrl(url: string): boolean {
  return url.length > 0 && url !== "about:blank";
}

function throwUnresolvedTarget(actionType: ScenarioAction["type"], targetSummary: string | null): never {
  throw new Error(`Unable to resolve ${actionType} target: ${targetSummary ?? "unknown target"}`);
}

function resolveBrowserType(browserName: RunnerBrowserName): BrowserType {
  switch (browserName) {
    case "firefox":
      return firefox;
    case "webkit":
      return webkit;
    case "chromium":
    default:
      return chromium;
  }
}

function parseGeolocation(value: ScenarioPlan["environment"]["geolocation"]): { latitude: number; longitude: number } | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const latitude = value.latitude;
  const longitude = value.longitude;

  if (typeof latitude !== "number" || typeof longitude !== "number") {
    return undefined;
  }

  return {
    latitude,
    longitude
  };
}

function createTitleFromUrl(urlString: string): string {
  try {
    const url = new URL(urlString);
    return url.hostname.replace(/^www\./, "") || "untitled";
  } catch {
    return "untitled";
  }
}

function buildCandidateLocators(
  page: Page,
  target: TargetDescriptor | undefined,
  options?: Record<string, unknown>
): Locator[] {
  const replayHintLocators = buildReplayHintLocators(page, options);

  if (!target) {
    return replayHintLocators;
  }

  if (typeof target === "string") {
    return [
      ...replayHintLocators,
      page.getByText(target),
    ];
  }

  const candidates: Locator[] = [];

  if (typeof target.selector === "string" && target.selector.length > 0) {
    candidates.push(page.locator(target.selector));
  }

  if (Array.isArray(target.selector_any)) {
    for (const selector of target.selector_any) {
      if (typeof selector === "string" && selector.length > 0) {
        candidates.push(page.locator(selector));
      }
    }
  }

  if (typeof target.role === "string") {
    if (typeof target.text === "string" && target.text.length > 0) {
      candidates.push(page.getByRole(target.role as Parameters<Page["getByRole"]>[0], { name: target.text }));
    }

    if (Array.isArray(target.text_any)) {
      for (const text of target.text_any) {
        if (typeof text === "string" && text.length > 0) {
          candidates.push(page.getByRole(target.role as Parameters<Page["getByRole"]>[0], { name: text }));
        }
      }
    }
  }

  if (typeof target.label === "string" && target.label.length > 0) {
    candidates.push(page.getByLabel(target.label));
  }

  if (Array.isArray(target.label_any)) {
    for (const label of target.label_any) {
      if (typeof label === "string" && label.length > 0) {
        candidates.push(page.getByLabel(label));
      }
    }
  }

  if (typeof target.placeholder === "string" && target.placeholder.length > 0) {
    candidates.push(page.getByPlaceholder(target.placeholder));
  }

  if (Array.isArray(target.placeholder_any)) {
    for (const placeholder of target.placeholder_any) {
      if (typeof placeholder === "string" && placeholder.length > 0) {
        candidates.push(page.getByPlaceholder(placeholder));
      }
    }
  }

  if (typeof target.name === "string" && target.name.length > 0) {
    candidates.push(page.locator(`[name="${escapeCssString(target.name)}"]`));
  }

  if (Array.isArray(target.name_any)) {
    for (const name of target.name_any) {
      if (typeof name === "string" && name.length > 0) {
        candidates.push(page.locator(`[name="${escapeCssString(name)}"]`));
      }
    }
  }

  if (typeof target.href_contains === "string" && target.href_contains.length > 0) {
    candidates.push(page.locator(`[href*="${escapeCssString(target.href_contains)}"]`));
  }

  if (typeof target.text === "string" && target.text.length > 0) {
    candidates.push(page.getByText(target.text));
  }

  if (Array.isArray(target.text_any)) {
    for (const text of target.text_any) {
      if (typeof text === "string" && text.length > 0) {
        candidates.push(page.getByText(text));
      }
    }
  }

  return [
    ...replayHintLocators,
    ...candidates
  ];
}

function buildReplayHintLocators(page: Page, options?: Record<string, unknown>): Locator[] {
  const replayHint = options?.replay_hint;
  if (!replayHint || typeof replayHint !== "object" || Array.isArray(replayHint)) {
    return [];
  }

  const locatorRecipe = (replayHint as Record<string, unknown>).locator_recipe;
  if (!Array.isArray(locatorRecipe)) {
    return [];
  }

  return locatorRecipe.flatMap((entry) => buildReplayRecipeLocator(page, entry));
}

function buildReplayRecipeLocator(page: Page, entry: unknown): Locator[] {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return [];
  }

  const recipe = entry as Partial<ReplayHintLocatorRecipeEntry>;
  const scope = resolveReplayRecipeScope(page, recipe.frame_id);
  if (!scope) {
    return [];
  }

  switch (recipe.strategy) {
    case "selector": {
      return typeof recipe.selector === "string" && recipe.selector.length > 0
        ? [scope.locator(recipe.selector)]
        : [];
    }
    case "role_text": {
      return typeof recipe.role === "string" && recipe.role.length > 0 && typeof recipe.text === "string" && recipe.text.length > 0
        ? [scope.getByRole(recipe.role as Parameters<Page["getByRole"]>[0], { name: recipe.text })]
        : [];
    }
    case "href": {
      return typeof recipe.href === "string" && recipe.href.length > 0
        ? hrefLocators(scope, recipe.href)
        : [];
    }
    case "tag_text": {
      return typeof recipe.tag === "string" && recipe.tag.length > 0 && typeof recipe.text === "string" && recipe.text.length > 0
        ? [scope.locator(recipe.tag).filter({ hasText: recipe.text })]
        : [];
    }
    default:
      return [];
  }
}

function resolveReplayRecipeScope(page: Page, frameId: string | undefined): Page | Frame | null {
  if (!frameId) {
    return page;
  }

  const match = /^frame:(\d+)$/.exec(frameId);
  if (!match) {
    return null;
  }

  const frameIndex = Number(match[1]) - 1;
  if (!Number.isInteger(frameIndex) || frameIndex < 0) {
    return null;
  }

  return page.frames().filter((frame) => frame !== page.mainFrame())[frameIndex] ?? null;
}

function hrefLocators(scope: Page | Frame, href: string): Locator[] {
  const hrefCandidates = new Set([href]);
  try {
    const parsed = new URL(href);
    hrefCandidates.add(parsed.pathname);
    hrefCandidates.add(`${parsed.pathname}${parsed.search}`);
    const fileName = parsed.pathname.split("/").filter(Boolean).at(-1);
    if (fileName) {
      hrefCandidates.add(fileName);
    }
  } catch {
    // The original href may already be relative; use it as-is.
  }

  return [...hrefCandidates]
    .filter((candidate) => candidate.length > 0)
    .map((candidate) => scope.locator(`a[href*="${escapeCssString(candidate)}"]`));
}

function escapeCssString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

async function safeLocatorElementDetails(locator: Locator): Promise<Record<string, unknown>> {
  try {
    return await locator.evaluate((element) => {
      function selectorFor(target: Element): string | null {
        const id = target.getAttribute("id");
        if (id) {
          return `#${id.replace(/[^a-zA-Z0-9_-]/g, "\\$&")}`;
        }
        const className = Array.from(target.classList).find((entry) => entry.length > 0);
        if (className) {
          return `${target.tagName.toLowerCase()}.${className.replace(/[^a-zA-Z0-9_-]/g, "\\$&")}`;
        }
        const href = target.getAttribute("href");
        if (target.tagName.toLowerCase() === "a" && href) {
          return `a[href="${href.replace(/"/g, '\\"')}"]`;
        }
        return target.tagName.toLowerCase();
      }

      function textFor(target: Element): string {
        const inputValue = target instanceof HTMLInputElement ? target.value : "";
        return [
          target.textContent,
          target.getAttribute("aria-label"),
          target.getAttribute("title"),
          inputValue
        ]
          .find((value) => typeof value === "string" && value.trim().length > 0)
          ?.trim()
          .replaceAll(/\s+/g, " ")
          .slice(0, 160) ?? "";
      }

      const rect = element.getBoundingClientRect();
      const tag = element.tagName.toLowerCase();
      const role = element.getAttribute("role") ?? (tag === "button" ? "button" : tag === "a" ? "link" : null);
      const text = textFor(element);
      const ariaLabel = element.getAttribute("aria-label");

      return {
        clickedText: text,
        clickedSelector: selectorFor(element),
        elementRole: role,
        elementText: text,
        ariaLabel,
        bbox: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          unit: "css_px" as const
        }
      };
    }, {
      timeout: DEFAULT_LOCATOR_METADATA_TIMEOUT_MS
    });
  } catch {
    return {};
  }
}

async function tryCandidateLocators(
  page: Page,
  target: TargetDescriptor | undefined,
  options: Record<string, unknown> | undefined,
  run: (locator: Locator) => Promise<void>
): Promise<boolean> {
  for (const locator of buildCandidateLocators(page, target, options)) {
    try {
      await run(locator.first());
      return true;
    } catch {
      continue;
    }
  }

  return false;
}

function shouldStop(stopCondition: Record<string, unknown> | undefined, finalUrl: string): boolean {
  if (!stopCondition) {
    return false;
  }

  const condition = stopCondition.condition;
  if (condition === "before_real_submit" || condition === "before_payment_commit") {
    return true;
  }

  const urlIncludes = stopCondition.url_includes;
  if (typeof urlIncludes === "string") {
    return finalUrl.includes(urlIncludes);
  }

  return false;
}

function stringifyValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return JSON.stringify(value ?? "");
}

function resolveWaitForTimeoutMs(action: ScenarioAction): number {
  const optionTimeout =
    readNumber(action.options, "timeout_ms") ??
    readNumber(action.options, "timeoutMs") ??
    readNumberRecord(action.value, "timeout_ms") ??
    readNumberRecord(action.value, "timeoutMs");

  if (typeof optionTimeout === "number" && Number.isFinite(optionTimeout) && optionTimeout >= 0) {
    return optionTimeout;
  }

  if (typeof action.value === "number" && Number.isFinite(action.value) && action.value >= 0) {
    return action.value;
  }

  return DEFAULT_WAIT_FOR_TIMEOUT_MS;
}

function resolveWaitForLocatorState(action: ScenarioAction): "attached" | "detached" | "visible" | "hidden" {
  const candidateState =
    readString(action.options, "state") ??
    readStringRecord(action.value, "state") ??
    (typeof action.value === "string" ? action.value : undefined);

  if (candidateState === "attached" || candidateState === "detached" || candidateState === "visible" || candidateState === "hidden") {
    return candidateState;
  }

  return "visible";
}

function resolveWaitForUrlIncludes(action: ScenarioAction): string | undefined {
  const optionUrl = readString(action.options, "url_includes") ?? readString(action.options, "urlIncludes");
  if (typeof optionUrl === "string" && optionUrl.length > 0) {
    return optionUrl;
  }

  const valueUrl = readStringRecord(action.value, "url_includes") ?? readStringRecord(action.value, "urlIncludes");
  if (typeof valueUrl === "string" && valueUrl.length > 0) {
    return valueUrl;
  }

  if (action.target && typeof action.target === "object" && typeof action.target.url === "string" && action.target.url.length > 0) {
    return action.target.url;
  }

  return undefined;
}

function resolveSettleUrlIncludes(strategy: SettleStrategy): string | undefined {
  const directUrl = readStringRecord(strategy, "url_includes") ?? readStringRecord(strategy, "urlIncludes");
  if (typeof directUrl === "string" && directUrl.length > 0) {
    return directUrl;
  }

  if (strategy.target && typeof strategy.target === "object" && typeof strategy.target.url === "string" && strategy.target.url.length > 0) {
    return strategy.target.url;
  }

  return undefined;
}

function resolveSettleResponseUrlIncludes(strategy: SettleStrategy): string | undefined {
  const directUrl =
    readStringRecord(strategy, "url_includes") ??
    readStringRecord(strategy, "urlIncludes") ??
    readStringRecord(strategy, "response_url_includes") ??
    readStringRecord(strategy, "responseUrlIncludes");
  if (typeof directUrl === "string" && directUrl.length > 0) {
    return directUrl;
  }

  if (strategy.target && typeof strategy.target === "object" && typeof strategy.target.url === "string" && strategy.target.url.length > 0) {
    return strategy.target.url;
  }

  return undefined;
}

function resolveSettleResponseMethod(strategy: SettleStrategy): string | undefined {
  const method =
    readStringRecord(strategy, "method") ??
    readStringRecord(strategy, "http_method") ??
    readStringRecord(strategy, "httpMethod");

  return typeof method === "string" && method.length > 0 ? method.toUpperCase() : undefined;
}

function resolveSettleResponseStatus(strategy: SettleStrategy): number | undefined {
  return (
    readNumberRecord(strategy, "status") ??
    readNumberRecord(strategy, "status_code") ??
    readNumberRecord(strategy, "statusCode")
  );
}

function resolveSettleExpectedCount(strategy: SettleStrategy): number | undefined {
  return (
    readNumberRecord(strategy, "expected_count") ??
    readNumberRecord(strategy, "expectedCount") ??
    readNumberRecord(strategy, "count")
  );
}

function resolveSettleMinCount(strategy: SettleStrategy): number | undefined {
  return readNumberRecord(strategy, "min_count") ?? readNumberRecord(strategy, "minCount");
}

function resolveSettleMaxCount(strategy: SettleStrategy): number | undefined {
  return readNumberRecord(strategy, "max_count") ?? readNumberRecord(strategy, "maxCount");
}

function resolveSettleCountDelta(strategy: SettleStrategy): number | undefined {
  return readNumberRecord(strategy, "count_delta") ?? readNumberRecord(strategy, "countDelta");
}

function isExpectedItemCountReached(
  currentCount: number,
  baselineCount: number,
  conditions: {
    expectedCount?: number;
    minCount?: number;
    maxCount?: number;
    countDelta?: number;
  }
): boolean {
  if (typeof conditions.expectedCount === "number") {
    return currentCount === conditions.expectedCount;
  }

  if (typeof conditions.minCount === "number" && currentCount < conditions.minCount) {
    return false;
  }

  if (typeof conditions.maxCount === "number" && currentCount > conditions.maxCount) {
    return false;
  }

  if (typeof conditions.minCount === "number" || typeof conditions.maxCount === "number") {
    return true;
  }

  if (typeof conditions.countDelta === "number") {
    return currentCount === baselineCount + conditions.countDelta;
  }

  return currentCount !== baselineCount;
}

function resolveTargetLocator(page: Page, target: TargetDescriptor | undefined): Locator {
  const candidateLocators = buildCandidateLocators(page, target);
  if (candidateLocators.length === 0) {
    throw new Error("Unable to resolve target locator");
  }

  return candidateLocators[0];
}

function resolveFallbackSettleDuration(timeoutMs: number): number {
  return Math.min(timeoutMs, 25);
}

function readNumber(source: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = source?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readString(source: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = source?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readNumberRecord(source: unknown, key: string): number | undefined {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return undefined;
  }

  const value = (source as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readStringRecord(source: unknown, key: string): string | undefined {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return undefined;
  }

  const value = (source as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

async function safePageTitle(page: Page, fallbackUrl: string): Promise<string> {
  try {
    const title = await page.title();
    return title.length > 0 ? title : createTitleFromUrl(fallbackUrl);
  } catch {
    return createTitleFromUrl(fallbackUrl);
  }
}

async function safeScrollY(page: Page, fallbackValue: number): Promise<number> {
  try {
    const scrollY = await page.evaluate(() => {
      const scope = globalThis as typeof globalThis & { scrollY?: number };
      return scope.scrollY ?? 0;
    });
    return typeof scrollY === "number" && Number.isFinite(scrollY) ? scrollY : fallbackValue;
  } catch {
    return fallbackValue;
  }
}

async function readScrollPosition(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => ({
    x: globalThis.scrollX,
    y: globalThis.scrollY
  })).catch(() => ({ x: 0, y: 0 }));
}

async function restoreScrollPosition(page: Page, scroll: { x: number; y: number }): Promise<void> {
  await page.evaluate((position) => {
    globalThis.scrollTo(position.x, position.y);
  }, scroll).catch(() => undefined);
}

async function safeBreadcrumb(page: Page, fallbackValue: string[]): Promise<string[]> {
  try {
    return await page.evaluate(() => {
      function normalizeText(value: string | null | undefined): string {
        return (value ?? "").trim().replaceAll(/\s+/g, " ");
      }

      function visibleText(element: Element): string {
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) {
          return "";
        }
        return normalizeText(element.textContent);
      }

      function splitBreadcrumbText(value: string): string[] {
        return normalizeText(value)
          .split(/\s*(?:>|›|\/|→|»|⟩)\s*/)
          .map((entry) => normalizeText(entry))
          .filter((entry) => entry.length > 0)
          .slice(0, 10);
      }

      const structuredItems = Array.from(document.querySelectorAll("[itemtype*='BreadcrumbList' i] [itemprop='itemListElement'], [typeof*='BreadcrumbList' i] [property='itemListElement']"))
        .map((element) => visibleText(element))
        .filter((text) => text.length > 0)
        .slice(0, 10);
      if (structuredItems.length > 0) {
        return structuredItems;
      }

      const selectors = [
        "[aria-label*='breadcrumb' i]",
        "[aria-label*='경로' i]",
        "[aria-label*='탐색' i]",
        "nav.breadcrumb",
        ".breadcrumb",
        "[class*='breadcrumb' i]",
        "[data-testid*='breadcrumb' i]",
        "[data-test*='breadcrumb' i]",
        "ol.breadcrumb",
        "ul.breadcrumb"
      ];
      const element = selectors
        .flatMap((selector) => Array.from(document.querySelectorAll(selector)))
        .find((candidate) => visibleText(candidate).length > 0);

      if (element) {
        const listItems = Array.from(element.querySelectorAll("li, [role='listitem'], a, span"))
          .map((candidate) => visibleText(candidate))
          .filter((text) => text.length > 0 && !/^(>|›|\/|→|»|⟩)$/.test(text));
        const uniqueItems = Array.from(new Set(listItems));
        if (uniqueItems.length > 1) {
          return uniqueItems.slice(0, 10);
        }
        return splitBreadcrumbText(visibleText(element));
      }

      const currentPage = document.querySelector("[aria-current='page'], [aria-current='step']");
      if (currentPage) {
        const container = currentPage.closest("nav, ol, ul, [class*='breadcrumb' i], [data-testid*='breadcrumb' i]");
        if (container) {
          return splitBreadcrumbText(visibleText(container));
        }
      }

      return [];
    });
  } catch {
    return fallbackValue;
  }
}

async function safeToastTexts(page: Page, fallbackValue: string[]): Promise<string[]> {
  try {
    return await page.evaluate(() => {
      function normalizeText(value: string | null | undefined): string {
        return (value ?? "").trim().replaceAll(/\s+/g, " ");
      }

      function isVisible(element: Element): boolean {
        const rect = element.getBoundingClientRect();
        const style = globalThis.getComputedStyle(element);
        return rect.width > 0 &&
          rect.height > 0 &&
          style.visibility !== "hidden" &&
          style.display !== "none" &&
          Number(style.opacity || "1") > 0;
      }

      const selectors = [
        "[role='alert']",
        "[role='status']",
        "[aria-live]",
        ".toast",
        "[class*='toast' i]",
        "[class*='snackbar' i]",
        "[class*='notification' i]",
        "[class*='notice' i]",
        "[class*='flash' i]",
        "[class*='message' i]",
        "[data-testid*='toast' i]",
        "[data-testid*='snackbar' i]",
        "[data-testid*='notification' i]",
        "[data-test*='toast' i]",
        "[data-test*='alert' i]"
      ];
      return Array.from(new Set(selectors
        .flatMap((selector) => Array.from(document.querySelectorAll(selector)))
        .filter((element) => isVisible(element))
        .map((element) => normalizeText(element.textContent))
        .filter((text) => text.length > 0 && text.length <= 240)))
        .slice(0, 10);
    });
  } catch {
    return fallbackValue;
  }
}

async function safeLoadingState(
  page: Page,
  lastAction: BrowserPageSnapshot["lastAction"],
  fallbackValue: BrowserLoadingState
): Promise<BrowserLoadingState> {
  try {
    return await page.evaluate(({ clickedSelector, clickedText }) => {
      function normalizeText(value: string | null | undefined): string {
        return (value ?? "").replace(/\s+/g, " ").trim();
      }

      function isVisible(element: Element): boolean {
        const rect = element.getBoundingClientRect();
        const style = globalThis.getComputedStyle(element);
        return rect.width > 0 &&
          rect.height > 0 &&
          style.visibility !== "hidden" &&
          style.display !== "none" &&
          Number(style.opacity || "1") > 0;
      }

      function isDisabled(element: Element | null): boolean | null {
        if (!element) {
          return null;
        }
        return element.hasAttribute("disabled") ||
          element.getAttribute("aria-disabled") === "true" ||
          Boolean((element as HTMLButtonElement | HTMLInputElement).disabled);
      }

      function queryClickedElement(): Element | null {
        if (clickedSelector) {
          try {
            const selected = document.querySelector(clickedSelector);
            if (selected) {
              return selected;
            }
          } catch {
            // Fall back to text matching below.
          }
        }

        const normalizedClickedText = normalizeText(clickedText).toLowerCase();
        if (!normalizedClickedText) {
          return null;
        }

        return Array.from(document.querySelectorAll("button, input[type='submit'], input[type='button'], [role='button']"))
          .find((element) => normalizeText(element.textContent || element.getAttribute("value") || element.getAttribute("aria-label")).toLowerCase() === normalizedClickedText) ?? null;
      }

      const spinnerSelectors = [
        "[class*='spinner' i]",
        "[class*='loading' i]",
        "[class*='loader' i]",
        "[data-testid*='spinner' i]",
        "[data-testid*='loading' i]",
        "[data-test*='spinner' i]",
        "[data-test*='loading' i]",
        "[aria-label*='loading' i]",
        "[aria-label*='로딩' i]"
      ];
      const progressSelectors = [
        "progress",
        "[role='progressbar']",
        "[aria-valuenow][aria-valuemin][aria-valuemax]"
      ];
      const statusSelectors = [
        "[role='status']",
        "[role='alert']",
        "[aria-live]",
        "[class*='status' i]",
        "[class*='loading' i]",
        "[class*='progress' i]"
      ];

      const hasSpinner = spinnerSelectors.some((selector) =>
        Array.from(document.querySelectorAll(selector)).some(isVisible)
      );
      const hasProgressbar = progressSelectors.some((selector) =>
        Array.from(document.querySelectorAll(selector)).some(isVisible)
      );
      const statusTextPattern = /loading|please wait|processing|submitting|saving|로딩|처리 중|처리중|저장 중|저장중|제출 중|제출중|결제 중|결제중|예약 중|예약중/i;
      const statusText = Array.from(new Set(statusSelectors
        .flatMap((selector) => Array.from(document.querySelectorAll(selector)))
        .filter(isVisible)
        .map((element) => normalizeText(element.textContent || element.getAttribute("aria-label")))
        .filter((text) => text.length > 0 && statusTextPattern.test(text))
        .map((text) => text.slice(0, 160))))
        .slice(0, 10);

      return {
        has_spinner: hasSpinner,
        has_progressbar: hasProgressbar,
        status_text: statusText,
        clicked_submit_disabled: isDisabled(queryClickedElement()),
        aria_busy: Array.from(document.querySelectorAll("[aria-busy='true']")).some(isVisible)
      };
    }, {
      clickedSelector: lastAction?.type === "click" ? lastAction.clickedSelector ?? null : null,
      clickedText: lastAction?.type === "click" ? lastAction.clickedText ?? null : null
    });
  } catch {
    return fallbackValue;
  }
}

async function safeStepIndicators(page: Page, fallbackValue: BrowserStepIndicatorSignal[]): Promise<BrowserStepIndicatorSignal[]> {
  try {
    return await page.evaluate(() => {
      function normalizeText(value: string | null | undefined): string {
        return (value ?? "").replace(/\s+/g, " ").trim();
      }

      function isVisible(element: Element): boolean {
        const rect = element.getBoundingClientRect();
        const style = globalThis.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      }

      function escapeSelector(value: string): string {
        return ((globalThis as typeof globalThis & { CSS?: { escape?: (value: string) => string } }).CSS?.escape?.(value)) ??
          value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
      }

      function selectorFor(element: Element): string | null {
        const id = element.getAttribute("id");
        if (id) {
          return `#${escapeSelector(id)}`;
        }
        const testId = element.getAttribute("data-testid") ?? element.getAttribute("data-test");
        if (testId) {
          return `[data-testid="${testId.replace(/"/g, '\\"')}"]`;
        }
        const className = Array.from(element.classList).find((entry) => entry.length > 0);
        return className ? `${element.tagName.toLowerCase()}.${escapeSelector(className)}` : element.tagName.toLowerCase();
      }

      function boundsFor(element: Element): InteractiveComponentBounds {
        const rect = element.getBoundingClientRect();
        return {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          unit: "css_px" as const
        };
      }

      function parseStepNumbers(text: string, element: Element): { current_step: number | null; total_steps: number | null } {
        const normalized = text.toLowerCase();
        const explicit = normalized.match(/(?:step\s*)?(\d+)\s*(?:\/|of|중)\s*(\d+)/) ??
          normalized.match(/(\d+)\s*단계\s*(?:\/|중|of)?\s*(\d+)?/);
        const currentFromText = explicit?.[1] ? Number.parseInt(explicit[1], 10) : null;
        const totalFromText = explicit?.[2] ? Number.parseInt(explicit[2], 10) : null;
        const children = Array.from(element.querySelectorAll("li, [role='listitem'], [aria-current], .active, [class*='current' i], [data-current='true']"))
          .filter((candidate) => normalizeText(candidate.textContent).length > 0);
        const currentIndex = children.findIndex((candidate) =>
          candidate.getAttribute("aria-current") === "step" ||
          candidate.getAttribute("aria-current") === "true" ||
          candidate.getAttribute("data-current") === "true" ||
          candidate.classList.contains("active") ||
          Array.from(candidate.classList).some((className) => /current|active|selected/i.test(className))
        );
        return {
          current_step: currentFromText ?? (currentIndex >= 0 ? currentIndex + 1 : null),
          total_steps: totalFromText ?? (children.length > 1 ? children.length : null)
        };
      }

      const selectors = [
        "[aria-label*='step' i]",
        "[aria-label*='progress' i]",
        "[aria-label*='단계' i]",
        "[aria-label*='진행' i]",
        "[class*='step' i]",
        "[class*='progress' i]",
        "[data-testid*='step' i]",
        "[data-testid*='progress' i]",
        "ol",
        "nav"
      ];
      const stepTextPattern = /step\s*\d+|\d+\s*\/\s*\d+|\d+\s*of\s*\d+|\d+\s*단계|정보\s*입력.*(?:결제|주문|예약).*완료|cart.*checkout.*payment/i;
      const seen = new Set<string>();

      return selectors
        .flatMap((selector) => Array.from(document.querySelectorAll(selector)))
        .map((element) => {
          const text = normalizeText(element.textContent || element.getAttribute("aria-label"));
          const numbers = parseStepNumbers(text, element);
          return {
            text: text.slice(0, 240),
            selector: selectorFor(element),
            current_step: numbers.current_step,
            total_steps: numbers.total_steps,
            bounds: boundsFor(element),
            visible: isVisible(element),
            likely: stepTextPattern.test(text) || (numbers.total_steps ?? 0) > 1
          };
        })
        .filter((indicator) => indicator.visible && indicator.likely && indicator.text.length > 0)
        .filter((indicator) => {
          const key = `${indicator.selector ?? ""}:${indicator.text}`;
          if (seen.has(key)) {
            return false;
          }
          seen.add(key);
          return true;
        })
        .slice(0, 8)
        .map(({ visible, likely, ...indicator }) => indicator);
    });
  } catch {
    return fallbackValue;
  }
}

async function safeBackLinkCandidates(page: Page, fallbackValue: BrowserBackLinkCandidateSignal[]): Promise<BrowserBackLinkCandidateSignal[]> {
  try {
    return await page.evaluate(() => {
      function normalizeText(value: string | null | undefined): string {
        return (value ?? "").replace(/\s+/g, " ").trim();
      }

      function isVisible(element: Element): boolean {
        const rect = element.getBoundingClientRect();
        const style = globalThis.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      }

      function escapeSelector(value: string): string {
        return ((globalThis as typeof globalThis & { CSS?: { escape?: (value: string) => string } }).CSS?.escape?.(value)) ??
          value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
      }

      function selectorFor(element: Element): string | null {
        const id = element.getAttribute("id");
        if (id) {
          return `#${escapeSelector(id)}`;
        }
        const href = element.getAttribute("href");
        if (href && element.tagName.toLowerCase() === "a") {
          return `a[href="${href.replace(/"/g, '\\"')}"]`;
        }
        const className = Array.from(element.classList).find((entry) => entry.length > 0);
        return className ? `${element.tagName.toLowerCase()}.${escapeSelector(className)}` : element.tagName.toLowerCase();
      }

      function hrefFor(element: Element): string | null {
        const href = element.getAttribute("href");
        if (!href) {
          return null;
        }
        try {
          return new URL(href, document.baseURI).toString();
        } catch {
          return href;
        }
      }

      function boundsFor(element: Element): InteractiveComponentBounds {
        const rect = element.getBoundingClientRect();
        return {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          unit: "css_px" as const
        };
      }

      function reasonFor(text: string, href: string | null, element: Element): BrowserBackLinkCandidateSignal["reason"] | null {
        if (/수정|변경|edit|change/i.test(text)) {
          return "edit_summary";
        }
        if (/이전|뒤로|돌아|back|previous|return/i.test(text)) {
          return element.getAttribute("onclick")?.toLowerCase().includes("history") ? "history_control" : "text_back";
        }
        if (href && /back|prev|previous|return|cart|checkout|edit|change/i.test(href)) {
          return "href_back";
        }
        return null;
      }

      const seen = new Set<string>();
      return Array.from(document.querySelectorAll("a[href], button, [role='button'], [role='link']"))
        .map((element) => {
          const text = normalizeText(element.textContent || element.getAttribute("aria-label") || element.getAttribute("title"));
          const href = hrefFor(element);
          const reason = reasonFor(text, href, element);
          return {
            text: text.slice(0, 120),
            selector: selectorFor(element),
            href,
            role: element.getAttribute("role") ?? (element.tagName.toLowerCase() === "a" ? "link" : element.tagName.toLowerCase() === "button" ? "button" : null),
            reason,
            bounds: boundsFor(element),
            visible: isVisible(element)
          };
        })
        .filter((candidate): candidate is Omit<typeof candidate, "reason" | "visible"> & { reason: BrowserBackLinkCandidateSignal["reason"]; visible: boolean } =>
          candidate.visible && candidate.reason !== null && candidate.text.length > 0
        )
        .filter((candidate) => {
          const key = `${candidate.selector ?? ""}:${candidate.text}:${candidate.href ?? ""}`;
          if (seen.has(key)) {
            return false;
          }
          seen.add(key);
          return true;
        })
        .slice(0, 12)
        .map(({ visible, ...candidate }) => candidate);
    });
  } catch {
    return fallbackValue;
  }
}

async function safeAccordionStates(page: Page, fallbackValue: BrowserAccordionState[]): Promise<BrowserAccordionState[]> {
  try {
    return await page.evaluate(() => {
      function normalizeText(value: string | null | undefined): string {
        return (value ?? "").replace(/\s+/g, " ").trim();
      }

      function escapeSelector(value: string): string {
        return ((globalThis as typeof globalThis & { CSS?: { escape?: (value: string) => string } }).CSS?.escape?.(value)) ??
          value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
      }

      function selectorFor(element: Element | null): string | null {
        if (!element) {
          return null;
        }
        const id = element.getAttribute("id");
        if (id) {
          return `#${escapeSelector(id)}`;
        }
        const className = Array.from(element.classList).find((entry) => entry.length > 0);
        return className ? `${element.tagName.toLowerCase()}.${escapeSelector(className)}` : element.tagName.toLowerCase();
      }

      function boundsFor(element: Element): InteractiveComponentBounds {
        const rect = element.getBoundingClientRect();
        return {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          unit: "css_px" as const
        };
      }

      function panelFor(trigger: Element): Element | null {
        const controls = trigger.getAttribute("aria-controls");
        if (controls) {
          const controlled = document.getElementById(controls);
          if (controlled) {
            return controlled;
          }
        }
        if (trigger.tagName.toLowerCase() === "summary") {
          return trigger.closest("details");
        }
        return trigger.nextElementSibling ?? trigger.closest("[class*='accordion' i], [data-testid*='accordion' i]") ?? null;
      }

      function panelRelationshipFor(trigger: Element, panel: Element | null): BrowserAccordionState["panel_relationship"] {
        if (!panel) {
          return "unknown";
        }
        const controls = trigger.getAttribute("aria-controls");
        if (controls && document.getElementById(controls) === panel) {
          return "aria_controls";
        }
        if (trigger.tagName.toLowerCase() === "summary" && trigger.closest("details") === panel) {
          return "details_summary";
        }
        if (trigger.nextElementSibling === panel) {
          return "next_sibling";
        }
        if (trigger.closest("[class*='accordion' i], [data-testid*='accordion' i]") === panel) {
          return "container";
        }
        return "unknown";
      }

      function isExpanded(trigger: Element, panel: Element | null): boolean {
        if (trigger.tagName.toLowerCase() === "summary") {
          return trigger.closest("details")?.hasAttribute("open") === true;
        }
        const ariaExpanded = trigger.getAttribute("aria-expanded");
        if (ariaExpanded === "true") {
          return true;
        }
        if (ariaExpanded === "false") {
          return false;
        }
        if (panel instanceof HTMLDetailsElement) {
          return panel.open;
        }
        return panel ? !panel.hasAttribute("hidden") && globalThis.getComputedStyle(panel).display !== "none" : false;
      }

      function hiddenPanelHasCta(panel: Element | null, expanded: boolean): boolean {
        if (!panel || expanded) {
          return false;
        }
        return Array.from(panel.querySelectorAll("a[href], button, input:not([type='hidden']), [role='button'], [role='link']"))
          .some((element) => normalizeText(element.textContent || element.getAttribute("aria-label") || element.getAttribute("value")).length > 0);
      }

      function hiddenPanelHasRequiredInfo(panel: Element | null, expanded: boolean): boolean {
        if (!panel || expanded) {
          return false;
        }
        const text = normalizeText(panel.textContent);
        const hasRequiredControl = Array.from(panel.querySelectorAll("input[required], select[required], textarea[required], [aria-required='true']")).length > 0;
        const hasRequiredText = /필수|required|must|mandatory|약관|동의|주의|제한|조건|마감|취소|환불|total|합계|총액|결제 금액/i.test(text);
        return hasRequiredControl || hasRequiredText;
      }

      const triggers = [
        ...Array.from(document.querySelectorAll("details > summary")),
        ...Array.from(document.querySelectorAll("[aria-expanded][aria-controls], [data-state='open'], [data-state='closed'], [class*='accordion' i] button, [data-testid*='accordion' i] button"))
      ];
      const seen = new Set<Element>();

      return triggers
        .filter((trigger) => {
          if (seen.has(trigger)) {
            return false;
          }
          seen.add(trigger);
          return true;
        })
        .map((trigger) => {
          const panel = panelFor(trigger);
          const expanded = isExpanded(trigger, panel);
          const panelText = normalizeText(panel?.textContent);
          return {
            trigger_text: normalizeText(trigger.textContent || trigger.getAttribute("aria-label")).slice(0, 160),
            trigger_selector: selectorFor(trigger),
            panel_selector: selectorFor(panel),
            panel_relationship: panelRelationshipFor(trigger, panel),
            expanded,
            panel_text_sample: panelText ? [panelText.slice(0, 240)] : [],
            hidden_panel_has_cta: hiddenPanelHasCta(panel, expanded),
            hidden_panel_has_required_info: hiddenPanelHasRequiredInfo(panel, expanded),
            bounds: boundsFor(trigger)
          };
        })
        .filter((accordion) => accordion.trigger_text.length > 0)
        .slice(0, 12);
    });
  } catch {
    return fallbackValue;
  }
}

async function safeCheckoutContext(page: Page, fallbackValue: BrowserCheckoutContext): Promise<BrowserCheckoutContext> {
  try {
    return await page.evaluate(() => {
      function normalizeText(value: string | null | undefined): string {
        return (value ?? "").replace(/\s+/g, " ").trim();
      }

      function isVisible(element: Element): boolean {
        const rect = element.getBoundingClientRect();
        const style = globalThis.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      }

      function escapeSelector(value: string): string {
        return ((globalThis as typeof globalThis & { CSS?: { escape?: (value: string) => string } }).CSS?.escape?.(value)) ??
          value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
      }

      function selectorFor(element: Element | null): string | null {
        if (!element) {
          return null;
        }
        const id = element.getAttribute("id");
        if (id) {
          return `#${escapeSelector(id)}`;
        }
        const testId = element.getAttribute("data-testid") ?? element.getAttribute("data-test");
        if (testId) {
          return `[data-testid="${testId.replace(/"/g, '\\"')}"]`;
        }
        const className = Array.from(element.classList).find((entry) => entry.length > 0);
        return className ? `${element.tagName.toLowerCase()}.${escapeSelector(className)}` : element.tagName.toLowerCase();
      }

      function flowSubtypeFor(pageText: string, urlText: string): BrowserCheckoutContext["flow_subtype"] {
        const searchable = `${pageText} ${urlText}`;
        if (/결제|payment|pay now|submit payment/i.test(searchable)) {
          return "payment";
        }
        if (/예약|booking|reservation|confirm booking/i.test(searchable)) {
          return "booking";
        }
        if (/주문|order|place order|complete order/i.test(searchable)) {
          return "order";
        }
        if (/신청|application|apply|submit application/i.test(searchable)) {
          return "application";
        }
        if (/checkout/i.test(searchable)) {
          return "checkout";
        }
        return "unknown";
      }

      const pageText = normalizeText(document.body?.innerText).slice(0, 8_000);
      const urlText = `${location.pathname} ${location.hash} ${document.title}`.toLowerCase();
      const keywordPatterns: Array<[string, RegExp]> = [
        ["checkout", /checkout|결제|주문|예약|신청|payment|booking|order/i],
        ["summary", /summary|order summary|요약|주문 내역|결제 정보|예약 정보/i],
        ["total", /total|합계|총액|결제 금액|최종 금액/i]
      ];
      const checkoutKeywords = keywordPatterns
        .filter(([, pattern]) => pattern.test(pageText) || pattern.test(urlText))
        .map(([keyword]) => keyword);
      const summarySelectors = [
        "[class*='summary' i]",
        "[class*='order' i]",
        "[data-testid*='summary' i]",
        "[data-testid*='order' i]",
        "aside",
        "table"
      ];
      const pricePattern = /(?:[$€£₩]\s?\d[\d,.]*|\d[\d,.]*\s?(?:원|달러|USD|KRW|만원|천원))/i;
      const summaryElements = summarySelectors
        .flatMap((selector) => Array.from(document.querySelectorAll(selector)))
        .filter(isVisible)
        .map((element) => ({
          element,
          text: normalizeText(element.textContent).slice(0, 240)
        }))
        .filter((summary) => summary.text.length > 0 && (/summary|요약|주문|예약|결제|total|합계|총액/i.test(summary.text) || pricePattern.test(summary.text)));
      const finalSubmitCandidates = Array.from(document.querySelectorAll("button, input[type='submit'], input[type='button'], [role='button']"))
        .filter(isVisible)
        .map((element) => ({
          element,
          text: normalizeText(element.textContent || element.getAttribute("value") || element.getAttribute("aria-label")).slice(0, 120)
        }))
        .filter((candidate) => /결제하기|결제|예약 확정|주문 완료|주문하기|신청 완료|pay now|place order|complete order|confirm booking|submit payment/i.test(candidate.text));
      const editableSummary = Array.from(document.querySelectorAll("a[href], button, [role='button'], [role='link']"))
        .filter(isVisible)
        .some((element) => /수정|변경|edit|change/i.test(normalizeText(element.textContent || element.getAttribute("aria-label") || element.getAttribute("title"))));
      const summaryElement = summaryElements[0]?.element ?? null;
      const finalSubmitElement = finalSubmitCandidates[0]?.element ?? null;
      const summarySelector = selectorFor(summaryElement);
      const submitSelector = selectorFor(finalSubmitElement);
      const sameForm = Boolean(summaryElement && finalSubmitElement && summaryElement.closest("form") && summaryElement.closest("form") === finalSubmitElement.closest("form"));
      const sameContainer = Boolean(summaryElement && finalSubmitElement && summaryElement.closest("main, section, article, aside, form, [class*='checkout' i], [class*='order' i], [data-testid*='checkout' i]") === finalSubmitElement.closest("main, section, article, aside, form, [class*='checkout' i], [class*='order' i], [data-testid*='checkout' i]"));
      const summaryBeforeSubmit = Boolean(summaryElement && finalSubmitElement && (summaryElement.compareDocumentPosition(finalSubmitElement) & Node.DOCUMENT_POSITION_FOLLOWING));
      const finalSubmitRelation = finalSubmitElement
        ? {
            related: Boolean(summaryElement && (sameForm || sameContainer || summaryBeforeSubmit)),
            relation_type: sameForm ? "same_form" as const : sameContainer ? "same_container" as const : summaryBeforeSubmit ? "summary_before_submit" as const : summaryElement ? "unknown" as const : "submit_without_summary" as const,
            summary_selector: summarySelector,
            submit_selector: submitSelector
          }
        : null;

      return {
        is_checkout_flow: checkoutKeywords.includes("checkout") || finalSubmitCandidates.length > 0,
        flow_subtype: flowSubtypeFor(pageText, urlText),
        has_order_summary: summaryElements.length > 0,
        has_editable_summary: editableSummary,
        has_final_submit: finalSubmitCandidates.length > 0,
        order_summary_text: Array.from(new Set(summaryElements.map((summary) => summary.text))).slice(0, 8),
        final_submit_text: finalSubmitCandidates[0]?.text ?? null,
        checkout_keywords: checkoutKeywords,
        final_submit_relation: finalSubmitRelation
      };
    });
  } catch {
    return fallbackValue;
  }
}

async function safeKeyboardFocusState(page: Page, fallbackValue: BrowserKeyboardFocusState): Promise<BrowserKeyboardFocusState> {
  try {
    const focusOrder: BrowserKeyboardFocusState["focus_order"] = [];
    const seenSelectors = new Set<string>();
    let repeatedSelector: string | null = null;

    for (let index = 0; index < 12; index += 1) {
      await page.keyboard.press("Tab");
      const step = await page.evaluate((order) => {
        function normalizeText(value: string | null | undefined): string {
          return (value ?? "").replace(/\s+/g, " ").trim();
        }

        function escapeSelector(value: string): string {
          return ((globalThis as typeof globalThis & { CSS?: { escape?: (value: string) => string } }).CSS?.escape?.(value)) ??
            value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
        }

        function selectorFor(element: Element | null): string | null {
          if (!element || element === document.body || element === document.documentElement) {
            return null;
          }
          const id = element.getAttribute("id");
          if (id) {
            return `#${escapeSelector(id)}`;
          }
          const name = element.getAttribute("name");
          if (name) {
            return `${element.tagName.toLowerCase()}[name="${name.replace(/"/g, '\\"')}"]`;
          }
          const className = Array.from(element.classList).find((entry) => entry.length > 0);
          return className ? `${element.tagName.toLowerCase()}.${escapeSelector(className)}` : element.tagName.toLowerCase();
        }

        function roleFor(element: Element | null): string | null {
          if (!element) {
            return null;
          }
          const explicit = element.getAttribute("role");
          if (explicit) {
            return explicit;
          }
          const tag = element.tagName.toLowerCase();
          if (tag === "a") {
            return "link";
          }
          if (tag === "button") {
            return "button";
          }
          if (tag === "input" || tag === "textarea") {
            return "textbox";
          }
          if (tag === "select") {
            return "combobox";
          }
          return null;
        }

        function boundsFor(element: Element | null): InteractiveComponentBounds | null {
          if (!element) {
            return null;
          }
          const rect = element.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) {
            return null;
          }
          return {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            unit: "css_px" as const
          };
        }

        function hasVisibleFocus(element: Element | null): boolean {
          if (!element) {
            return false;
          }
          const style = globalThis.getComputedStyle(element);
          return Boolean(
            (style.outlineStyle && style.outlineStyle !== "none" && style.outlineWidth !== "0px") ||
            (style.boxShadow && style.boxShadow !== "none") ||
            element.matches(":focus-visible")
          );
        }

        const active = document.activeElement;
        const modal = document.querySelector("dialog[open], [role='dialog'][aria-modal='true'], [aria-modal='true'], .modal[open], .modal.is-open, [data-testid*='modal' i]");
        return {
          order,
          selector: selectorFor(active),
          text: normalizeText(active?.textContent || active?.getAttribute("aria-label") || active?.getAttribute("placeholder")).slice(0, 120) || null,
          role: roleFor(active),
          visible_focus: hasVisibleFocus(active),
          inside_modal: Boolean(active && modal?.contains(active)),
          bounds: boundsFor(active)
        };
      }, index + 1);

      focusOrder.push(step);
      if (step.selector && seenSelectors.has(step.selector)) {
        repeatedSelector = step.selector;
        break;
      }
      if (step.selector) {
        seenSelectors.add(step.selector);
      }
    }

    const modalOpen = focusOrder.some((step) => step.inside_modal) || await page.evaluate(() =>
      Boolean(document.querySelector("dialog[open], [role='dialog'][aria-modal='true'], [aria-modal='true'], .modal[open], .modal.is-open, [data-testid*='modal' i]"))
    ).catch(() => false);
    const uniqueTabStops = new Set(focusOrder.map((step) => step.selector).filter(Boolean)).size;
    return {
      sampled: true,
      tab_stop_count: uniqueTabStops,
      modal_open: modalOpen,
      keyboard_trap_candidate: Boolean(modalOpen && (repeatedSelector || uniqueTabStops <= 1) && focusOrder.length > 1),
      focus_order: focusOrder,
      reason: repeatedSelector ? `repeated_focus:${repeatedSelector}` : null
    };
  } catch {
    return fallbackValue.sampled ? fallbackValue : emptyKeyboardFocusState("focus_sampling_failed");
  }
}

async function safeRepeatedGenericLinkGrouping(page: Page, fallbackValue: BrowserRepeatedGenericLinkGroup[]): Promise<BrowserRepeatedGenericLinkGroup[]> {
  try {
    return await page.evaluate(() => {
      function normalizeText(value: string | null | undefined): string {
        return (value ?? "").replace(/\s+/g, " ").trim();
      }

      function isVisible(element: Element): boolean {
        const rect = element.getBoundingClientRect();
        const style = globalThis.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      }

      function escapeSelector(value: string): string {
        return ((globalThis as typeof globalThis & { CSS?: { escape?: (value: string) => string } }).CSS?.escape?.(value)) ??
          value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
      }

      function selectorFor(element: Element): string {
        const id = element.getAttribute("id");
        if (id) {
          return `#${escapeSelector(id)}`;
        }
        const href = element.getAttribute("href");
        if (href && element.tagName.toLowerCase() === "a") {
          return `a[href="${href.replace(/"/g, '\\"')}"]`;
        }
        const className = Array.from(element.classList).find((entry) => entry.length > 0);
        return className ? `${element.tagName.toLowerCase()}.${escapeSelector(className)}` : element.tagName.toLowerCase();
      }

      function headingFor(container: Element | null): string | null {
        if (!container) {
          return null;
        }
        const heading = container.querySelector("h1, h2, h3, h4, h5, h6, [role='heading']");
        return normalizeText(heading?.textContent).slice(0, 120) || null;
      }

      function nearbyTextFor(container: Element | null, linkText: string): string[] {
        if (!container) {
          return [];
        }
        const normalizedLink = linkText.toLowerCase();
        return Array.from(new Set(Array.from(container.querySelectorAll("h1, h2, h3, h4, h5, h6, [role='heading'], p, li, label, legend"))
          .map((candidate) => normalizeText(candidate.textContent).slice(0, 180))
          .filter((text) => text.length > 0 && text.toLowerCase() !== normalizedLink)))
          .slice(0, 5);
      }

      const genericPattern = /^(자세히 보기|더보기|더 보기|여기|보기|read more|learn more|more|details|click here)$/i;
      const grouped = new Map<string, BrowserRepeatedGenericLinkGroup>();

      for (const link of Array.from(document.querySelectorAll("a[href], [role='link']"))) {
        if (!isVisible(link)) {
          continue;
        }
        const linkText = normalizeText(link.textContent || link.getAttribute("aria-label") || link.getAttribute("title"));
        if (!genericPattern.test(linkText)) {
          continue;
        }
        const container = link.closest("article, section, li, [class*='card' i], [data-testid*='card' i], [data-test*='card' i]") ?? link.parentElement;
        const heading = headingFor(container);
        const key = linkText.toLowerCase();
        const existing = grouped.get(key) ?? {
          link_text: linkText,
          occurrence_count: 0,
          container_heading: heading,
          nearby_text: nearbyTextFor(container, linkText),
          selectors: []
        };
        existing.occurrence_count += 1;
        if (existing.container_heading !== heading) {
          existing.container_heading = null;
        }
        existing.nearby_text = Array.from(new Set([...existing.nearby_text, ...nearbyTextFor(container, linkText)])).slice(0, 8);
        existing.selectors.push(selectorFor(link));
        grouped.set(key, existing);
      }

      return Array.from(grouped.values())
        .filter((group) => group.occurrence_count > 1 || group.container_heading !== null || group.nearby_text.length > 0)
        .slice(0, 12);
    });
  } catch {
    return fallbackValue;
  }
}

async function safeCartCount(page: Page, fallbackValue: number | null): Promise<number | null> {
  try {
    return await page.evaluate(() => {
      function normalizeText(value: string | null | undefined): string {
        return (value ?? "").trim().replaceAll(/\s+/g, " ");
      }

      function isVisible(element: Element): boolean {
        const rect = element.getBoundingClientRect();
        const style = globalThis.getComputedStyle(element);
        return rect.width > 0 &&
          rect.height > 0 &&
          style.visibility !== "hidden" &&
          style.display !== "none";
      }

      function readCount(value: string): number | null {
        const normalized = normalizeText(value);
        if (normalized.length === 0) {
          return null;
        }

        const explicitMatch = normalized.match(/(?:cart|basket|bag|장바구니|카트|바구니|쇼핑백)[^\d]{0,16}(\d{1,3})|(\d{1,3})[^\d]{0,8}(?:items?|개|건)/i);
        const fallbackMatch = normalized.match(/^\s*(\d{1,3})\s*$/);
        const valueText = explicitMatch?.[1] ?? explicitMatch?.[2] ?? fallbackMatch?.[1];
        if (!valueText) {
          return null;
        }

        const count = Number(valueText);
        return Number.isInteger(count) && count >= 0 && count <= 999 ? count : null;
      }

      const explicitAttributeSelectors = [
        "[data-cart-count]",
        "[data-basket-count]",
        "[data-bag-count]",
        "[data-count][class*='cart' i]",
        "[data-count][id*='cart' i]"
      ];
      for (const element of explicitAttributeSelectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)))) {
        const count = readCount(
          element.getAttribute("data-cart-count") ??
          element.getAttribute("data-basket-count") ??
          element.getAttribute("data-bag-count") ??
          element.getAttribute("data-count") ??
          ""
        );
        if (count !== null) {
          return count;
        }
      }

      const cartSelectors = [
        "[class*='cart' i]",
        "[id*='cart' i]",
        "[aria-label*='cart' i]",
        "[class*='basket' i]",
        "[id*='basket' i]",
        "[aria-label*='basket' i]",
        "[class*='bag' i]",
        "[id*='bag' i]",
        "[aria-label*='bag' i]",
        "[aria-label*='장바구니' i]",
        "[aria-label*='카트' i]",
        "[title*='cart' i]",
        "[title*='basket' i]",
        "[title*='장바구니' i]",
        "[data-testid*='cart' i]",
        "[data-testid*='basket' i]"
      ];
      const cartElements = Array.from(new Set(cartSelectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)))))
        .filter((element) => isVisible(element));

      for (const element of cartElements) {
        const badge = element.querySelector("[class*='badge' i], [class*='count' i], [data-count], [aria-label]");
        const count = readCount([
          badge?.textContent,
          badge?.getAttribute("data-count"),
          badge?.getAttribute("aria-label"),
          element.getAttribute("aria-label"),
          element.getAttribute("title"),
          element.textContent
        ].filter(Boolean).join(" "));
        if (count !== null) {
          return count;
        }
      }

      return null;
    });
  } catch {
    return fallbackValue;
  }
}

async function safeVisiblePrices(page: Page, fallbackValue: string[]): Promise<string[]> {
  try {
    return await page.evaluate(() => {
      const text = document.body?.innerText ?? "";
      const matches = text.match(/(?:[$€£₩]\\s?\\d[\\d,.]*|\\d[\\d,.]*\\s?(?:원|달러|USD|KRW|만원|천원))/gi) ?? [];
      return Array.from(new Set(matches.map((match) => match.trim()))).slice(0, 20);
    });
  } catch {
    return fallbackValue;
  }
}

async function safeProductImages(page: Page, fallbackValue: BrowserProductImageSignal[]): Promise<BrowserProductImageSignal[]> {
  try {
    return await page.evaluate(() => {
      const viewportWidth = globalThis.innerWidth || 0;
      const viewportHeight = globalThis.innerHeight || 0;
      return Array.from(document.images)
        .map((image) => {
          const rect = image.getBoundingClientRect();
          return {
            src: image.currentSrc || image.src || null,
            alt: image.alt || null,
            bounds: {
              x: Math.round(rect.x),
              y: Math.round(rect.y),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
              unit: "css_px" as const
            },
            visible: rect.width > 24 && rect.height > 24 && rect.bottom >= 0 && rect.right >= 0 && rect.top <= viewportHeight && rect.left <= viewportWidth
          };
        })
        .filter((image) => image.visible)
        .slice(0, 20)
        .map(({ visible, ...image }) => image);
    });
  } catch {
    return fallbackValue;
  }
}

async function safeProductCards(page: Page, fallbackValue: BrowserProductCardSignal[]): Promise<BrowserProductCardSignal[]> {
  try {
    return await page.evaluate(() => {
      const pricePattern = /(?:[$€£₩]\s?\d[\d,.]*|\d[\d,.]*\s?(?:원|달러|USD|KRW|만원|천원))/i;
      const candidates = Array.from(document.querySelectorAll("article, li, [class*='card' i], [class*='product' i], [class*='item' i], [data-product], [data-testid*='product' i]"));
      const viewportWidth = globalThis.innerWidth || 0;
      const viewportHeight = globalThis.innerHeight || 0;

      function selectorFor(element: Element): string | null {
        const link = element.matches("a[href]") ? element : element.querySelector("a[href]");
        const target = link ?? element;
        const id = target.getAttribute("id");
        if (id) {
          return `#${id.replace(/[^a-zA-Z0-9_-]/g, "\\$&")}`;
        }
        const href = target.getAttribute("href");
        if (href) {
          return `a[href="${href.replace(/"/g, '\\"')}"]`;
        }
        const className = Array.from(target.classList).find((entry) => entry.length > 0);
        return className ? `${target.tagName.toLowerCase()}.${className.replace(/[^a-zA-Z0-9_-]/g, "\\$&")}` : target.tagName.toLowerCase();
      }

      return candidates
        .map((element) => {
          const rect = element.getBoundingClientRect();
          const text = (element.textContent ?? "").trim().replaceAll(/\s+/g, " ").slice(0, 240);
          const price = text.match(pricePattern)?.[0] ?? null;
          const visibleImage = Array.from(element.querySelectorAll("img")).some((image) => {
            const imageRect = image.getBoundingClientRect();
            return imageRect.width > 24 && imageRect.height > 24;
          });
          return {
            element_text: text,
            clicked_selector: selectorFor(element),
            visible_price: price,
            visible_product_image: visibleImage,
            bbox: {
              x: Math.round(rect.x),
              y: Math.round(rect.y),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
              unit: "css_px" as const
            },
            visible: rect.width > 40 && rect.height > 40 && rect.bottom >= 0 && rect.right >= 0 && rect.top <= viewportHeight && rect.left <= viewportWidth,
            likely: Boolean(price || visibleImage)
          };
        })
        .filter((card) => card.visible && card.likely && card.element_text.length > 0)
        .slice(0, 20)
        .map(({ visible, likely, ...card }) => card);
    });
  } catch {
    return fallbackValue;
  }
}

async function safeSelectedFilters(page: Page, fallbackValue: BrowserFilterSignal[]): Promise<BrowserFilterSignal[]> {
  try {
    return await page.evaluate(() => {
      function normalizeText(value: string | null | undefined): string {
        return (value ?? "").trim().replaceAll(/\s+/g, " ");
      }

      function selectorFor(element: Element): string | null {
        const id = element.getAttribute("id");
        if (id) {
          return `#${id.replace(/[^a-zA-Z0-9_-]/g, "\\$&")}`;
        }
        const name = element.getAttribute("name");
        if (name) {
          return `${element.tagName.toLowerCase()}[name="${name.replace(/"/g, '\\"')}"]`;
        }
        const className = Array.from(element.classList).find((entry) => entry.length > 0);
        return className ? `${element.tagName.toLowerCase()}.${className.replace(/[^a-zA-Z0-9_-]/g, "\\$&")}` : element.tagName.toLowerCase();
      }

      function labelForInput(input: HTMLInputElement | HTMLOptionElement): string {
        if (input instanceof HTMLOptionElement) {
          return normalizeText(input.label || input.textContent || input.value);
        }
        const id = input.getAttribute("id");
        const explicitLabel = id ? document.querySelector(`label[for="${id.replace(/"/g, '\\"')}"]`) : null;
        const wrappingLabel = input.closest("label");
        return normalizeText(
          explicitLabel?.textContent ||
          wrappingLabel?.textContent ||
          input.getAttribute("aria-label") ||
          input.value ||
          input.name
        );
      }

      const checkedInputs = Array.from(document.querySelectorAll("input[type='checkbox']:checked, input[type='radio']:checked"))
        .map((input) => {
          const typedInput = input as HTMLInputElement;
          return {
            key: normalizeText(typedInput.name || typedInput.getAttribute("data-filter") || "filter"),
            value: labelForInput(typedInput),
            selector: selectorFor(typedInput)
          };
        });

      const selectedOptions = Array.from(document.querySelectorAll("select"))
        .flatMap((select) => Array.from((select as HTMLSelectElement).selectedOptions)
          .filter((option) => option.value.length > 0)
          .map((option) => ({
            key: normalizeText((select as HTMLSelectElement).name || select.getAttribute("aria-label") || "select"),
            value: labelForInput(option),
            selector: selectorFor(select)
          })));

      const pressedOrSelected = Array.from(document.querySelectorAll("[aria-pressed='true'], [aria-selected='true'], [data-state='checked'], [data-selected='true'], .active, .selected, [class*='filter'][class*='active']"))
        .map((element) => ({
          key: normalizeText(element.getAttribute("data-filter") || element.getAttribute("role") || "ui_state"),
          value: normalizeText(element.textContent || element.getAttribute("aria-label") || element.getAttribute("title")),
          selector: selectorFor(element)
        }));

      const seen = new Set<string>();
      return [...checkedInputs, ...selectedOptions, ...pressedOrSelected]
        .filter((filter) => filter.value.length > 0)
        .filter((filter) => {
          const key = `${filter.key}:${filter.value}:${filter.selector ?? ""}`;
          if (seen.has(key)) {
            return false;
          }
          seen.add(key);
          return true;
        })
        .slice(0, 30);
    });
  } catch {
    return fallbackValue;
  }
}

async function safeSearchQuery(page: Page, fallbackValue: string | null): Promise<string | null> {
  try {
    return await page.evaluate(() => {
      const candidates = Array.from(document.querySelectorAll([
        "input[type='search']",
        "form[role='search'] input",
        "input[name*='search' i]",
        "input[name='q']",
        "input[name*='query' i]",
        "input[name*='keyword' i]",
        "input[placeholder*='검색']",
        "input[placeholder*='search' i]"
      ].join(", "))) as HTMLInputElement[];

      const query = candidates
        .map((input) => input.value.trim())
        .find((value) => value.length > 0);

      return query ?? null;
    });
  } catch {
    return fallbackValue;
  }
}

async function safeDomSignature(page: Page, fallbackValue: string | null): Promise<string | null> {
  try {
    return await page.evaluate(() => {
      const bodyText = (document.body?.innerText ?? "").replaceAll(/\s+/g, " ").slice(0, 4_000);
      return [
        document.location.href,
        document.title,
        document.querySelectorAll("*").length,
        document.querySelectorAll("a,button,input,select,textarea,[role='button'],[role='link']").length,
        bodyText
      ].join("|");
    });
  } catch {
    return fallbackValue;
  }
}

async function safePerformanceSummary(page: Page, fallbackValue: BrowserPerformanceSummary | null): Promise<BrowserPerformanceSummary | null> {
  try {
    return await page.evaluate(() => {
      const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
      const paintEntries = performance.getEntriesByType("paint");
      const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
      const firstContentfulPaint = paintEntries.find((entry) => entry.name === "first-contentful-paint");
      const largestContentfulPaintEntries = performance.getEntriesByType("largest-contentful-paint");
      const largestContentfulPaint = largestContentfulPaintEntries[largestContentfulPaintEntries.length - 1];
      const layoutShiftEntries = performance.getEntriesByType("layout-shift") as Array<PerformanceEntry & {
        value?: number;
        hadRecentInput?: boolean;
      }>;
      const eventEntries = performance.getEntriesByType("event") as Array<PerformanceEntry & {
        processingStart?: number;
        startTime: number;
        duration?: number;
      }>;
      const longTasks = performance.getEntriesByType("longtask");
      const sum = (values: number[]) => values.reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0);
      const cumulativeLayoutShift = sum(layoutShiftEntries
        .filter((entry) => entry.hadRecentInput !== true)
        .map((entry) => entry.value ?? 0));
      const interactionToNextPaint = eventEntries.length > 0
        ? Math.max(...eventEntries.map((entry) => Math.max(entry.duration ?? 0, (entry.processingStart ?? entry.startTime) - entry.startTime)))
        : null;
      const renderBlockingResourceCount = resources.filter((resource) =>
        ["script", "link", "css"].some((token) => resource.initiatorType.toLowerCase().includes(token)) &&
        resource.responseEnd > 0 &&
        resource.startTime < (firstContentfulPaint?.startTime ?? 1_800)
      ).length;

      return {
        navigation_type: navigation?.type ?? null,
        time_origin: Number.isFinite(performance.timeOrigin) ? performance.timeOrigin : null,
        dom_content_loaded_ms: navigation ? durationFromStart(navigation.domContentLoadedEventEnd, navigation.startTime) : null,
        load_event_ms: navigation ? durationFromStart(navigation.loadEventEnd, navigation.startTime) : null,
        first_contentful_paint_ms: firstContentfulPaint ? roundMetric(firstContentfulPaint.startTime) : null,
        largest_contentful_paint_ms: largestContentfulPaint ? roundMetric(largestContentfulPaint.startTime) : null,
        cumulative_layout_shift: roundMetric(cumulativeLayoutShift),
        interaction_to_next_paint_ms: interactionToNextPaint === null ? null : roundMetric(interactionToNextPaint),
        render_blocking_resource_count: renderBlockingResourceCount,
        long_task_count: longTasks.length,
        web_vitals_source: "browser_performance_api" as const,
        resource_count: resources.length,
        transfer_size_bytes: sum(resources.map((resource) => resource.transferSize)),
        encoded_body_size_bytes: sum(resources.map((resource) => resource.encodedBodySize)),
        decoded_body_size_bytes: sum(resources.map((resource) => resource.decodedBodySize))
      };

      function durationFromStart(value: number, startTime: number): number | null {
        const duration = value - startTime;
        return Number.isFinite(duration) && duration >= 0 ? roundMetric(duration) : null;
      }

      function roundMetric(value: number): number {
        return Math.round(value * 100) / 100;
      }
    });
  } catch {
    return fallbackValue;
  }
}

async function safeInteractiveComponents(
  page: Page,
  lastAction: BrowserPageSnapshot["lastAction"],
  fallbackValue: InteractiveComponentObservationItem[]
): Promise<InteractiveComponentObservationItem[]> {
  try {
    const mainComponents = await extractInteractiveComponentsFromFrame(page.mainFrame(), lastAction, null);
    const frameComponents: InteractiveComponentObservationItem[] = [];

    for (const [index, frame] of page.frames().filter((frame) => frame !== page.mainFrame()).entries()) {
      try {
        frameComponents.push(...await extractInteractiveComponentsFromFrame(frame, lastAction, `frame:${index + 1}`));
      } catch {
        continue;
      }
    }

    const components = [...mainComponents, ...frameComponents]
      .sort((left, right) => componentScore(right) - componentScore(left))
      .slice(0, 20);
    const primaryIndex = components.findIndex((component) => component.is_cta_candidate);

    return components.map((component, index) => ({
      ...component,
      is_primary_like: index === primaryIndex,
      interaction_order: component.clicked_in_scenario || component.typed_in_scenario || component.filled_in_scenario || component.selected_in_scenario ? 1 : null,
      visual_prominence: createVisualProminence(component, index, index === primaryIndex)
    }));
  } catch {
    return fallbackValue;
  }
}

async function safeVisibleTextBlocks(
  page: Page,
  fallbackValue: VisibleTextBlockObservationItem[]
): Promise<VisibleTextBlockObservationItem[]> {
  try {
    return await page.evaluate(() => {
      const TEXT_BLOCK_SELECTOR = "main h1, main h2, main h3, main p, main li, main label, h1, h2, h3, p, li, label, legend, [role='heading'], [role='alert'], [role='status']";
      const CTA_TEXT_PATTERN = /무료|시작|가입|신청|구매|결제|문의|상담|체험|다운로드|start|sign\s*up|try|buy|checkout|contact|demo|continue/i;
      const viewportWidth = globalThis.innerWidth || 0;
      const viewportHeight = globalThis.innerHeight || 0;
      const seen = new Set<string>();

      function normalizeText(value: string | null | undefined): string {
        return (value ?? "").replace(/\s+/g, " ").trim();
      }

      function implicitRole(element: Element, tag: string): string | null {
        if (/^h[1-6]$/.test(tag)) {
          return "heading";
        }
        if (tag === "a") {
          return "link";
        }
        if (tag === "button") {
          return "button";
        }
        return null;
      }

      function selectorFor(element: Element, tag: string): string | null {
        const id = element.getAttribute("id");
        if (id) {
          return `#${id.replace(/[^a-zA-Z0-9_-]/g, "\\$&")}`;
        }
        const className = Array.from(element.classList).find((entry) => entry.length > 0);
        if (className) {
          return `${tag}.${className.replace(/[^a-zA-Z0-9_-]/g, "\\$&")}`;
        }
        return tag;
      }

      function visibilityFor(rect: DOMRect): InteractiveComponentVisibility {
        const area = Math.max(0, rect.width) * Math.max(0, rect.height);
        const intersectionWidth = Math.max(0, Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0));
        const intersectionHeight = Math.max(0, Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0));
        const intersectionArea = intersectionWidth * intersectionHeight;
        return {
          visible: area > 0,
          in_viewport: intersectionArea > 0,
          above_fold: rect.top < viewportHeight && rect.bottom > 0,
          area_px: Math.round(area),
          viewport_coverage_ratio: area > 0 ? Math.round((intersectionArea / area) * 1000) / 1000 : 0
        };
      }

      function parseCssPixels(value: string): number | null {
        const parsed = Number(value.replace("px", ""));
        return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : null;
      }

      function lineMetricsFor(element: Element, rect: DOMRect): {
        line_count: number | null;
        line_width_px: number | null;
        block_width_px: number;
        font_size_px: number | null;
        line_height_px: number | null;
        text_align: string | null;
        mobile_line_break_segments: string[];
      } {
        const style = globalThis.getComputedStyle(element);
        const fontSize = parseCssPixels(style.fontSize);
        const lineHeight = style.lineHeight === "normal" ? (fontSize ? Math.round(fontSize * 1.2 * 100) / 100 : null) : parseCssPixels(style.lineHeight);
        const lineCount = lineHeight && lineHeight > 0 ? Math.max(1, Math.round(rect.height / lineHeight)) : null;
        const blockWidth = Math.round(rect.width);
        return {
          line_count: lineCount,
          line_width_px: lineCount && lineCount > 0 ? Math.round(blockWidth / lineCount) : blockWidth,
          block_width_px: blockWidth,
          font_size_px: fontSize,
          line_height_px: lineHeight,
          text_align: style.textAlign || null,
          mobile_line_break_segments: estimateMobileLineSegments(normalizeText(element.textContent), fontSize, 360)
        };
      }

      function estimateMobileLineSegments(text: string, fontSize: number | null, mobileWidth: number): string[] {
        if (!text) {
          return [];
        }
        const approxCharWidth = Math.max(7, (fontSize ?? 16) * 0.55);
        const maxChars = Math.max(12, Math.floor((mobileWidth - 32) / approxCharWidth));
        const words = text.split(/\s+/);
        const lines: string[] = [];
        let current = "";
        for (const word of words) {
          const next = current ? `${current} ${word}` : word;
          if (next.length > maxChars && current) {
            lines.push(current);
            current = word;
          } else {
            current = next;
          }
        }
        if (current) {
          lines.push(current);
        }
        return lines.slice(0, 8);
      }

      function distanceBetween(left: DOMRect, right: DOMRect): number {
        const dx = Math.max(0, Math.max(left.left, right.left) - Math.min(left.right, right.right));
        const dy = Math.max(0, Math.max(left.top, right.top) - Math.min(left.bottom, right.bottom));
        return Math.round(Math.sqrt(dx * dx + dy * dy));
      }

      const ctaCandidates = Array.from(document.querySelectorAll("a[href], button, [role='button'], [role='link']"))
        .map((element) => {
          const tag = element.tagName.toLowerCase();
          const text = normalizeText((element as HTMLElement & { innerText?: string }).innerText ?? element.textContent);
          const rect = element.getBoundingClientRect();
          return {
            text,
            selector: selectorFor(element, tag),
            rect
          };
        })
        .filter((candidate) => candidate.text.length > 0 && CTA_TEXT_PATTERN.test(candidate.text) && candidate.rect.width > 0 && candidate.rect.height > 0);

      function nearbyCtaFor(rect: DOMRect): VisibleTextBlockObservationItem["nearby_cta_ref"] {
        const nearest = ctaCandidates
          .map((candidate) => ({
            text: candidate.text.slice(0, 120),
            selector: candidate.selector,
            distance_px: distanceBetween(rect, candidate.rect)
          }))
          .sort((left, right) => left.distance_px - right.distance_px)[0];
        return nearest ?? null;
      }

      return Array.from(document.querySelectorAll(TEXT_BLOCK_SELECTOR))
        .map((element) => {
          const rect = element.getBoundingClientRect();
          const text = normalizeText(element.textContent);
          const tag = element.tagName.toLowerCase();
          const visibility = visibilityFor(rect);
          const metrics = lineMetricsFor(element, rect);
          const nearbyCta = nearbyCtaFor(rect);
          return {
            text,
            tag,
            role: element.getAttribute("role") ?? implicitRole(element, tag),
            is_heading: /^h[1-6]$/.test(tag) || element.getAttribute("role") === "heading",
            ...metrics,
            nearby_cta_ref: nearbyCta,
            cta_distance_px: nearbyCta?.distance_px ?? null,
            bounds: {
              x: Math.round(rect.x),
              y: Math.round(rect.y),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
              unit: "css_px" as const
            },
            visibility,
            score: (visibility.above_fold ? 1_000_000 : 0) + visibility.area_px + Math.min(text.length, 240)
          };
        })
        .filter((block) => block.text.length > 0 && block.visibility.in_viewport && block.bounds.width > 0 && block.bounds.height > 0)
        .filter((block) => {
          const key = `${block.tag}:${block.text.toLowerCase()}`;
          if (seen.has(key)) {
            return false;
          }
          seen.add(key);
          return true;
        })
        .sort((left, right) => right.score - left.score)
        .slice(0, 30)
        .map(({ score, ...block }) => block);
    });
  } catch {
    return fallbackValue;
  }
}

async function extractInteractiveComponentsFromFrame(
  frame: Frame,
  lastAction: BrowserPageSnapshot["lastAction"],
  frameId: string | null
): Promise<InteractiveComponentObservationItem[]> {
  return frame.evaluate(({ lastAction, frameId }) => {
      const CTA_TEXT_PATTERN = /무료|시작|가입|신청|구매|결제|문의|상담|체험|다운로드|start|sign\s*up|try|buy|checkout|contact|demo|continue/i;
      const SELECTOR_ESCAPE_SCOPE = globalThis as typeof globalThis & {
        CSS?: {
          escape?: (value: string) => string;
        };
      };

      function escapeSelector(value: string): string {
        return SELECTOR_ESCAPE_SCOPE.CSS?.escape?.(value) ?? value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
      }

      function implicitRole(element: Element, tag: string): string | null {
        if (tag === "a" && element.hasAttribute("href")) {
          return "link";
        }
        if (tag === "button") {
          return "button";
        }
        if (tag === "select") {
          return "combobox";
        }
        if (tag === "textarea") {
          return "textbox";
        }
        if (tag === "input") {
          const type = (element.getAttribute("type") ?? "").toLowerCase();
          if (["button", "submit", "reset"].includes(type)) {
            return "button";
          }
          if (type === "search") {
            return "searchbox";
          }
          if (type === "checkbox") {
            return "checkbox";
          }
          if (type === "radio") {
            return "radio";
          }
          return "textbox";
        }
        return null;
      }

      function normalizeText(value: string | null | undefined): string {
        return (value ?? "").replace(/\s+/g, " ").trim();
      }

      function firstText(values: Array<string | null | undefined>): string | null {
        for (const value of values) {
          const normalized = normalizeText(value);
          if (normalized.length > 0) {
            return normalized;
          }
        }
        return null;
      }

      function visibleTextFor(element: Element): string | null {
        const inputValue = element instanceof HTMLInputElement && ["button", "submit", "reset"].includes(element.type.toLowerCase())
          ? element.value
          : "";
        const elementWithInnerText = element as HTMLElement & { innerText?: string };
        return firstText([
          inputValue,
          elementWithInnerText.innerText,
          element.textContent
        ])?.slice(0, 120) ?? null;
      }

      function ariaLabelledByTextFor(element: Element): string | null {
        const labelledBy = element.getAttribute("aria-labelledby");
        if (!labelledBy) {
          return null;
        }

        return firstText(labelledBy
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent ?? null));
      }

      function associatedLabelTextFor(element: Element): string | null {
        const id = element.getAttribute("id");
        if (id) {
          const explicitLabel = document.querySelector(`label[for="${escapeSelector(id)}"]`);
          const explicitLabelText = explicitLabel?.textContent;
          if (normalizeText(explicitLabelText).length > 0) {
            return normalizeText(explicitLabelText);
          }
        }

        const wrappingLabelText = element.closest("label")?.textContent;
        if (normalizeText(wrappingLabelText).length > 0) {
          return normalizeText(wrappingLabelText);
        }

        return null;
      }

      function accessibleNameFor(element: Element, visibleText: string | null): string | null {
        const altText = element instanceof HTMLImageElement || element instanceof HTMLInputElement
          ? element.getAttribute("alt")
          : null;
        return firstText([
          element.getAttribute("aria-label"),
          ariaLabelledByTextFor(element),
          associatedLabelTextFor(element),
          altText,
          visibleText,
          element.getAttribute("title"),
          placeholderFor(element),
          nameFor(element)
        ])?.slice(0, 120) ?? null;
      }

      function textFor(element: Element, visibleText: string | null, accessibleName: string | null): string {
        return firstText([
          visibleText,
          accessibleName,
          element.getAttribute("title"),
          placeholderFor(element),
          nameFor(element)
        ])?.slice(0, 120) ?? "";
      }

      function labelTextFor(element: Element): string | null {
        const explicitAria = element.getAttribute("aria-label");
        if (explicitAria?.trim()) {
          return explicitAria.trim();
        }

        return associatedLabelTextFor(element);
      }

      function placeholderFor(element: Element): string | null {
        return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
          ? element.getAttribute("placeholder")
          : null;
      }

      function describedByTextFor(element: Element): string | null {
        const describedBy = element.getAttribute("aria-describedby");
        if (!describedBy) {
          return null;
        }

        return firstText(describedBy
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent ?? null))?.slice(0, 240) ?? null;
      }

      function helpTextFor(element: Element): string | null {
        const describedByText = describedByTextFor(element);
        if (describedByText) {
          return describedByText;
        }

        const container = element.closest("label, .field, .form-field, .input, .control, [data-testid*='field' i], [data-test*='field' i]") ?? element.parentElement;
        if (!container) {
          return null;
        }

        return firstText(Array.from(container.querySelectorAll("small, .help, .hint, .description, [class*='help' i], [class*='hint' i], [data-testid*='help' i], [data-test*='help' i]"))
          .map((candidate) => candidate.textContent))?.slice(0, 240) ?? null;
      }

      function fieldContainerFor(element: Element): Element | null {
        return element.closest("label, fieldset, .field, .form-field, .input, .control, [data-testid*='field' i], [data-test*='field' i]") ?? element.parentElement;
      }

      function visibleRequiredMarkerFor(element: Element, labelText: string | null): string | null {
        const container = fieldContainerFor(element);
        const text = normalizeText(`${labelText ?? ""} ${container?.textContent ?? ""}`);
        const marker = text.match(/(\*|필수|required|mandatory|must)/i)?.[1] ?? null;
        return marker?.slice(0, 40) ?? null;
      }

      function visibleOptionalMarkerFor(element: Element, labelText: string | null): string | null {
        const container = fieldContainerFor(element);
        const text = normalizeText(`${labelText ?? ""} ${container?.textContent ?? ""}`);
        const marker = text.match(/(선택|optional|옵션)/i)?.[1] ?? null;
        return marker?.slice(0, 40) ?? null;
      }

      function groupLevelRequiredStateFor(element: Element): BrowserFormGroupRequiredState | null {
        if (!(element instanceof HTMLInputElement) || !["radio", "checkbox"].includes(element.type.toLowerCase())) {
          return null;
        }
        const groupName = element.name;
        const group = element.closest("fieldset, [role='radiogroup'], [role='group'], .field, .form-field, [data-testid*='group' i]");
        const members = groupName
          ? Array.from(document.querySelectorAll(`input[type="${element.type}"][name="${groupName.replace(/"/g, '\\"')}"]`))
          : Array.from(group?.querySelectorAll(`input[type="${element.type}"]`) ?? [element]);
        const requiredCount = members.filter((member) => member.hasAttribute("required") || member.getAttribute("aria-required") === "true").length;
        if (requiredCount === members.length && members.length > 0) {
          return "required";
        }
        if (requiredCount === 0 && members.length > 0) {
          return "optional";
        }
        if (requiredCount > 0) {
          return "mixed";
        }
        return "unknown";
      }

      function submitRequiredErrorFor(element: Element): string | null {
        const invalid = element.getAttribute("aria-invalid") === "true" || (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement ? !element.validity.valid : false);
        const container = fieldContainerFor(element);
        const errorText = firstText(Array.from(container?.querySelectorAll("[role='alert'], .error, .invalid, [class*='error' i], [class*='invalid' i], [data-testid*='error' i]") ?? [])
          .map((candidate) => candidate.textContent))?.slice(0, 240) ?? null;
        if (errorText) {
          return errorText;
        }
        if (invalid && (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) {
          return element.validationMessage ? element.validationMessage.slice(0, 240) : null;
        }
        return null;
      }

      function inputConstraintFor(element: Element, attribute: "pattern" | "min" | "max"): string | null {
        return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
          ? element.getAttribute(attribute)
          : null;
      }

      function inputFormatHintFor(input: {
        inputType: string | null;
        describedbyText: string | null;
        helpText: string | null;
        pattern: string | null;
        min: string | null;
        max: string | null;
        maxlength: number | null;
      }): string | null {
        return firstText([
          input.describedbyText,
          input.helpText,
          input.pattern ? `pattern: ${input.pattern}` : null,
          input.min || input.max ? `range: ${input.min ?? "any"}-${input.max ?? "any"}` : null,
          input.maxlength !== null ? `max length: ${input.maxlength}` : null,
          input.inputType && !["text", "search"].includes(input.inputType) ? `type: ${input.inputType}` : null
        ])?.slice(0, 240) ?? null;
      }

      function maxLengthFor(element: Element): number | null {
        if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
          return null;
        }
        return element.maxLength >= 0 ? element.maxLength : null;
      }

      function nameFor(element: Element): string | null {
        const name = element.getAttribute("name");
        return name && name.trim().length > 0 ? name.trim() : null;
      }

      function inputTypeFor(element: Element, tag: string): string | null {
        if (element instanceof HTMLInputElement) {
          return element.type || "text";
        }
        if (tag === "select") {
          return "select";
        }
        if (tag === "textarea") {
          return "textarea";
        }
        return null;
      }

      function isFormControl(element: Element, tag: string): boolean {
        if (element instanceof HTMLInputElement && ["button", "submit", "reset", "image"].includes(element.type.toLowerCase())) {
          return false;
        }
        return tag === "input" || tag === "select" || tag === "textarea" || element.getAttribute("role") === "textbox" || element.getAttribute("role") === "searchbox";
      }

      function isDisabled(element: Element): boolean {
        return (
          element.hasAttribute("disabled") ||
          element.getAttribute("aria-disabled") === "true" ||
          Boolean((element as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).disabled)
        );
      }

      function isRequired(element: Element): boolean {
        return element.hasAttribute("required") || element.getAttribute("aria-required") === "true";
      }

      function selectorFor(element: Element, tag: string): string | null {
        const id = element.getAttribute("id");
        if (id) {
          return `#${escapeSelector(id)}`;
        }

        const className = Array.from(element.classList).find((entry) => entry.length > 0);
        if (className) {
          return `${tag}.${escapeSelector(className)}`;
        }

        const href = element.getAttribute("href");
        if (tag === "a" && href) {
          return `a[href="${href.replace(/"/g, '\\"')}"]`;
        }

        return tag;
      }

      function hrefFor(element: Element, tag: string): string | null {
        if (tag !== "a") {
          return null;
        }

        const href = element.getAttribute("href");
        if (!href) {
          return null;
        }

        try {
          return new URL(href, document.baseURI).toString();
        } catch {
          return href;
        }
      }

      function isClickable(element: Element, tag: string, role: string | null): boolean {
        return Boolean(
          tag === "a" ||
          tag === "button" ||
          role === "button" ||
          role === "link" ||
          element.hasAttribute("onclick") ||
          element.getAttribute("tabindex") === "0"
        );
      }

      function scenarioTargetMatches(input: {
        text: string;
        selector: string | null;
        role: string | null;
        name: string | null;
        labelText: string | null;
        placeholder: string | null;
      }): boolean {
        const target = (lastAction?.target ?? "").toLowerCase();
        if (!target) {
          return false;
        }
        return Boolean(
          (input.selector && target.includes(input.selector.toLowerCase())) ||
          (input.text && target.includes(input.text.toLowerCase())) ||
          (input.role && target.includes(`role=${input.role.toLowerCase()}`)) ||
          (input.name && target.includes(input.name.toLowerCase())) ||
          (input.labelText && target.includes(input.labelText.toLowerCase())) ||
          (input.placeholder && target.includes(input.placeholder.toLowerCase()))
        );
      }

      function visibilityFor(rect: DOMRect): InteractiveComponentVisibility {
        const area = Math.max(0, rect.width) * Math.max(0, rect.height);
        const intersectionWidth = Math.max(0, Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0));
        const intersectionHeight = Math.max(0, Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0));
        const intersectionArea = intersectionWidth * intersectionHeight;
        return {
          visible: area > 0,
          in_viewport: intersectionArea > 0,
          above_fold: rect.top < viewportHeight && rect.bottom > 0,
          area_px: Math.round(area),
          viewport_coverage_ratio: area > 0 ? Math.round((intersectionArea / area) * 1000) / 1000 : 0
        };
      }

      function viewportPosition(rect: DOMRect, visibility: InteractiveComponentVisibility): InteractiveComponentLayout["viewport_position"] {
        if (visibility.viewport_coverage_ratio >= 1) {
          return "inside";
        }
        if (visibility.in_viewport) {
          return "partially_inside";
        }
        if (rect.bottom < 0) {
          return "above";
        }
        if (rect.top > viewportHeight) {
          return "below";
        }
        if (rect.right < 0) {
          return "left";
        }
        return "right";
      }

      function layoutFor(element: Element, rect: DOMRect, visibility: InteractiveComponentVisibility): InteractiveComponentLayout {
        const style = globalThis.getComputedStyle(element);
        const viewportArea = Math.max(1, viewportWidth * viewportHeight);
        const position = style.position || null;
        const zIndex = style.zIndex && style.zIndex !== "auto" ? style.zIndex : null;
        return {
          center_x: Math.round(rect.x + rect.width / 2),
          center_y: Math.round(rect.y + rect.height / 2),
          viewport_position: viewportPosition(rect, visibility),
          css_position: position,
          z_index: zIndex,
          is_fixed: position === "fixed",
          is_sticky: position === "sticky",
          overlay_candidate: (position === "fixed" || position === "sticky") && visibility.in_viewport && visibility.area_px / viewportArea >= 0.2
        };
      }

      function boundsFor(rect: DOMRect): InteractiveComponentBounds {
        return {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          unit: "css_px" as const
        };
      }

      function containerRoleFor(element: Element): string | null {
        const explicitRole = element.getAttribute("role");
        if (explicitRole) {
          return explicitRole;
        }

        const tag = element.tagName.toLowerCase();
        if (tag === "header") {
          return "header";
        }
        if (tag === "footer") {
          return "footer";
        }
        if (tag === "main") {
          return "main";
        }
        if (tag === "nav") {
          return "nav";
        }
        if (tag === "form") {
          return "form";
        }
        if (tag === "section") {
          return "section";
        }
        if (tag === "article") {
          return "card";
        }
        if (tag === "aside") {
          return "aside";
        }
        if (tag === "dialog") {
          return "modal";
        }
        if (tag === "ul" || tag === "ol") {
          return "list";
        }

        const className = typeof (element as HTMLElement).className === "string"
          ? (element as HTMLElement).className.toLowerCase()
          : "";
        const testId = `${element.getAttribute("data-testid") ?? ""} ${element.getAttribute("data-test") ?? ""}`.toLowerCase();
        if (className.includes("card") || testId.includes("card")) {
          return "card";
        }
        if (className.includes("modal") || testId.includes("modal")) {
          return "modal";
        }
        if (className.includes("accordion") || testId.includes("accordion")) {
          return "accordion";
        }

        return null;
      }

      function textSnippetsFor(container: Element, componentText: string | null): string[] {
        const componentNormalized = normalizeText(componentText).toLowerCase();
        const candidates = Array.from(container.querySelectorAll("h1, h2, h3, h4, h5, h6, [role='heading'], p, li, label, legend"))
          .map((candidate) => normalizeText(candidate.textContent).slice(0, 180))
          .filter((text) => text.length > 0)
          .filter((text) => text.toLowerCase() !== componentNormalized);
        return Array.from(new Set(candidates)).slice(0, 5);
      }

      function headingFor(container: Element): string | null {
        const heading = container.querySelector("h1, h2, h3, h4, h5, h6, [role='heading']");
        return normalizeText(heading?.textContent).slice(0, 120) || null;
      }

      function containerInfoFor(element: Element, componentText: string | null): {
        container_role: string | null;
        container_bounds: InteractiveComponentBounds | null;
        container_heading: string | null;
        nearby_text: string[];
      } {
        const selector = [
          "header",
          "footer",
          "main",
          "nav",
          "form",
          "section",
          "article",
          "aside",
          "dialog",
          "ul",
          "ol",
          "[role='banner']",
          "[role='contentinfo']",
          "[role='main']",
          "[role='navigation']",
          "[role='form']",
          "[role='region']",
          "[role='dialog']",
          "[role='list']",
          "[class*='card' i]",
          "[class*='modal' i]",
          "[class*='accordion' i]",
          "[data-testid*='card' i]",
          "[data-testid*='modal' i]",
          "[data-testid*='accordion' i]"
        ].join(",");
        const container = element.closest(selector);
        if (!container) {
          return {
            container_role: null,
            container_bounds: null,
            container_heading: null,
            nearby_text: []
          };
        }

        const rect = container.getBoundingClientRect();
        return {
          container_role: containerRoleFor(container),
          container_bounds: boundsFor(rect),
          container_heading: headingFor(container),
          nearby_text: textSnippetsFor(container, componentText)
        };
      }

      function targetSpacingPx(
        component: { bounds: InteractiveComponentBounds },
        components: Array<{ bounds: InteractiveComponentBounds }>
      ): number | null {
        const distances = components
          .filter((candidate) => candidate !== component)
          .map((candidate) => {
            const left = component.bounds;
            const right = candidate.bounds;
            const dx = Math.max(0, Math.max(left.x, right.x) - Math.min(left.x + left.width, right.x + right.width));
            const dy = Math.max(0, Math.max(left.y, right.y) - Math.min(left.y + left.height, right.y + right.height));
            return Math.round(Math.sqrt(dx * dx + dy * dy));
          });
        return distances.length > 0 ? Math.min(...distances) : null;
      }

      const INTERACTIVE_SELECTOR = "a[href], button, input:not([type='hidden']), select, textarea, [role='button'], [role='link'], [role='textbox'], [role='searchbox'], [onclick], [tabindex='0']";

      function collectInteractiveElements(root: Document | ShadowRoot, shadowRoot: boolean): Array<{ element: Element; shadowRoot: boolean }> {
        const direct = Array.from(root.querySelectorAll(INTERACTIVE_SELECTOR)).map((element) => ({
          element,
          shadowRoot
        }));
        const nested = Array.from(root.querySelectorAll("*")).flatMap((element) => {
          const openShadowRoot = (element as HTMLElement).shadowRoot;
          return openShadowRoot ? collectInteractiveElements(openShadowRoot, true) : [];
        });

        return [...direct, ...nested];
      }

      const viewportWidth = globalThis.innerWidth || 0;
      const viewportHeight = globalThis.innerHeight || 0;
      const components = collectInteractiveElements(document, false)
        .map(({ element, shadowRoot }) => {
          const rect = element.getBoundingClientRect();
          const tag = element.tagName.toLowerCase();
          const role = element.getAttribute("role") ?? implicitRole(element, tag);
          const visibleText = visibleTextFor(element);
          const accessibleName = accessibleNameFor(element, visibleText);
          const text = textFor(element, visibleText, accessibleName);
          const selector = selectorFor(element, tag);
          const href = hrefFor(element, tag);
          const inputType = inputTypeFor(element, tag);
          const labelText = labelTextFor(element);
          const placeholder = placeholderFor(element);
          const describedbyText = describedByTextFor(element);
          const helpText = helpTextFor(element);
          const pattern = inputConstraintFor(element, "pattern");
          const min = inputConstraintFor(element, "min");
          const max = inputConstraintFor(element, "max");
          const maxlength = maxLengthFor(element);
          const inputFormatHint = inputFormatHintFor({
            inputType,
            describedbyText,
            helpText,
            pattern,
            min,
            max,
            maxlength
          });
          const visibleRequiredMarker = visibleRequiredMarkerFor(element, labelText);
          const visibleOptionalMarker = visibleOptionalMarkerFor(element, labelText);
          const groupRequiredState = groupLevelRequiredStateFor(element);
          const submitRequiredError = submitRequiredErrorFor(element);
          const name = nameFor(element);
          const formControl = isFormControl(element, tag);
          const disabled = isDisabled(element);
          const clickable = isClickable(element, tag, role);
          const visibility = visibilityFor(rect);
          const layout = layoutFor(element, rect, visibility);
          const visible = visibility.visible && visibility.in_viewport;
          const isCtaCandidate = clickable && !formControl && !disabled && Boolean(text.match(CTA_TEXT_PATTERN) || role === "button" || tag === "button");
          const containerInfo = containerInfoFor(element, visibleText ?? text);
          const targetMatched = scenarioTargetMatches({ text, selector, role, name, labelText, placeholder });
          const lastActionType = lastAction?.type ?? null;
          const textLikeInput = formControl && ["text", "email", "password", "search", "tel", "url", "textarea", "number"].includes(inputType ?? "text");

          return {
            text,
            visible_text: visibleText,
            accessible_name: accessibleName,
            selector,
            role,
            href,
            input_type: inputType,
            label_text: labelText,
            placeholder,
            name,
            describedby_text: describedbyText,
            help_text: helpText,
            input_format_hint: inputFormatHint,
            pattern,
            min,
            max,
            maxlength,
            visible_required_marker: visibleRequiredMarker,
            visible_optional_marker: visibleOptionalMarker,
            group_level_required_state: groupRequiredState,
            submit_required_error: submitRequiredError,
            required: isRequired(element),
            disabled,
            is_form_control: formControl,
            frame_id: frameId,
            shadow_root: shadowRoot,
            tag,
            clickable: clickable && !formControl && !disabled,
            clicked_in_scenario: lastActionType === "click" && targetMatched,
            typed_in_scenario: lastActionType === "fill" && targetMatched && textLikeInput,
            filled_in_scenario: (lastActionType === "fill" || lastActionType === "select") && targetMatched && formControl,
            selected_in_scenario: lastActionType === "select" && targetMatched && (tag === "select" || role === "combobox" || role === "listbox"),
            interaction_order: null,
            is_cta_candidate: isCtaCandidate,
            is_primary_like: false,
            visual_prominence: undefined,
            bounds: boundsFor(rect),
            visibility,
            layout,
            ...containerInfo,
            visible,
            score: (isCtaCandidate ? 1000 : 0) + (formControl ? 100 : 0) + rect.width * rect.height + (text.match(CTA_TEXT_PATTERN) ? 500 : 0)
          };
        })
        .filter((component) => component.visible && (component.clickable || component.is_form_control) && component.bounds.width > 0 && component.bounds.height > 0)
        .map((component, index, allComponents) => ({
          ...component,
          nearest_target_spacing_px: targetSpacingPx(component, allComponents)
        }))
        .sort((left, right) => right.score - left.score)
        .slice(0, 20);

      return components.map((component) => ({
        text: component.text,
        visible_text: component.visible_text,
        accessible_name: component.accessible_name,
        selector: component.selector,
        role: component.role,
        href: component.href,
        input_type: component.input_type,
        label_text: component.label_text,
        placeholder: component.placeholder,
        name: component.name,
        describedby_text: component.describedby_text,
        help_text: component.help_text,
        input_format_hint: component.input_format_hint,
        pattern: component.pattern,
        min: component.min,
        max: component.max,
        maxlength: component.maxlength,
        visible_required_marker: component.visible_required_marker,
        visible_optional_marker: component.visible_optional_marker,
        group_level_required_state: component.group_level_required_state,
        submit_required_error: component.submit_required_error,
        required: component.required,
        disabled: component.disabled,
        is_form_control: component.is_form_control,
        frame_id: component.frame_id,
        shadow_root: component.shadow_root,
        tag: component.tag,
        clickable: component.clickable,
        clicked_in_scenario: component.clicked_in_scenario,
        typed_in_scenario: component.typed_in_scenario,
        filled_in_scenario: component.filled_in_scenario,
        selected_in_scenario: component.selected_in_scenario,
        interaction_order: component.interaction_order,
        is_cta_candidate: component.is_cta_candidate,
        is_primary_like: false,
        visual_prominence: component.visual_prominence,
        bounds: component.bounds,
        visibility: component.visibility,
        layout: component.layout,
        container_role: component.container_role,
        container_bounds: component.container_bounds,
        container_heading: component.container_heading,
        nearby_text: component.nearby_text,
        nearest_target_spacing_px: component.nearest_target_spacing_px
      }));
    }, { lastAction, frameId });
}

function componentScore(component: InteractiveComponentObservationItem): number {
  return (component.is_cta_candidate ? 1_000_000 : 0) +
    component.bounds.width * component.bounds.height +
    (component.frame_id ? 100 : 0);
}

function createVisualProminence(
  component: InteractiveComponentObservationItem,
  zeroBasedRank: number,
  primaryLike: boolean
): NonNullable<InteractiveComponentObservationItem["visual_prominence"]> {
  const area = component.visibility?.area_px ?? component.bounds.width * component.bounds.height;
  const aboveFoldBonus = component.visibility?.above_fold === true ? 200 : 0;
  const primaryBonus = primaryLike ? 500 : 0;
  const ctaBonus = component.is_cta_candidate ? 250 : 0;
  return {
    score: Math.round(area + aboveFoldBonus + primaryBonus + ctaBonus),
    rank: zeroBasedRank + 1,
    area_px: area,
    above_fold: component.visibility?.above_fold === true,
    primary_like: primaryLike
  };
}
