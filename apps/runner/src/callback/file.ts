import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { RunnerConfig } from "../config/index.ts";
import { createCallbackClientFromHandler, type CallbackClient } from "./client.ts";
import { toIsoTimestamp } from "../shared/utils.ts";

interface CallbackRecord {
  callbackType: string;
  runId: string;
  emittedAt: string;
  payload: unknown;
}

export function createFileCallbackClient(config: Pick<RunnerConfig, "callbackLogFile">): CallbackClient {
  return createCallbackClientFromHandler(async (callbackType, runId, payload) => {
    const record: CallbackRecord = {
      callbackType,
      runId,
      emittedAt: toIsoTimestamp(),
      payload
    };

    await mkdir(dirname(config.callbackLogFile), { recursive: true });
    await appendFile(config.callbackLogFile, `${JSON.stringify(record)}\n`, "utf8");
  });
}
