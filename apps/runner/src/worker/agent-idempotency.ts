import { createHash, createHmac, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { RunnerConfig } from "../config/index.ts";
import { logOperationalEvent } from "../shared/utils.ts";
import { redactAgentTrace, redactSensitiveValue } from "../agent/redaction.ts";
import type { AgentRunnerExecutionResult } from "./agent-worker.ts";

export interface AgentIdempotencyRecord {
  schemaVersion: "0.1";
  idempotencyKey: string;
  runId: string;
  taskId: string;
  attemptId: string;
  attemptIndex: number;
  completedAt: string;
  result: AgentRunnerExecutionResult;
}

export interface AgentIdempotencyStore {
  read(idempotencyKey: string): Promise<AgentRunnerExecutionResult | null>;
  persist(idempotencyKey: string, result: AgentRunnerExecutionResult): Promise<void>;
  claim?(
    idempotencyKey: string,
    input: AgentIdempotencyClaimInput
  ): Promise<AgentIdempotencyClaimResult>;
}

export interface AgentIdempotencyClaimInput {
  runId: string;
  taskId: string;
  attemptId: string;
  attemptIndex: number;
}

export type AgentIdempotencyClaimResult =
  | { status: "CLAIMED" }
  | { status: "COMPLETED"; result: AgentRunnerExecutionResult }
  | { status: "IN_PROGRESS"; claimedBy?: string | null; leaseExpiresAt?: string | null };

export class AgentIdempotencyInProgressError extends Error {
  readonly idempotencyKey: string;
  readonly claimedBy?: string | null;
  readonly leaseExpiresAt?: string | null;

  constructor(
    idempotencyKey: string,
    claimedBy?: string | null,
    leaseExpiresAt?: string | null
  ) {
    super("Agent execution with the same idempotency key is already claimed by another runner.");
    this.name = "AgentIdempotencyInProgressError";
    this.idempotencyKey = idempotencyKey;
    this.claimedBy = claimedBy;
    this.leaseExpiresAt = leaseExpiresAt;
  }
}

export function createLocalAgentIdempotencyStore(
  config: Pick<RunnerConfig, "artifactsRoot" | "workerId">
): AgentIdempotencyStore {
  return {
    read: (idempotencyKey) => readAgentIdempotencyResult(config, idempotencyKey),
    persist: (idempotencyKey, result) => persistAgentIdempotencyResult(config, idempotencyKey, result)
  };
}

export function createApiAgentIdempotencyStore(
  config: Pick<
    RunnerConfig,
    "workerId" | "callbackBaseUrl" | "callbackTimeoutMs" | "callbackAuthToken" | "callbackSignatureSecret" | "agentIdempotencyLeaseTtlMs"
  >
): AgentIdempotencyStore {
  if (!config.callbackBaseUrl) {
    throw new Error("RUNNER_CALLBACK_BASE_URL is required when RUNNER_AGENT_IDEMPOTENCY_STORE_MODE=api");
  }

  return {
    claim: (idempotencyKey, input) => claimApiAgentIdempotencyResult(config, idempotencyKey, input),
    read: (idempotencyKey) => readApiAgentIdempotencyResult(config, idempotencyKey),
    persist: (idempotencyKey, result) => persistApiAgentIdempotencyResult(config, idempotencyKey, result)
  };
}

export function resolveAgentIdempotencyKey(input: {
  envelopeIdempotencyKey?: string;
  taskIdempotencyKey?: string | null;
}): string | null {
  const key = input.taskIdempotencyKey ?? input.envelopeIdempotencyKey;
  return typeof key === "string" && key.trim().length > 0 ? key.trim() : null;
}

export async function readAgentIdempotencyResult(
  config: Pick<RunnerConfig, "artifactsRoot">,
  idempotencyKey: string
): Promise<AgentRunnerExecutionResult | null> {
  const recordPath = agentIdempotencyRecordPath(config, idempotencyKey);

  try {
    const rawRecord = await readFile(recordPath, "utf8");
    const record = JSON.parse(rawRecord) as Partial<AgentIdempotencyRecord>;

    if (record.schemaVersion !== "0.1" || record.idempotencyKey !== idempotencyKey || !record.result) {
      return null;
    }

    return record.result;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }

    logOperationalEvent(
      "agent-idempotency",
      "record_read_failed",
      {
        recordPath,
        errorMessage: error instanceof Error ? error.message : String(error)
      },
      "warn"
    );
    return null;
  }
}

export async function persistAgentIdempotencyResult(
  config: Pick<RunnerConfig, "artifactsRoot" | "workerId">,
  idempotencyKey: string,
  result: AgentRunnerExecutionResult
): Promise<void> {
  if (result.trace.outcome.status === "RUNNING" || result.trace.outcome.status === "FAILED") {
    return;
  }

  const recordPath = agentIdempotencyRecordPath(config, idempotencyKey);
  const tempPath = `${recordPath}.${config.workerId}.${process.pid}.tmp`;
  const record: AgentIdempotencyRecord = {
    schemaVersion: "0.1",
    idempotencyKey,
    runId: result.runId,
    taskId: result.trace.task_id,
    attemptId: result.trace.attempt_id,
    attemptIndex: result.trace.attempt_index,
    completedAt: new Date().toISOString(),
    result: sanitizeAgentIdempotencyResult(result)
  };

  await mkdir(dirname(recordPath), { recursive: true });
  await writeFile(tempPath, JSON.stringify(record, null, 2), "utf8");
  await rename(tempPath, recordPath);
}

export function sanitizeAgentIdempotencyResult(result: AgentRunnerExecutionResult): AgentRunnerExecutionResult {
  return {
    ...result,
    trace: redactAgentTrace(result.trace),
    scenarioPlanExport: result.scenarioPlanExport
      ? redactSensitiveValue(result.scenarioPlanExport)
      : undefined,
    traceArtifact: result.traceArtifact
      ? redactSensitiveValue(result.traceArtifact)
      : undefined,
    scenarioPlanExportArtifact: result.scenarioPlanExportArtifact
      ? redactSensitiveValue(result.scenarioPlanExportArtifact)
      : undefined
  };
}

async function readApiAgentIdempotencyResult(
  config: Pick<RunnerConfig, "workerId" | "callbackBaseUrl" | "callbackTimeoutMs" | "callbackAuthToken" | "callbackSignatureSecret">,
  idempotencyKey: string
): Promise<AgentRunnerExecutionResult | null> {
  const idempotencyKeyHash = agentIdempotencyKeyHash(idempotencyKey);

  try {
    const response = await requestApiAgentIdempotencyRecord(config, idempotencyKeyHash, "GET");
    const envelope = await response.json() as { data?: { found?: unknown; result?: unknown } };
    return envelope.data?.found === true && envelope.data.result
      ? envelope.data.result as AgentRunnerExecutionResult
      : null;
  } catch (error) {
    logOperationalEvent(
      "agent-idempotency",
      "api_record_read_failed",
      {
        idempotencyKeyHash,
        errorMessage: error instanceof Error ? error.message : String(error)
      },
      "warn"
    );
    return null;
  }
}

async function claimApiAgentIdempotencyResult(
  config: Pick<RunnerConfig, "workerId" | "callbackBaseUrl" | "callbackTimeoutMs" | "callbackAuthToken" | "callbackSignatureSecret" | "agentIdempotencyLeaseTtlMs">,
  idempotencyKey: string,
  input: AgentIdempotencyClaimInput
): Promise<AgentIdempotencyClaimResult> {
  const idempotencyKeyHash = agentIdempotencyKeyHash(idempotencyKey);
  const body = JSON.stringify({
    runId: input.runId,
    taskId: input.taskId,
    attemptId: input.attemptId,
    attemptIndex: input.attemptIndex,
    leaseTtlMs: config.agentIdempotencyLeaseTtlMs
  });
  const response = await requestApiAgentIdempotencyRecord(config, idempotencyKeyHash, "POST", body, "/claim");
  const envelope = await response.json() as { data?: ApiAgentIdempotencyRecord };
  const record = envelope.data;

  if (!record?.found) {
    throw new Error("agent idempotency claim API returned an empty record");
  }

  if (record.status === "COMPLETED" && record.result) {
    return {
      status: "COMPLETED",
      result: record.result as AgentRunnerExecutionResult
    };
  }

  if (record.status === "CLAIMED" && record.claimedBy === config.workerId) {
    return { status: "CLAIMED" };
  }

  return {
    status: "IN_PROGRESS",
    claimedBy: record.claimedBy,
    leaseExpiresAt: record.leaseExpiresAt
  };
}

async function persistApiAgentIdempotencyResult(
  config: Pick<RunnerConfig, "workerId" | "callbackBaseUrl" | "callbackTimeoutMs" | "callbackAuthToken" | "callbackSignatureSecret">,
  idempotencyKey: string,
  result: AgentRunnerExecutionResult
): Promise<void> {
  if (result.trace.outcome.status === "RUNNING" || result.trace.outcome.status === "FAILED") {
    return;
  }

  const idempotencyKeyHash = agentIdempotencyKeyHash(idempotencyKey);
  const sanitizedResult = sanitizeAgentIdempotencyResult(result);
  const body = JSON.stringify({
    runId: sanitizedResult.runId,
    taskId: sanitizedResult.trace.task_id,
    attemptId: sanitizedResult.trace.attempt_id,
    attemptIndex: sanitizedResult.trace.attempt_index,
    result: sanitizedResult
  });

  try {
    await requestApiAgentIdempotencyRecord(config, idempotencyKeyHash, "PUT", body);
  } catch (error) {
    logOperationalEvent(
      "agent-idempotency",
      "api_record_persist_failed",
      {
        idempotencyKeyHash,
        runId: result.runId,
        errorMessage: error instanceof Error ? error.message : String(error)
      },
      "warn"
    );
  }
}

async function requestApiAgentIdempotencyRecord(
  config: Pick<RunnerConfig, "workerId" | "callbackBaseUrl" | "callbackTimeoutMs" | "callbackAuthToken" | "callbackSignatureSecret">,
  idempotencyKeyHash: string,
  method: "GET" | "PUT" | "POST",
  body: string = "",
  pathSuffix: string = ""
): Promise<Response> {
  const endpoint = `${apiAgentIdempotencyEndpoint(config.callbackBaseUrl as string, idempotencyKeyHash)}${pathSuffix}`;
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), config.callbackTimeoutMs);

  try {
    const response = await fetch(endpoint, {
      method,
      headers: createApiAgentIdempotencyHeaders(config, body),
      body: method === "PUT" || method === "POST" ? body : undefined,
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`agent idempotency API ${method} failed with status ${response.status}`);
    }

    return response;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`agent idempotency API ${method} timed out after ${config.callbackTimeoutMs}ms`);
    }

    throw error;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

interface ApiAgentIdempotencyRecord {
  found?: boolean;
  status?: string | null;
  claimedBy?: string | null;
  leaseExpiresAt?: string | null;
  result?: unknown;
}

function createApiAgentIdempotencyHeaders(
  config: Pick<RunnerConfig, "workerId" | "callbackAuthToken" | "callbackSignatureSecret">,
  body: string
): Record<string, string> {
  const headers: Record<string, string> = {
    "x-worker-id": config.workerId,
    "x-event-id": randomUUID(),
    "x-signature": createApiAgentIdempotencySignature(body, config.callbackSignatureSecret)
  };

  if (body.length > 0) {
    headers["content-type"] = "application/json";
  }

  if (config.callbackAuthToken) {
    headers.authorization = `Bearer ${config.callbackAuthToken}`;
  }

  return headers;
}

function createApiAgentIdempotencySignature(body: string, secret: string | undefined): string {
  if (!secret) {
    return "unsigned";
  }

  return `hmac-sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

function apiAgentIdempotencyEndpoint(baseUrl: string, idempotencyKeyHash: string): string {
  const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  return `${normalizedBaseUrl}/internal/runner/agent-idempotency/${idempotencyKeyHash}`;
}

function agentIdempotencyRecordPath(config: Pick<RunnerConfig, "artifactsRoot">, idempotencyKey: string): string {
  const digest = agentIdempotencyKeyHash(idempotencyKey);
  return join(config.artifactsRoot, "agent-idempotency", `${digest}.json`);
}

function agentIdempotencyKeyHash(idempotencyKey: string): string {
  return createHash("sha256").update(idempotencyKey).digest("hex");
}
