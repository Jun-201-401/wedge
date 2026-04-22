import type { BrowserCapturedArtifacts, BrowserSession } from "../../browser/playwright/index.ts";
import type { CallbackClient } from "../../callback/index.ts";
import type { CapturePipeline } from "../../capture/index.ts";
import type { DeliveryIssue } from "../../delivery/index.ts";
import type { ArtifactStore } from "../../storage/index.ts";
import type { ScenarioPlan, ScenarioStep } from "../../shared/contracts.ts";
import { errorMessage } from "../../shared/utils.ts";
import { createArtifactBatch, createCheckpointRequest } from "./checkpoint-payloads.ts";

export interface CheckpointEmissionInput {
  runId: string;
  stepOrder: number;
  step: ScenarioStep;
  plan: ScenarioPlan;
  pageSnapshot: ReturnType<BrowserSession["snapshot"]>;
  settleResult: Awaited<ReturnType<BrowserSession["settle"]>>;
  capturedArtifacts?: BrowserCapturedArtifacts;
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
  capturedArtifacts,
  callbackClient,
  capturePipeline,
  artifactStore
}: CheckpointEmissionInput): Promise<DeliveryIssue[]> {
  const deliveryIssues: DeliveryIssue[] = [];
  const checkpointCollection = await capturePipeline.collectCheckpoint({
    step,
    stepOrder,
    plan,
    pageSnapshot,
    settleResult,
    capturedArtifacts
  });

  let storedArtifacts = [] as Awaited<ReturnType<ArtifactStore["persistArtifacts"]>>;

  try {
    storedArtifacts = await artifactStore.persistArtifacts({
      runId,
      artifacts: checkpointCollection.artifacts
    });
  } catch (error) {
    deliveryIssues.push({
      scope: "artifact-storage",
      stepKey: step.step_id,
      message: `artifact storage failed: ${errorMessage(error)}`
    });
  }

  if (storedArtifacts.length > 0) {
    try {
      await callbackClient.sendArtifacts(runId, createArtifactBatch(storedArtifacts));
    } catch (error) {
      deliveryIssues.push({
        scope: "artifacts-callback",
        stepKey: step.step_id,
        message: `artifact callback failed: ${errorMessage(error)}`
      });
    }
  }

  try {
    await callbackClient.sendCheckpoints(runId, createCheckpointRequest(checkpointCollection.checkpoint, storedArtifacts));
  } catch (error) {
    deliveryIssues.push({
      scope: "checkpoints-callback",
      stepKey: step.step_id,
      message: `checkpoint callback failed: ${errorMessage(error)}`
    });
  }

  return deliveryIssues;
}
