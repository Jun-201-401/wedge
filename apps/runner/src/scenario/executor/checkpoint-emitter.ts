import type { BrowserSession } from "../../browser/playwright/index.ts";
import type { CallbackClient } from "../../callback/index.ts";
import type { CapturePipeline } from "../../capture/index.ts";
import type { ArtifactStore } from "../../storage/index.ts";
import type { ScenarioPlan, ScenarioStep } from "../../shared/contracts.ts";
import { createArtifactBatch, createCheckpointRequest } from "./checkpoint-payloads.ts";

export interface CheckpointEmissionInput {
  runId: string;
  stepOrder: number;
  step: ScenarioStep;
  plan: ScenarioPlan;
  pageSnapshot: ReturnType<BrowserSession["snapshot"]>;
  settleResult: Awaited<ReturnType<BrowserSession["settle"]>>;
  callbackClient: CallbackClient;
  capturePipeline: CapturePipeline;
  artifactStore: ArtifactStore;
}

export async function emitCheckpointArtifactsAndCallbacks({
  runId,
  stepOrder,
  step,
  plan,
  pageSnapshot,
  settleResult,
  callbackClient,
  capturePipeline,
  artifactStore
}: CheckpointEmissionInput): Promise<void> {
  const checkpointCollection = await capturePipeline.collectCheckpoint({
    step,
    stepOrder,
    plan,
    pageSnapshot,
    settleResult
  });

  const storedArtifacts = await artifactStore.persistArtifacts({
    runId,
    artifacts: checkpointCollection.artifacts
  });

  if (storedArtifacts.length > 0) {
    await callbackClient.sendArtifacts(runId, createArtifactBatch(storedArtifacts));
  }

  await callbackClient.sendCheckpoints(runId, createCheckpointRequest(checkpointCollection.checkpoint, storedArtifacts));
}
