import type { BrowserSession } from "../../browser/playwright/index.ts";
import type { CallbackClient } from "../../callback/index.ts";
import type { CapturePipeline, JourneyDepthContext } from "../../capture/index.ts";
import { createDeliverySummary, mergeDeliveryIssues, type DeliveryIssue, type DeliverySummary } from "../../delivery/index.ts";
import type { ArtifactStore } from "../../storage/index.ts";
import type { ScenarioPlan } from "../../shared/contracts.ts";
import { classifyRunnerFailure, errorMessage, logOperationalEvent, type RunnerFailureCode } from "../../shared/utils.ts";
import { emitFailureCheckpointArtifactsAndCallbacks } from "./checkpoint-emitter.ts";
import { executeScenarioStep } from "./step-executor.ts";
import { emitStepEventBestEffort } from "./step-events.ts";

export interface ScenarioExecutionSummary {
  completedStepCount: number;
  failedStepCount: number;
  stopped: boolean;
}

export interface ScenarioExecutionResult {
  summary: ScenarioExecutionSummary;
  delivery: DeliverySummary;
}

export class ScenarioExecutionError extends Error {
  readonly summary: ScenarioExecutionSummary;
  readonly delivery: DeliverySummary;
  readonly failedStepKey: string;
  readonly failedStepOrder: number;
  readonly failureCode: RunnerFailureCode;
  readonly failureArtifactRefs: string[];
  readonly cause: unknown;

  constructor(input: {
    cause: unknown;
    summary: ScenarioExecutionSummary;
    delivery: DeliverySummary;
    failedStepKey: string;
    failedStepOrder: number;
    failureCode: RunnerFailureCode;
    failureArtifactRefs?: string[];
  }) {
    super(errorMessage(input.cause));
    this.name = "ScenarioExecutionError";
    this.summary = input.summary;
    this.delivery = input.delivery;
    this.failedStepKey = input.failedStepKey;
    this.failedStepOrder = input.failedStepOrder;
    this.failureCode = input.failureCode;
    this.failureArtifactRefs = input.failureArtifactRefs ?? [];
    this.cause = input.cause;
  }
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
}: ScenarioExecutorInput): Promise<ScenarioExecutionResult> {
  let completedStepCount = 0;
  let stopped = false;
  const deliveryIssues: DeliveryIssue[] = [];
  const journeyDepthContext: JourneyDepthContext = {};

  for (const [index, step] of plan.steps.entries()) {
    const stepOrder = index + 1;
    let stepResult;
    try {
      stepResult = await executeScenarioStep({
        runId,
        stepOrder,
        step,
        plan,
        session,
        callbackClient,
        capturePipeline,
        artifactStore,
        journeyDepthContext
      });
    } catch (error) {
      const failureCode = classifyRunnerFailure(error);
      const failureMessage = errorMessage(error);

      logOperationalEvent(
        "scenario-executor",
        "step_failed",
        {
          runId,
          stepOrder,
          stepKey: step.step_id,
          stage: step.stage,
          actionType: step.action.type,
          failureCode,
          failureMessage
        },
        "error"
      );

      deliveryIssues.push(
        ...(
          await emitStepEventBestEffort(callbackClient, runId, stepOrder, step.step_id, "STEP_FAILED", {
            description: step.description,
            stage: step.stage,
            actionType: step.action.type,
            failureCode,
            failureMessage
          })
        )
      );

      const failureEvidence = await emitFailureCheckpointArtifactsAndCallbacks({
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
      });
      deliveryIssues.push(...failureEvidence.deliveryIssues);

      const summary = {
        completedStepCount,
        failedStepCount: 1,
        stopped: false
      };
      throw new ScenarioExecutionError({
        cause: error,
        summary,
        delivery: createDeliverySummary(mergeDeliveryIssues(deliveryIssues)),
        failedStepKey: step.step_id,
        failedStepOrder: stepOrder,
        failureCode,
        failureArtifactRefs: failureEvidence.artifactRefs
      });
    }

    completedStepCount += 1;
    deliveryIssues.push(...stepResult.deliveryIssues);

    if (stepResult.stopRequested) {
      stopped = true;
      break;
    }
  }

  return {
    summary: {
      completedStepCount,
      failedStepCount: 0,
      stopped
    },
    delivery: createDeliverySummary(mergeDeliveryIssues(deliveryIssues))
  };
}
