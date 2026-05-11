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
  type Page
} from "playwright";
import { createCdpSession, type CdpSessionMetadata } from "../cdp/index.ts";
import type { RunnerBrowserName, RunnerConfig } from "../../config/index.ts";
import type {
  InteractiveComponentBounds,
  ScenarioAction,
  ScenarioPlan,
  ScenarioStep,
  SettleStrategy,
  TargetDescriptor,
  InteractiveComponentObservationItem
} from "../../shared/contracts.ts";
import {
  assertScenarioActionAllowed,
  assertVisitedUrlAllowed
} from "../../scenario/policy.ts";
import { describeTarget, sleep, toIsoTimestamp } from "../../shared/utils.ts";

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
  consoleErrors: string[];
  networkErrors: string[];
  networkEvents: BrowserNetworkEventSignal[];
  breadcrumb: string[];
  toastTexts: string[];
  cartCount: number | null;
  visiblePrices: string[];
  productImages: BrowserProductImageSignal[];
  productCards: BrowserProductCardSignal[];
  selectedFilters: BrowserFilterSignal[];
  searchQuery: string | null;
  domSignature: string | null;
  cdpSession: CdpSessionMetadata;
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
}

export interface PreparedBrowserSettle {
  settle: () => Promise<BrowserSettleResult>;
  cancel: () => Promise<void>;
}

export interface BrowserSession {
  id: string;
  plan: ScenarioPlan;
  execute: (action: ScenarioAction, step: ScenarioStep) => Promise<BrowserActionResult>;
  prepareSettle?: (strategy: SettleStrategy) => Promise<PreparedBrowserSettle | null>;
  settle: (strategy: SettleStrategy) => Promise<BrowserSettleResult>;
  snapshot: () => BrowserPageSnapshot;
  captureArtifacts: () => Promise<BrowserCapturedArtifacts>;
  close: () => Promise<void>;
}

export interface BrowserSessionFactory {
  kind: "simulated-playwright" | "playwright";
  createSession: (input: { runId: string; plan: ScenarioPlan }) => Promise<BrowserSession>;
}

const DEFAULT_LOCATOR_TIMEOUT_MS = 1_500;
const DEFAULT_LOCATOR_METADATA_TIMEOUT_MS = 100;
const DEFAULT_WAIT_FOR_TIMEOUT_MS = 1_500;
const ITEM_COUNT_POLL_INTERVAL_MS = 50;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

type SettleTimeoutDetails = Record<string, unknown> | ((error: unknown) => Record<string, unknown>);

interface SettleAttempt {
  attempt: () => Promise<Record<string, unknown>>;
  timeoutDetails: SettleTimeoutDetails;
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
  consoleErrors: string[];
  networkErrors: string[];
  networkEvents: BrowserNetworkEventSignal[];
  breadcrumb: string[];
  toastTexts: string[];
  cartCount: number | null;
  visiblePrices: string[];
  productImages: BrowserProductImageSignal[];
  productCards: BrowserProductCardSignal[];
  selectedFilters: BrowserFilterSignal[];
  searchQuery: string | null;
  domSignature: string | null;
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

  snapshot(): BrowserPageSnapshot {
    return createBrowserPageSnapshot(this.plan, this.state, this.cdpSession);
  }

  async captureArtifacts(): Promise<BrowserCapturedArtifacts> {
    return {};
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

    return session;
  }

  async execute(action: ScenarioAction, step: ScenarioStep): Promise<BrowserActionResult> {
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

  async prepareSettle(strategy: SettleStrategy): Promise<PreparedBrowserSettle | null> {
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
    const startedAt = Date.now();
    const targetSummary = describeTarget(strategy.target);

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

  async captureArtifacts(): Promise<BrowserCapturedArtifacts> {
    const screenshotBuffer = await this.page.screenshot({
      type: "png",
      fullPage: true
    });
    const screenshotDimensions = readPngDimensions(screenshotBuffer) ?? this.plan.environment.viewport;
    const domSnapshot = await this.page.content();

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
      }
    };
  }

  async close(): Promise<void> {
    await this.context.close();
    await this.browser.close();
  }

  private async initializeContext(plan: ScenarioPlan): Promise<void> {
    if (Array.isArray(plan.environment.permissions) && plan.environment.permissions.length > 0) {
      await this.context.grantPermissions(plan.environment.permissions);
    }
  }

  private attachPageObservers(): void {
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
        errorText: failureText
      });
    });

    this.page.on("response", (response) => {
      appendNetworkEvent(this.state, {
        method: response.request().method(),
        url: response.url(),
        status: response.status(),
        failed: false
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
    this.state.breadcrumb = await safeBreadcrumb(this.page, this.state.breadcrumb);
    this.state.toastTexts = await safeToastTexts(this.page, this.state.toastTexts);
    this.state.cartCount = await safeCartCount(this.page, this.state.cartCount);
    this.state.visiblePrices = await safeVisiblePrices(this.page, this.state.visiblePrices);
    this.state.productImages = await safeProductImages(this.page, this.state.productImages);
    this.state.productCards = await safeProductCards(this.page, this.state.productCards);
    this.state.selectedFilters = await safeSelectedFilters(this.page, this.state.selectedFilters);
    this.state.searchQuery = await safeSearchQuery(this.page, this.state.searchQuery);
    this.state.domSignature = await safeDomSignature(this.page, this.state.domSignature);
    appendVisitedUrl(this.state.visitedUrls, currentUrl);
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
    consoleErrors: [],
    networkErrors: [],
    networkEvents: [],
    breadcrumb: [],
    toastTexts: [],
    cartCount: null,
    visiblePrices: [],
    productImages: [],
    productCards: [],
    selectedFilters: [],
    searchQuery: null,
    domSignature: null
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
      bounds: { ...component.bounds }
    })),
    consoleErrors: [...state.consoleErrors],
    networkErrors: [...state.networkErrors],
    networkEvents: state.networkEvents.map((event) => ({ ...event })),
    breadcrumb: [...state.breadcrumb],
    toastTexts: [...state.toastTexts],
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
    cdpSession
  };
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

function appendVisitedUrl(visitedUrls: string[], url: string): void {
  if (visitedUrls[visitedUrls.length - 1] !== url) {
    visitedUrls.push(url);
  }
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

function inferFieldKey(target: TargetDescriptor | undefined, fallback: string): string {
  if (target && typeof target === "object") {
    if (typeof target.label === "string" && target.label.length > 0) {
      return target.label;
    }

    if (Array.isArray(target.label_any) && target.label_any.length > 0) {
      return target.label_any[0];
    }

    if (typeof target.placeholder === "string" && target.placeholder.length > 0) {
      return target.placeholder;
    }

    if (Array.isArray(target.placeholder_any) && target.placeholder_any.length > 0) {
      return target.placeholder_any[0];
    }

    if (typeof target.name === "string" && target.name.length > 0) {
      return target.name;
    }

    if (Array.isArray(target.name_any) && target.name_any.length > 0) {
      return target.name_any[0];
    }

    if (typeof target.selector === "string" && target.selector.length > 0) {
      return target.selector;
    }
  }

  return fallback;
}

function inferGotoUrl(target: TargetDescriptor | undefined, fallbackUrl: string): string {
  if (typeof target === "string") {
    return target;
  }

  if (target && typeof target === "object" && typeof target.url === "string" && target.url.length > 0) {
    return target.url;
  }

  return fallbackUrl;
}

function inferNavigationUrl(currentUrl: string, target: TargetDescriptor | undefined): string | null {
  if (target && typeof target === "object" && typeof target.url === "string") {
    return target.url;
  }

  const targetText = describeTarget(target)?.toLowerCase() ?? "";
  if (targetText.includes("signup") || targetText.includes("회원가입") || targetText.includes("start free")) {
    return new URL("/signup", currentUrl).toString();
  }

  return null;
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

async function safeInteractiveComponents(
  page: Page,
  lastAction: BrowserPageSnapshot["lastAction"],
  fallbackValue: InteractiveComponentObservationItem[]
): Promise<InteractiveComponentObservationItem[]> {
  const clickedTarget = lastAction?.type === "click" ? lastAction.target : null;
  try {
    const mainComponents = await extractInteractiveComponentsFromFrame(page.mainFrame(), clickedTarget, null);
    const frameComponents: InteractiveComponentObservationItem[] = [];

    for (const [index, frame] of page.frames().filter((frame) => frame !== page.mainFrame()).entries()) {
      try {
        frameComponents.push(...await extractInteractiveComponentsFromFrame(frame, clickedTarget, `frame:${index + 1}`));
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
      is_primary_like: index === primaryIndex
    }));
  } catch {
    return fallbackValue;
  }
}

async function extractInteractiveComponentsFromFrame(
  frame: Frame,
  clickedTarget: string | null,
  frameId: string | null
): Promise<InteractiveComponentObservationItem[]> {
  return frame.evaluate(({ clickedTarget, frameId }) => {
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
        if (tag === "input") {
          const type = (element.getAttribute("type") ?? "").toLowerCase();
          return ["button", "submit", "reset"].includes(type) ? "button" : null;
        }
        return null;
      }

      function textFor(element: Element): string {
        const inputValue = element instanceof HTMLInputElement ? element.value : "";
        return [
          element.textContent,
          element.getAttribute("aria-label"),
          element.getAttribute("title"),
          inputValue
        ]
          .find((value) => typeof value === "string" && value.trim().length > 0)
          ?.trim()
          .replaceAll(/\\s+/g, " ")
          .slice(0, 120) ?? "";
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

      function isClickedInScenario(input: { text: string; selector: string | null; role: string | null }): boolean {
        const target = (clickedTarget ?? "").toLowerCase();
        if (!target) {
          return false;
        }
        return Boolean(
          (input.selector && target.includes(input.selector.toLowerCase())) ||
          (input.text && target.includes(input.text.toLowerCase())) ||
          (input.role && target.includes(`role=${input.role.toLowerCase()}`))
        );
      }

      const INTERACTIVE_SELECTOR = "a[href], button, input[type='button'], input[type='submit'], [role='button'], [role='link'], [onclick], [tabindex='0']";

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
          const text = textFor(element);
          const selector = selectorFor(element, tag);
          const href = hrefFor(element, tag);
          const clickable = isClickable(element, tag, role);
          const visible = rect.width > 0 && rect.height > 0 && rect.bottom >= 0 && rect.right >= 0 && rect.top <= viewportHeight && rect.left <= viewportWidth;
          const isCtaCandidate = clickable && Boolean(text.match(CTA_TEXT_PATTERN) || role === "button" || tag === "button");

          return {
            text,
            selector,
            role,
            href,
            frame_id: frameId,
            shadow_root: shadowRoot,
            tag,
            clickable,
            clicked_in_scenario: isClickedInScenario({ text, selector, role }),
            is_cta_candidate: isCtaCandidate,
            is_primary_like: false,
            bounds: {
              x: Math.round(rect.x),
              y: Math.round(rect.y),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
              unit: "css_px" as const
            },
            visible,
            score: (isCtaCandidate ? 1000 : 0) + rect.width * rect.height + (text.match(CTA_TEXT_PATTERN) ? 500 : 0)
          };
        })
        .filter((component) => component.visible && component.clickable && component.bounds.width > 0 && component.bounds.height > 0)
        .sort((left, right) => right.score - left.score)
        .slice(0, 20);

      return components.map((component) => ({
        text: component.text,
        selector: component.selector,
        role: component.role,
        href: component.href,
        frame_id: component.frame_id,
        shadow_root: component.shadow_root,
        tag: component.tag,
        clickable: component.clickable,
        clicked_in_scenario: component.clicked_in_scenario,
        is_cta_candidate: component.is_cta_candidate,
        is_primary_like: false,
        bounds: component.bounds
      }));
    }, { clickedTarget, frameId });
}

function componentScore(component: InteractiveComponentObservationItem): number {
  return (component.is_cta_candidate ? 1_000_000 : 0) +
    component.bounds.width * component.bounds.height +
    (component.frame_id ? 100 : 0);
}
