import { randomUUID } from "node:crypto";
import { createCdpSession, type CdpSessionMetadata } from "../cdp/index.ts";
import type { RunnerConfig } from "../../config/index.ts";
import type {
  ScenarioAction,
  ScenarioPlan,
  ScenarioStep,
  SettleStrategy,
  TargetDescriptor
} from "../../shared/contracts.ts";
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
  } | null;
  consoleErrors: string[];
  networkErrors: string[];
  cdpSession: CdpSessionMetadata;
}

export interface BrowserSession {
  id: string;
  plan: ScenarioPlan;
  execute: (action: ScenarioAction, step: ScenarioStep) => Promise<BrowserActionResult>;
  settle: (strategy: SettleStrategy) => Promise<BrowserSettleResult>;
  snapshot: () => BrowserPageSnapshot;
  close: () => Promise<void>;
}

export interface BrowserSessionFactory {
  kind: "simulated-playwright";
  createSession: (input: { runId: string; plan: ScenarioPlan }) => Promise<BrowserSession>;
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
  consoleErrors: string[];
  networkErrors: string[];
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
    this.state = {
      currentUrl: plan.start_url,
      finalUrl: plan.start_url,
      title: createTitleFromUrl(plan.start_url),
      visitedUrls: [plan.start_url],
      fields: {},
      selectedOptions: {},
      scrollY: 0,
      lastAction: null,
      consoleErrors: [],
      networkErrors: []
    };
  }

  async execute(action: ScenarioAction, step: ScenarioStep): Promise<BrowserActionResult> {
    const targetSummary = describeTarget(action.target);
    const actionTimestamp = toIsoTimestamp();

    this.state.lastAction = {
      type: action.type,
      target: targetSummary,
      at: actionTimestamp
    };

    switch (action.type) {
      case "goto": {
        const nextUrl = typeof action.target === "string" ? action.target : this.plan.start_url;
        this.navigate(nextUrl);
        break;
      }
      case "click": {
        const nextUrl = inferNavigationUrl(this.state.currentUrl, action.target);
        if (nextUrl) {
          this.navigate(nextUrl);
        }
        break;
      }
      case "fill": {
        const fieldKey = inferFieldKey(action.target, step.step_id);
        this.state.fields[fieldKey] = stringifyValue(action.value);
        break;
      }
      case "select": {
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
    return {
      currentUrl: this.state.currentUrl,
      finalUrl: this.state.finalUrl,
      title: this.state.title,
      viewport: this.plan.environment.viewport,
      locale: this.plan.environment.locale,
      timezone: this.plan.environment.timezone,
      visitedUrls: [...this.state.visitedUrls],
      fields: { ...this.state.fields },
      selectedOptions: { ...this.state.selectedOptions },
      scrollY: this.state.scrollY,
      lastAction: this.state.lastAction ? { ...this.state.lastAction } : null,
      consoleErrors: [...this.state.consoleErrors],
      networkErrors: [...this.state.networkErrors],
      cdpSession: this.cdpSession
    };
  }

  async close(): Promise<void> {
    await sleep(1);
  }

  private navigate(url: string): void {
    this.state.currentUrl = url;
    this.state.finalUrl = url;
    this.state.title = createTitleFromUrl(url);

    if (this.state.visitedUrls[this.state.visitedUrls.length - 1] !== url) {
      this.state.visitedUrls.push(url);
    }
  }
}

export function createPlaywrightSessionFactory(config: RunnerConfig): BrowserSessionFactory {
  return {
    kind: "simulated-playwright",
    createSession: async ({ plan }) => new SimulatedPlaywrightSession(plan, config.simulatedDelayCapMs)
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

function inferFieldKey(target: TargetDescriptor, fallback: string): string {
  if (target && typeof target === "object") {
    if (typeof target.label === "string" && target.label.length > 0) {
      return target.label;
    }

    if (Array.isArray(target.label_any) && target.label_any.length > 0) {
      return target.label_any[0];
    }

    if (typeof target.selector === "string" && target.selector.length > 0) {
      return target.selector;
    }
  }

  return fallback;
}

function inferNavigationUrl(currentUrl: string, target: TargetDescriptor): string | null {
  if (target && typeof target === "object" && typeof target.url === "string") {
    return target.url;
  }

  const targetText = describeTarget(target)?.toLowerCase() ?? "";
  if (targetText.includes("signup") || targetText.includes("회원가입") || targetText.includes("start free")) {
    return new URL("/signup", currentUrl).toString();
  }

  return null;
}

function shouldStop(stopCondition: Record<string, unknown> | undefined, finalUrl: string): boolean {
  if (!stopCondition) {
    return true;
  }

  const urlIncludes = stopCondition.url_includes;
  if (typeof urlIncludes === "string") {
    return finalUrl.includes(urlIncludes);
  }

  return true;
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
