import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { RunnerConfig } from "../config/index.ts";
import type {
  ArtifactBatch,
  RunnerAcceptedPayload,
  RunnerCheckpointsRequest,
  RunnerFailedPayload,
  RunnerFinishedPayload,
  StepEventBatch
} from "../shared/contracts.ts";
import { toIsoTimestamp } from "../shared/utils.ts";

export interface CallbackClient {
  sendAccepted: (runId: string, payload: RunnerAcceptedPayload) => Promise<void>;
  sendStepEvents: (runId: string, payload: StepEventBatch) => Promise<void>;
  sendArtifacts: (runId: string, payload: ArtifactBatch) => Promise<void>;
  sendCheckpoints: (runId: string, payload: RunnerCheckpointsRequest) => Promise<void>;
  sendFinished: (runId: string, payload: RunnerFinishedPayload) => Promise<void>;
  sendFailed: (runId: string, payload: RunnerFailedPayload) => Promise<void>;
}

interface CallbackRecord {
  callbackType: string;
  runId: string;
  emittedAt: string;
  payload: unknown;
}

export function createCallbackClient(config: RunnerConfig): CallbackClient {
  async function emit(callbackType: string, runId: string, payload: unknown): Promise<void> {
    const record: CallbackRecord = {
      callbackType,
      runId,
      emittedAt: toIsoTimestamp(),
      payload
    };

    await mkdir(dirname(config.callbackLogFile), { recursive: true });
    await appendFile(config.callbackLogFile, `${JSON.stringify(record)}\n`, "utf8");
  }

  return {
    sendAccepted: (runId, payload) => emit("accepted", runId, payload),
    sendStepEvents: (runId, payload) => emit("step-events", runId, payload),
    sendArtifacts: (runId, payload) => emit("artifacts", runId, payload),
    sendCheckpoints: (runId, payload) => emit("checkpoints", runId, payload),
    sendFinished: (runId, payload) => emit("finished", runId, payload),
    sendFailed: (runId, payload) => emit("failed", runId, payload)
  };
}
