import type { CallbackClient } from "../callback/index.ts";
import { errorMessage, isRecord, logOperationalEvent, toIsoTimestamp } from "../shared/utils.ts";
import { RunnerMessageValidationError } from "./validators/common.ts";

export const RUNNER_MESSAGE_VALIDATION_FAILURE_CODE = "RUNNER_MESSAGE_VALIDATION_FAILED";

export interface RunMessageValidationFailureInput {
  rawMessage: string;
  error: RunnerMessageValidationError;
  callbackClient: CallbackClient;
  workerId: string;
}

export async function notifyRunMessageValidationFailure({
  rawMessage,
  error,
  callbackClient,
  workerId
}: RunMessageValidationFailureInput): Promise<void> {
  const context = extractRunValidationFailureContext(rawMessage);

  logOperationalEvent(
    "messaging",
    "message_validation_failed",
    {
      messageType: context.messageType ?? null,
      runId: context.runId ?? null,
      failureCode: RUNNER_MESSAGE_VALIDATION_FAILURE_CODE,
      failureMessage: error.message
    },
    "error"
  );

  if (!context.runId) {
    logOperationalEvent(
      "messaging",
      "message_validation_failed_without_run_id",
      {
        messageType: context.messageType ?? null,
        failureCode: RUNNER_MESSAGE_VALIDATION_FAILURE_CODE,
        failureMessage: error.message
      },
      "warn"
    );
    return;
  }

  try {
    await callbackClient.sendFailed(context.runId, {
      workerId,
      failedAt: toIsoTimestamp(),
      failureCode: RUNNER_MESSAGE_VALIDATION_FAILURE_CODE,
      failureMessage: `Invalid runner MQ message: ${errorMessage(error)}`,
      resultCompleteness: "NONE"
    });
  } catch (callbackError) {
    logOperationalEvent(
      "messaging",
      "message_validation_failed_callback_failed",
      {
        messageType: context.messageType ?? null,
        runId: context.runId,
        failureCode: RUNNER_MESSAGE_VALIDATION_FAILURE_CODE,
        failureMessage: error.message,
        callbackErrorMessage: errorMessage(callbackError)
      },
      "error"
    );
  }
}

export function extractRunValidationFailureContext(rawMessage: string): {
  messageType?: string;
  runId?: string;
} {
  try {
    const parsed = JSON.parse(rawMessage) as unknown;
    if (!isRecord(parsed)) {
      return {};
    }

    const messageType = typeof parsed.messageType === "string" ? parsed.messageType : undefined;
    const payload = isRecord(parsed.payload) ? parsed.payload : undefined;
    const runId = readRunId(payload);

    return {
      messageType,
      runId
    };
  } catch {
    return {};
  }
}

function readRunId(payload: Record<string, unknown> | undefined): string | undefined {
  if (!payload) {
    return undefined;
  }

  if (typeof payload.runId === "string" && payload.runId.length > 0) {
    return payload.runId;
  }

  const agentTask = isRecord(payload.agentTask) ? payload.agentTask : undefined;
  if (typeof agentTask?.run_id === "string" && agentTask.run_id.length > 0) {
    return agentTask.run_id;
  }

  return undefined;
}
