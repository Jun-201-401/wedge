import type { BrowserCaptureOptions, BrowserSession } from "../../browser/playwright/index.ts";
import type { CallbackClient } from "../../callback/index.ts";
import type { CapturePipeline, JourneyDepthContext } from "../../capture/index.ts";
import type { DeliveryIssue } from "../../delivery/index.ts";
import {
  createEmptyCollectorStatusSummary,
  type CollectorStatusSummary
} from "../../observability/collectors.ts";
import type { ArtifactStore } from "../../storage/index.ts";
import type { ScenarioPlan, ScenarioStep } from "../../shared/contracts.ts";
import { executeScenarioAction } from "../actions/index.ts";
import { emitCheckpointArtifactsAndCallbacks } from "./checkpoint-emitter.ts";
import { emitStepEventBestEffort } from "./step-events.ts";

export interface ScenarioStepExecutorInput {
  runId: string;
  stepOrder: number;
  step: ScenarioStep;
  plan: ScenarioPlan;
  session: BrowserSession;
  callbackClient: CallbackClient;
  capturePipeline: CapturePipeline;
  artifactStore: ArtifactStore;
  emitStepEvents?: boolean;
  journeyDepthContext?: JourneyDepthContext;
}

export interface ScenarioStepExecutionResult {
  stopRequested: boolean;
  deliveryIssues: DeliveryIssue[];
  collectorStatus: CollectorStatusSummary;
}

export async function executeScenarioStep({
  runId,
  stepOrder,
  step,
  plan,
  session,
  callbackClient,
  capturePipeline,
  artifactStore,
  emitStepEvents = true,
  journeyDepthContext
}: ScenarioStepExecutorInput): Promise<ScenarioStepExecutionResult> {
  const deliveryIssues: DeliveryIssue[] = [];
  const preparedSettle = await session.prepareSettle?.(step.settle_strategy);

  if (emitStepEvents) {
    deliveryIssues.push(...(await emitStepEventBestEffort(callbackClient, runId, stepOrder, step.step_id, "STEP_STARTED", {
      description: step.description,
      stage: step.stage
    })));
  }

  const beforeSnapshot = step.checkpoint ? session.snapshot() : undefined;
  let actionResult;
  try {
    actionResult = await executeScenarioAction(session, step);
  } catch (error) {
    await preparedSettle?.cancel();
    throw error;
  }

  if (emitStepEvents) {
    deliveryIssues.push(...(await emitStepEventBestEffort(callbackClient, runId, stepOrder, step.step_id, "ACTION_EXECUTED", {
      actionType: actionResult.actionType,
      target: actionResult.targetSummary,
      details: actionResult.details
    })));
  }

  const settleResult = preparedSettle ? await preparedSettle.settle() : await session.settle(step.settle_strategy);
  const pageSnapshot = session.snapshot();
  const capturedArtifacts = step.checkpoint
    ? await session.captureArtifacts(createBrowserCaptureOptions(plan))
    : undefined;

  if (step.checkpoint) {
    const checkpointResult = await emitCheckpointArtifactsAndCallbacks({
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
    });
    deliveryIssues.push(...checkpointResult.deliveryIssues);
    return {
      stopRequested: actionResult.stopRequested,
      deliveryIssues: await appendStepCompletedEvent({
        deliveryIssues,
        emitStepEvents,
        callbackClient,
        runId,
        stepOrder,
        step,
        settleResult,
        pageSnapshot
      }),
      collectorStatus: checkpointResult.collectorStatus
    };
  }

  return {
    stopRequested: actionResult.stopRequested,
    deliveryIssues: await appendStepCompletedEvent({
      deliveryIssues,
      emitStepEvents,
      callbackClient,
      runId,
      stepOrder,
      step,
      settleResult,
      pageSnapshot
    }),
    collectorStatus: createEmptyCollectorStatusSummary()
  };
}

async function appendStepCompletedEvent({
  deliveryIssues,
  emitStepEvents,
  callbackClient,
  runId,
  stepOrder,
  step,
  settleResult,
  pageSnapshot
}: {
  deliveryIssues: DeliveryIssue[];
  emitStepEvents: boolean;
  callbackClient: CallbackClient;
  runId: string;
  stepOrder: number;
  step: ScenarioStep;
  settleResult: Awaited<ReturnType<BrowserSession["settle"]>>;
  pageSnapshot: ReturnType<BrowserSession["snapshot"]>;
}): Promise<DeliveryIssue[]> {
  if (!emitStepEvents) {
    return deliveryIssues;
  }

  return [
    ...deliveryIssues,
    ...(await emitStepEventBestEffort(callbackClient, runId, stepOrder, step.step_id, "STEP_COMPLETED", {
      settle: settleResult,
      finalUrl: pageSnapshot.finalUrl
    }))
  ];
}

function createBrowserCaptureOptions(plan: ScenarioPlan): BrowserCaptureOptions {
  const options: BrowserCaptureOptions = {};
  if (plan.artifact_policy?.capture_ax_tree === true) {
    options.captureAxTree = true;
  }
  if (plan.artifact_policy?.capture_har === true) {
    options.captureHar = true;
  }
  if (plan.artifact_policy?.capture_performance === true) {
    options.capturePerformance = true;
  }
  if (plan.artifact_policy?.capture_trace === true) {
    options.captureTrace = true;
  }
  return options;
}
