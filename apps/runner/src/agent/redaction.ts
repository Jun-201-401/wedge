import type { ScenarioAction, ScenarioPlan, SettleStrategy } from "../shared/contracts.ts";
import type { AgentDecision } from "./planner.ts";
import type { AgentTrace } from "./trace.ts";

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const CARD_PATTERN = /\b(?:\d[ -]*?){13,19}\b/g;
const KOREA_MOBILE_PATTERN = /\b(?:\+82[-.\s]?)?0?1[016789][-\s.]?\d{3,4}[-\s.]?\d{4}\b/g;
const US_PHONE_PATTERN = /\b(?:\+?1[-.\s]?)?(?:\(\d{3}\)|\d{3})[-.\s]?\d{3}[-.\s]?\d{4}\b/g;
const BEARER_TOKEN_PATTERN = /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}\b/gi;
const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const INLINE_SECRET_PATTERN = /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password)([=:]\s*|\s+)([^&\s]+)/gi;
const SENSITIVE_QUERY_KEYS = new Set([
  "email",
  "phone",
  "tel",
  "token",
  "access_token",
  "refresh_token",
  "api_key",
  "apikey",
  "secret",
  "password",
  "card",
  "card_number",
  "cvc",
  "cvv"
]);
const SENSITIVE_OBJECT_KEY_PATTERN = /(^|[_-])(api[_-]?key|access[_-]?token|refresh[_-]?token|token|authorization|cookie|secret|password|card[_-]?number|cvc|cvv|email|phone|tel)($|[_-])/i;

export function redactSensitiveString(value: string): string {
  const preservedValues: string[] = [];
  const valueWithPlaceholders = value.replace(UUID_PATTERN, (match) => {
    preservedValues.push(match);
    return `__WEDGE_UUID_${preservedValues.length - 1}__`;
  });

  const redacted = redactUrlQuery(valueWithPlaceholders)
    .replace(EMAIL_PATTERN, "[REDACTED_EMAIL]")
    .replace(CARD_PATTERN, "[REDACTED_CARD]")
    .replace(KOREA_MOBILE_PATTERN, "[REDACTED_PHONE]")
    .replace(US_PHONE_PATTERN, "[REDACTED_PHONE]")
    .replace(BEARER_TOKEN_PATTERN, "$1[REDACTED_TOKEN]")
    .replace(INLINE_SECRET_PATTERN, "$1$2[REDACTED_SECRET]");

  return preservedValues.reduce(
    (current, preserved, index) => current.replaceAll(`__WEDGE_UUID_${index}__`, preserved),
    redacted
  );
}

export function redactSensitiveValue<T>(value: T): T {
  return redactValue(value, null) as T;
}

export function containsSensitiveValue(value: unknown): boolean {
  return JSON.stringify(value) !== JSON.stringify(redactSensitiveValue(value));
}

export function redactAgentDecision(decision: AgentDecision): AgentDecision {
  return redactSensitiveValue(decision);
}

export function redactAgentTrace(trace: AgentTrace): AgentTrace {
  return redactSensitiveValue(trace);
}

export function redactScenarioAction(action: ScenarioAction): ScenarioAction {
  return redactSensitiveValue(action);
}

export function redactSettleStrategy(settleStrategy: SettleStrategy): SettleStrategy {
  return redactSensitiveValue(settleStrategy);
}

export function redactScenarioPlan(plan: ScenarioPlan): ScenarioPlan {
  return redactSensitiveValue(plan);
}

function redactValue(value: unknown, key: string | null): unknown {
  if (typeof value === "string") {
    return isSensitiveKey(key) ? sensitiveReplacementForKey(key) : redactSensitiveString(value);
  }

  if (typeof value === "number" && isSensitiveKey(key)) {
    return sensitiveReplacementForKey(key);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, key));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        redactValue(entryValue, entryKey)
      ])
    );
  }

  return value;
}

function isSensitiveKey(key: string | null): boolean {
  return key !== null && SENSITIVE_OBJECT_KEY_PATTERN.test(key);
}

function sensitiveReplacementForKey(key: string | null): string {
  const normalizedKey = key?.toLowerCase() ?? "";
  if (normalizedKey.includes("email")) {
    return "[REDACTED_EMAIL]";
  }
  if (normalizedKey.includes("phone") || normalizedKey.includes("tel")) {
    return "[REDACTED_PHONE]";
  }
  if (normalizedKey.includes("card")) {
    return "[REDACTED_CARD]";
  }
  return "[REDACTED_SECRET]";
}

function redactUrlQuery(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return value;
  }

  let redacted = false;
  for (const [key] of parsed.searchParams) {
    if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) {
      parsed.searchParams.set(key, sensitiveReplacementForKey(key));
      redacted = true;
    }
  }

  return redacted ? parsed.href : value;
}
