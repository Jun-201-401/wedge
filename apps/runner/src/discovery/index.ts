import {
  chromium,
  firefox,
  webkit,
  type BrowserType,
  type Page
} from "playwright";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { CallbackClient } from "../callback/index.ts";
import type { RunnerBrowserName, RunnerConfig } from "../config/index.ts";
import type {
  DiscoveryEntrypointCandidate,
  DiscoveryEntrypointType,
  DiscoveryExecuteMessage,
  DiscoveryFlowCandidate,
  DiscoveryFlowType,
  DiscoveryScenarioRecommendation,
  SiteDiscoveryResult,
  TargetDescriptorMap,
  DiscoverySummaryPayload
} from "../shared/contracts.ts";

const DEFAULT_DISCOVERY_LOCALE = "ko-KR";
const DEFAULT_DISCOVERY_TIMEZONE = "Asia/Seoul";
const POST_LOAD_SETTLE_MS = 150;

const DISCOVERY_FLOW_ORDER: DiscoveryFlowType[] = [
  "LANDING_CTA",
  "SIGNUP_LEAD_FORM",
  "PRICING",
  "PURCHASE_CHECKOUT"
];

interface ExecuteDiscoveryInput {
  message: DiscoveryExecuteMessage;
  config: RunnerConfig;
  callbackClient?: CallbackClient;
  locale?: string;
  timezone?: string;
}

interface RawDiscoveryElement {
  tagName: string;
  role: string | null;
  text: string;
  href: string | null;
  selector: string | null;
  inputType: string | null;
  name: string | null;
  placeholder: string | null;
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
}

export interface DiscoveryExecutionResult {
  discoveryId: string;
  result: SiteDiscoveryResult;
  resultFile: string;
}

export async function executeDiscovery({
  message,
  config,
  locale = DEFAULT_DISCOVERY_LOCALE,
  timezone = DEFAULT_DISCOVERY_TIMEZONE
}: ExecuteDiscoveryInput): Promise<SiteDiscoveryResult> {
  const { payload } = message;
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
      timezoneId: timezone
    });
    const page = await context.newPage();
    page.setDefaultNavigationTimeout(Math.min(config.browserNavigationTimeoutMs, payload.maxDurationMs));

    await page.goto(payload.url, {
      waitUntil: "domcontentloaded",
      timeout: payload.maxDurationMs
    });
    await settleAfterLoad(page);

    const candidatesByKey = new Map<string, DiscoveryCandidate>();
    collectUniqueCandidates(candidatesByKey, await collectCandidatesFromPage(page));

    for (let index = 0; index < payload.maxScrollCount; index += 1) {
      await page.evaluate(() => {
        const scope = globalThis as typeof globalThis & {
          innerHeight?: number;
          scrollBy?: (x: number, y: number) => void;
        };
        scope.scrollBy?.(0, Math.max(scope.innerHeight ?? 900, 600));
      });
      await page.waitForTimeout(POST_LOAD_SETTLE_MS);
      collectUniqueCandidates(candidatesByKey, await collectCandidatesFromPage(page));
    }

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

    return {
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
          checkpoint_id: "cp_001",
          stage: "FIRST_VIEW",
          state: {
            page: {
              title,
              url: finalUrl,
              ready_state: await readReadyState(page)
            }
          },
          observations: observations.map((observation) => observation.payload),
          artifact_refs: []
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
        `Discovery collected ${candidates.length} candidate(s) after ${payload.maxScrollCount} limited scroll(s).`
      ]
    };
  } finally {
    await browser.close();
  }
}

export async function executeDiscoveryAndPersist(input: ExecuteDiscoveryInput): Promise<DiscoveryExecutionResult> {
  const browserSessionId = randomUUID();

  try {
    await input.callbackClient?.sendDiscoveryAccepted?.(input.message.payload.discoveryId, {
      eventId: randomUUID(),
      workerId: input.config.workerId,
      acceptedAt: new Date().toISOString(),
      browserSessionId
    });

    const result = await executeDiscovery(input);
    const resultFile = createDiscoveryResultFilePath(input.config, result.discovery_id);
    await writeDiscoveryResult(resultFile, result);

    await input.callbackClient?.sendDiscoveryFinished?.(input.message.payload.discoveryId, {
      eventId: randomUUID(),
      workerId: input.config.workerId,
      finishedAt: new Date().toISOString(),
      finalUrl: result.final_url,
      summary: createDiscoverySummaryPayload(result)
    });

    return {
      discoveryId: result.discovery_id,
      result,
      resultFile
    };
  } catch (error) {
    await input.callbackClient?.sendDiscoveryFailed?.(input.message.payload.discoveryId, {
      eventId: randomUUID(),
      workerId: input.config.workerId,
      failedAt: new Date().toISOString(),
      failureCode: "DISCOVERY_EXECUTION_FAILED",
      failureMessage: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

export function createDiscoverySummaryPayload(result: SiteDiscoveryResult): DiscoverySummaryPayload {
  const recommendations = result.scenario_recommendations.map((recommendation) => ({
    scenarioType: recommendation.scenario_type,
    recommendationLevel: recommendation.recommendation_level,
    confidence: recommendation.confidence,
    reason: recommendation.reason,
    evidenceRefs: recommendation.evidence_refs,
    suggestedStartUrl: recommendation.suggested_start_url ?? null,
    suggestedTarget: recommendation.suggested_target ?? null
  }));

  return {
    detectedFlowTypes: result.detected_flow_types,
    missingFlowTypes: result.missing_flow_types ?? [],
    primaryCtaCount: countRecommendations(result, "LANDING_CTA"),
    formCandidateCount: countRecommendations(result, "SIGNUP_LEAD_FORM"),
    pricingEntrypointCount: countRecommendations(result, "PRICING"),
    checkoutEntrypointCount: countRecommendations(result, "PURCHASE_CHECKOUT"),
    scenarioRecommendations: recommendations
  };
}

export async function writeDiscoveryResult(resultFile: string, result: SiteDiscoveryResult): Promise<void> {
  await mkdir(dirname(resultFile), {
    recursive: true
  });
  await writeFile(resultFile, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}

export function createDiscoveryResultFilePath(config: RunnerConfig, discoveryId: string): string {
  return resolve(config.artifactsRoot, "discoveries", sanitizePathSegment(discoveryId), "site-discovery-result.json");
}

async function collectCandidatesFromPage(page: Page): Promise<DiscoveryCandidate[]> {
  const rawElements = await page.evaluate(() => {
    type BrowserElement = {
      tagName: string;
      innerText?: string;
      textContent?: string;
      value?: string;
      href?: string;
      type?: string;
      name?: string;
      placeholder?: string;
      className?: unknown;
      getAttribute: (name: string) => string | null;
    };
    const scope = globalThis as typeof globalThis & {
      document: {
        querySelectorAll: (selector: string) => Iterable<BrowserElement>;
      };
      CSS?: {
        escape?: (nextValue: string) => string;
      };
    };
    const elements = [
      ...scope.document.querySelectorAll("a, button, [role='button'], [role='link'], form, input, select, textarea, section, [id], [class]")
    ].slice(0, 250);

    return elements.map((element): RawDiscoveryElement => {
      return {
        tagName: element.tagName.toLowerCase(),
        role: element.getAttribute("role"),
        text: normalizeBrowserText(element.innerText || element.textContent || element.value || ""),
        href: element.href || element.getAttribute("href"),
        selector: buildSelector(element),
        inputType: element.type || null,
        name: element.name || element.getAttribute("name"),
        placeholder: element.placeholder || element.getAttribute("placeholder")
      };
    });

    function normalizeBrowserText(value: string): string {
      return value.replace(/\s+/g, " ").trim().slice(0, 160);
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
  });

  return rawElements.flatMap(toDiscoveryCandidates);
}

function toDiscoveryCandidates(raw: RawDiscoveryElement): DiscoveryCandidate[] {
  const label = normalizeText(raw.text || raw.placeholder || raw.name || raw.href || raw.selector || raw.tagName);
  if (!label) {
    return [];
  }

  const searchable = normalizeSearchText([label, raw.href, raw.selector, raw.name, raw.placeholder].filter(isString).join(" "));
  const candidates: DiscoveryCandidate[] = [];

  if (isLandingCta(raw, searchable)) {
    candidates.push(createCandidate(raw, {
      entrypointType: isSignupLike(searchable) ? "signup" : "cta",
      flowType: "LANDING_CTA",
      label,
      confidence: isPrimaryLike(searchable) ? 0.86 : 0.72,
      reason: "Primary-like CTA candidate was found.",
      observationType: "cta_candidate"
    }));
  }

  if (isSignupForm(raw, searchable)) {
    candidates.push(createCandidate(raw, {
      entrypointType: "form",
      flowType: "SIGNUP_LEAD_FORM",
      label,
      confidence: raw.inputType === "email" || searchable.includes("email") || searchable.includes("이메일") ? 0.84 : 0.7,
      reason: "Signup or lead form candidate was found.",
      observationType: "form_candidate"
    }));
  }

  if (isPricingCandidate(raw, searchable)) {
    candidates.push(createCandidate(raw, {
      entrypointType: "pricing",
      flowType: "PRICING",
      label,
      confidence: searchable.includes("pricing") || searchable.includes("요금") || searchable.includes("가격") ? 0.82 : 0.68,
      reason: "Pricing entrypoint candidate was found.",
      observationType: "pricing_candidate"
    }));
  }

  if (isCheckoutCandidate(raw, searchable)) {
    candidates.push(createCandidate(raw, {
      entrypointType: "checkout",
      flowType: "PURCHASE_CHECKOUT",
      label,
      confidence: searchable.includes("checkout") || searchable.includes("결제") || searchable.includes("payment") ? 0.8 : 0.66,
      reason: "Checkout or payment entrypoint candidate was found.",
      observationType: "checkout_candidate"
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
    observationData: {
      text: input.label,
      href: raw.href,
      selector: raw.selector,
      role,
      name: raw.name,
      placeholder: raw.placeholder,
      input_type: raw.inputType
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

function isLandingCta(raw: RawDiscoveryElement, searchable: string): boolean {
  if (!isInteractive(raw)) {
    return false;
  }

  return hasAny(searchable, ["get started", "sign up", "signup", "register", "free", "trial", "시작", "회원가입", "가입", "무료", "체험"])
    || hasEnglishWord(searchable, "start");
}

function isSignupForm(raw: RawDiscoveryElement, searchable: string): boolean {
  if (raw.tagName === "form") {
    return hasAny(searchable, ["signup", "sign up", "register", "lead", "email", "회원가입", "가입", "이메일"]);
  }

  if (raw.tagName === "input" || raw.tagName === "textarea") {
    return raw.inputType === "email" || hasAny(searchable, ["email", "work email", "company", "organization", "이메일", "회사"]);
  }

  return false;
}

function isPricingCandidate(raw: RawDiscoveryElement, searchable: string): boolean {
  return hasAny(searchable, ["pricing", "price", "plan", "starter", "요금", "가격", "플랜"])
    && (isInteractive(raw) || raw.tagName === "section");
}

function isCheckoutCandidate(raw: RawDiscoveryElement, searchable: string): boolean {
  return hasAny(searchable, ["checkout", "payment", "billing", "purchase", "결제", "구매"])
    && (isInteractive(raw) || raw.tagName === "section");
}

function isInteractive(raw: RawDiscoveryElement): boolean {
  return raw.tagName === "a" || raw.tagName === "button" || raw.role === "button" || raw.role === "link";
}

function isSignupLike(searchable: string): boolean {
  return hasAny(searchable, ["signup", "sign up", "register", "회원가입", "가입"]);
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
  if (flowType === "LANDING_CTA" || flowType === "PRICING") {
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

function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

async function settleAfterLoad(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle", { timeout: 1_000 }).catch(() => undefined);
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

function countRecommendations(result: SiteDiscoveryResult, flowType: DiscoveryFlowType): number {
  return result.flow_candidates
    ?.find((candidate) => candidate.flow_type === flowType)
    ?.entrypoint_candidates.length ?? 0;
}
