import type { CallbackClient } from "../callback/index.ts";
import type { DeliveryIssue } from "../delivery/index.ts";
import type { ScenarioExecutionSummary } from "../scenario/executor/index.ts";
import { errorMessage, toIsoTimestamp } from "../shared/utils.ts";

export interface AcceptedCallbackInput {
  callbackClient: CallbackClient;
  runId: string;
  workerId: string;
  browserSessionId: string;
}

export interface FinishedCallbackInput {
  callbackClient: CallbackClient;
  runId: string;
  workerId: string;
  summary: ScenarioExecutionSummary;
}

export interface FailedCallbackInput {
  callbackClient: CallbackClient;
  runId: string;
  workerId: string;
  error: unknown;
  accepted: boolean;
  hasSession: boolean;
}

export async function emitAcceptedCallback({
  callbackClient,
  runId,
  workerId,
  browserSessionId
}: AcceptedCallbackInput): Promise<void> {
  await callbackClient.sendAccepted(runId, {
    workerId,
    acceptedAt: toIsoTimestamp(),
    browserSessionId
  });
}

export async function emitFinishedCallback({
  callbackClient,
  runId,
  workerId,
  summary
}: FinishedCallbackInput): Promise<DeliveryIssue[]> {
  try {
    await callbackClient.sendFinished(runId, {
      workerId,
      executionFinishedAt: toIsoTimestamp(),
      summary
    });
    return [];
  } catch (error) {
    return [
      {
        scope: "finished-callback",
        message: `finished callback failed: ${errorMessage(error)}`
      }
    ];
  }
}

export async function emitFailedCallback({
  callbackClient,
  runId,
  workerId,
  error,
  accepted,
  hasSession
}: FailedCallbackInput): Promise<void> {
  if (!hasSession) {
    return;
  }

  try {
    await callbackClient.sendFailed(runId, {
      workerId,
      failedAt: toIsoTimestamp(),
      failureCode: "RUNNER_EXECUTION_FAILED",
      failureMessage: errorMessage(error),
      resultCompleteness: accepted ? "PARTIAL" : "NONE"
    });
  } catch (sendFailedError) {
    throw new Error(
      `runner execution failed: ${errorMessage(error)}; failed callback emission failed: ${errorMessage(sendFailedError)}`
    );
  }
}
