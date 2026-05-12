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
  parseAgentExecuteMessage,
  parseDiscoveryExecuteMessage,
  parseScenarioAuthoringExecuteMessage,
  parseRunExecuteMessage,
  readAgentExecuteMessage,
  readDiscoveryExecuteMessage,
  readScenarioAuthoringExecuteMessage,
  readRunExecuteMessage
} from "./messaging/index.ts";
import { executeScenarioAuthoring, type ScenarioAuthoringExecutionResult } from "./authoring/index.ts";
import { executeDiscoveryAndPersist, type DiscoveryExecutionResult } from "./discovery/index.ts";
import { startRunnerQueueConsumers, type RunnerQueueConsumer } from "./messaging/rabbitmq/index.ts";
import { startRunnerMqRuntime, type RunnerMqRuntime } from "./runtime/index.ts";
import {
  replayArtifactOutbox,
  startArtifactOutboxReplayWorker,
  type ArtifactOutboxReplaySummary,
  type ArtifactOutboxReplayWorker
} from "./storage/replay.ts";
import { createArtifactStore } from "./storage/index.ts";
import { registerAgentWorker, type AgentRunnerExecutionResult } from "./worker/agent-worker.ts";
import { registerWorker, type RunnerExecutionResult } from "./worker/index.ts";
import type {
  AgentExecuteMessage,
  DiscoveryExecuteMessage,
  RunExecuteMessage,
  ScenarioAuthoringExecuteMessage
} from "./shared/contracts.ts";

export type RunnerInputMessageResult =
  | {
      kind: "run";
      execution: RunnerExecutionResult;
    }
  | {
      kind: "agent";
      execution: AgentRunnerExecutionResult;
    }
  | {
      kind: "discovery";
      discovery: DiscoveryExecutionResult;
    }
  | {
      kind: "scenario-authoring";
      authoring: ScenarioAuthoringExecutionResult;
    };

export interface RunnerApp {
  service: string;
  config: RunnerConfig;
  processMessage: (message: RunExecuteMessage) => Promise<RunnerExecutionResult>;
  processRawMessage: (rawMessage: string) => Promise<RunnerExecutionResult>;
  processMessageFile: (messageFile: string) => Promise<RunnerExecutionResult>;
  processAgentMessage: (message: AgentExecuteMessage) => Promise<AgentRunnerExecutionResult>;
  processAgentMessageFile: (messageFile: string) => Promise<AgentRunnerExecutionResult>;
  processDiscoveryMessage: (message: DiscoveryExecuteMessage) => Promise<DiscoveryExecutionResult>;
  processDiscoveryMessageFile: (messageFile: string) => Promise<DiscoveryExecutionResult>;
  processScenarioAuthoringMessage: (message: ScenarioAuthoringExecuteMessage) => Promise<ScenarioAuthoringExecutionResult>;
  processScenarioAuthoringMessageFile: (messageFile: string) => Promise<ScenarioAuthoringExecutionResult>;
  processRawInputMessage: (rawMessage: string) => Promise<RunnerInputMessageResult>;
  processInputMessageFile: (messageFile: string) => Promise<RunnerInputMessageResult>;
  replayCallbackOutbox: () => Promise<CallbackOutboxReplaySummary>;
  startCallbackOutboxReplayWorker: () => Promise<CallbackOutboxReplayWorker>;
  replayArtifactOutbox: () => Promise<ArtifactOutboxReplaySummary>;
  startArtifactOutboxReplayWorker: () => Promise<ArtifactOutboxReplayWorker>;
  startMqConsumer: () => Promise<RunnerQueueConsumer>;
  startMqRuntime: () => Promise<RunnerMqRuntime>;
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
  const agentWorker = registerAgentWorker({
    config,
    browserFactory,
    callbackClient,
    capturePipeline,
    artifactStore
  });
  const startMqConsumer = async () =>
    startRunnerQueueConsumers({
      config,
      processRawRunMessage: async (rawMessage) => {
        await worker.handleMessage(parseRunExecuteMessage(rawMessage));
      },
      processRawAgentMessage: async (rawMessage) => {
        await agentWorker.handleMessage(parseAgentExecuteMessage(rawMessage));
      },
      processRawDiscoveryMessage: async (rawMessage) => {
        await executeDiscoveryAndPersist({
          message: parseDiscoveryExecuteMessage(rawMessage),
          config,
          callbackClient,
          artifactStore
        });
      },
      processRawScenarioAuthoringMessage: async (rawMessage) => {
        await executeScenarioAuthoring({
          message: parseScenarioAuthoringExecuteMessage(rawMessage),
          config,
          callbackClient
        });
      }
    });

  return {
    service: config.serviceName,
    config,
    processMessage: (message) => worker.handleMessage(message),
    processRawMessage: (rawMessage) => worker.handleMessage(parseRunExecuteMessage(rawMessage)),
    processMessageFile: async (messageFile) => worker.handleMessage(await readRunExecuteMessage(messageFile)),
    processAgentMessage: (message) => agentWorker.handleMessage(message),
    processAgentMessageFile: async (messageFile) => agentWorker.handleMessage(await readAgentExecuteMessage(messageFile)),
    processDiscoveryMessage: (message) => executeDiscoveryAndPersist({ message, config, callbackClient, artifactStore }),
    processDiscoveryMessageFile: async (messageFile) =>
      executeDiscoveryAndPersist({
        message: await readDiscoveryExecuteMessage(messageFile),
        config,
        callbackClient,
        artifactStore
      }),
    processScenarioAuthoringMessage: (message) => executeScenarioAuthoring({ message, config, callbackClient }),
    processScenarioAuthoringMessageFile: async (messageFile) =>
      executeScenarioAuthoring({
        message: await readScenarioAuthoringExecuteMessage(messageFile),
        config,
        callbackClient
      }),
    processRawInputMessage: async (rawMessage) => {
      const messageType = readInputMessageType(rawMessage);
      if (messageType === "agent.execute.request") {
        return {
          kind: "agent",
          execution: await agentWorker.handleMessage(parseAgentExecuteMessage(rawMessage))
        };
      }

      if (messageType === "discovery.execute.request") {
        return {
          kind: "discovery",
          discovery: await executeDiscoveryAndPersist({
            message: parseDiscoveryExecuteMessage(rawMessage),
            config,
            callbackClient,
            artifactStore
          })
        };
      }

      if (messageType === "scenario-authoring.execute.request") {
        return {
          kind: "scenario-authoring",
          authoring: await executeScenarioAuthoring({
            message: parseScenarioAuthoringExecuteMessage(rawMessage),
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
        processAgent: async (message) => agentWorker.handleMessage(message),
        processDiscovery: async (message) => executeDiscoveryAndPersist({ message, config, callbackClient, artifactStore }),
        processScenarioAuthoring: async (message) => executeScenarioAuthoring({ message, config, callbackClient })
      });
    },
    replayCallbackOutbox: async () => replayCallbackOutbox(config),
    startCallbackOutboxReplayWorker: async () => startCallbackOutboxReplayWorker(config),
    replayArtifactOutbox: async () => replayArtifactOutbox(config),
    startArtifactOutboxReplayWorker: async () => startArtifactOutboxReplayWorker(config),
    startMqConsumer,
    startMqRuntime: async () =>
      startRunnerMqRuntime({
        config,
        startMqConsumer,
        startCallbackOutboxReplayWorker: async () => startCallbackOutboxReplayWorker(config),
        startArtifactOutboxReplayWorker: async () => startArtifactOutboxReplayWorker(config)
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
    processAgent: (message: AgentExecuteMessage) => Promise<AgentRunnerExecutionResult>;
    processDiscovery: (message: DiscoveryExecuteMessage) => Promise<DiscoveryExecutionResult>;
    processScenarioAuthoring: (message: ScenarioAuthoringExecuteMessage) => Promise<ScenarioAuthoringExecutionResult>;
  }
): Promise<RunnerInputMessageResult> {
  const messageType = readInputMessageType(rawMessage);
  if (messageType === "agent.execute.request") {
    return {
      kind: "agent",
      execution: await handlers.processAgent(parseAgentExecuteMessage(rawMessage))
    };
  }

  if (messageType === "discovery.execute.request") {
    return {
      kind: "discovery",
      discovery: await handlers.processDiscovery(parseDiscoveryExecuteMessage(rawMessage))
    };
  }

  if (messageType === "scenario-authoring.execute.request") {
    return {
      kind: "scenario-authoring",
      authoring: await handlers.processScenarioAuthoring(parseScenarioAuthoringExecuteMessage(rawMessage))
    };
  }

  return {
    kind: "run",
    execution: await handlers.processRun(parseRunExecuteMessage(rawMessage))
  };
}
