import type {
  ArtifactBatch,
  RunnerAcceptedPayload,
  RunnerCheckpointsRequest,
  RunnerFailedPayload,
  RunnerFinishedPayload,
  StepEventBatch
} from "../shared/contracts.ts";

export type CallbackPayloadMap = {
  accepted: RunnerAcceptedPayload;
  "step-events": StepEventBatch;
  artifacts: ArtifactBatch;
  checkpoints: RunnerCheckpointsRequest;
  finished: RunnerFinishedPayload;
  failed: RunnerFailedPayload;
};

export type CallbackType = keyof CallbackPayloadMap;

export interface CallbackClient {
  sendAccepted: (runId: string, payload: RunnerAcceptedPayload) => Promise<void>;
  sendStepEvents: (runId: string, payload: StepEventBatch) => Promise<void>;
  sendArtifacts: (runId: string, payload: ArtifactBatch) => Promise<void>;
  sendCheckpoints: (runId: string, payload: RunnerCheckpointsRequest) => Promise<void>;
  sendFinished: (runId: string, payload: RunnerFinishedPayload) => Promise<void>;
  sendFailed: (runId: string, payload: RunnerFailedPayload) => Promise<void>;
}

const CALLBACK_METHOD_NAMES = {
  accepted: "sendAccepted",
  "step-events": "sendStepEvents",
  artifacts: "sendArtifacts",
  checkpoints: "sendCheckpoints",
  finished: "sendFinished",
  failed: "sendFailed"
} as const satisfies Record<CallbackType, keyof CallbackClient>;

export function createCallbackClientFromHandler(
  handler: <T extends CallbackType>(callbackType: T, runId: string, payload: CallbackPayloadMap[T]) => Promise<void>
): CallbackClient {
  return {
    sendAccepted: (runId, payload) => handler("accepted", runId, payload),
    sendStepEvents: (runId, payload) => handler("step-events", runId, payload),
    sendArtifacts: (runId, payload) => handler("artifacts", runId, payload),
    sendCheckpoints: (runId, payload) => handler("checkpoints", runId, payload),
    sendFinished: (runId, payload) => handler("finished", runId, payload),
    sendFailed: (runId, payload) => handler("failed", runId, payload)
  };
}

export async function dispatchCallback(
  callbackClient: CallbackClient,
  callbackType: CallbackType,
  runId: string,
  payload: unknown
): Promise<void> {
  const methodName = CALLBACK_METHOD_NAMES[callbackType];
  const method = callbackClient[methodName] as (runId: string, payload: unknown) => Promise<void>;
  await method(runId, payload);
}
