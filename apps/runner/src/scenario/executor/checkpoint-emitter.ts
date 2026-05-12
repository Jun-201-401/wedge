import type { BrowserActionResult, BrowserCapturedArtifacts, BrowserSession } from "../../browser/playwright/index.ts";
import type { CallbackClient } from "../../callback/index.ts";
import type { CapturePipeline, JourneyDepthContext } from "../../capture/index.ts";
import type { DeliveryIssue } from "../../delivery/index.ts";
import type { ArtifactStore } from "../../storage/index.ts";
import type { ScenarioPlan, ScenarioStep } from "../../shared/contracts.ts";
import { errorMessage } from "../../shared/utils.ts";
import { createArtifactBatch, createCheckpointRequest } from "./checkpoint-payloads.ts";

export interface CheckpointEmissionResult {
  deliveryIssues: DeliveryIssue[];
  artifactRefs: string[];
}

export interface CheckpointEmissionInput {
  runId: string;
  stepOrder: number;
  step: ScenarioStep;
  plan: ScenarioPlan;
  beforeSnapshot?: ReturnType<BrowserSession["snapshot"]>;
  pageSnapshot: ReturnType<BrowserSession["snapshot"]>;
  actionResult?: BrowserActionResult;
  settleResult: Awaited<ReturnType<BrowserSession["settle"]>>;
  capturedArtifacts?: BrowserCapturedArtifacts;
  journeyDepthContext?: JourneyDepthContext;
  callbackClient: CallbackClient;
  capturePipeline: CapturePipeline;
  artifactStore: ArtifactStore;
}

export async function emitCheckpointArtifactsAndCallbacks({
  runId,
  stepOrder,
  step,
  plan,
  beforeSnapshot,
  pageSnapshot,
  actionResult,
  settleResult,
  capturedArtifacts,
  journeyDepthContext,
  callbackClient,
  capturePipeline,
  artifactStore
}: CheckpointEmissionInput): Promise<DeliveryIssue[]> {
  const result = await emitCheckpointCollection({
    runId,
    step,
    collection: await capturePipeline.collectCheckpoint({
      step,
      stepOrder,
      plan,
      beforeSnapshot,
      pageSnapshot,
      actionResult,
      settleResult,
      capturedArtifacts,
      journeyDepthContext
    }),
    callbackClient,
    artifactStore
  });

  return result.deliveryIssues;
}

export async function emitFailureCheckpointArtifactsAndCallbacks({
  runId,
  stepOrder,
  step,
  plan,
  failureCode,
  failureMessage,
  session,
  callbackClient,
  capturePipeline,
  artifactStore
}: {
  runId: string;
  stepOrder: number;
  step: ScenarioStep;
  plan: ScenarioPlan;
  failureCode: string;
  failureMessage: string;
  session: BrowserSession;
  callbackClient: CallbackClient;
  capturePipeline: CapturePipeline;
  artifactStore: ArtifactStore;
}): Promise<CheckpointEmissionResult> {
  try {
    const pageSnapshot = session.snapshot();
    const capturedArtifacts = await session.captureArtifacts(createFailureBrowserCaptureOptions(plan));
    const collection = await capturePipeline.collectCheckpoint({
      step,
      stepOrder,
      plan,
      pageSnapshot,
      settleResult: {
        strategy: step.settle_strategy.type,
        durationMs: 0,
        status: "failed",
        details: {
          failureCode,
          failureMessage,
          captureReason: "step_failure"
        }
      },
      capturedArtifacts
    });

    return await emitCheckpointCollection({
      runId,
      step,
      collection,
      callbackClient,
      artifactStore
    });
  } catch (error) {
    return {
      deliveryIssues: [
        {
          scope: "failure-capture",
          stepKey: step.step_id,
          message: `failure evidence capture failed: ${errorMessage(error)}`
        }
      ],
      artifactRefs: []
    };
  }
}

async function emitCheckpointCollection({
  runId,
  step,
  collection,
  callbackClient,
  artifactStore
}: {
  runId: string;
  step: ScenarioStep;
  collection: Awaited<ReturnType<CapturePipeline["collectCheckpoint"]>>;
  callbackClient: CallbackClient;
  artifactStore: ArtifactStore;
}): Promise<CheckpointEmissionResult> {
  const deliveryIssues: DeliveryIssue[] = [];

  let storedArtifacts = [] as Awaited<ReturnType<ArtifactStore["persistArtifacts"]>>;

  try {
    storedArtifacts = await artifactStore.persistArtifacts({
      runId,
      artifacts: collection.artifacts
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
    await callbackClient.sendCheckpoints(runId, createCheckpointRequest(collection.checkpoint, storedArtifacts));
  } catch (error) {
    deliveryIssues.push({
      scope: "checkpoints-callback",
      stepKey: step.step_id,
      message: `checkpoint callback failed: ${errorMessage(error)}`
    });
  }

  return {
    deliveryIssues,
    artifactRefs: storedArtifacts.map((artifact) => artifact.artifactId)
  };
}

function createFailureBrowserCaptureOptions(plan: ScenarioPlan) {
  return {
    captureAxTree: plan.artifact_policy?.capture_ax_tree === true || undefined,
    captureHar: plan.artifact_policy?.capture_har === true || undefined,
    capturePerformance: plan.artifact_policy?.capture_performance === true || undefined,
    captureTrace: plan.artifact_policy?.capture_trace === true || undefined
  };
}
