import { createHmac, randomUUID } from "node:crypto";
import type { RunnerConfig } from "../config/index.ts";
import type { RunnerControlStatePayload } from "../shared/contracts.ts";
import {
  createCallbackClientFromHandler,
  type CallbackClient,
  type CallbackType
} from "./client.ts";

export function createHttpCallbackClient(
  config: Pick<
    RunnerConfig,
    "workerId" | "callbackBaseUrl" | "callbackTimeoutMs" | "callbackAuthToken" | "callbackSignatureSecret"
  >
): CallbackClient {
  if (!config.callbackBaseUrl) {
    throw new Error("RUNNER_CALLBACK_BASE_URL is required when callbackMode=http");
  }

  return {
    ...createCallbackClientFromHandler((callbackType, runId, payload) =>
      postRunnerCallback(config, runId, callbackType, payload)
    ),
    readRunControlState: (runId) => getRunnerControlState(config, runId)
  };
}

async function postRunnerCallback(
  config: Pick<
    RunnerConfig,
    "workerId" | "callbackBaseUrl" | "callbackTimeoutMs" | "callbackAuthToken" | "callbackSignatureSecret"
  >,
  runId: string,
  callbackType: CallbackType,
  payload: unknown
): Promise<void> {
  const body = JSON.stringify(payload);
  const endpoint = buildRunnerCallbackUrl(config.callbackBaseUrl as string, runId, callbackType);
  const eventId = readPayloadEventId(payload) ?? randomUUID();
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), config.callbackTimeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: createRunnerCallbackHeaders(config, body, eventId),
      body,
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`runner callback ${callbackType} failed with status ${response.status}`);
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`runner callback ${callbackType} timed out after ${config.callbackTimeoutMs}ms`);
    }

    throw error;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

function createRunnerCallbackHeaders(
  config: Pick<RunnerConfig, "workerId" | "callbackAuthToken" | "callbackSignatureSecret">,
  body: string,
  eventId: string
): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-worker-id": config.workerId,
    "x-event-id": eventId,
    "x-signature": createRunnerCallbackSignature(body, config.callbackSignatureSecret)
  };

  if (config.callbackAuthToken) {
    headers.authorization = `Bearer ${config.callbackAuthToken}`;
  }

  return headers;
}

function createRunnerCallbackSignature(body: string, secret: string | undefined): string {
  if (!secret) {
    return "unsigned";
  }

  return `hmac-sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

function readPayloadEventId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return undefined;
  }

  const eventId = (payload as { eventId?: unknown }).eventId;
  return typeof eventId === "string" && eventId.length > 0 ? eventId : undefined;
}

function buildRunnerCallbackUrl(baseUrl: string, resourceId: string, callbackType: CallbackType): string {
  const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  if (callbackType.startsWith("discovery-")) {
    const discoveryCallbackType = callbackType.replace("discovery-", "");
    return `${normalizedBaseUrl}/internal/runner/discoveries/${resourceId}/${discoveryCallbackType}`;
  }

  return `${normalizedBaseUrl}/internal/runner/runs/${resourceId}/${callbackType}`;
}

async function getRunnerControlState(
  config: Pick<
    RunnerConfig,
    "workerId" | "callbackBaseUrl" | "callbackTimeoutMs" | "callbackAuthToken"
  >,
  runId: string
): Promise<RunnerControlStatePayload> {
  const endpoint = buildRunnerControlStateUrl(config.callbackBaseUrl as string, runId);
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), config.callbackTimeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: "GET",
      headers: createRunnerControlHeaders(config),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`runner control-state failed with status ${response.status}`);
    }

    const envelope = await response.json() as { data?: unknown };
    return parseRunnerControlState(envelope.data);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`runner control-state timed out after ${config.callbackTimeoutMs}ms`);
    }

    throw error;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

function createRunnerControlHeaders(
  config: Pick<RunnerConfig, "workerId" | "callbackAuthToken">
): Record<string, string> {
  const headers: Record<string, string> = {
    accept: "application/json",
    "x-worker-id": config.workerId
  };

  if (config.callbackAuthToken) {
    headers.authorization = `Bearer ${config.callbackAuthToken}`;
  }

  return headers;
}

function buildRunnerControlStateUrl(baseUrl: string, runId: string): string {
  const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  return `${normalizedBaseUrl}/internal/runner/runs/${runId}/control-state`;
}

function parseRunnerControlState(data: unknown): RunnerControlStatePayload {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("runner control-state response must include data object");
  }

  const candidate = data as Partial<RunnerControlStatePayload>;
  if (typeof candidate.runId !== "string" || typeof candidate.status !== "string" || typeof candidate.stopRequested !== "boolean") {
    throw new Error("runner control-state response has invalid data shape");
  }

  return {
    runId: candidate.runId,
    status: candidate.status as RunnerControlStatePayload["status"],
    stopRequested: candidate.stopRequested,
    resultCompleteness: candidate.resultCompleteness
  };
}
