import type { BrowserActionResult, BrowserCapturedArtifacts, BrowserSession } from "../../browser/playwright/index.ts";
import type { CallbackClient } from "../../callback/index.ts";
import type { CapturePipeline, JourneyDepthContext } from "../../capture/index.ts";
import { createDeliveryIssue, type DeliveryIssue } from "../../delivery/index.ts";
import {
  createEmptyCollectorStatusSummary,
  summarizeArtifactManifest,
  summarizeCheckpointCollectors,
  type ArtifactManifestSummary,
  type CollectorStatusSummary
} from "../../observability/collectors.ts";
import type { ArtifactStore } from "../../storage/index.ts";
import type { RunnerFailureObservation, ScenarioPlan, ScenarioStep } from "../../shared/contracts.ts";
import { errorMessage, logOperationalEvent } from "../../shared/utils.ts";
import { createArtifactBatch, createCheckpointRequest } from "./checkpoint-payloads.ts";

export interface CheckpointEmissionResult {
  deliveryIssues: DeliveryIssue[];
  artifactRefs: string[];
  checkpointId?: string;
  artifactManifest: ArtifactManifestSummary;
  collectorStatus: CollectorStatusSummary;
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
}: CheckpointEmissionInput): Promise<CheckpointEmissionResult> {
  return emitCheckpointCollection({
    runId,
    stepOrder,
    plan,
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
    collection.checkpoint.observations.push({ ...createRunnerFailureObservation({
      step,
      stepOrder,
      failureCode,
      failureMessage
    }) });

    return await emitCheckpointCollection({
      runId,
      stepOrder,
      plan,
      step,
      collection,
      callbackClient,
      artifactStore
    });
  } catch (error) {
    return {
      deliveryIssues: [
        createDeliveryIssue({
          scope: "failure-capture",
          stepKey: step.step_id,
          message: `failure evidence capture failed: ${errorMessage(error)}`
        })
      ],
      artifactRefs: [],
      checkpointId: undefined,
      artifactManifest: summarizeArtifactManifest({
        requestedArtifacts: [],
        storedArtifacts: []
      }),
      collectorStatus: createEmptyCollectorStatusSummary(plan)
    };
  }
}

async function emitCheckpointCollection({
  runId,
  stepOrder,
  plan,
  step,
  collection,
  callbackClient,
  artifactStore
}: {
  runId: string;
  stepOrder: number;
  plan: ScenarioPlan;
  step: ScenarioStep;
  collection: Awaited<ReturnType<CapturePipeline["collectCheckpoint"]>>;
  callbackClient: CallbackClient;
  artifactStore: ArtifactStore;
}): Promise<CheckpointEmissionResult> {
  const deliveryIssues: DeliveryIssue[] = [];
  const collectorStatus = summarizeCheckpointCollectors(plan, collection);

  let storedArtifacts = [] as Awaited<ReturnType<ArtifactStore["persistArtifacts"]>>;

  try {
    storedArtifacts = await artifactStore.persistArtifacts({
      runId,
      artifacts: collection.artifacts
    });
  } catch (error) {
    deliveryIssues.push(createDeliveryIssue({
      scope: "artifact-storage",
      stepKey: step.step_id,
      message: `artifact storage failed: ${errorMessage(error)}`
    }));
  }

  if (storedArtifacts.length > 0) {
    try {
      await callbackClient.sendArtifacts(runId, createArtifactBatch(storedArtifacts));
    } catch (error) {
      deliveryIssues.push(createDeliveryIssue({
        scope: "artifacts-callback",
        stepKey: step.step_id,
        message: `artifact callback failed: ${errorMessage(error)}`
      }));
    }
  }

  try {
    await callbackClient.sendCheckpoints(runId, createCheckpointRequest(collection.checkpoint, storedArtifacts));
  } catch (error) {
    deliveryIssues.push(createDeliveryIssue({
      scope: "checkpoints-callback",
      stepKey: step.step_id,
      message: `checkpoint callback failed: ${errorMessage(error)}`
    }));
  }

  const artifactManifest = summarizeArtifactManifest({
    requestedArtifacts: collection.artifacts,
    storedArtifacts
  });
  logOperationalEvent(
    "scenario-executor",
    "artifact_manifest",
    {
      runId,
      stepOrder,
      stepKey: step.step_id,
      requestedCount: artifactManifest.requestedCount,
      storedCount: artifactManifest.storedCount,
      requestedTypes: artifactManifest.requestedTypes,
      storedTypes: artifactManifest.storedTypes,
      totalStoredBytes: artifactManifest.totalStoredBytes,
      artifactIds: artifactManifest.artifactIds,
      storedKeys: artifactManifest.storedKeys,
      deliveryIssueScopes: deliveryIssues.map((issue) => issue.scope),
      collectorStatus
    },
    deliveryIssues.length > 0 || artifactManifest.storedCount < artifactManifest.requestedCount || hasFailedCollectorStatus(collectorStatus)
      ? "warn"
      : "info"
  );

  return {
    deliveryIssues,
    artifactRefs: storedArtifacts.map((artifact) => artifact.artifactId),
    checkpointId: collection.checkpoint.checkpointId,
    artifactManifest,
    collectorStatus
  };
}

function createRunnerFailureObservation({
  step,
  stepOrder,
  failureCode,
  failureMessage
}: {
  step: ScenarioStep;
  stepOrder: number;
  failureCode: string;
  failureMessage: string;
}): RunnerFailureObservation {
  return {
    observation_id: `${step.step_id}.obs_runner_failure`,
    type: "runner_failure",
    stage: step.stage,
    source: ["scenario_log", "browser"],
    confidence: 0.95,
    failed_step_key: step.step_id,
    failed_step_order: stepOrder,
    failure_code: failureCode,
    failure_message: failureMessage,
    result_completeness_candidate: "PARTIAL",
    capture_reason: "step_failure"
  };
}

function hasFailedCollectorStatus(collectorStatus: CollectorStatusSummary): boolean {
  return Object.values(collectorStatus).some((status) => status.status === "failed");
}

function createFailureBrowserCaptureOptions(plan: ScenarioPlan) {
  return {
    screenshotMode: plan.artifact_policy?.screenshot_mode,
    captureAxTree: plan.artifact_policy?.capture_ax_tree === true || undefined,
    captureHar: plan.artifact_policy?.capture_har === true || undefined,
    capturePerformance: plan.artifact_policy?.capture_performance === true || undefined,
    captureTrace: plan.artifact_policy?.capture_trace === true || undefined
  };
}
