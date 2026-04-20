import type {
  Artifact,
  ArtifactBatch,
  Checkpoint,
  RunnerCheckpointsRequest
} from "../../shared/contracts.ts";

export function createArtifactBatch(artifacts: Artifact[]): ArtifactBatch {
  return {
    artifacts
  };
}

export function createCheckpointRequest(
  checkpoint: Omit<Checkpoint, "artifactRefs">,
  artifacts: Artifact[]
): RunnerCheckpointsRequest {
  return {
    checkpoints: [
      {
        ...checkpoint,
        artifactRefs: artifacts.map((artifact) => artifact.artifactId)
      }
    ]
  };
}
