import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { RunnerConfig } from "../config/index.ts";
import type { CallbackClient } from "./index.ts";
import { toIsoTimestamp } from "../shared/utils.ts";

interface CallbackRecord {
  callbackType: string;
  runId: string;
  emittedAt: string;
  payload: unknown;
}

export function createFileCallbackClient(config: Pick<RunnerConfig, "callbackLogFile">): CallbackClient {
  async function emit(callbackType: string, runId: string, payload: unknown): Promise<void> {
    const record: CallbackRecord = {
      callbackType,
      runId,
      emittedAt: toIsoTimestamp(),
      payload
    };

    await mkdir(dirname(config.callbackLogFile), { recursive: true });
    await appendFile(config.callbackLogFile, `${JSON.stringify(record)}\n`, "utf8");
  }

  return {
    sendAccepted: (runId, payload) => emit("accepted", runId, payload),
    sendStepEvents: (runId, payload) => emit("step-events", runId, payload),
    sendArtifacts: (runId, payload) => emit("artifacts", runId, payload),
    sendCheckpoints: (runId, payload) => emit("checkpoints", runId, payload),
    sendFinished: (runId, payload) => emit("finished", runId, payload),
    sendFailed: (runId, payload) => emit("failed", runId, payload)
  };
}
