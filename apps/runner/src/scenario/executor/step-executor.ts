import type { BrowserSession } from "../../browser/playwright/index.ts";
import type { CallbackClient } from "../../callback/index.ts";
import type { CapturePipeline } from "../../capture/index.ts";
import type { DeliveryIssue } from "../../delivery/index.ts";
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
}

export interface ScenarioStepExecutionResult {
  stopRequested: boolean;
  deliveryIssues: DeliveryIssue[];
}

export async function executeScenarioStep({
  runId,
  stepOrder,
  step,
  plan,
  session,
  callbackClient,
  capturePipeline,
  artifactStore
}: ScenarioStepExecutorInput): Promise<ScenarioStepExecutionResult> {
  const deliveryIssues: DeliveryIssue[] = [];

  deliveryIssues.push(
    ...(
      await emitStepEventBestEffort(callbackClient, runId, stepOrder, step.step_id, "STEP_STARTED", {
    description: step.description,
    stage: step.stage
      })
    )
  );

  const actionResult = await executeScenarioAction(session, step);

  deliveryIssues.push(
    ...(
      await emitStepEventBestEffort(callbackClient, runId, stepOrder, step.step_id, "ACTION_EXECUTED", {
        actionType: actionResult.actionType,
        target: actionResult.targetSummary,
        details: actionResult.details
      })
    )
  );

  const settleResult = await session.settle(step.settle_strategy);
  const pageSnapshot = session.snapshot();
  const capturedArtifacts = step.checkpoint ? await session.captureArtifacts() : undefined;

  if (step.checkpoint) {
    deliveryIssues.push(...(await emitCheckpointArtifactsAndCallbacks({
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
    })));
  }

  deliveryIssues.push(
    ...(
      await emitStepEventBestEffort(callbackClient, runId, stepOrder, step.step_id, "STEP_COMPLETED", {
        settle: settleResult,
        finalUrl: pageSnapshot.finalUrl
      })
    )
  );

  return {
    stopRequested: actionResult.stopRequested,
    deliveryIssues
  };
}
