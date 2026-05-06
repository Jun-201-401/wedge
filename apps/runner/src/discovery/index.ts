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
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { CallbackClient } from "../callback/index.ts";
import type { RunnerBrowserName, RunnerConfig } from "../config/index.ts";
import { createArtifactStore, type ArtifactStore } from "../storage/index.ts";
import type {
  Artifact,
  ArtifactDraft,
  DiscoveryEntrypointCandidate,
  DiscoveryEntrypointType,
  DiscoveryCheckpointRequest,
  DiscoveryExecuteMessage,
  DiscoveryFlowCandidate,
  DiscoveryFlowType,
  DiscoveryScenarioRecommendation,
  ScenarioStage,
  SiteDiscoveryResult,
  TargetDescriptorMap,
  DiscoverySummaryPayload
} from "../shared/contracts.ts";

const DEFAULT_DISCOVERY_LOCALE = "ko-KR";
const DEFAULT_DISCOVERY_TIMEZONE = "Asia/Seoul";
const POST_LOAD_SETTLE_MS = 150;
const MAX_SHALLOW_NAVIGATION_CANDIDATES = 6;
const SHALLOW_NAVIGATION_TIMEOUT_MS = 1_500;

const DISCOVERY_FLOW_ORDER: DiscoveryFlowType[] = [
  "LANDING_CTA",
  "SIGNUP_LEAD_FORM",
  "CONTACT",
  "PRICING",
  "PURCHASE_CHECKOUT"
];

interface ExecuteDiscoveryInput {
  message: DiscoveryExecuteMessage;
  config: RunnerConfig;
  callbackClient?: CallbackClient;
  artifactStore?: ArtifactStore;
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
  ariaLabel: string | null;
  ariaLabelledByText: string | null;
  title: string | null;
  alt: string | null;
  labelText: string | null;
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

interface DiscoveryCollectionResult {
  result: SiteDiscoveryResult;
  artifactDraftsByCheckpointId: Map<string, ArtifactDraft[]>;
}

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
    collectUniqueCandidates(candidatesByKey, await collectCandidatesFromPage(page));

    for (let index = 0; index < payload.maxScrollCount; index += 1) {
      if (remainingBudgetMs(discoveryDeadlineMs) < POST_LOAD_SETTLE_MS) {
        break;
      }

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
  const browserSessionId = randomUUID();

  try {
    await input.callbackClient?.sendDiscoveryAccepted?.(input.message.payload.discoveryId, {
      eventId: randomUUID(),
      workerId: input.config.workerId,
      acceptedAt: new Date().toISOString(),
      browserSessionId
    });

    const collection = await executeDiscoveryForPersistence(input);
    const artifactStore = input.artifactStore ?? createArtifactStore(input.config);
    const storedArtifactsByCheckpointId = await persistDiscoveryArtifacts(
      artifactStore,
      collection.result.discovery_id,
      collection.artifactDraftsByCheckpointId
    );
    const resultFile = createDiscoveryResultFilePath(input.config, collection.result.discovery_id);
    await writeDiscoveryResult(resultFile, collection.result);

    for (const checkpoint of createDiscoveryCheckpointRequests(
      collection.result,
      input.config.workerId,
      storedArtifactsByCheckpointId
    )) {
      await input.callbackClient?.sendDiscoveryCheckpoints?.(input.message.payload.discoveryId, checkpoint);
    }

    await input.callbackClient?.sendDiscoveryFinished?.(input.message.payload.discoveryId, {
      eventId: randomUUID(),
      workerId: input.config.workerId,
      finishedAt: new Date().toISOString(),
      finalUrl: collection.result.final_url,
      summary: createDiscoverySummaryPayload(collection.result)
    });

    return {
      discoveryId: collection.result.discovery_id,
      result: collection.result,
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

export function createDiscoveryCheckpointRequests(
  result: SiteDiscoveryResult,
  workerId: string,
  storedArtifactsByCheckpointId: Map<string, Artifact[]> = new Map()
): DiscoveryCheckpointRequest[] {
  return result.checkpoints.map((checkpoint, index) => {
    const checkpointId = readString(checkpoint, "checkpoint_id", `cp_${String(index + 1).padStart(3, "0")}`);
    const durationMs = readNumber(checkpoint, "duration_ms") ?? readSettleDuration(checkpoint);
    const storedArtifacts = storedArtifactsByCheckpointId.get(checkpointId) ?? [];
    const callbackArtifacts = storedArtifacts.map(toDiscoveryCallbackArtifact);

    return {
      eventId: randomUUID(),
      workerId,
      checkpoint: {
        checkpointId,
        stepKey: readString(checkpoint, "step_key", `discovery_${checkpointId}`),
        stage: readScenarioStage(checkpoint, "stage", "FIRST_VIEW"),
        trigger: readRecord(checkpoint, "trigger", {
          type: "discovery",
          source: "site_discovery",
          inputUrl: result.input_url
        }),
        settle: readSettle(checkpoint, durationMs),
        state: readRecord(checkpoint, "state", {}),
        observations: readRecordArray(checkpoint, "observations"),
        deltas: readRecordArray(checkpoint, "deltas"),
        artifactRefs: callbackArtifacts.length > 0
          ? callbackArtifacts.map((artifact) => String(artifact.artifactId))
          : readStringArray(checkpoint, "artifact_refs")
      },
      artifacts: callbackArtifacts.length > 0 ? callbackArtifacts : readRecordArray(checkpoint, "artifacts"),
      observations: []
    };
  });
}

function toDiscoveryCallbackArtifact(artifact: Artifact): Record<string, unknown> {
  return {
    artifactId: artifact.artifactId,
    artifactType: artifact.artifactType,
    bucket: artifact.bucket,
    key: artifact.key,
    mimeType: artifact.mimeType,
    width: artifact.width,
    height: artifact.height,
    sizeBytes: artifact.sizeBytes,
    sha256: artifact.sha256,
    createdAt: artifact.createdAt,
    stepKey: artifact.stepKey
  };
}

async function persistDiscoveryArtifacts(
  artifactStore: ArtifactStore,
  discoveryId: string,
  artifactDraftsByCheckpointId: Map<string, ArtifactDraft[]>
): Promise<Map<string, Artifact[]>> {
  const storedArtifactsByCheckpointId = new Map<string, Artifact[]>();

  for (const [checkpointId, artifacts] of artifactDraftsByCheckpointId) {
    if (artifacts.length === 0) {
      continue;
    }

    storedArtifactsByCheckpointId.set(
      checkpointId,
      await artifactStore.persistArtifacts({
        runId: discoveryId,
        artifacts
      })
    );
  }

  return storedArtifactsByCheckpointId;
}

async function createDiscoveryArtifactDrafts(
  page: Page,
  stepKey: string,
  viewport: { width: number; height: number }
): Promise<ArtifactDraft[]> {
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
      closest?: (selector: string) => BrowserElement | null;
    };
    const scope = globalThis as typeof globalThis & {
      document: {
        querySelectorAll: (selector: string) => Iterable<BrowserElement>;
        getElementById?: (id: string) => BrowserElement | null;
      };
      CSS?: {
        escape?: (nextValue: string) => string;
      };
    };
    const elements = [
      ...scope.document.querySelectorAll("a, button, [role='button'], [role='link'], form, input, select, textarea, section, img, label, [aria-label], [aria-labelledby], [title], [id], [class]")
    ].slice(0, 250);

    return elements.map((element): RawDiscoveryElement => {
      const linkedElement = element.closest?.("a");
      return {
        tagName: element.tagName.toLowerCase(),
        role: element.getAttribute("role"),
        text: normalizeBrowserText(element.innerText || element.textContent || element.value || ""),
        href: element.href || element.getAttribute("href") || linkedElement?.href || linkedElement?.getAttribute("href") || null,
        selector: buildSelector(element),
        inputType: element.type || null,
        name: element.name || element.getAttribute("name"),
        placeholder: element.placeholder || element.getAttribute("placeholder"),
        ariaLabel: normalizeNullableText(element.getAttribute("aria-label")),
        ariaLabelledByText: readAriaLabelledByText(element),
        title: normalizeNullableText(element.getAttribute("title")),
        alt: normalizeNullableText(element.getAttribute("alt")),
        labelText: readAssociatedLabelText(element)
      };
    });

    function normalizeBrowserText(value: string): string {
      return value.replace(/\s+/g, " ").trim().slice(0, 160);
    }

    function normalizeNullableText(value: string | null | undefined): string | null {
      const normalized = normalizeBrowserText(value ?? "");
      return normalized || null;
    }

    function readAriaLabelledByText(element: BrowserElement): string | null {
      const ids = (element.getAttribute("aria-labelledby") ?? "").split(/\s+/).filter(Boolean);
      const text = ids
        .map((id) => scope.document.getElementById?.(id)?.textContent ?? "")
        .join(" ");
      return normalizeNullableText(text);
    }

    function readAssociatedLabelText(element: BrowserElement): string | null {
      const tagName = element.tagName.toLowerCase();
      if (tagName === "label") {
        return normalizeNullableText(element.innerText || element.textContent || "");
      }

      const wrappingLabel = element.closest?.("label");
      if (wrappingLabel) {
        return normalizeNullableText(wrappingLabel.innerText || wrappingLabel.textContent || "");
      }

      const id = element.getAttribute("id");
      if (!id) {
        return null;
      }

      const text = [...scope.document.querySelectorAll(`label[for="${cssStringEscape(id)}"]`)]
        .map((label) => label.innerText || label.textContent || "")
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

      const destinationCandidates = await collectCandidatesFromPage(page);
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
  candidate.observationData = {
    ...candidate.observationData,
    shallow_navigation: {
      status: "verified",
      destination_url: verifiedUrl,
      title
    }
  };
}

function toDiscoveryCandidates(raw: RawDiscoveryElement): DiscoveryCandidate[] {
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
    raw.title
  ].filter(isString).join(" "));
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

  if (isContactCandidate(raw, searchable)) {
    candidates.push(createCandidate(raw, {
      entrypointType: "contact",
      flowType: "CONTACT",
      label,
      confidence: isDemoOrSalesLike(searchable) ? 0.86 : 0.74,
      reason: "Contact, consultation, or demo request candidate was found.",
      observationType: "contact_candidate"
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
      input_type: raw.inputType,
      aria_label: raw.ariaLabel,
      aria_labelled_by_text: raw.ariaLabelledByText,
      label_text: raw.labelText,
      alt: raw.alt,
      title: raw.title
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
  ]) && (isInteractive(raw) || raw.tagName === "section" || raw.tagName === "form");
}

function isPricingCandidate(raw: RawDiscoveryElement, searchable: string): boolean {
  return hasAny(searchable, ["pricing", "price", "plan", "starter", "요금", "가격", "플랜"])
    && (isInteractive(raw) || raw.tagName === "section");
}

function isCheckoutCandidate(raw: RawDiscoveryElement, searchable: string): boolean {
  return hasAny(searchable, ["checkout", "payment", "billing", "purchase", "결제", "구매"])
    && (isInteractive(raw) || raw.tagName === "section");
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
  return raw.tagName === "a" || raw.tagName === "button" || raw.role === "button" || raw.role === "link" || Boolean(raw.href);
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

function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
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

function countRecommendations(result: SiteDiscoveryResult, flowType: DiscoveryFlowType): number {
  return result.flow_candidates
    ?.find((candidate) => candidate.flow_type === flowType)
    ?.entrypoint_candidates.length ?? 0;
}

function readString(payload: Record<string, unknown>, key: string, fallback: string): string {
  const value = payload[key];
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function readNumber(payload: Record<string, unknown>, key: string): number | undefined {
  const value = payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readScenarioStage(payload: Record<string, unknown>, key: string, fallback: ScenarioStage): ScenarioStage {
  const value = payload[key];
  if (value === "FIRST_VIEW" || value === "VALUE" || value === "CTA" || value === "INPUT" || value === "COMMIT") {
    return value;
  }
  return fallback;
}

function readRecord(
  payload: Record<string, unknown>,
  key: string,
  fallback: Record<string, unknown>
): Record<string, unknown> {
  const value = payload[key];
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return fallback;
}

function readRecordArray(payload: Record<string, unknown>, key: string): Record<string, unknown>[] {
  const value = payload[key];
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is Record<string, unknown> =>
    Boolean(item) && typeof item === "object" && !Array.isArray(item)
  );
}

function readStringArray(payload: Record<string, unknown>, key: string): string[] {
  const value = payload[key];
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

function readSettle(payload: Record<string, unknown>, durationMs: number): DiscoveryCheckpointRequest["checkpoint"]["settle"] {
  const settle = readRecord(payload, "settle", {});
  return {
    ...settle,
    strategy: typeof settle.strategy === "string" ? settle.strategy : "domcontentloaded",
    durationMs,
    status: settle.status === "timeout" || settle.status === "failed" ? settle.status : "settled"
  };
}

function readSettleDuration(payload: Record<string, unknown>): number {
  const settle = readRecord(payload, "settle", {});
  return typeof settle.durationMs === "number" && Number.isFinite(settle.durationMs) ? settle.durationMs : 0;
}
