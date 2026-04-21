import type { Artifact } from "../../../../packages/contracts/types/runner.ts";

export type {
  Artifact,
  ArtifactBatch,
  Checkpoint,
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
