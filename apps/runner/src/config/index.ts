import { hostname } from "node:os";
import { resolve } from "node:path";

export type RunnerBrowserMode = "simulated" | "playwright";
export type RunnerBrowserName = "chromium" | "firefox" | "webkit";

export interface RunnerConfig {
  serviceName: string;
  workerId: string;
  artifactsRoot: string;
  callbackLogFile: string;
  artifactBucket: string;
  browserMode: RunnerBrowserMode;
  browserName: RunnerBrowserName;
  browserHeadless: boolean;
  browserLaunchTimeoutMs: number;
  browserNavigationTimeoutMs: number;
  playwrightBrowsersPath?: string;
  simulatedDelayCapMs: number;
}

export function loadRunnerConfig(overrides: Partial<RunnerConfig> = {}): RunnerConfig {
  const serviceName = overrides.serviceName ?? process.env.RUNNER_SERVICE_NAME ?? "runner";
  const artifactsRoot =
    overrides.artifactsRoot ??
    resolve(process.cwd(), process.env.RUNNER_ARTIFACTS_ROOT ?? ".runner-artifacts");
  const browserMode = parseBrowserMode(overrides.browserMode ?? process.env.RUNNER_BROWSER_MODE);
  const browserName = parseBrowserName(overrides.browserName ?? process.env.RUNNER_BROWSER_NAME);
  const browserHeadless = parseBoolean(overrides.browserHeadless, process.env.RUNNER_BROWSER_HEADLESS, true);
  const browserLaunchTimeoutMs = parseNumber(
    overrides.browserLaunchTimeoutMs,
    process.env.RUNNER_BROWSER_LAUNCH_TIMEOUT_MS,
    30_000
  );
  const browserNavigationTimeoutMs = parseNumber(
    overrides.browserNavigationTimeoutMs,
    process.env.RUNNER_BROWSER_NAVIGATION_TIMEOUT_MS,
    30_000
  );

  return {
    serviceName,
    workerId: overrides.workerId ?? `${serviceName}-${hostname()}-${process.pid}`,
    artifactsRoot,
    callbackLogFile:
      overrides.callbackLogFile ??
      resolve(artifactsRoot, process.env.RUNNER_CALLBACK_LOG_FILE ?? "callbacks.jsonl"),
    artifactBucket: overrides.artifactBucket ?? process.env.RUNNER_ARTIFACT_BUCKET ?? "local-runner",
    browserMode,
    browserName,
    browserHeadless,
    browserLaunchTimeoutMs,
    browserNavigationTimeoutMs,
    playwrightBrowsersPath: overrides.playwrightBrowsersPath ?? process.env.PLAYWRIGHT_BROWSERS_PATH ?? undefined,
    simulatedDelayCapMs: parseNumber(overrides.simulatedDelayCapMs, process.env.RUNNER_SIMULATED_DELAY_CAP_MS, 25)
  };
}

function parseBrowserMode(value: RunnerConfig["browserMode"] | string | undefined): RunnerBrowserMode {
  if (value === "simulated" || value === "playwright") {
    return value;
  }

  return "simulated";
}

function parseBrowserName(value: RunnerConfig["browserName"] | string | undefined): RunnerBrowserName {
  if (value === "chromium" || value === "firefox" || value === "webkit") {
    return value;
  }

  return "chromium";
}

function parseBoolean(
  overrideValue: boolean | undefined,
  envValue: string | undefined,
  defaultValue: boolean
): boolean {
  if (typeof overrideValue === "boolean") {
    return overrideValue;
  }

  if (!envValue) {
    return defaultValue;
  }

  if (envValue === "1" || envValue.toLowerCase() === "true" || envValue.toLowerCase() === "yes") {
    return true;
  }

  if (envValue === "0" || envValue.toLowerCase() === "false" || envValue.toLowerCase() === "no") {
    return false;
  }

  return defaultValue;
}

function parseNumber(
  overrideValue: number | undefined,
  envValue: string | undefined,
  defaultValue: number
): number {
  if (typeof overrideValue === "number" && Number.isFinite(overrideValue)) {
    return overrideValue;
  }

  if (!envValue) {
    return defaultValue;
  }

  const parsed = Number(envValue);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}
