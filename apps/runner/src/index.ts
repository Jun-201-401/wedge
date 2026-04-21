import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { createRunnerApp } from "./app.ts";

interface CliOptions {
  messageFile?: string;
  consumeMq: boolean;
  help: boolean;
}

const defaultMessageFile = resolve(process.cwd(), "examples/run-execute.request.json");

try {
  const cliOptions = parseCliOptions(process.argv.slice(2));
  if (cliOptions.help) {
    printHelp();
  } else {
    const app = createRunnerApp();

    if (cliOptions.consumeMq || app.config.mqConsumerEnabled) {
      const consumer = await app.startMqConsumer();
      registerShutdownHooks(consumer.close);

      console.log(
        JSON.stringify(
          {
            service: app.service,
            workerId: app.config.workerId,
            mode: "mq-consumer",
            mqUrl: app.config.mqUrl,
            queue: app.config.mqQueueRunExecute,
            prefetch: app.config.mqPrefetch
          },
          null,
          2
        )
      );
    } else {
      const messageFile = cliOptions.messageFile ?? process.env.RUNNER_MESSAGE_FILE ?? defaultMessageFile;
      await access(messageFile);

      const result = await app.processMessageFile(messageFile);

      console.log(
        JSON.stringify(
          {
            service: app.service,
            runId: result.runId,
            workerId: result.workerId,
            browserSessionId: result.browserSessionId,
            summary: result.summary,
            artifactsRoot: app.config.artifactsRoot,
            callbackLogFile: app.config.callbackLogFile
          },
          null,
          2
        )
      );
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
    }
  }

  return cliOptions;
}

function printHelp(): void {
  console.log(`Usage: npm run start -- [--message-file <path-to-run-execute-request.json>] [--consume-mq]

If --message-file is omitted, the runner uses:
  examples/run-execute.request.json

If --consume-mq is provided, the runner starts a RabbitMQ consumer instead of file input.`);
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
