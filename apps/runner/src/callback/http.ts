import { createHmac, randomUUID } from "node:crypto";
import type { RunnerConfig } from "../config/index.ts";
import type { CallbackClient } from "./index.ts";

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
    sendAccepted: (runId, payload) => postRunnerCallback(config, runId, "accepted", payload),
    sendStepEvents: (runId, payload) => postRunnerCallback(config, runId, "step-events", payload),
    sendArtifacts: (runId, payload) => postRunnerCallback(config, runId, "artifacts", payload),
    sendCheckpoints: (runId, payload) => postRunnerCallback(config, runId, "checkpoints", payload),
    sendFinished: (runId, payload) => postRunnerCallback(config, runId, "finished", payload),
    sendFailed: (runId, payload) => postRunnerCallback(config, runId, "failed", payload)
  };
}

async function postRunnerCallback(
  config: Pick<
    RunnerConfig,
    "workerId" | "callbackBaseUrl" | "callbackTimeoutMs" | "callbackAuthToken" | "callbackSignatureSecret"
  >,
  runId: string,
  callbackType: RunnerCallbackType,
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

function buildRunnerCallbackUrl(baseUrl: string, runId: string, callbackType: RunnerCallbackType): string {
  const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  return `${normalizedBaseUrl}/internal/runner/runs/${runId}/${callbackType}`;
}

type RunnerCallbackType = "accepted" | "step-events" | "artifacts" | "checkpoints" | "finished" | "failed";
