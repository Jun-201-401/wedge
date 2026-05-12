export function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function toIsoTimestamp(date: Date = new Date()): string {
  return date.toISOString();
}

export function describeTarget(target: unknown): string | null {
  if (typeof target === "string") {
    return target;
  }

  if (!isRecord(target)) {
    return null;
  }

  const fragments = [
    typeof target.role === "string" ? `role=${target.role}` : null,
    typeof target.text === "string" ? `text=${target.text}` : null,
    Array.isArray(target.text_any) && target.text_any.length > 0 ? `text_any=${target.text_any.join("|")}` : null,
    typeof target.label === "string" ? `label=${target.label}` : null,
    Array.isArray(target.label_any) && target.label_any.length > 0
      ? `label_any=${target.label_any.join("|")}`
      : null,
    typeof target.selector === "string" ? `selector=${target.selector}` : null,
    Array.isArray(target.selector_any) && target.selector_any.length > 0
      ? `selector_any=${target.selector_any.join("|")}`
      : null,
    typeof target.url === "string" ? `url=${target.url}` : null
  ].filter((fragment): fragment is string => fragment !== null);

  return fragments.length > 0 ? fragments.join(", ") : JSON.stringify(target);
}

export async function sleep(durationMs: number): Promise<void> {
  if (durationMs <= 0) {
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, durationMs));
}

export function sanitizePathFragment(value: string): string {
  return value.replaceAll(/[^a-zA-Z0-9_-]/g, "-");
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export type RunnerFailureCode = "RUNNER_EXECUTION_FAILED" | "RUNNER_TIMEOUT" | "RUNNER_BROWSER_CRASH";
export type RunnerTerminalOutcome = "COMPLETED" | "STOPPED" | "FAILED_TIMEOUT" | "FAILED_BROWSER_CRASH" | "FAILED_ERROR";
export type RunnerTimeoutPhase = "action" | "settle" | "callback" | "unknown";

export interface RunnerFailureDetails {
  failureCode: RunnerFailureCode;
  timeoutPhase?: RunnerTimeoutPhase;
  timeoutMs?: number | null;
}

export function classifyRunnerFailure(error: unknown): RunnerFailureCode {
  return classifyRunnerFailureDetails(error).failureCode;
}

export function classifyRunnerFailureDetails(
  error: unknown,
  context: { timeoutPhase?: RunnerTimeoutPhase; timeoutMs?: number | null } = {}
): RunnerFailureDetails {
  const name = error instanceof Error ? error.name.toLowerCase() : "";
  const message = errorMessage(error).toLowerCase();

  if (
    name.includes("timeout") ||
    message.includes("timeout") ||
    message.includes("timed out")
  ) {
    return {
      failureCode: "RUNNER_TIMEOUT",
      timeoutPhase: context.timeoutPhase ?? inferTimeoutPhase(message),
      timeoutMs: context.timeoutMs ?? parseTimeoutMs(message)
    };
  }

  if (
    name.includes("browsercrash") ||
    name.includes("targetclosed") ||
    message.includes("page crashed") ||
    message.includes("browser has been closed") ||
    message.includes("target page, context or browser has been closed") ||
    message.includes("browser closed") ||
    message.includes("context closed") ||
    message.includes("page closed")
  ) {
    return {
      failureCode: "RUNNER_BROWSER_CRASH"
    };
  }

  return {
    failureCode: "RUNNER_EXECUTION_FAILED"
  };
}

export function runnerFailureOutcome(failureCode: RunnerFailureCode): RunnerTerminalOutcome {
  if (failureCode === "RUNNER_TIMEOUT") {
    return "FAILED_TIMEOUT";
  }
  if (failureCode === "RUNNER_BROWSER_CRASH") {
    return "FAILED_BROWSER_CRASH";
  }
  return "FAILED_ERROR";
}

function inferTimeoutPhase(message: string): RunnerTimeoutPhase {
  if (message.includes("callback")) {
    return "callback";
  }
  if (message.includes("settle") || message.includes("networkidle") || message.includes("load state")) {
    return "settle";
  }
  if (message.includes("locator") || message.includes("click") || message.includes("fill") || message.includes("press")) {
    return "action";
  }
  return "unknown";
}

function parseTimeoutMs(message: string): number | null {
  const match = /(?:after|timeout(?:=|:)?|timed out after)\s*(\d+(?:\.\d+)?)\s*ms/i.exec(message);
  if (!match) {
    return null;
  }
  const timeoutMs = Number(match[1]);
  return Number.isFinite(timeoutMs) ? timeoutMs : null;
}

export type OperationalLogLevel = "info" | "warn" | "error";

export function logOperationalEvent(
  component: string,
  event: string,
  details: Record<string, unknown> = {},
  level: OperationalLogLevel = "info"
): void {
  const value = process.env.RUNNER_OPERATIONAL_LOGS;
  if (value) {
    const normalized = value.toLowerCase();
    if (normalized === "0" || normalized === "false" || normalized === "off" || normalized === "no") {
      return;
    }
  }

  const line = JSON.stringify({
    timestamp: toIsoTimestamp(),
    level,
    component,
    event,
    ...details
  });

  if (level === "error") {
    console.error(line);
    return;
  }

  console.log(line);
}
