import { createHash, createHmac, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { RunnerConfig } from "../config/index.ts";
import { logOperationalEvent } from "../shared/utils.ts";

interface MessageIdempotencyRecord<T> {
  schemaVersion: "0.1";
  scope: MessageIdempotencyScope;
  idempotencyKey: string;
  completedAt: string;
  result: T;
}

export type MessageIdempotencyScope = "run" | "discovery";

type MessageIdempotencyConfig = Pick<
  RunnerConfig,
  | "artifactsRoot"
  | "workerId"
  | "messageIdempotencyStoreMode"
  | "callbackBaseUrl"
  | "callbackTimeoutMs"
  | "callbackAuthToken"
  | "callbackSignatureSecret"
>;

export function normalizeMessageIdempotencyKey(idempotencyKey: string | undefined): string | null {
  if (!idempotencyKey || idempotencyKey.trim().length === 0) {
    return null;
  }
  return idempotencyKey.trim();
}

export async function readMessageIdempotencyResult<T>(
  config: MessageIdempotencyConfig,
  scope: MessageIdempotencyScope,
  idempotencyKey: string
): Promise<T | null> {
  if (config.messageIdempotencyStoreMode === "api") {
    const apiResult = await readApiMessageIdempotencyResult<T>(config, scope, idempotencyKey);
    if (apiResult) {
      return apiResult;
    }
  }

  return readLocalMessageIdempotencyResult<T>(config, scope, idempotencyKey);
}

export async function persistMessageIdempotencyResult<T>(
  config: MessageIdempotencyConfig,
  scope: MessageIdempotencyScope,
  idempotencyKey: string,
  result: T
): Promise<void> {
  if (config.messageIdempotencyStoreMode === "api") {
    await persistApiMessageIdempotencyResult(config, scope, idempotencyKey, result);
  }

  await persistLocalMessageIdempotencyResult(config, scope, idempotencyKey, result);
}

async function readLocalMessageIdempotencyResult<T>(
  config: Pick<RunnerConfig, "artifactsRoot">,
  scope: MessageIdempotencyScope,
  idempotencyKey: string
): Promise<T | null> {
  try {
    const record = JSON.parse(await readFile(messageIdempotencyRecordPath(config, scope, idempotencyKey), "utf8")) as Partial<MessageIdempotencyRecord<T>>;
    if (record.schemaVersion !== "0.1" || record.scope !== scope || record.idempotencyKey !== idempotencyKey || !record.result) {
      return null;
    }
    return record.result;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      logOperationalEvent(
        "message-idempotency",
        "read_failed",
        {
          scope,
          errorMessage: error instanceof Error ? error.message : String(error)
        },
        "warn"
      );
    }
    return null;
  }
}

async function persistLocalMessageIdempotencyResult<T>(
  config: Pick<RunnerConfig, "artifactsRoot">,
  scope: MessageIdempotencyScope,
  idempotencyKey: string,
  result: T
): Promise<void> {
  const recordPath = messageIdempotencyRecordPath(config, scope, idempotencyKey);
  await mkdir(dirname(recordPath), { recursive: true });
  const record: MessageIdempotencyRecord<T> = {
    schemaVersion: "0.1",
    scope,
    idempotencyKey,
    completedAt: new Date().toISOString(),
    result
  };
  await writeFile(recordPath, JSON.stringify(record, null, 2), "utf8");
}

async function readApiMessageIdempotencyResult<T>(
  config: MessageIdempotencyConfig,
  scope: MessageIdempotencyScope,
  idempotencyKey: string
): Promise<T | null> {
  if (!config.callbackBaseUrl) {
    return null;
  }
  const idempotencyKeyHash = messageIdempotencyKeyHash(idempotencyKey);

  try {
    const response = await requestApiMessageIdempotencyRecord(config, scope, idempotencyKeyHash, "GET");
    const envelope = await response.json() as { data?: { found?: unknown; result?: unknown } };
    return envelope.data?.found === true && envelope.data.result
      ? envelope.data.result as T
      : null;
  } catch (error) {
    logOperationalEvent(
      "message-idempotency",
      "api_record_read_failed",
      {
        scope,
        idempotencyKeyHash,
        errorMessage: error instanceof Error ? error.message : String(error)
      },
      "warn"
    );
    return null;
  }
}

async function persistApiMessageIdempotencyResult<T>(
  config: MessageIdempotencyConfig,
  scope: MessageIdempotencyScope,
  idempotencyKey: string,
  result: T
): Promise<void> {
  if (!config.callbackBaseUrl) {
    return;
  }

  const idempotencyKeyHash = messageIdempotencyKeyHash(idempotencyKey);
  const runId = readTerminalResultId(result);
  if (!runId) {
    logOperationalEvent(
      "message-idempotency",
      "api_record_persist_skipped",
      {
        scope,
        idempotencyKeyHash,
        reason: "missing_run_or_discovery_id"
      },
      "warn"
    );
    return;
  }

  const body = JSON.stringify({ runId, result });
  try {
    await requestApiMessageIdempotencyRecord(config, scope, idempotencyKeyHash, "PUT", body);
  } catch (error) {
    logOperationalEvent(
      "message-idempotency",
      "api_record_persist_failed",
      {
        scope,
        idempotencyKeyHash,
        runId,
        errorMessage: error instanceof Error ? error.message : String(error)
      },
      "warn"
    );
  }
}

async function requestApiMessageIdempotencyRecord(
  config: MessageIdempotencyConfig,
  scope: MessageIdempotencyScope,
  idempotencyKeyHash: string,
  method: "GET" | "PUT",
  body: string = ""
): Promise<Response> {
  const endpoint = apiMessageIdempotencyEndpoint(config.callbackBaseUrl as string, scope, idempotencyKeyHash);
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), config.callbackTimeoutMs);

  try {
    const response = await fetch(endpoint, {
      method,
      headers: createApiMessageIdempotencyHeaders(config, body),
      body: method === "PUT" ? body : undefined,
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`message idempotency API ${method} failed with status ${response.status}`);
    }

    return response;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`message idempotency API ${method} timed out after ${config.callbackTimeoutMs}ms`);
    }

    throw error;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

function createApiMessageIdempotencyHeaders(
  config: Pick<RunnerConfig, "workerId" | "callbackAuthToken" | "callbackSignatureSecret">,
  body: string
): Record<string, string> {
  const headers: Record<string, string> = {
    "x-worker-id": config.workerId,
    "x-event-id": randomUUID(),
    "x-signature": createApiMessageIdempotencySignature(body, config.callbackSignatureSecret)
  };

  if (body.length > 0) {
    headers["content-type"] = "application/json";
  }

  if (config.callbackAuthToken) {
    headers.authorization = `Bearer ${config.callbackAuthToken}`;
  }

  return headers;
}

function createApiMessageIdempotencySignature(body: string, secret: string | undefined): string {
  if (!secret) {
    return "unsigned";
  }

  return `hmac-sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

function apiMessageIdempotencyEndpoint(baseUrl: string, scope: MessageIdempotencyScope, idempotencyKeyHash: string): string {
  const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  return `${normalizedBaseUrl}/internal/runner/message-idempotency/${scope}/${idempotencyKeyHash}`;
}

function readTerminalResultId(result: unknown): string | null {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return null;
  }
  const record = result as { runId?: unknown; discoveryId?: unknown };
  if (typeof record.runId === "string" && record.runId.length > 0) {
    return record.runId;
  }
  return typeof record.discoveryId === "string" && record.discoveryId.length > 0 ? record.discoveryId : null;
}

export function messageIdempotencyKeyHash(idempotencyKey: string): string {
  return createHash("sha256").update(idempotencyKey).digest("hex");
}

function messageIdempotencyRecordPath(
  config: Pick<RunnerConfig, "artifactsRoot">,
  scope: MessageIdempotencyScope,
  idempotencyKey: string
): string {
  return join(config.artifactsRoot, "message-idempotency", scope, `${messageIdempotencyKeyHash(idempotencyKey)}.json`);
}
