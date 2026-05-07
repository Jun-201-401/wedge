import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { createRunnerApp } from "./app.ts";
import {
  RUNNER_MQ_ARTIFACT_OUTBOX_WORKER_ENABLED_ENV,
  RUNNER_MQ_CALLBACK_OUTBOX_WORKER_ENABLED_ENV
} from "./config/index.ts";

interface CliOptions {
  messageFile?: string;
  consumeMq: boolean;
  replayOutbox: boolean;
  watchOutbox: boolean;
  replayArtifactOutbox: boolean;
  watchArtifactOutbox: boolean;
  help: boolean;
}

const defaultMessageFile = resolve(process.cwd(), "examples/run-execute.request.json");

try {
  const cliOptions = parseCliOptions(process.argv.slice(2));
  if (cliOptions.help) {
    printHelp();
  } else {
    const app = createRunnerApp();

    if (cliOptions.watchArtifactOutbox) {
      const worker = await app.startArtifactOutboxReplayWorker();
      registerShutdownHooks(worker.close);

      console.log(
        JSON.stringify(
          {
            service: app.service,
            workerId: app.config.workerId,
            mode: "artifact-outbox-worker",
            outboxFile: app.config.artifactOutboxFile,
            lockFile: app.config.artifactOutboxLockFile,
            replayIntervalMs: app.config.artifactOutboxReplayIntervalMs
          },
          null,
          2
        )
      );
    } else if (cliOptions.replayArtifactOutbox) {
      const result = await app.replayArtifactOutbox();

      console.log(
        JSON.stringify(
          {
            service: app.service,
            workerId: app.config.workerId,
            mode: "artifact-outbox-replay",
            outboxFile: app.config.artifactOutboxFile,
            lockFile: app.config.artifactOutboxLockFile,
            summary: result
          },
          null,
          2
        )
      );
    } else if (cliOptions.watchOutbox) {
      const worker = await app.startCallbackOutboxReplayWorker();
      registerShutdownHooks(worker.close);

      console.log(
        JSON.stringify(
          {
            service: app.service,
            workerId: app.config.workerId,
            mode: "callback-outbox-worker",
            outboxFile: app.config.callbackOutboxFile,
            lockFile: app.config.callbackOutboxLockFile,
            replayIntervalMs: app.config.callbackOutboxReplayIntervalMs
          },
          null,
          2
        )
      );
    } else if (cliOptions.replayOutbox) {
      const result = await app.replayCallbackOutbox();

      console.log(
        JSON.stringify(
          {
            service: app.service,
            workerId: app.config.workerId,
            mode: "callback-outbox-replay",
            outboxFile: app.config.callbackOutboxFile,
            lockFile: app.config.callbackOutboxLockFile,
            summary: result
          },
          null,
          2
        )
      );
    } else if (cliOptions.consumeMq || app.config.mqConsumerEnabled) {
      const runtime = await app.startMqRuntime();
      registerShutdownHooks(runtime.close);

      console.log(
        JSON.stringify(
          {
            service: app.service,
            workerId: app.config.workerId,
            mode: "mq-consumer",
            mqUrl: app.config.mqUrl,
            queues: [app.config.mqQueueRunExecute, app.config.mqQueueDiscoveryExecute],
            prefetch: app.config.mqPrefetch,
            agentConcurrency: app.config.agentConcurrency,
            recoveryWorkers: {
              enabled: runtime.enabledWorkers,
              callbackOutbox: createOutboxRecoveryWorkerStatus(
                Boolean(runtime.callbackOutboxWorker),
                app.config.callbackOutboxFile,
                app.config.callbackOutboxLockFile,
                app.config.callbackOutboxReplayIntervalMs
              ),
              artifactOutbox: createOutboxRecoveryWorkerStatus(
                Boolean(runtime.artifactOutboxWorker),
                app.config.artifactOutboxFile,
                app.config.artifactOutboxLockFile,
                app.config.artifactOutboxReplayIntervalMs
              )
            }
          },
          null,
          2
        )
      );
    } else {
      const messageFile = cliOptions.messageFile ?? process.env.RUNNER_MESSAGE_FILE ?? defaultMessageFile;
      await access(messageFile);

      const result = await app.processInputMessageFile(messageFile);

      if (result.kind === "discovery") {
        console.log(
          JSON.stringify(
            {
              service: app.service,
              discoveryId: result.discovery.discoveryId,
              workerId: app.config.workerId,
              mode: "discovery-file",
              resultFile: result.discovery.resultFile,
              artifactsRoot: app.config.artifactsRoot,
              summary: {
                detectedFlowTypes: result.discovery.result.detected_flow_types,
                missingFlowTypes: result.discovery.result.missing_flow_types ?? [],
                recommendationCount: result.discovery.result.scenario_recommendations.length
              }
            },
            null,
            2
          )
        );
      } else {
        const execution = result.execution;
        console.log(
          JSON.stringify(
            {
              service: app.service,
              runId: execution.runId,
              workerId: execution.workerId,
              browserSessionId: execution.browserSessionId,
              summary: execution.summary,
              delivery: execution.delivery,
              artifactsRoot: app.config.artifactsRoot,
              callbackLogFile: app.config.callbackLogFile
            },
            null,
            2
          )
        );
      }
    }
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`runner failed: ${message}`);
  process.exitCode = 1;
}

function parseCliOptions(argv: string[]): CliOptions {
  const cliOptions: CliOptions = {
    consumeMq: false,
    replayOutbox: false,
    watchOutbox: false,
    replayArtifactOutbox: false,
    watchArtifactOutbox: false,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];

    if (current === "--help" || current === "-h") {
      cliOptions.help = true;
      continue;
    }

    if (current === "--message-file") {
      cliOptions.messageFile = argv[index + 1];
      index += 1;
      continue;
    }

    if (current === "--consume-mq") {
      cliOptions.consumeMq = true;
      continue;
    }

    if (current === "--replay-outbox") {
      cliOptions.replayOutbox = true;
      continue;
    }

    if (current === "--watch-outbox") {
      cliOptions.watchOutbox = true;
      continue;
    }

    if (current === "--replay-artifact-outbox") {
      cliOptions.replayArtifactOutbox = true;
      continue;
    }

    if (current === "--watch-artifact-outbox") {
      cliOptions.watchArtifactOutbox = true;
    }
  }

  return cliOptions;
}

function printHelp(): void {
  console.log(`Usage: npm run start -- [--message-file <path-to-run-or-discovery-request.json>] [--consume-mq] [--replay-outbox] [--watch-outbox] [--replay-artifact-outbox] [--watch-artifact-outbox]

If --message-file is omitted, the runner uses:
  examples/run-execute.request.json

The --message-file input supports:
  run.execute.request
  agent.execute.request
  discovery.execute.request

If --consume-mq is provided, the runner starts RabbitMQ consumers for run.execute.request, agent.execute.request, and discovery.execute.request instead of file input.
MQ consumer mode also starts callback and artifact outbox replay workers by default.
Agent queue concurrency uses RUNNER_AGENT_CONCURRENCY separately from RUNNER_MQ_PREFETCH.
Set RUNNER_MQ_MAX_DELIVERY_ATTEMPTS to bound poison message requeue attempts when RUNNER_MQ_REQUEUE_ON_FAILURE=true.
Set ${RUNNER_MQ_CALLBACK_OUTBOX_WORKER_ENABLED_ENV}=false or ${RUNNER_MQ_ARTIFACT_OUTBOX_WORKER_ENABLED_ENV}=false to disable either recovery worker.`);
}

function createOutboxRecoveryWorkerStatus(
  enabled: boolean,
  outboxFile: string,
  lockFile: string,
  replayIntervalMs: number
): {
  enabled: boolean;
  outboxFile: string;
  lockFile: string;
  replayIntervalMs: number;
} {
  return {
    enabled,
    outboxFile,
    lockFile,
    replayIntervalMs
  };
}

function registerShutdownHooks(close: () => Promise<void>): void {
  let closing = false;

  const handleShutdown = async () => {
    if (closing) {
      return;
    }

    closing = true;

    try {
      await close();
    } finally {
      process.exit(0);
    }
  };

  process.once("SIGINT", () => {
    void handleShutdown();
  });
  process.once("SIGTERM", () => {
    void handleShutdown();
  });
}
