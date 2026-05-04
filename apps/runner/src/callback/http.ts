import { createHmac, randomUUID } from "node:crypto";
import type { RunnerConfig } from "../config/index.ts";
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

  return createCallbackClientFromHandler((callbackType, runId, payload) =>
    postRunnerCallback(config, runId, callbackType, payload)
  );
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
  const eventId = randomUUID();
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

  return createHmac("sha256", secret).update(body).digest("hex");
}

function buildRunnerCallbackUrl(baseUrl: string, resourceId: string, callbackType: CallbackType): string {
  const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  if (callbackType.startsWith("discovery-")) {
    const discoveryCallbackType = callbackType.replace("discovery-", "");
    return `${normalizedBaseUrl}/internal/runner/discoveries/${resourceId}/${discoveryCallbackType}`;
  }

  return `${normalizedBaseUrl}/internal/runner/runs/${resourceId}/${callbackType}`;
}
