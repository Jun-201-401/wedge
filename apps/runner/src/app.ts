import { createPlaywrightSession } from "./browser/playwright/index.js";
import { registerCallbackClient } from "./callback/index.js";
import { runnerConfig } from "./config/index.js";
import { createCapturePipeline } from "./capture/index.js";
import { registerMessageHandlers } from "./messaging/index.js";
import { executeScenario } from "./scenario/executor/index.js";
import { createArtifactStore } from "./storage/index.js";
import { registerWorker } from "./worker/index.js";

export interface RunnerApp {
  service: string;
  status: "scaffold";
  components: Record<string, string>;
}

export function createRunnerApp(): RunnerApp {
  return {
    service: runnerConfig.serviceName,
    status: "scaffold",
    components: {
      messaging: registerMessageHandlers(),
      worker: registerWorker(),
      scenarioExecutor: executeScenario(),
      browser: createPlaywrightSession(),
      capture: createCapturePipeline(),
      callback: registerCallbackClient(),
      storage: createArtifactStore()
    }
  };
}
