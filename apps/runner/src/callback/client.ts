import type {
  ArtifactBatch,
  DiscoveryAcceptedPayload,
  DiscoveryCheckpointRequest,
  DiscoveryFailedPayload,
  DiscoveryFinishedPayload,
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
  "discovery-accepted": DiscoveryAcceptedPayload;
  "discovery-checkpoints": DiscoveryCheckpointRequest;
  "discovery-finished": DiscoveryFinishedPayload;
  "discovery-failed": DiscoveryFailedPayload;
};

export type CallbackType = keyof CallbackPayloadMap;

export interface CallbackClient {
  sendAccepted: (runId: string, payload: RunnerAcceptedPayload) => Promise<void>;
  sendStepEvents: (runId: string, payload: StepEventBatch) => Promise<void>;
  sendArtifacts: (runId: string, payload: ArtifactBatch) => Promise<void>;
  sendCheckpoints: (runId: string, payload: RunnerCheckpointsRequest) => Promise<void>;
  sendFinished: (runId: string, payload: RunnerFinishedPayload) => Promise<void>;
  sendFailed: (runId: string, payload: RunnerFailedPayload) => Promise<void>;
  sendDiscoveryAccepted?: (discoveryId: string, payload: DiscoveryAcceptedPayload) => Promise<void>;
  sendDiscoveryCheckpoints?: (discoveryId: string, payload: DiscoveryCheckpointRequest) => Promise<void>;
  sendDiscoveryFinished?: (discoveryId: string, payload: DiscoveryFinishedPayload) => Promise<void>;
  sendDiscoveryFailed?: (discoveryId: string, payload: DiscoveryFailedPayload) => Promise<void>;
}

const CALLBACK_METHOD_NAMES = {
  accepted: "sendAccepted",
  "step-events": "sendStepEvents",
  artifacts: "sendArtifacts",
  checkpoints: "sendCheckpoints",
  finished: "sendFinished",
  failed: "sendFailed",
  "discovery-accepted": "sendDiscoveryAccepted",
  "discovery-checkpoints": "sendDiscoveryCheckpoints",
  "discovery-finished": "sendDiscoveryFinished",
  "discovery-failed": "sendDiscoveryFailed"
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
    sendFailed: (runId, payload) => handler("failed", runId, payload),
    sendDiscoveryAccepted: (discoveryId, payload) => handler("discovery-accepted", discoveryId, payload),
    sendDiscoveryCheckpoints: (discoveryId, payload) => handler("discovery-checkpoints", discoveryId, payload),
    sendDiscoveryFinished: (discoveryId, payload) => handler("discovery-finished", discoveryId, payload),
    sendDiscoveryFailed: (discoveryId, payload) => handler("discovery-failed", discoveryId, payload)
  };
}

export async function dispatchCallback(
  callbackClient: CallbackClient,
  callbackType: CallbackType,
  runId: string,
  payload: unknown
): Promise<void> {
  const methodName = CALLBACK_METHOD_NAMES[callbackType];
  const method = callbackClient[methodName] as ((runId: string, payload: unknown) => Promise<void>) | undefined;
  if (!method) {
    throw new Error(`runner callback ${callbackType} is not supported by this client`);
  }
  await method(runId, payload);
}
