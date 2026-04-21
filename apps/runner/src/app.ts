import { createPlaywrightSessionFactory } from "./browser/playwright/index.ts";
import { createCallbackClient } from "./callback/index.ts";
import { loadRunnerConfig, type RunnerConfig } from "./config/index.ts";
import { createCapturePipeline } from "./capture/index.ts";
import { parseRunExecuteMessage, readRunExecuteMessage } from "./messaging/index.ts";
import { startRunExecuteQueueConsumer, type RunExecuteQueueConsumer } from "./messaging/rabbitmq/index.ts";
import { createArtifactStore } from "./storage/index.ts";
import { registerWorker, type RunnerExecutionResult } from "./worker/index.ts";
import type { RunExecuteMessage } from "./shared/contracts.ts";

export interface RunnerApp {
  service: string;
  config: RunnerConfig;
  processMessage: (message: RunExecuteMessage) => Promise<RunnerExecutionResult>;
  processRawMessage: (rawMessage: string) => Promise<RunnerExecutionResult>;
  processMessageFile: (messageFile: string) => Promise<RunnerExecutionResult>;
  startMqConsumer: () => Promise<RunExecuteQueueConsumer>;
}

export function createRunnerApp(overrides: Partial<RunnerConfig> = {}): RunnerApp {
  const config = loadRunnerConfig(overrides);
  const callbackClient = createCallbackClient(config);
  const capturePipeline = createCapturePipeline();
  const artifactStore = createArtifactStore(config);
  const browserFactory = createPlaywrightSessionFactory(config);
  const worker = registerWorker({
    config,
    browserFactory,
    callbackClient,
    capturePipeline,
    artifactStore
  });

  return {
    service: config.serviceName,
    config,
    processMessage: (message) => worker.handleMessage(message),
    processRawMessage: (rawMessage) => worker.handleMessage(parseRunExecuteMessage(rawMessage)),
    processMessageFile: async (messageFile) => worker.handleMessage(await readRunExecuteMessage(messageFile)),
    startMqConsumer: async () =>
      startRunExecuteQueueConsumer({
        config,
        processRawMessage: async (rawMessage) => {
          await worker.handleMessage(parseRunExecuteMessage(rawMessage));
        }
      })
  };
}
