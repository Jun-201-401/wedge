import type { RunnerConfig } from "../config/index.ts";
import { errorMessage, logOperationalEvent, sleep } from "../shared/utils.ts";
import {
  createCallbackClientFromHandler,
  dispatchCallback as dispatchCallbackClient,
  type CallbackClient,
  type CallbackType
} from "./client.ts";
import { createFileCallbackClient } from "./file.ts";
import { createHttpCallbackClient } from "./http.ts";
import { appendCallbackOutboxRecord } from "./outbox.ts";

export type { CallbackClient, CallbackType } from "./client.ts";

export function createCallbackClient(config: RunnerConfig): CallbackClient {
  const transportClient = createCallbackTransportClient(config);

  return {
    ...createCallbackClientFromHandler((callbackType, runId, payload) =>
      sendWithRetry(config, transportClient, callbackType, runId, payload)
    ),
    readRunControlState: transportClient.readRunControlState
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
  return dispatchCallbackClient(callbackClient, callbackType, runId, payload);
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
      await dispatchCallbackClient(callbackClient, callbackType, runId, payload);
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
