import type { RunnerConfig } from "../config/index.ts";
import type {
  ArtifactBatch,
  RunnerAcceptedPayload,
  RunnerCheckpointsRequest,
  RunnerFailedPayload,
  RunnerFinishedPayload,
  StepEventBatch
} from "../shared/contracts.ts";
import { createFileCallbackClient } from "./file.ts";
import { createHttpCallbackClient } from "./http.ts";

export interface CallbackClient {
  sendAccepted: (runId: string, payload: RunnerAcceptedPayload) => Promise<void>;
  sendStepEvents: (runId: string, payload: StepEventBatch) => Promise<void>;
  sendArtifacts: (runId: string, payload: ArtifactBatch) => Promise<void>;
  sendCheckpoints: (runId: string, payload: RunnerCheckpointsRequest) => Promise<void>;
  sendFinished: (runId: string, payload: RunnerFinishedPayload) => Promise<void>;
  sendFailed: (runId: string, payload: RunnerFailedPayload) => Promise<void>;
}

export function createCallbackClient(config: RunnerConfig): CallbackClient {
  if (config.callbackMode === "http") {
    return createHttpCallbackClient(config);
  }

  return createFileCallbackClient(config);
}
