import type { RunnerConfig } from "../config/index.ts";
import { errorMessage, logOperationalEvent, sleep } from "../shared/utils.ts";
import {
  createCallbackClientFromHandler,
  dispatchCallback as dispatchCallbackClient,
  type CallbackClient,
  type CallbackType
} from "./client.ts";
import { createFileCallbackClient } from "./file.ts";
import { createHttpCallbackClient, RunnerCallbackHttpError } from "./http.ts";
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
  let nonRetryable = false;
  const maxAttempts = config.callbackRetryDelaysMs.length + 1;
  const appendOutboxOnFailure = options.appendOutboxOnFailure ?? true;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await dispatchCallbackClient(callbackClient, callbackType, runId, payload);
      if (failureCount > 0) {
        logOperationalEvent(
          "callback",
          "retry_sequence_recovered",
          createCallbackRetryLogDetails({
            callbackType,
            runId,
            failedAttempts: failureCount,
            recoveredOnAttempt: attempt,
            maxAttempts,
            firstErrorMessage,
            lastErrorMessage: errorMessage(lastError),
            appendOutboxOnFailure,
            terminalAction: "recovered"
          }),
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

      if (isNonRetryableCallbackError(error)) {
        nonRetryable = true;
        logOperationalEvent(
          "callback",
          "non_retryable_failure_detected",
          {
            callbackType,
            runId,
            failedAttempts: failureCount,
            maxAttempts,
            errorMessage: errorMessage(error),
            httpStatus: readCallbackHttpStatus(error),
            responseBodySummary: readCallbackHttpResponseBody(error)
          },
          "error"
        );
        break;
      }

      if (attempt < maxAttempts) {
        await sleep(config.callbackRetryDelaysMs[attempt - 1] ?? 0);
        continue;
      }
    }
  }

  const lastErrorMessage = errorMessage(lastError);
  const attemptedCount = nonRetryable ? failureCount : maxAttempts;
  logOperationalEvent(
    "callback",
    "retry_sequence_exhausted",
    createCallbackRetryLogDetails({
      callbackType,
      runId,
      failedAttempts: failureCount,
      maxAttempts,
      firstErrorMessage,
      lastErrorMessage,
      appendOutboxOnFailure,
      terminalAction: nonRetryable ? "throw_non_retryable" : appendOutboxOnFailure ? "append_outbox_then_throw" : "throw",
      nonRetryable
    }),
    "error"
  );

  if (appendOutboxOnFailure && !nonRetryable) {
    try {
      await appendCallbackOutboxRecord(config, {
        callbackType,
        runId,
        payload,
        attempts: attemptedCount,
        errorMessage: lastErrorMessage
      });
      logOperationalEvent(
        "callback",
        "outbox_record_appended",
        {
          callbackType,
          runId,
          attempts: attemptedCount,
          errorMessage: lastErrorMessage,
          outboxAction: "appended",
          httpStatus: readCallbackHttpStatus(lastError)
        },
        "error"
      );
    } catch (outboxError) {
      throw new Error(
        `runner callback ${callbackType} failed after ${attemptedCount} attempts: ${lastErrorMessage}; outbox persistence failed: ${errorMessage(outboxError)}`
      );
    }
  }

  throw new Error(`runner callback ${callbackType} failed after ${attemptedCount} attempts: ${lastErrorMessage}`);
}

function createCallbackRetryLogDetails(input: {
  callbackType: CallbackType;
  runId: string;
  failedAttempts: number;
  recoveredOnAttempt?: number;
  maxAttempts: number;
  firstErrorMessage: string | null;
  lastErrorMessage: string;
  appendOutboxOnFailure: boolean;
  terminalAction: "recovered" | "append_outbox_then_throw" | "throw" | "throw_non_retryable";
  nonRetryable?: boolean;
}): Record<string, unknown> {
  return {
    callbackType: input.callbackType,
    runId: input.runId,
    failedAttempts: input.failedAttempts,
    recoveredOnAttempt: input.recoveredOnAttempt,
    maxAttempts: input.maxAttempts,
    firstErrorMessage: input.firstErrorMessage,
    lastErrorMessage: input.lastErrorMessage,
    httpStatus: readCallbackHttpStatus(input.lastErrorMessage),
    outboxEnabled: input.appendOutboxOnFailure,
    terminalAction: input.terminalAction,
    nonRetryable: input.nonRetryable ?? false,
    responseBodySummary: readCallbackHttpResponseBody(input.lastErrorMessage)
  };
}

export function isNonRetryableCallbackError(error: unknown): boolean {
  const status = readCallbackHttpStatus(error);
  return status === 400 || status === 404 || status === 409;
}

export function readCallbackHttpStatus(error: unknown): number | null {
  if (error instanceof RunnerCallbackHttpError) {
    return error.status;
  }

  return parseHttpStatus(errorMessage(error));
}

export function readCallbackHttpResponseBody(error: unknown): string | null {
  if (error instanceof RunnerCallbackHttpError) {
    return error.responseBody || null;
  }

  const message = typeof error === "string" ? error : errorMessage(error);
  const match = /status\s+\d{3}:\s+(.+)$/i.exec(message);
  return match?.[1] ?? null;
}

function parseHttpStatus(message: string): number | null {
  const match = /status\s+(\d{3})\b/i.exec(message);
  if (!match) {
    return null;
  }
  return Number.parseInt(match[1], 10);
}
