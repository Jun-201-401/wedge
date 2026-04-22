import type { RunnerConfig } from "../config/index.ts";
import type {
  ArtifactBatch,
  RunnerAcceptedPayload,
  RunnerCheckpointsRequest,
  RunnerFailedPayload,
  RunnerFinishedPayload,
  StepEventBatch
} from "../shared/contracts.ts";
import { errorMessage, logOperationalEvent, sleep } from "../shared/utils.ts";
import { createFileCallbackClient } from "./file.ts";
import { createHttpCallbackClient } from "./http.ts";
import { appendCallbackOutboxRecord } from "./outbox.ts";

export type CallbackType = "accepted" | "step-events" | "artifacts" | "checkpoints" | "finished" | "failed";

export interface CallbackClient {
  sendAccepted: (runId: string, payload: RunnerAcceptedPayload) => Promise<void>;
  sendStepEvents: (runId: string, payload: StepEventBatch) => Promise<void>;
  sendArtifacts: (runId: string, payload: ArtifactBatch) => Promise<void>;
  sendCheckpoints: (runId: string, payload: RunnerCheckpointsRequest) => Promise<void>;
  sendFinished: (runId: string, payload: RunnerFinishedPayload) => Promise<void>;
  sendFailed: (runId: string, payload: RunnerFailedPayload) => Promise<void>;
}

export function createCallbackClient(config: RunnerConfig): CallbackClient {
  const transportClient = createCallbackTransportClient(config);

  return {
    sendAccepted: (runId, payload) => sendWithRetry(config, transportClient, "accepted", runId, payload),
    sendStepEvents: (runId, payload) =>
      sendWithRetry(config, transportClient, "step-events", runId, payload),
    sendArtifacts: (runId, payload) => sendWithRetry(config, transportClient, "artifacts", runId, payload),
    sendCheckpoints: (runId, payload) =>
      sendWithRetry(config, transportClient, "checkpoints", runId, payload),
    sendFinished: (runId, payload) => sendWithRetry(config, transportClient, "finished", runId, payload),
    sendFailed: (runId, payload) => sendWithRetry(config, transportClient, "failed", runId, payload)
  };
}

export function createCallbackTransportClient(
  config: Pick<
    RunnerConfig,
    | "workerId"
    | "callbackLogFile"
    | "callbackMode"
    | "callbackBaseUrl"
    | "callbackTimeoutMs"
    | "callbackAuthToken"
    | "callbackSignatureSecret"
  >
): CallbackClient {
  if (config.callbackMode === "http") {
    return createHttpCallbackClient(config);
  }

  return createFileCallbackClient(config);
}

export async function dispatchCallback(
  callbackClient: CallbackClient,
  callbackType: CallbackType,
  runId: string,
  payload: unknown
): Promise<void> {
  switch (callbackType) {
    case "accepted":
      return callbackClient.sendAccepted(runId, payload as RunnerAcceptedPayload);
    case "step-events":
      return callbackClient.sendStepEvents(runId, payload as StepEventBatch);
    case "artifacts":
      return callbackClient.sendArtifacts(runId, payload as ArtifactBatch);
    case "checkpoints":
      return callbackClient.sendCheckpoints(runId, payload as RunnerCheckpointsRequest);
    case "finished":
      return callbackClient.sendFinished(runId, payload as RunnerFinishedPayload);
    case "failed":
      return callbackClient.sendFailed(runId, payload as RunnerFailedPayload);
  }
}

export async function sendWithRetry(
  config: Pick<
    RunnerConfig,
    "callbackRetryDelaysMs" | "callbackOutboxFile" | "callbackOutboxRetentionMs" | "callbackOutboxMaxRecords"
  >,
  callbackClient: CallbackClient,
  callbackType: CallbackType,
  runId: string,
  payload: unknown,
  options: {
    appendOutboxOnFailure?: boolean;
  } = {}
): Promise<void> {
  let lastError: unknown;
  let firstErrorMessage: string | null = null;
  let failureCount = 0;
  const maxAttempts = config.callbackRetryDelaysMs.length + 1;
  const appendOutboxOnFailure = options.appendOutboxOnFailure ?? true;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await dispatchCallback(callbackClient, callbackType, runId, payload);
      if (failureCount > 0) {
        logOperationalEvent(
          "callback",
          "retry_sequence_recovered",
          {
            callbackType,
            runId,
            failedAttempts: failureCount,
            recoveredOnAttempt: attempt,
            maxAttempts,
            firstErrorMessage,
            lastErrorMessage: errorMessage(lastError)
          },
          "warn"
        );
      }
      return;
    } catch (error) {
      lastError = error;
      failureCount += 1;
      if (firstErrorMessage === null) {
        firstErrorMessage = errorMessage(error);
      }

      if (attempt < maxAttempts) {
        await sleep(config.callbackRetryDelaysMs[attempt - 1] ?? 0);
        continue;
      }
    }
  }

  const lastErrorMessage = errorMessage(lastError);
  logOperationalEvent(
    "callback",
    "retry_sequence_exhausted",
    {
      callbackType,
      runId,
      failedAttempts: failureCount,
      maxAttempts,
      firstErrorMessage,
      lastErrorMessage
    },
    "error"
  );

  if (appendOutboxOnFailure) {
    try {
      await appendCallbackOutboxRecord(config, {
        callbackType,
        runId,
        payload,
        attempts: maxAttempts,
        errorMessage: lastErrorMessage
      });
      logOperationalEvent(
        "callback",
        "outbox_record_appended",
        {
          callbackType,
          runId,
          attempts: maxAttempts,
          errorMessage: lastErrorMessage
        },
        "error"
      );
    } catch (outboxError) {
      throw new Error(
        `runner callback ${callbackType} failed after ${maxAttempts} attempts: ${lastErrorMessage}; outbox persistence failed: ${errorMessage(outboxError)}`
      );
    }
  }

  throw new Error(`runner callback ${callbackType} failed after ${maxAttempts} attempts: ${lastErrorMessage}`);
}
