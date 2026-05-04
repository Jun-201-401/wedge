import { readFile } from "node:fs/promises";
import { createPlaywrightSessionFactory } from "./browser/playwright/index.ts";
import { createCallbackClient } from "./callback/index.ts";
import {
  replayCallbackOutbox,
  startCallbackOutboxReplayWorker,
  type CallbackOutboxReplaySummary,
  type CallbackOutboxReplayWorker
} from "./callback/replay.ts";
import { loadRunnerConfig, type RunnerConfig } from "./config/index.ts";
import { createCapturePipeline } from "./capture/index.ts";
import {
  parseDiscoveryExecuteMessage,
  parseRunExecuteMessage,
  readDiscoveryExecuteMessage,
  readRunExecuteMessage
} from "./messaging/index.ts";
import { executeDiscoveryAndPersist, type DiscoveryExecutionResult } from "./discovery/index.ts";
import { startRunnerQueueConsumers, type RunnerQueueConsumer } from "./messaging/rabbitmq/index.ts";
import {
  replayArtifactOutbox,
  startArtifactOutboxReplayWorker,
  type ArtifactOutboxReplaySummary,
  type ArtifactOutboxReplayWorker
} from "./storage/replay.ts";
import { createArtifactStore } from "./storage/index.ts";
import { registerWorker, type RunnerExecutionResult } from "./worker/index.ts";
import type { DiscoveryExecuteMessage, RunExecuteMessage } from "./shared/contracts.ts";

export type RunnerInputMessageResult =
  | {
      kind: "run";
      execution: RunnerExecutionResult;
    }
  | {
      kind: "discovery";
      discovery: DiscoveryExecutionResult;
    };

export interface RunnerApp {
  service: string;
  config: RunnerConfig;
  processMessage: (message: RunExecuteMessage) => Promise<RunnerExecutionResult>;
  processRawMessage: (rawMessage: string) => Promise<RunnerExecutionResult>;
  processMessageFile: (messageFile: string) => Promise<RunnerExecutionResult>;
  processDiscoveryMessage: (message: DiscoveryExecuteMessage) => Promise<DiscoveryExecutionResult>;
  processDiscoveryMessageFile: (messageFile: string) => Promise<DiscoveryExecutionResult>;
  processRawInputMessage: (rawMessage: string) => Promise<RunnerInputMessageResult>;
  processInputMessageFile: (messageFile: string) => Promise<RunnerInputMessageResult>;
  replayCallbackOutbox: () => Promise<CallbackOutboxReplaySummary>;
  startCallbackOutboxReplayWorker: () => Promise<CallbackOutboxReplayWorker>;
  replayArtifactOutbox: () => Promise<ArtifactOutboxReplaySummary>;
  startArtifactOutboxReplayWorker: () => Promise<ArtifactOutboxReplayWorker>;
  startMqConsumer: () => Promise<RunnerQueueConsumer>;
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
    processDiscoveryMessage: (message) => executeDiscoveryAndPersist({ message, config, callbackClient }),
    processDiscoveryMessageFile: async (messageFile) =>
      executeDiscoveryAndPersist({
        message: await readDiscoveryExecuteMessage(messageFile),
        config,
        callbackClient
      }),
    processRawInputMessage: async (rawMessage) => {
      const messageType = readInputMessageType(rawMessage);
      if (messageType === "discovery.execute.request") {
        return {
          kind: "discovery",
          discovery: await executeDiscoveryAndPersist({
            message: parseDiscoveryExecuteMessage(rawMessage),
            config,
            callbackClient
          })
        };
      }

      return {
        kind: "run",
        execution: await worker.handleMessage(parseRunExecuteMessage(rawMessage))
      };
    },
    processInputMessageFile: async (messageFile) => {
      const rawMessage = await readFile(messageFile, "utf8");
      return dispatchInputMessage(rawMessage, {
        processRun: async (message) => worker.handleMessage(message),
        processDiscovery: async (message) => executeDiscoveryAndPersist({ message, config, callbackClient })
      });
    },
    replayCallbackOutbox: async () => replayCallbackOutbox(config),
    startCallbackOutboxReplayWorker: async () => startCallbackOutboxReplayWorker(config),
    replayArtifactOutbox: async () => replayArtifactOutbox(config),
    startArtifactOutboxReplayWorker: async () => startArtifactOutboxReplayWorker(config),
    startMqConsumer: async () =>
      startRunnerQueueConsumers({
        config,
        processRawRunMessage: async (rawMessage) => {
          await worker.handleMessage(parseRunExecuteMessage(rawMessage));
        },
        processRawDiscoveryMessage: async (rawMessage) => {
          await executeDiscoveryAndPersist({
            message: parseDiscoveryExecuteMessage(rawMessage),
            config,
            callbackClient
          });
        }
      })
  };
}

function readInputMessageType(rawMessage: string): string | undefined {
  try {
    const parsed = JSON.parse(rawMessage) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const messageType = (parsed as Record<string, unknown>).messageType;
      return typeof messageType === "string" ? messageType : undefined;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

async function dispatchInputMessage(
  rawMessage: string,
  handlers: {
    processRun: (message: RunExecuteMessage) => Promise<RunnerExecutionResult>;
    processDiscovery: (message: DiscoveryExecuteMessage) => Promise<DiscoveryExecutionResult>;
  }
): Promise<RunnerInputMessageResult> {
  const messageType = readInputMessageType(rawMessage);
  if (messageType === "discovery.execute.request") {
    return {
      kind: "discovery",
      discovery: await handlers.processDiscovery(parseDiscoveryExecuteMessage(rawMessage))
    };
  }

  return {
    kind: "run",
    execution: await handlers.processRun(parseRunExecuteMessage(rawMessage))
  };
}
