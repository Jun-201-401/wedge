import type {
  AgentEventBatch,
  AgentTraceCallbackPayload,
  ArtifactBatch,
  DiscoveryAcceptedPayload,
  DiscoveryCheckpointRequest,
  DiscoveryFailedPayload,
  DiscoveryFinishedPayload,
  ScenarioAuthoringAcceptedPayload,
  ScenarioAuthoringFailedPayload,
  ScenarioAuthoringFinishedPayload,
  RunnerAcceptedPayload,
  RunnerCheckpointsRequest,
  RunnerControlStatePayload,
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
  "agent-events": AgentEventBatch;
  "agent-traces": AgentTraceCallbackPayload;
  "discovery-accepted": DiscoveryAcceptedPayload;
  "discovery-checkpoints": DiscoveryCheckpointRequest;
  "discovery-finished": DiscoveryFinishedPayload;
  "discovery-failed": DiscoveryFailedPayload;
  "scenario-authoring-accepted": ScenarioAuthoringAcceptedPayload;
  "scenario-authoring-finished": ScenarioAuthoringFinishedPayload;
  "scenario-authoring-failed": ScenarioAuthoringFailedPayload;
};

export type CallbackType = keyof CallbackPayloadMap;

export interface CallbackClient {
  sendAccepted: (runId: string, payload: RunnerAcceptedPayload) => Promise<void>;
  sendStepEvents: (runId: string, payload: StepEventBatch) => Promise<void>;
  sendArtifacts: (runId: string, payload: ArtifactBatch) => Promise<void>;
  sendCheckpoints: (runId: string, payload: RunnerCheckpointsRequest) => Promise<void>;
  sendFinished: (runId: string, payload: RunnerFinishedPayload) => Promise<void>;
  sendFailed: (runId: string, payload: RunnerFailedPayload) => Promise<void>;
  sendAgentEvents: (runId: string, payload: AgentEventBatch) => Promise<void>;
  sendAgentTrace: (runId: string, payload: AgentTraceCallbackPayload) => Promise<void>;
  sendDiscoveryAccepted?: (discoveryId: string, payload: DiscoveryAcceptedPayload) => Promise<void>;
  sendDiscoveryCheckpoints?: (discoveryId: string, payload: DiscoveryCheckpointRequest) => Promise<void>;
  sendDiscoveryFinished?: (discoveryId: string, payload: DiscoveryFinishedPayload) => Promise<void>;
  sendDiscoveryFailed?: (discoveryId: string, payload: DiscoveryFailedPayload) => Promise<void>;
  sendScenarioAuthoringAccepted?: (authoringJobId: string, payload: ScenarioAuthoringAcceptedPayload) => Promise<void>;
  sendScenarioAuthoringFinished?: (authoringJobId: string, payload: ScenarioAuthoringFinishedPayload) => Promise<void>;
  sendScenarioAuthoringFailed?: (authoringJobId: string, payload: ScenarioAuthoringFailedPayload) => Promise<void>;
  readRunControlState?: (runId: string) => Promise<RunnerControlStatePayload>;
}

const CALLBACK_METHOD_NAMES = {
  accepted: "sendAccepted",
  "step-events": "sendStepEvents",
  artifacts: "sendArtifacts",
  checkpoints: "sendCheckpoints",
  finished: "sendFinished",
  failed: "sendFailed",
  "agent-events": "sendAgentEvents",
  "agent-traces": "sendAgentTrace",
  "discovery-accepted": "sendDiscoveryAccepted",
  "discovery-checkpoints": "sendDiscoveryCheckpoints",
  "discovery-finished": "sendDiscoveryFinished",
  "discovery-failed": "sendDiscoveryFailed",
  "scenario-authoring-accepted": "sendScenarioAuthoringAccepted",
  "scenario-authoring-finished": "sendScenarioAuthoringFinished",
  "scenario-authoring-failed": "sendScenarioAuthoringFailed"
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
    sendAgentEvents: (runId, payload) => handler("agent-events", runId, payload),
    sendAgentTrace: (runId, payload) => handler("agent-traces", runId, payload),
    sendDiscoveryAccepted: (discoveryId, payload) => handler("discovery-accepted", discoveryId, payload),
    sendDiscoveryCheckpoints: (discoveryId, payload) => handler("discovery-checkpoints", discoveryId, payload),
    sendDiscoveryFinished: (discoveryId, payload) => handler("discovery-finished", discoveryId, payload),
    sendDiscoveryFailed: (discoveryId, payload) => handler("discovery-failed", discoveryId, payload),
    sendScenarioAuthoringAccepted: (authoringJobId, payload) => handler("scenario-authoring-accepted", authoringJobId, payload),
    sendScenarioAuthoringFinished: (authoringJobId, payload) => handler("scenario-authoring-finished", authoringJobId, payload),
    sendScenarioAuthoringFailed: (authoringJobId, payload) => handler("scenario-authoring-failed", authoringJobId, payload)
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
