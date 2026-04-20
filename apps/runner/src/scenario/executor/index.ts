import type { BrowserSession } from "../../browser/playwright/index.ts";
import type { CallbackClient } from "../../callback/index.ts";
import type { CapturePipeline } from "../../capture/index.ts";
import type { ArtifactStore } from "../../storage/index.ts";
import type { ScenarioPlan } from "../../shared/contracts.ts";
import { executeScenarioStep } from "./step-executor.ts";

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

    if (stepResult.stopRequested) {
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
