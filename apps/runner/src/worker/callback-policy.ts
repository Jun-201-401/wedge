import type { CallbackClient } from "../callback/index.ts";
import { createDeliveryIssue, type DeliveryIssue } from "../delivery/index.ts";
import type { ScenarioExecutionSummary } from "../scenario/executor/index.ts";
import type { RunnerFailedPayload } from "../shared/contracts.ts";
import { classifyRunnerFailure, errorMessage, toIsoTimestamp, type RunnerFailureCode } from "../shared/utils.ts";

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
  summary?: ScenarioExecutionSummary;
  failedStepKey?: string;
  failedStepOrder?: number;
  lastCheckpointId?: string;
  failureCode?: RunnerFailureCode;
  failureArtifactRefs?: string[];
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
      createDeliveryIssue({
        scope: "finished-callback",
        message: `finished callback failed: ${errorMessage(error)}`
      })
    ];
  }
}

export async function emitFailedCallback({
  callbackClient,
  runId,
  workerId,
  error,
  accepted,
  hasSession,
  summary,
  failedStepKey,
  failedStepOrder,
  lastCheckpointId,
  failureCode,
  failureArtifactRefs
}: FailedCallbackInput): Promise<void> {
  if (!hasSession) {
    return;
  }

  try {
    await callbackClient.sendFailed(runId, {
      workerId,
      failedAt: toIsoTimestamp(),
      failureCode: failureCode ?? classifyRunnerFailure(error),
      failureMessage: errorMessage(error),
      resultCompleteness: resolveFailureResultCompleteness({
        accepted,
        summary,
        lastCheckpointId,
        failureArtifactRefs
      }),
      summary,
      failedStepKey,
      failedStepOrder,
      lastCheckpointId,
      failureArtifactRefs: failureArtifactRefs && failureArtifactRefs.length > 0 ? failureArtifactRefs : undefined
    });
  } catch (sendFailedError) {
    throw new Error(
      `runner execution failed: ${errorMessage(error)}; failed callback emission failed: ${errorMessage(sendFailedError)}`
    );
  }
}

export function resolveFailureResultCompleteness({
  accepted,
  summary,
  lastCheckpointId,
  failureArtifactRefs
}: {
  accepted: boolean;
  summary?: ScenarioExecutionSummary;
  lastCheckpointId?: string;
  failureArtifactRefs?: string[];
}): RunnerFailedPayload["resultCompleteness"] {
  if (!accepted) {
    return "NONE";
  }

  const hasCompletedCheckpointPath = (summary?.completedStepCount ?? 0) > 0;
  const hasFailureCheckpoint = typeof lastCheckpointId === "string" && lastCheckpointId.length > 0;
  const hasFailureArtifact = (failureArtifactRefs?.length ?? 0) > 0;

  return hasCompletedCheckpointPath || hasFailureCheckpoint || hasFailureArtifact ? "PARTIAL" : "NONE";
}
