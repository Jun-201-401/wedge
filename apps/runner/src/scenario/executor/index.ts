import { randomUUID } from "node:crypto";
import type { BrowserSession } from "../../browser/playwright/index.ts";
import type { CallbackClient } from "../../callback/index.ts";
import type { CapturePipeline } from "../../capture/index.ts";
import type { ArtifactStore } from "../../storage/index.ts";
import type {
  ArtifactBatch,
  Checkpoint,
  ScenarioPlan,
  StepEvent,
  StepEventBatch
} from "../../shared/contracts.ts";
import { executeScenarioAction } from "../actions/index.ts";
import { toIsoTimestamp } from "../../shared/utils.ts";

export interface ScenarioExecutionSummary {
  completedStepCount: number;
  failedStepCount: number;
  stopped: boolean;
}

export interface ScenarioExecutorInput {
  runId: string;
  plan: ScenarioPlan;
  session: BrowserSession;
  callbackClient: CallbackClient;
  capturePipeline: CapturePipeline;
  artifactStore: ArtifactStore;
}

export async function executeScenario({
  runId,
  plan,
  session,
  callbackClient,
  capturePipeline,
  artifactStore
}: ScenarioExecutorInput): Promise<ScenarioExecutionSummary> {
  let completedStepCount = 0;
  let stopped = false;

  for (const [index, step] of plan.steps.entries()) {
    const stepOrder = index + 1;

    await callbackClient.sendStepEvents(runId, createStepEventBatch(stepOrder, step.step_id, "STEP_STARTED", {
      description: step.description,
      stage: step.stage
    }));

    const actionResult = await executeScenarioAction(session, step);

    await callbackClient.sendStepEvents(
      runId,
      createStepEventBatch(stepOrder, step.step_id, "ACTION_EXECUTED", {
        actionType: actionResult.actionType,
        target: actionResult.targetSummary,
        details: actionResult.details
      })
    );

    const settleResult = await session.settle(step.settle_strategy);
    const pageSnapshot = session.snapshot();

    if (step.checkpoint) {
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
        const artifactBatch: ArtifactBatch = {
          artifacts: storedArtifacts
        };

        await callbackClient.sendArtifacts(runId, artifactBatch);
      }

      const checkpoint: Checkpoint = {
        ...checkpointCollection.checkpoint,
        artifactRefs: storedArtifacts.map((artifact) => artifact.artifactId)
      };

      await callbackClient.sendCheckpoints(runId, {
        checkpoints: [checkpoint]
      });
    }

    await callbackClient.sendStepEvents(
      runId,
      createStepEventBatch(stepOrder, step.step_id, "STEP_COMPLETED", {
        settle: settleResult,
        finalUrl: pageSnapshot.finalUrl
      })
    );

    completedStepCount += 1;

    if (actionResult.stopRequested) {
      stopped = true;
      break;
    }
  }

  return {
    completedStepCount,
    failedStepCount: 0,
    stopped
  };
}

function createStepEventBatch(
  stepOrder: number,
  stepKey: string,
  eventType: StepEvent["eventType"],
  payload: Record<string, unknown>
): StepEventBatch {
  return {
    events: [
      {
        eventId: randomUUID(),
        stepOrder,
        stepKey,
        eventType,
        occurredAt: toIsoTimestamp(),
        payload
      }
    ]
  };
}
