import type { BrowserSession } from "../../browser/playwright/index.ts";
import type { CallbackClient } from "../../callback/index.ts";
import type { CapturePipeline } from "../../capture/index.ts";
import { createDeliverySummary, mergeDeliveryIssues, type DeliveryIssue, type DeliverySummary } from "../../delivery/index.ts";
import type { ArtifactStore } from "../../storage/index.ts";
import type { ScenarioPlan } from "../../shared/contracts.ts";
import { executeScenarioStep } from "./step-executor.ts";

export interface ScenarioExecutionSummary {
  completedStepCount: number;
  failedStepCount: number;
  stopped: boolean;
}

export interface ScenarioExecutionResult {
  summary: ScenarioExecutionSummary;
  delivery: DeliverySummary;
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

  for (const [index, step] of plan.steps.entries()) {
    const stepOrder = index + 1;
    const stepResult = await executeScenarioStep({
      runId,
      stepOrder,
      step,
      plan,
      session,
      callbackClient,
      capturePipeline,
      artifactStore
    });

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
