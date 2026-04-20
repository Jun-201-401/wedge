import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { createRunnerApp } from "./app.ts";

interface CliOptions {
  messageFile?: string;
  help: boolean;
}

const defaultMessageFile = resolve(process.cwd(), "examples/run-execute.request.json");

try {
  const cliOptions = parseCliOptions(process.argv.slice(2));
  if (cliOptions.help) {
    printHelp();
  } else {
    const messageFile = cliOptions.messageFile ?? process.env.RUNNER_MESSAGE_FILE ?? defaultMessageFile;
    await access(messageFile);

    const app = createRunnerApp();
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
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`runner failed: ${message}`);
  process.exitCode = 1;
}

function parseCliOptions(argv: string[]): CliOptions {
  const cliOptions: CliOptions = {
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
    }
  }

  return cliOptions;
}

function printHelp(): void {
  console.log(`Usage: npm run start -- --message-file <path-to-run-execute-request.json>

If --message-file is omitted, the runner uses:
  examples/run-execute.request.json`);
}
