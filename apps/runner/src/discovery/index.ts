import {
  chromium,
  firefox,
  webkit,
  type BrowserContext,
  type BrowserType,
  type Page,
  type Route
} from "playwright";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import type { CallbackClient } from "../callback/index.ts";
import { preparePageForScreenshot } from "../browser/playwright/screenshot.ts";
import type { RunnerBrowserName, RunnerConfig } from "../config/index.ts";
import type { ArtifactStore } from "../storage/index.ts";
import type {
  ArtifactDraft,
  DiscoveryEntrypointCandidate,
  DiscoveryEntrypointType,
  DiscoveryExecuteMessage,
  DiscoveryEvidenceSignal,
  DiscoveryEvidenceSummary,
  DiscoveryFlowCandidate,
  DiscoveryFlowType,
  DiscoveryScenarioRecommendation,
  SiteDiscoveryResult,
  TargetDescriptorMap
} from "../shared/contracts.ts";
import { executeDiscoveryWithIdempotency } from "./idempotent-execution.ts";
import { executeDiscoveryPersistenceLifecycle } from "./persistence-lifecycle.ts";

export {
  createDiscoveryCheckpointRequests,
  createDiscoveryResultFilePath,
  createDiscoverySummaryPayload,
  writeDiscoveryResult
} from "./persistence-lifecycle.ts";

const DEFAULT_DISCOVERY_LOCALE = "ko-KR";
const DEFAULT_DISCOVERY_TIMEZONE = "Asia/Seoul";
const POST_LOAD_SETTLE_MS = 150;
const DOM_COLLECTION_NAVIGATION_RETRY_COUNT = 2;
const MAX_SHALLOW_NAVIGATION_CANDIDATES = 6;
const SHALLOW_NAVIGATION_TIMEOUT_MS = 1_500;
const MAX_RAW_DISCOVERY_ELEMENTS = 1_500;
const MAX_CLASSIFIED_DISCOVERY_ELEMENTS = 300;

const DISCOVERY_FLOW_ORDER: DiscoveryFlowType[] = [
  "LANDING_CTA",
  "SIGNUP_LEAD_FORM",
  "CONTACT",
  "PRICING",
  "PURCHASE_CHECKOUT"
];

export interface ExecuteDiscoveryInput {
  message: DiscoveryExecuteMessage;
  config: RunnerConfig;
  callbackClient?: CallbackClient;
  artifactStore?: ArtifactStore;
  locale?: string;
  timezone?: string;
}

interface RawDiscoveryElement {
  domIndex: number;
  sourceTagName: string;
  tagName: string;
  role: string | null;
  text: string;
  href: string | null;
  selector: string | null;
  inputType: string | null;
  name: string | null;
  placeholder: string | null;
  ariaLabel: string | null;
  ariaLabelledByText: string | null;
  title: string | null;
  alt: string | null;
  labelText: string | null;
  nearbyText: string | null;
  formText: string | null;
  formFieldText: string | null;
  submitText: string | null;
  visible: boolean;
  inViewport: boolean;
  interactive: boolean;
  linkedImageAlt: boolean;
  editable: boolean;
  hiddenInput: boolean;
  disabled: boolean;
  rankScore: number;
}

interface DiscoveryCandidate {
  entrypointType: DiscoveryEntrypointType;
  flowType: DiscoveryFlowType;
  label: string;
  url: string | null;
  selector: string | null;
  confidence: number;
  reason: string;
  target: TargetDescriptorMap;
  observationType: string;
  observationData: Record<string, unknown>;
  signals: DiscoveryCandidateSignal[];
}

export interface DiscoveryExecutionResult {
  discoveryId: string;
  result: SiteDiscoveryResult;
  resultFile: string;
}

export interface DiscoveryCollectionResult {
  result: SiteDiscoveryResult;
  artifactDraftsByCheckpointId: Map<string, ArtifactDraft[]>;
}

type DiscoveryCandidateSignal = Omit<DiscoveryEvidenceSignal, "signal_id" | "evidence_ref">;
const discoveryIdempotentExecutions = new Map<string, Promise<DiscoveryExecutionResult>>();

export async function executeDiscovery(input: ExecuteDiscoveryInput): Promise<SiteDiscoveryResult> {
  return (await executeDiscoveryForPersistence(input)).result;
}

async function executeDiscoveryForPersistence({
  message,
  config,
  locale = DEFAULT_DISCOVERY_LOCALE,
  timezone = DEFAULT_DISCOVERY_TIMEZONE
}: ExecuteDiscoveryInput): Promise<DiscoveryCollectionResult> {
  const { payload } = message;
  const discoveryDeadlineMs = Date.now() + payload.maxDurationMs;
  const browserType = resolveBrowserType(config.browserName);
  const browser = await browserType.launch({
    headless: config.browserHeadless,
    slowMo: config.playwrightSlowMoMs,
    timeout: config.browserLaunchTimeoutMs
  });

  try {
    const context = await browser.newContext({
      viewport: payload.viewport,
      locale,
      timezoneId: timezone,
      serviceWorkers: "block"
    });
    const page = await context.newPage();
    page.setDefaultNavigationTimeout(Math.min(config.browserNavigationTimeoutMs, remainingBudgetMs(discoveryDeadlineMs, 100)));

    await page.goto(payload.url, {
      waitUntil: "domcontentloaded",
      timeout: remainingBudgetMs(discoveryDeadlineMs, 100)
    });
    await settleWithinBudget(page, discoveryDeadlineMs);

    const candidatesByKey = new Map<string, DiscoveryCandidate>();
    collectUniqueCandidates(candidatesByKey, await collectCandidatesFromStablePage(page, discoveryDeadlineMs));

    for (let index = 0; index < payload.maxScrollCount; index += 1) {
      if (remainingBudgetMs(discoveryDeadlineMs) < POST_LOAD_SETTLE_MS) {
        break;
      }

      await evaluateWithNavigationRetry(page, discoveryDeadlineMs, () => page.evaluate(() => {
        const scope = globalThis as typeof globalThis & {
          innerHeight?: number;
          scrollBy?: (x: number, y: number) => void;
        };
        scope.scrollBy?.(0, Math.max(scope.innerHeight ?? 900, 600));
      }));
      await page.waitForTimeout(POST_LOAD_SETTLE_MS);
      collectUniqueCandidates(candidatesByKey, await collectCandidatesFromStablePage(page, discoveryDeadlineMs));
    }

    const shallowNavigationNotes = await verifyCandidatesWithShallowNavigation(
      context,
      page.url(),
      candidatesByKey,
      discoveryDeadlineMs
    );

    const finalUrl = page.url();
    const title = await page.title().catch(() => "");
    const candidates = [...candidatesByKey.values()].sort(sortCandidates);
    const observations = createCandidateObservations(candidates);
    const evidenceRefByCandidate = new Map<DiscoveryCandidate, string>();
    for (const observation of observations) {
      const candidate = observation.candidate;
      evidenceRefByCandidate.set(candidate, `cp_001.${observation.payload.observation_id}`);
    }

    const detectedFlowTypes = DISCOVERY_FLOW_ORDER.filter((flowType) =>
      candidates.some((candidate) => candidate.flowType === flowType)
    );
    const missingFlowTypes = DISCOVERY_FLOW_ORDER.filter((flowType) => !detectedFlowTypes.includes(flowType));
    const checkpointId = "cp_001";
    const checkpointStepKey = `discovery_${checkpointId}`;
    const artifactDrafts = await createDiscoveryArtifactDrafts(page, checkpointStepKey, payload.viewport);

    return {
      result: {
        schema_version: "0.5",
        discovery_id: payload.discoveryId,
        input_url: payload.url,
        final_url: finalUrl,
        environment: {
          device: payload.devicePreset,
          viewport: payload.viewport,
          locale,
          timezone
        },
        checkpoints: [
          {
            checkpoint_id: checkpointId,
            step_key: checkpointStepKey,
            stage: "FIRST_VIEW",
            state: {
              page: {
                title,
                url: finalUrl,
                ready_state: await readReadyState(page)
              }
            },
            observations: observations.map((observation) => observation.payload),
            artifact_refs: artifactDrafts.map((artifact) => artifact.artifactId)
          }
        ],
        detected_flow_types: detectedFlowTypes,
        missing_flow_types: missingFlowTypes,
        flow_candidates: createFlowCandidates(candidates, evidenceRefByCandidate, missingFlowTypes),
        scenario_recommendations: createScenarioRecommendations(
          candidates,
          evidenceRefByCandidate,
          detectedFlowTypes,
          missingFlowTypes,
          finalUrl
        ),
        collection_notes: [
          `Discovery collected ${candidates.length} candidate(s) after ${payload.maxScrollCount} limited scroll(s).`,
          ...shallowNavigationNotes
        ]
      },
      artifactDraftsByCheckpointId: new Map([[checkpointId, artifactDrafts]])
    };
  } finally {
    await browser.close();
  }
}

export async function executeDiscoveryAndPersist(input: ExecuteDiscoveryInput): Promise<DiscoveryExecutionResult> {
  return executeDiscoveryWithIdempotency({
    config: input.config,
    message: input.message,
    idempotentExecutions: discoveryIdempotentExecutions,
    execute: () => executeDiscoveryPersistenceLifecycle({
      input,
      collect: executeDiscoveryForPersistence
    })
  });
}

async function createDiscoveryArtifactDrafts(
  page: Page,
  stepKey: string,
  viewport: { width: number; height: number }
): Promise<ArtifactDraft[]> {
  await preparePageForScreenshot(page);

  const [screenshotBuffer, domSnapshot] = await Promise.all([
    page.screenshot({ type: "png" }),
    page.content()
  ]);

  return [
    {
      artifactId: randomUUID(),
      artifactType: "SCREENSHOT",
      stepKey,
      mimeType: "image/png",
      fileExtension: "png",
      content: screenshotBuffer.toString("base64"),
      contentEncoding: "base64",
      width: viewport.width,
      height: viewport.height
    },
    {
      artifactId: randomUUID(),
      artifactType: "DOM_SNAPSHOT",
      stepKey,
      mimeType: "text/html",
      fileExtension: "html",
      content: domSnapshot
    }
  ];
}

async function collectCandidatesFromStablePage(page: Page, deadlineMs: number): Promise<DiscoveryCandidate[]> {
  return evaluateWithNavigationRetry(page, deadlineMs, () => collectCandidatesFromPage(page));
}

async function evaluateWithNavigationRetry<T>(
  page: Page,
  deadlineMs: number,
  operation: () => Promise<T>
): Promise<T> {
  let lastNavigationError: unknown;

  for (let attempt = 0; attempt <= DOM_COLLECTION_NAVIGATION_RETRY_COUNT; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isNavigationInterruptedEvaluateError(error) || attempt === DOM_COLLECTION_NAVIGATION_RETRY_COUNT) {
        throw error;
      }

      lastNavigationError = error;
      if (remainingBudgetMs(deadlineMs) < POST_LOAD_SETTLE_MS) {
        throw error;
      }

      await settleWithinBudget(page, deadlineMs);
      await page.waitForTimeout(Math.min(POST_LOAD_SETTLE_MS, remainingBudgetMs(deadlineMs)));
    }
  }

  throw lastNavigationError instanceof Error ? lastNavigationError : new Error(String(lastNavigationError));
}

function isNavigationInterruptedEvaluateError(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase();
  return message.includes("execution context was destroyed")
    || message.includes("most likely because of a navigation")
    || message.includes("cannot find context with specified id");
}

async function collectCandidatesFromPage(page: Page): Promise<DiscoveryCandidate[]> {
  const rawElements = await page.evaluate(({ maxRawElements, maxClassifiedElements }) => {
    type BrowserElement = {
      tagName: string;
      innerText?: string;
      textContent?: string;
      href?: unknown;
      type?: unknown;
      name?: unknown;
      placeholder?: unknown;
      disabled?: unknown;
      className?: unknown;
      getAttribute: (name: string) => string | null;
      closest?: (selector: string) => BrowserElement | null;
      querySelectorAll?: (selector: string) => Iterable<BrowserElement>;
      cloneNode?: (deep: boolean) => BrowserElement;
      remove?: () => void;
      getBoundingClientRect?: () => { x: number; y: number; width: number; height: number; top: number; right: number; bottom: number; left: number };
    };
    const scope = globalThis as typeof globalThis & {
      innerWidth?: number;
      innerHeight?: number;
      document: {
        querySelectorAll: (selector: string) => Iterable<BrowserElement>;
        getElementById?: (id: string) => BrowserElement | null;
      };
      getComputedStyle?: (element: BrowserElement) => {
        display?: string;
        visibility?: string;
        opacity?: string;
      };
      CSS?: {
        escape?: (nextValue: string) => string;
      };
    };
    const candidateSelector = [
      "a",
      "button",
      "input",
      "textarea",
      "select",
      "form",
      "[role='button']",
      "[role='link']",
      "[role='textbox']",
      "[role='searchbox']",
      "[role='combobox']",
      "[href]",
      "[onclick]",
      "[tabindex]",
      "header",
      "main",
      "section",
      "nav",
      "aside",
      "[role='region']",
      "img",
      "label",
      "[aria-label]",
      "[aria-labelledby]",
      "[title]",
      "[id]"
    ].join(", ");
    const elements = collectRankedSeedElements(maxRawElements);
    const nearbyTextByContainer = new WeakMap<BrowserElement, string | null>();
    const formTextByForm = new WeakMap<BrowserElement, string | null>();
    const formFieldTextByForm = new WeakMap<BrowserElement, string | null>();
    const submitTextByForm = new WeakMap<BrowserElement, string | null>();

    return elements.map((element, domIndex): RawDiscoveryElement => {
      const linkedElement = element.closest?.("a");
      const originalTagName = element.tagName.toLowerCase();
      const targetElement = originalTagName === "img" && linkedElement ? linkedElement : element;
      const role = targetElement.getAttribute("role");
      const tagName = targetElement.tagName.toLowerCase();
      const inputType = normalizeFieldType(targetElement, tagName);
      const href = readString(targetElement.href) || targetElement.getAttribute("href") || readString(linkedElement?.href) || linkedElement?.getAttribute("href") || null;
      const text = readSafeRenderedText(element);
      const ariaLabel = normalizeNullableText(element.getAttribute("aria-label"));
      const ariaLabelledByText = readAriaLabelledByText(element);
      const title = normalizeNullableText(element.getAttribute("title"));
      const alt = normalizeNullableText(element.getAttribute("alt"));
      const labelText = readAssociatedLabelText(element);
      const name = readString(targetElement.name) || targetElement.getAttribute("name");
      const placeholder = readString(targetElement.placeholder) || targetElement.getAttribute("placeholder");
      const nearbyText = readNearbyText(element);
      const form = element.closest?.("form") ?? (tagName === "form" ? element : null);
      const formText = form ? readFormText(form) : null;
      const formFieldText = form ? readFormFieldText(form) : null;
      const submitText = form ? readSubmitText(form) : null;
      const visibility = readVisibility(element);
      const interactive = isInteractiveElement(tagName, role, href, targetElement);
      const editable = tagName === "textarea" || tagName === "select" || (tagName === "input" && inputType !== "hidden");
      const hiddenInput = tagName === "input" && inputType === "hidden";
      const disabled = Boolean(element.disabled) || element.getAttribute("aria-disabled") === "true";
      const searchable = [
        text,
        ariaLabel,
        ariaLabelledByText,
        labelText,
        title,
        alt,
        name,
        placeholder,
        href,
        nearbyText,
        formText,
        formFieldText,
        submitText
      ].filter(Boolean).join(" ").toLowerCase();

      return {
        domIndex,
        sourceTagName: originalTagName,
        tagName,
        role,
        text,
        href,
        selector: buildSelector(targetElement),
        inputType,
        name,
        placeholder,
        ariaLabel,
        ariaLabelledByText,
        title,
        alt,
        labelText,
        nearbyText,
        formText,
        formFieldText,
        submitText,
        visible: visibility.visible,
        inViewport: visibility.inViewport,
        interactive,
        linkedImageAlt: originalTagName === "img" && Boolean(linkedElement) && Boolean(alt),
        editable,
        hiddenInput,
        disabled,
        rankScore: rankElement({
          tagName,
          role,
          searchable,
          visible: visibility.visible,
          inViewport: visibility.inViewport,
          interactive,
          editable,
          hiddenInput,
          disabled,
          area: visibility.area,
          domIndex
        })
      };
    })
      .sort((left, right) => right.rankScore - left.rankScore || left.domIndex - right.domIndex)
      .slice(0, maxClassifiedElements);

    function normalizeBrowserText(value: unknown): string {
      if (typeof value !== "string") {
        return "";
      }
      return value.replace(/\s+/g, " ").trim().slice(0, 160);
    }

    function normalizeNullableText(value: unknown): string | null {
      const normalized = normalizeBrowserText(value ?? "");
      return normalized || null;
    }

    function readString(value: unknown): string | null {
      return typeof value === "string" && value.length > 0 ? value : null;
    }

    function readVisibility(element: BrowserElement): { visible: boolean; inViewport: boolean; area: number } {
      const rect = element.getBoundingClientRect?.();
      if (!rect) {
        return { visible: false, inViewport: false, area: 0 };
      }

      const area = rect.width * rect.height;
      const style = scope.getComputedStyle?.(element);
      const opacity = Number(style?.opacity ?? "1");
      const visible = rect.width > 0
        && rect.height > 0
        && style?.display !== "none"
        && style?.visibility !== "hidden"
        && opacity > 0;
      const viewportWidth = scope.innerWidth ?? 0;
      const viewportHeight = scope.innerHeight ?? 0;
      const inViewport = Boolean(visible && rect
        && rect.bottom >= 0
        && rect.right >= 0
        && rect.top <= viewportHeight
        && rect.left <= viewportWidth);

      return { visible, inViewport, area };
    }

    function readNearbyText(element: BrowserElement): string | null {
      const container = element.closest?.("form, section, header, nav, aside, [role='region']");
      if (!container || container === element) {
        return null;
      }

      const cached = nearbyTextByContainer.get(container);
      if (cached !== undefined) {
        return cached;
      }

      const text = normalizeNullableText(readSafeRenderedText(container));
      nearbyTextByContainer.set(container, text);
      return text;
    }

    function readFormText(form: BrowserElement): string | null {
      const cached = formTextByForm.get(form);
      if (cached !== undefined) {
        return cached;
      }

      const text = normalizeNullableText(readSafeRenderedText(form));
      formTextByForm.set(form, text);
      return text;
    }

    function readFormFieldText(form: BrowserElement): string | null {
      const cached = formFieldTextByForm.get(form);
      if (cached !== undefined) {
        return cached;
      }

      const fields = [...(form.querySelectorAll?.("input, textarea, select") ?? [])]
        .filter((field) => readString(field.type) !== "hidden")
        .map((field) => [
          normalizeFieldType(field, field.tagName.toLowerCase()),
          readString(field.name) || field.getAttribute("name"),
          readString(field.placeholder) || field.getAttribute("placeholder"),
          readAssociatedLabelText(field),
          readSelectOptionText(field)
        ].filter(Boolean).join(" "))
        .filter(Boolean)
        .join(" ");

      const text = normalizeNullableText(fields);
      formFieldTextByForm.set(form, text);
      return text;
    }

    function normalizeFieldType(element: BrowserElement, tagName: string): string | null {
      if (tagName === "select") {
        return "select";
      }
      if (tagName === "textarea") {
        return "textarea";
      }
      return readString(element.type);
    }

    function readSelectOptionText(element: BrowserElement): string | null {
      if (element.tagName.toLowerCase() !== "select") {
        return null;
      }

      const options = [...(element.querySelectorAll?.("option") ?? [])]
        .map((option) => normalizeBrowserText(option.textContent || option.getAttribute("label") || option.getAttribute("value") || ""))
        .filter(Boolean)
        .slice(0, 5)
        .join(" ");

      return normalizeNullableText(options);
    }

    function readSubmitText(form: BrowserElement): string | null {
      const cached = submitTextByForm.get(form);
      if (cached !== undefined) {
        return cached;
      }

      const submitControls = [...(form.querySelectorAll?.("button, input[type='submit'], [role='button']") ?? [])]
        .map((control) => normalizeBrowserText(readSafeRenderedText(control) || control.getAttribute("aria-label") || control.getAttribute("title") || control.getAttribute("name") || ""))
        .filter(Boolean)
        .join(" ");

      const text = normalizeNullableText(submitControls);
      submitTextByForm.set(form, text);
      return text;
    }

    function isInteractiveElement(tagName: string, role: string | null, href: string | null, element: BrowserElement): boolean {
      return isActionSeedElement(tagName, role, href, element);
    }

    function collectRankedSeedElements(maxElements: number): BrowserElement[] {
      const flowKeywords = [
        "get started", "sign up", "signup", "register", "free", "trial", "start",
        "contact", "demo", "sales", "pricing", "price", "plan", "checkout", "payment", "billing", "purchase", "cart",
        "시작", "회원가입", "가입", "무료", "체험", "문의", "상담", "데모", "요금", "가격", "플랜", "결제", "구매", "장바구니"
      ];
      const priorityBuckets: BrowserElement[][] = [[], [], [], []];
      const allElements = Array.from(scope.document.querySelectorAll(candidateSelector)) as unknown as BrowserElement[];

      for (const element of allElements) {
        const tagName = element.tagName.toLowerCase();
        const role = element.getAttribute("role");
        const href = readString(element.href) || element.getAttribute("href");
        const seedText = readSeedText(element, tagName);
        if (hasAnyText(seedText, flowKeywords)) {
          priorityBuckets[0].push(element);
        } else if (isActionSeedElement(tagName, role, href, element)) {
          priorityBuckets[1].push(element);
        } else if (isStructuralSeedElement(tagName, role)) {
          priorityBuckets[2].push(element);
        } else {
          priorityBuckets[3].push(element);
        }
      }

      const selected: BrowserElement[] = [];
      const seen = new Set<BrowserElement>();
      const quotas = bucketQuotas(maxElements);
      for (const [bucketIndex, bucket] of priorityBuckets.entries()) {
        for (const element of bucket.slice(0, quotas[bucketIndex])) {
          if (seen.has(element)) {
            continue;
          }
          seen.add(element);
          selected.push(element);
          if (selected.length >= maxElements) {
            return selected;
          }
        }
      }

      for (const bucket of priorityBuckets) {
        for (const element of bucket) {
          if (seen.has(element)) {
            continue;
          }
          seen.add(element);
          selected.push(element);
          if (selected.length >= maxElements) {
            return selected;
          }
        }
      }

      return selected;
    }

    function bucketQuotas(maxElements: number): number[] {
      const keywordQuota = Math.floor(maxElements * 0.35);
      const actionQuota = Math.floor(maxElements * 0.35);
      const structuralQuota = Math.floor(maxElements * 0.2);
      return [keywordQuota, actionQuota, structuralQuota, maxElements - keywordQuota - actionQuota - structuralQuota];
    }

    function readSeedText(element: BrowserElement, tagName: string): string {
      const renderedText = readSafeRenderedText(element);
      return [
        renderedText,
        element.getAttribute("aria-label"),
        element.getAttribute("aria-labelledby"),
        element.getAttribute("title"),
        element.getAttribute("alt"),
        element.getAttribute("name"),
        element.getAttribute("placeholder"),
        readString(element.href) || element.getAttribute("href")
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
    }

    function isActionSeedElement(tagName: string, role: string | null, href: string | null, element: BrowserElement): boolean {
      return tagName === "a"
        || tagName === "button"
        || tagName === "input"
        || tagName === "textarea"
        || tagName === "select"
        || tagName === "form"
        || role === "button"
        || role === "link"
        || role === "textbox"
        || role === "searchbox"
        || role === "combobox"
        || Boolean(href)
        || element.getAttribute("onclick") !== null;
    }

    function isEditableSeedElement(tagName: string): boolean {
      return tagName === "input" || tagName === "textarea" || tagName === "select";
    }

    function readSafeRenderedText(element: BrowserElement): string {
      const tagName = element.tagName.toLowerCase();
      if (isEditableSeedElement(tagName)) {
        return "";
      }

      const clone = element.cloneNode?.(true);
      if (clone) {
        for (const field of clone.querySelectorAll?.("input, textarea, select") ?? []) {
          field.remove?.();
        }
        return normalizeBrowserText(clone.innerText || clone.textContent || "");
      }

      return "";
    }

    function isStructuralSeedElement(tagName: string, role: string | null): boolean {
      return tagName === "header"
        || tagName === "main"
        || tagName === "section"
        || tagName === "nav"
        || tagName === "aside"
        || tagName === "img"
        || tagName === "label"
        || role === "region";
    }

    function rankElement(input: {
      tagName: string;
      role: string | null;
      searchable: string;
      visible: boolean;
      inViewport: boolean;
      interactive: boolean;
      editable: boolean;
      hiddenInput: boolean;
      disabled: boolean;
      area: number;
      domIndex: number;
    }): number {
      let score = 0;
      if (input.visible) {
        score += 30;
      }
      if (input.inViewport) {
        score += 30;
      }
      if (input.interactive) {
        score += 20;
      }
      if (input.editable) {
        score += 15;
      }
      if (input.tagName === "form") {
        score += 12;
      }
      if (input.area > 900) {
        score += 8;
      }
      if (hasAnyText(input.searchable, [
        "get started", "sign up", "signup", "register", "free", "trial", "start",
        "contact", "demo", "sales", "pricing", "price", "plan", "checkout", "payment", "billing", "purchase", "cart",
        "시작", "회원가입", "가입", "무료", "체험", "문의", "상담", "데모", "요금", "가격", "플랜", "결제", "구매", "장바구니"
      ])) {
        score += 25;
      }
      if (input.role === "button" || input.role === "link" || input.role === "textbox" || input.role === "searchbox" || input.role === "combobox") {
        score += 8;
      }
      if (input.hiddenInput) {
        score -= 80;
      }
      if (input.disabled) {
        score -= 20;
      }
      if (hasAnyText(input.searchable, ["바로가기", "skip to", "전체삭제"])) {
        score -= 20;
      }

      return score - Math.min(input.domIndex, 1_000) / 10_000;
    }

    function hasAnyText(value: string, keywords: string[]): boolean {
      return keywords.some((keyword) => value.includes(keyword));
    }

    function readAriaLabelledByText(element: BrowserElement): string | null {
      const ids = (element.getAttribute("aria-labelledby") ?? "").split(/\s+/).filter(Boolean);
      const text = ids
        .map((id) => {
          const labelElement = scope.document.getElementById?.(id) as BrowserElement | null | undefined;
          return labelElement ? readSafeRenderedText(labelElement) : "";
        })
        .join(" ");
      return normalizeNullableText(text);
    }

    function readAssociatedLabelText(element: BrowserElement): string | null {
      const tagName = element.tagName.toLowerCase();
      if (tagName === "label") {
        return normalizeNullableText(readSafeRenderedText(element));
      }

      const wrappingLabel = element.closest?.("label");
      if (wrappingLabel) {
        return normalizeNullableText(readSafeRenderedText(wrappingLabel));
      }

      const id = element.getAttribute("id");
      if (!id) {
        return null;
      }

      const text = (Array.from(scope.document.querySelectorAll(`label[for="${cssStringEscape(id)}"]`)) as unknown as BrowserElement[])
        .map((label) => readSafeRenderedText(label))
        .join(" ");
      return normalizeNullableText(text);
    }

    function buildSelector(element: BrowserElement): string | null {
      const tagName = element.tagName.toLowerCase();
      const id = element.getAttribute("id");
      if (id) {
        return `#${cssEscape(id)}`;
      }

      const testId = element.getAttribute("data-testid");
      if (testId) {
        return `[data-testid="${cssStringEscape(testId)}"]`;
      }

      const name = element.getAttribute("name");
      if (name) {
        return `${tagName}[name="${cssStringEscape(name)}"]`;
      }

      const href = element.getAttribute("href");
      if (href) {
        return `${tagName}[href="${cssStringEscape(href)}"]`;
      }

      const className = typeof element.className === "string" ? element.className.trim().split(/\s+/)[0] : "";
      if (className) {
        return `${tagName}.${cssEscape(className)}`;
      }

      return tagName;
    }

    function cssEscape(value: string): string {
      const css = scope.CSS;
      return css?.escape ? css.escape(value) : value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
    }

    function cssStringEscape(value: string): string {
      return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    }
  }, {
    maxRawElements: MAX_RAW_DISCOVERY_ELEMENTS,
    maxClassifiedElements: MAX_CLASSIFIED_DISCOVERY_ELEMENTS
  });

  return rawElements.flatMap(toDiscoveryCandidates);
}

async function verifyCandidatesWithShallowNavigation(
  context: BrowserContext,
  baseUrl: string,
  candidatesByKey: Map<string, DiscoveryCandidate>,
  deadlineMs: number
): Promise<string[]> {
  const unsafeElementKeys = new Set(
    [...candidatesByKey.values()]
      .filter(isUnsafeShallowNavigationCandidate)
      .map(candidateElementKey)
  );
  const candidates = [...candidatesByKey.values()]
    .filter((candidate) => isShallowNavigationCandidate(baseUrl, candidate, unsafeElementKeys))
    .sort(sortCandidates)
    .slice(0, MAX_SHALLOW_NAVIGATION_CANDIDATES);
  const notes: string[] = [];

  for (const candidate of candidates) {
    const targetUrl = candidate.url;
    if (!targetUrl) {
      continue;
    }

    const remainingMs = deadlineMs - Date.now();
    if (remainingMs < 500) {
      notes.push("Shallow navigation stopped because the discovery time budget was exhausted.");
      break;
    }

    const navigationTimeoutMs = Math.min(SHALLOW_NAVIGATION_TIMEOUT_MS, remainingMs);
    const preflight = await preflightShallowNavigationTarget(baseUrl, targetUrl, navigationTimeoutMs);
    if (!preflight.safe) {
      notes.push(`Shallow navigation blocked unsafe redirect for ${candidate.flowType} candidate "${candidate.label}".`);
      continue;
    }

    const postPreflightRemainingMs = deadlineMs - Date.now();
    if (postPreflightRemainingMs < 500) {
      notes.push("Shallow navigation stopped because the discovery time budget was exhausted.");
      break;
    }

    const postPreflightNavigationTimeoutMs = Math.min(SHALLOW_NAVIGATION_TIMEOUT_MS, postPreflightRemainingMs);
    const page = await context.newPage();
    const removeRequestGuard = await installShallowNavigationRequestGuard(context, page, baseUrl);
    try {
      page.setDefaultNavigationTimeout(postPreflightNavigationTimeoutMs);
      await page.goto(targetUrl, {
        waitUntil: "domcontentloaded",
        timeout: postPreflightNavigationTimeoutMs
      });
      await settleWithinBudget(page, deadlineMs);

      const finalUrl = page.url();
      if (!isSafeShallowNavigationUrl(baseUrl, finalUrl)) {
        notes.push(`Shallow navigation blocked unsafe destination for ${candidate.flowType} candidate "${candidate.label}".`);
        continue;
      }

      const destinationCandidates = await collectCandidatesFromStablePage(page, deadlineMs);
      const verified = isFlowVerifiedByDestination(candidate.flowType, destinationCandidates, finalUrl);
      if (verified) {
        markCandidateShallowVerified(candidate, finalUrl, await page.title().catch(() => ""));
      }
    } catch (error) {
      notes.push(`Shallow navigation skipped ${candidate.flowType} candidate "${candidate.label}": ${errorMessage(error)}.`);
    } finally {
      await removeRequestGuard();
      await page.close().catch(() => undefined);
    }
  }

  return notes;
}

async function preflightShallowNavigationTarget(
  baseUrl: string,
  targetUrl: string,
  timeoutMs: number
): Promise<{ safe: boolean }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(100, timeoutMs));

  try {
    const response = await fetch(targetUrl, {
      method: "HEAD",
      redirect: "manual",
      signal: controller.signal
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        return { safe: false };
      }

      return { safe: isSafeShallowNavigationUrl(baseUrl, new URL(location, targetUrl).toString()) };
    }

    return { safe: isSafeShallowNavigationUrl(baseUrl, response.url || targetUrl) };
  } catch {
    return { safe: isSafeShallowNavigationUrl(baseUrl, targetUrl) };
  } finally {
    clearTimeout(timeout);
  }
}

async function installShallowNavigationRequestGuard(
  context: BrowserContext,
  page: Page,
  baseUrl: string
): Promise<() => Promise<void>> {
  const guard = async (route: Route): Promise<void> => {
    const request = route.request();
    if (request.frame().page() !== page) {
      await route.continue().catch(() => undefined);
      return;
    }

    const method = request.method().toUpperCase();
    const requestUrl = request.url();

    if ((method !== "GET" && method !== "HEAD") || !isSafeShallowNavigationUrl(baseUrl, requestUrl)) {
      await route.abort("blockedbyclient").catch(() => undefined);
      return;
    }

    await route.continue().catch(() => undefined);
  };

  await context.route("**/*", guard);
  return () => context.unroute("**/*", guard).catch(() => undefined);
}

function isShallowNavigationCandidate(
  baseUrl: string,
  candidate: DiscoveryCandidate,
  unsafeElementKeys: Set<string>
): boolean {
  if (!candidate.url || !candidate.selector) {
    return false;
  }

  if (unsafeElementKeys.has(candidateElementKey(candidate))) {
    return false;
  }

  if (isUnsafeShallowNavigationCandidate(candidate)) {
    return false;
  }

  return isSameSiteNavigation(baseUrl, candidate.url);
}

function isUnsafeShallowNavigationCandidate(candidate: DiscoveryCandidate): boolean {
  return candidate.flowType === "PURCHASE_CHECKOUT"
    || isUnsafeNavigationText(candidate.label)
    || isUnsafeNavigationText(candidate.url ?? "")
    || isUnsafeNavigationText(String(candidate.target.href_contains ?? ""));
}

function isSafeShallowNavigationUrl(baseUrl: string, nextUrl: string): boolean {
  return isSameSiteNavigation(baseUrl, nextUrl) && !isUnsafeNavigationText(nextUrl);
}

function isFlowVerifiedByDestination(
  flowType: DiscoveryFlowType,
  destinationCandidates: DiscoveryCandidate[],
  destinationUrl: string
): boolean {
  const searchableUrl = normalizeSearchText(destinationUrl);
  if (flowType === "LANDING_CTA") {
    return destinationCandidates.length > 0 || hasAny(searchableUrl, ["signup", "start", "trial", "demo", "contact"]);
  }

  if (flowType === "CONTACT") {
    return destinationCandidates.some((candidate) =>
      candidate.flowType === "CONTACT" || candidate.flowType === "SIGNUP_LEAD_FORM"
    ) || hasAny(searchableUrl, ["contact", "demo", "sales", "상담", "문의"]);
  }

  if (flowType === "SIGNUP_LEAD_FORM") {
    return destinationCandidates.some((candidate) => candidate.flowType === "SIGNUP_LEAD_FORM")
      || hasAny(searchableUrl, ["signup", "register", "trial", "가입"]);
  }

  if (flowType === "PRICING") {
    return destinationCandidates.some((candidate) => candidate.flowType === "PRICING")
      || hasAny(searchableUrl, ["pricing", "plans", "price", "요금", "가격"]);
  }

  return false;
}

function markCandidateShallowVerified(candidate: DiscoveryCandidate, verifiedUrl: string, title: string): void {
  candidate.confidence = Math.min(0.95, candidate.confidence + 0.08);
  candidate.reason = `${candidate.reason} Shallow navigation verified a relevant destination.`;
  candidate.signals = [
    ...candidate.signals,
    signal("shallow_navigation", `${candidate.flowType.toLowerCase()}_destination_verified`, verifiedUrl, 0.2)
  ];
  candidate.observationData = {
    ...candidate.observationData,
    shallow_navigation: {
      status: "verified",
      destination_url: verifiedUrl,
      title
    }
  };
}

function matchedSignalsFor(flowType: DiscoveryFlowType, raw: RawDiscoveryElement, searchable: string): DiscoveryCandidateSignal[] {
  const signals: DiscoveryCandidateSignal[] = [];
  const textSources: Array<[DiscoveryEvidenceSignal["source"], string | null, boolean?]> = [
    ["text", raw.text, false],
    ["text", raw.nearbyText, true],
    ["text", raw.formText, true],
    ["aria_label", raw.ariaLabel],
    ["aria_labelled_by_text", raw.ariaLabelledByText],
    ["label_text", raw.labelText],
    ["alt", raw.alt],
    ["title", raw.title],
    ["placeholder", raw.placeholder],
    ["name", raw.name]
  ];
  const keywords = keywordsFor(flowType);

  for (const [source, value, snippetOnly = false] of textSources) {
    const normalized = normalizeSearchText(value ?? "");
    if (value && hasAny(normalized, keywords)) {
      signals.push(signal(source, signalTypeFor(flowType, "keyword"), snippetOnly ? matchedSnippet(value, keywords) : value, 0.3));
    }
  }

  if (raw.href && hasAny(normalizeSearchText(raw.href), keywords)) {
    signals.push(signal("href", signalTypeFor(flowType, "url"), toHrefContains(raw.href) ?? raw.href, 0.2));
  }

  if (raw.selector && hasAny(normalizeSearchText(raw.selector), keywords)) {
    signals.push(signal("selector", signalTypeFor(flowType, "selector"), raw.selector, 0.1));
  }

  if (raw.linkedImageAlt && raw.selector) {
    signals.push(signal("selector", signalTypeFor(flowType, "linked_image_parent"), raw.selector, 0.15));
  }

  if (flowType === "SIGNUP_LEAD_FORM" && (
    raw.inputType === "email" ||
    raw.editable ||
    hasAny(searchable, signupFormFieldKeywords())
  )) {
    signals.push(signal("form_field", "lead_form_field", raw.formFieldText || raw.placeholder || raw.name || raw.inputType || "form field", 0.25));
  }

  if ((flowType === "CONTACT" || flowType === "PURCHASE_CHECKOUT") && raw.submitText && hasAny(normalizeSearchText(raw.submitText), keywords)) {
    signals.push(signal("form_field", signalTypeFor(flowType, "submit"), raw.submitText, 0.2));
  }

  return dedupeSignals(signals);
}

function keywordsFor(flowType: DiscoveryFlowType): string[] {
  switch (flowType) {
    case "LANDING_CTA":
      return ["get started", "sign up", "signup", "register", "free", "trial", "start", "시작", "회원가입", "가입", "무료", "체험"];
    case "SIGNUP_LEAD_FORM":
      return signupFormKeywords();
    case "CONTACT":
      return ["contact", "contact us", "contact sales", "talk to sales", "book a demo", "request demo", "schedule demo", "demo", "sales", "문의", "상담", "데모", "영업"];
    case "PRICING":
      return ["pricing", "price", "plan", "starter", "요금", "가격", "플랜"];
    case "PURCHASE_CHECKOUT":
      return checkoutActionKeywords();
    default:
      return [];
  }
}

function signalTypeFor(flowType: DiscoveryFlowType, suffix: string): string {
  return `${flowType.toLowerCase()}_${suffix}`;
}

function matchedSnippet(value: string, keywords: string[]): string {
  const normalizedValue = normalizeSearchText(value);
  const matchedKeyword = keywords.find((keyword) => normalizedValue.includes(keyword));
  if (!matchedKeyword) {
    return normalizeText(value).slice(0, 80);
  }

  const lowerValue = value.toLowerCase();
  const keywordIndex = lowerValue.indexOf(matchedKeyword.toLowerCase());
  if (keywordIndex < 0) {
    return matchedKeyword;
  }

  const contextSize = 32;
  const start = Math.max(0, keywordIndex - contextSize);
  const end = Math.min(value.length, keywordIndex + matchedKeyword.length + contextSize);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < value.length ? "…" : "";
  return normalizeText(`${prefix}${value.slice(start, end)}${suffix}`).slice(0, 100);
}

function signal(source: DiscoveryEvidenceSignal["source"], signalType: string, value: string, weight: number): DiscoveryCandidateSignal {
  return {
    source,
    signal_type: signalType,
    value: normalizeText(value).slice(0, 160),
    weight
  };
}

function dedupeSignals(signals: DiscoveryCandidateSignal[]): DiscoveryCandidateSignal[] {
  const byKey = new Map<string, DiscoveryCandidateSignal>();
  for (const nextSignal of signals) {
    const key = `${nextSignal.source}|${nextSignal.signal_type}|${nextSignal.value}`;
    if (!byKey.has(key)) {
      byKey.set(key, nextSignal);
    }
  }
  return [...byKey.values()];
}

function toDiscoveryCandidates(raw: RawDiscoveryElement): DiscoveryCandidate[] {
  if (raw.hiddenInput || raw.disabled) {
    return [];
  }

  const label = normalizeText(
    raw.text
      || raw.ariaLabel
      || raw.ariaLabelledByText
      || raw.labelText
      || raw.alt
      || raw.title
      || raw.placeholder
      || raw.name
      || raw.href
      || raw.selector
      || raw.tagName
  );
  if (!label) {
    return [];
  }

  const searchable = normalizeSearchText([
    label,
    raw.href,
    raw.selector,
    raw.name,
    raw.placeholder,
    raw.ariaLabel,
    raw.ariaLabelledByText,
    raw.labelText,
    raw.alt,
    raw.title,
    raw.nearbyText,
    raw.formText,
    raw.formFieldText,
    raw.submitText
  ].filter(isString).join(" "));
  const candidates: DiscoveryCandidate[] = [];

  if (isLandingCta(raw, searchable)) {
    candidates.push(createCandidate(raw, {
      entrypointType: isSignupLike(searchable) ? "signup" : "cta",
      flowType: "LANDING_CTA",
      label,
      confidence: landingCtaConfidence(raw, searchable),
      reason: "Primary-like CTA candidate was found.",
      observationType: "cta_candidate",
      signals: matchedSignalsFor("LANDING_CTA", raw, searchable)
    }));
  }

  if (isSignupForm(raw, searchable)) {
    candidates.push(createCandidate(raw, {
      entrypointType: "form",
      flowType: "SIGNUP_LEAD_FORM",
      label,
      confidence: signupFormConfidence(raw, searchable),
      reason: "Signup or lead form candidate was found.",
      observationType: "form_candidate",
      signals: matchedSignalsFor("SIGNUP_LEAD_FORM", raw, searchable)
    }));
  }

  if (isContactCandidate(raw, searchable)) {
    candidates.push(createCandidate(raw, {
      entrypointType: "contact",
      flowType: "CONTACT",
      label,
      confidence: isDemoOrSalesLike(searchable) ? 0.86 : 0.74,
      reason: "Contact, consultation, or demo request candidate was found.",
      observationType: "contact_candidate",
      signals: matchedSignalsFor("CONTACT", raw, searchable)
    }));
  }

  if (isPricingCandidate(raw, searchable)) {
    candidates.push(createCandidate(raw, {
      entrypointType: "pricing",
      flowType: "PRICING",
      label,
      confidence: searchable.includes("pricing") || searchable.includes("요금") || searchable.includes("가격") ? 0.82 : 0.68,
      reason: "Pricing entrypoint candidate was found.",
      observationType: "pricing_candidate",
      signals: matchedSignalsFor("PRICING", raw, searchable)
    }));
  }

  if (isCheckoutCandidate(raw, searchable)) {
    candidates.push(createCandidate(raw, {
      entrypointType: "checkout",
      flowType: "PURCHASE_CHECKOUT",
      label,
      confidence: checkoutConfidence(raw, searchable),
      reason: "Checkout or payment entrypoint candidate was found.",
      observationType: "checkout_candidate",
      signals: matchedSignalsFor("PURCHASE_CHECKOUT", raw, searchable)
    }));
  }

  return candidates;
}

function createCandidate(
  raw: RawDiscoveryElement,
  input: {
    entrypointType: DiscoveryEntrypointType;
    flowType: DiscoveryFlowType;
    label: string;
    confidence: number;
    reason: string;
    observationType: string;
    signals: DiscoveryCandidateSignal[];
  }
): DiscoveryCandidate {
  const role = resolveTargetRole(raw, input.entrypointType);
  const target: TargetDescriptorMap = {};
  if (role) {
    target.role = role;
  }
  if (input.label) {
    target.text = input.label;
  }
  if (raw.selector) {
    target.selector = raw.selector;
  }
  const hrefContains = toHrefContains(raw.href);
  if (hrefContains) {
    target.href_contains = hrefContains;
  }
  if (raw.placeholder) {
    target.placeholder = raw.placeholder;
  }
  if (raw.name) {
    target.name = raw.name;
  }

  return {
    entrypointType: input.entrypointType,
    flowType: input.flowType,
    label: input.label,
    url: raw.href,
    selector: raw.selector,
    confidence: input.confidence,
    reason: input.reason,
    target,
    observationType: input.observationType,
    signals: input.signals,
    observationData: {
      text: input.label,
      href: raw.href,
      selector: raw.selector,
      source_tag_name: raw.sourceTagName,
      linked_image_alt: raw.linkedImageAlt,
      role,
      name: raw.name,
      placeholder: raw.placeholder,
      input_type: raw.inputType,
      aria_label: raw.ariaLabel,
      aria_labelled_by_text: raw.ariaLabelledByText,
      label_text: raw.labelText,
      alt: raw.alt,
      title: raw.title,
      field_type: raw.inputType,
      form_field_text: raw.formFieldText,
      submit_text: raw.submitText,
      editable: raw.editable,
      disabled: raw.disabled
    }
  };
}

function createCandidateObservations(candidates: DiscoveryCandidate[]): Array<{
  candidate: DiscoveryCandidate;
  payload: Record<string, unknown>;
}> {
  return candidates.map((candidate, index) => ({
    candidate,
    payload: {
      observation_id: `obs_${String(index + 1).padStart(3, "0")}`,
      type: candidate.observationType,
      stage: resolveObservationStage(candidate.flowType),
      source: ["dom", "discovery"],
      data: candidate.observationData,
      confidence: candidate.confidence
    }
  }));
}

function createFlowCandidates(
  candidates: DiscoveryCandidate[],
  evidenceRefByCandidate: Map<DiscoveryCandidate, string>,
  missingFlowTypes: DiscoveryFlowType[]
): DiscoveryFlowCandidate[] {
  const detected = DISCOVERY_FLOW_ORDER.flatMap((flowType) => {
    const flowCandidates = candidates.filter((candidate) => candidate.flowType === flowType).slice(0, 5);
    if (flowCandidates.length === 0) {
      return [];
    }

    return [{
      flow_type: flowType,
      confidence: maxConfidence(flowCandidates),
      evidence_refs: evidenceRefsFor(flowCandidates, evidenceRefByCandidate),
      entrypoint_candidates: flowCandidates.map((candidate) => toEntrypointCandidate(candidate, evidenceRefByCandidate)),
      reason: flowCandidates[0]?.reason ?? "Discovery candidate was found."
    }];
  });

  const missing = missingFlowTypes.map((flowType): DiscoveryFlowCandidate => ({
    flow_type: flowType,
    confidence: 0.12,
    evidence_refs: [],
    entrypoint_candidates: [],
    reason: `No ${flowType.toLowerCase()} entrypoint was found during lightweight discovery.`
  }));

  return [...detected, ...missing];
}

function createScenarioRecommendations(
  candidates: DiscoveryCandidate[],
  evidenceRefByCandidate: Map<DiscoveryCandidate, string>,
  detectedFlowTypes: DiscoveryFlowType[],
  missingFlowTypes: DiscoveryFlowType[],
  finalUrl: string
): DiscoveryScenarioRecommendation[] {
  const detected = detectedFlowTypes.map((flowType): DiscoveryScenarioRecommendation => {
    const flowCandidates = candidates.filter((candidate) => candidate.flowType === flowType).sort(sortCandidates);
    const primaryCandidate = flowCandidates[0];
    return {
      scenario_type: flowType,
      recommendation_level: recommendationLevel(primaryCandidate?.confidence ?? 0),
      confidence: primaryCandidate?.confidence ?? 0,
      reason: primaryCandidate?.reason ?? `${flowType} candidate was detected.`,
      evidence_refs: evidenceRefsFor(flowCandidates.slice(0, 3), evidenceRefByCandidate),
      evidence_summary: evidenceSummaryFor(flowType, flowCandidates.slice(0, 3), evidenceRefByCandidate),
      suggested_start_url: finalUrl,
      suggested_target: primaryCandidate?.target ?? null
    };
  });

  const missing = missingFlowTypes.map((flowType): DiscoveryScenarioRecommendation => ({
    scenario_type: flowType,
    recommendation_level: "NOT_AVAILABLE",
    confidence: 0,
    reason: `No ${flowType.toLowerCase()} entrypoint was detected.`,
    evidence_refs: [],
    evidence_summary: evidenceSummaryFor(flowType, [], evidenceRefByCandidate),
    suggested_start_url: null,
    suggested_target: null
  }));

  return [...detected, ...missing];
}

function toEntrypointCandidate(
  candidate: DiscoveryCandidate,
  evidenceRefByCandidate: Map<DiscoveryCandidate, string>
): DiscoveryEntrypointCandidate {
  return {
    entrypoint_type: candidate.entrypointType,
    label: candidate.label,
    url: candidate.url,
    selector: candidate.selector,
    confidence: candidate.confidence,
    evidence_refs: evidenceRefsFor([candidate], evidenceRefByCandidate)
  };
}

function evidenceSummaryFor(
  flowType: DiscoveryFlowType,
  candidates: DiscoveryCandidate[],
  evidenceRefByCandidate: Map<DiscoveryCandidate, string>
): DiscoveryEvidenceSummary {
  let signalIndex = 0;
  const matchedSignals = candidates.flatMap((candidate) => {
    const evidenceRef = evidenceRefByCandidate.get(candidate) ?? null;
    return candidate.signals.map((candidateSignal) => ({
      ...candidateSignal,
      signal_id: `sig_${String((signalIndex += 1)).padStart(3, "0")}`,
      evidence_ref: evidenceRef
    }));
  });

  return {
    matched_signals: matchedSignals,
    missing_signals: missingSignalsFor(flowType, candidates),
    limitations: [
      "image_text_ocr_not_performed",
      "authenticated_pages_not_explored"
    ]
  };
}

function missingSignalsFor(flowType: DiscoveryFlowType, candidates: DiscoveryCandidate[]): string[] {
  if (candidates.length === 0) {
    return [`no_${flowType.toLowerCase()}_entrypoint_detected`];
  }

  if (flowType === "SIGNUP_LEAD_FORM" || flowType === "CONTACT") {
    return ["safe_submit_boundary_not_verified"];
  }

  if (flowType === "PURCHASE_CHECKOUT") {
    return ["safe_payment_boundary_not_verified"];
  }

  return [];
}

function collectUniqueCandidates(
  candidatesByKey: Map<string, DiscoveryCandidate>,
  nextCandidates: DiscoveryCandidate[]
): void {
  for (const candidate of nextCandidates) {
    const key = [candidate.flowType, candidate.entrypointType, candidate.url, candidate.selector, candidate.label].join("|");
    const existing = candidatesByKey.get(key);
    if (!existing || candidate.confidence > existing.confidence) {
      candidatesByKey.set(key, candidate);
    }
  }
}

function sortCandidates(left: DiscoveryCandidate, right: DiscoveryCandidate): number {
  return right.confidence - left.confidence || left.label.localeCompare(right.label);
}

function landingCtaConfidence(raw: RawDiscoveryElement, searchable: string): number {
  if (raw.href && isPrimaryLike(searchable)) {
    return 0.88;
  }

  if (raw.href) {
    return 0.78;
  }

  return isPrimaryLike(searchable) ? 0.76 : 0.68;
}

function signupFormConfidence(raw: RawDiscoveryElement, searchable: string): number {
  if (raw.inputType === "email") {
    return 0.88;
  }

  if (raw.tagName === "select" && hasAny(searchable, ["email", "work email", "company", "organization", "team", "plan", "이메일", "회사", "팀", "플랜"])) {
    return 0.78;
  }

  if (raw.tagName === "textarea" && hasAny(searchable, ["message", "team", "inquiry", "contact", "company", "문의", "상담", "메시지", "회사"])) {
    return 0.76;
  }

  if (searchable.includes("email") || searchable.includes("이메일")) {
    return raw.tagName === "form" ? 0.82 : 0.84;
  }

  if (hasAny(searchable, ["company", "organization", "phone", "회사", "연락처"])) {
    return raw.tagName === "form" ? 0.76 : 0.74;
  }

  return 0.7;
}

function isLandingCta(raw: RawDiscoveryElement, searchable: string): boolean {
  if (!isCtaAction(raw)) {
    return false;
  }

  return hasAny(searchable, ["get started", "sign up", "signup", "register", "free", "trial", "시작", "회원가입", "가입", "무료", "체험"])
    || hasEnglishWord(searchable, "start");
}

function isSignupForm(raw: RawDiscoveryElement, searchable: string): boolean {
  if (raw.tagName === "form") {
    return hasAny(searchable, signupFormKeywords());
  }

  if (raw.tagName === "input" || raw.tagName === "textarea" || raw.tagName === "select") {
    return raw.inputType === "email" || hasAny(searchable, signupFormFieldKeywords());
  }

  return false;
}

function signupFormKeywords(): string[] {
  return [
    "signup",
    "sign up",
    "register",
    "lead",
    "trial",
    "request",
    "email",
    "work email",
    "company",
    "organization",
    "team",
    "team size",
    "phone",
    "contact",
    "message",
    "회원가입",
    "가입",
    "이메일",
    "회사",
    "팀",
    "연락처",
    "문의",
    "상담",
    "메시지"
  ];
}

function signupFormFieldKeywords(): string[] {
  return [
    "email",
    "work email",
    "company",
    "organization",
    "team",
    "team size",
    "phone",
    "contact",
    "message",
    "role",
    "이메일",
    "회사",
    "팀",
    "연락처",
    "문의",
    "상담",
    "메시지"
  ];
}

function isContactCandidate(raw: RawDiscoveryElement, searchable: string): boolean {
  return hasAny(searchable, [
    "contact",
    "contact us",
    "contact sales",
    "talk to sales",
    "book a demo",
    "request demo",
    "schedule demo",
    "demo",
    "sales",
    "문의",
    "문의하기",
    "상담",
    "상담 신청",
    "데모",
    "데모 신청",
    "영업 문의"
  ]) && isInteractive(raw);
}

function isPricingCandidate(raw: RawDiscoveryElement, searchable: string): boolean {
  return hasAny(searchable, ["pricing", "price", "plan", "starter", "요금", "가격", "플랜"])
    && isInteractive(raw);
}

function isCheckoutCandidate(raw: RawDiscoveryElement, searchable: string): boolean {
  if (!isInteractive(raw)) {
    return false;
  }

  if (isPassiveCheckoutContext(searchable) && !hasStrongCheckoutAction(searchable)) {
    return false;
  }

  return hasAny(searchable, checkoutActionKeywords());
}

function checkoutConfidence(raw: RawDiscoveryElement, searchable: string): number {
  if (hasAny(searchable, ["checkout", "payment", "cart", "결제", "장바구니"])) {
    return 0.82;
  }

  if (hasAny(searchable, ["buy now", "purchase", "바로구매", "구매하기", "주문하기"])) {
    return 0.8;
  }

  if (raw.href && hasStrongCheckoutAction(searchable)) {
    return 0.72;
  }

  return 0.62;
}

function hasStrongCheckoutAction(searchable: string): boolean {
  return hasAny(searchable, [
    "checkout",
    "payment",
    "billing",
    "purchase",
    "cart",
    "buy now",
    "add to cart",
    "결제",
    "구매하기",
    "바로구매",
    "장바구니",
    "장바구니 담기",
    "담기",
    "주문하기"
  ]);
}

function checkoutActionKeywords(): string[] {
  return [
    "checkout",
    "payment",
    "billing",
    "purchase",
    "cart",
    "buy now",
    "add to cart",
    "결제",
    "구매하기",
    "바로구매",
    "장바구니",
    "장바구니 담기",
    "담기",
    "주문하기"
  ];
}

function isPassiveCheckoutContext(searchable: string): boolean {
  return hasAny(searchable, [
    "배송",
    "오전배송",
    "무료배송",
    "마감",
    "주문 마감",
    "배송 안내",
    "배송비",
    "주문 폭주",
    "혜택",
    "할인",
    "쿠폰",
    "카드 할인",
    "적립",
    "안내"
  ]);
}

function isUnsafeNavigationText(text: string): boolean {
  return hasAny(normalizeSearchText(text), [
    "billing",
    "buy",
    "cart",
    "delete",
    "destroy",
    "remove",
    "order",
    "purchase",
    "unsubscribe",
    "submit",
    "pay",
    "payment",
    "checkout",
    "결제",
    "삭제",
    "탈퇴",
    "제출",
    "구매",
    "주문",
    "회원 탈퇴"
  ]);
}

function isSameSiteNavigation(baseUrl: string, nextUrl: string): boolean {
  try {
    const base = new URL(baseUrl);
    const next = new URL(nextUrl, base);
    if (base.protocol === "file:" && next.protocol === "file:") {
      return sameOrDescendantPath(dirname(base.pathname), next.pathname);
    }

    return base.origin === next.origin && (next.protocol === "http:" || next.protocol === "https:");
  } catch {
    return false;
  }
}

function sameOrDescendantPath(baseDirectory: string, nextPath: string): boolean {
  const normalizedBase = baseDirectory.endsWith("/") ? baseDirectory : `${baseDirectory}/`;
  return nextPath.startsWith(normalizedBase);
}

function candidateElementKey(candidate: DiscoveryCandidate): string {
  return [candidate.url, candidate.selector].join("|");
}

function isInteractive(raw: RawDiscoveryElement): boolean {
  return raw.interactive;
}

function isCtaAction(raw: RawDiscoveryElement): boolean {
  return raw.tagName === "a"
    || raw.tagName === "button"
    || raw.role === "button"
    || raw.role === "link"
    || Boolean(raw.href);
}

function isSignupLike(searchable: string): boolean {
  return hasAny(searchable, ["signup", "sign up", "register", "회원가입", "가입"]);
}

function isDemoOrSalesLike(searchable: string): boolean {
  return hasAny(searchable, ["contact sales", "talk to sales", "book a demo", "request demo", "schedule demo", "데모", "상담", "영업"]);
}

function isPrimaryLike(searchable: string): boolean {
  return hasAny(searchable, ["free", "trial", "시작", "무료", "체험"])
    || hasEnglishWord(searchable, "start")
    || hasEnglishWord(searchable, "get");
}

function resolveTargetRole(raw: RawDiscoveryElement, entrypointType: DiscoveryEntrypointType): string | undefined {
  if (raw.role) {
    return raw.role;
  }

  if (raw.tagName === "a") {
    return "link";
  }

  if (raw.href) {
    return "link";
  }

  if (raw.tagName === "button") {
    return "button";
  }

  if (entrypointType === "form") {
    return undefined;
  }

  return undefined;
}

function toHrefContains(urlString: string | null): string | undefined {
  if (!urlString) {
    return undefined;
  }

  try {
    const url = new URL(urlString);
    return `${url.pathname}${url.search}${url.hash}` || urlString;
  } catch {
    return urlString;
  }
}

function resolveObservationStage(flowType: DiscoveryFlowType): string {
  if (flowType === "LANDING_CTA" || flowType === "PRICING" || flowType === "CONTACT") {
    return "CTA";
  }

  if (flowType === "SIGNUP_LEAD_FORM") {
    return "INPUT";
  }

  if (flowType === "PURCHASE_CHECKOUT") {
    return "COMMIT";
  }

  return "FIRST_VIEW";
}

function recommendationLevel(confidence: number): DiscoveryScenarioRecommendation["recommendation_level"] {
  if (confidence >= 0.8) {
    return "HIGH";
  }

  if (confidence >= 0.55) {
    return "MEDIUM";
  }

  if (confidence > 0) {
    return "LOW";
  }

  return "NOT_AVAILABLE";
}

function evidenceRefsFor(
  candidates: DiscoveryCandidate[],
  evidenceRefByCandidate: Map<DiscoveryCandidate, string>
): string[] {
  return candidates.flatMap((candidate) => {
    const evidenceRef = evidenceRefByCandidate.get(candidate);
    return evidenceRef ? [evidenceRef] : [];
  });
}

function maxConfidence(candidates: DiscoveryCandidate[]): number {
  return candidates.reduce((max, candidate) => Math.max(max, candidate.confidence), 0);
}

function hasAny(value: string, keywords: string[]): boolean {
  return keywords.some((keyword) => value.includes(keyword));
}

function hasEnglishWord(value: string, word: string): boolean {
  return new RegExp(`(^|[^a-z])${word}([^a-z]|$)`, "i").test(value);
}

function normalizeSearchText(value: string): string {
  return normalizeText(value).toLowerCase();
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function remainingBudgetMs(deadlineMs: number, minimumMs = 0): number {
  return Math.max(minimumMs, deadlineMs - Date.now());
}

async function settleWithinBudget(page: Page, deadlineMs: number): Promise<void> {
  const timeoutMs = Math.min(1_000, remainingBudgetMs(deadlineMs));
  if (timeoutMs < 100) {
    return;
  }

  await settleAfterLoad(page, timeoutMs);
}

async function settleAfterLoad(page: Page, timeoutMs = 1_000): Promise<void> {
  await page.waitForLoadState("networkidle", { timeout: Math.max(100, timeoutMs) }).catch(() => undefined);
}

async function readReadyState(page: Page): Promise<string> {
  return page.evaluate(() => {
    const scope = globalThis as typeof globalThis & {
      document: {
        readyState: string;
      };
    };
    return scope.document.readyState;
  }).catch(() => "unknown");
}

function resolveBrowserType(browserName: RunnerBrowserName): BrowserType {
  if (browserName === "firefox") {
    return firefox;
  }

  if (browserName === "webkit") {
    return webkit;
  }

  return chromium;
}
