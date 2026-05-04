import type {
  Artifact,
  ScenarioActionType,
  SettleStrategyType
} from "../../../../packages/contracts/types/runner.ts";

export type {
  Artifact,
  ArtifactBatch,
  Checkpoint,
  DiscoveryEntrypointCandidate,
  DiscoveryEntrypointType,
  DiscoveryExecuteMessage,
  DiscoveryAcceptedPayload,
  DiscoveryFinishedPayload,
  DiscoveryFailedPayload,
  DiscoverySummaryPayload,
  DiscoveryExecutePayload,
  DiscoveryFlowCandidate,
  DiscoveryFlowType,
  DiscoveryRecommendationLevel,
  DiscoveryScenarioRecommendation,
  RunExecuteMessage,
  RunnerAcceptedPayload,
  RunnerCheckpointsRequest,
  RunnerFailedPayload,
  RunnerFinishedPayload,
  ScenarioAction,
  ScenarioActionType,
  ScenarioPlan,
  ScenarioStage,
  ScenarioStep,
  SettleStrategy,
  SettleStrategyType,
  SiteDiscoveryResult,
  StepEvent,
  StepEventBatch,
  TargetDescriptor,
  TargetDescriptorMap
} from "../../../../packages/contracts/types/runner.ts";

export interface ArtifactDraft {
  artifactId: string;
  artifactType: Artifact["artifactType"];
  stepKey: string;
  mimeType: string;
  fileExtension: string;
  content: string;
  contentEncoding?: "utf8" | "base64";
  width?: number;
  height?: number;
}

export const scenarioActionTypes = [
  "goto",
  "click",
  "fill",
  "select",
  "scroll",
  "hover",
  "wait_for",
  "checkpoint",
  "stop_when"
] as const satisfies readonly ScenarioActionType[];

export const settleStrategyTypes = [
  "network_idle",
  "locator_visible",
  "response",
  "url_change",
  "spinner_hidden",
  "item_count_change",
  "fixed_short",
  "none"
] as const satisfies readonly SettleStrategyType[];
