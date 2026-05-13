import type { RunnerConfig } from "../config/index.ts";
import { errorMessage, logOperationalEvent } from "../shared/utils.ts";
import {
  createCallbackTransportClient,
  isNonRetryableCallbackError,
  readCallbackHttpResponseBody,
  readCallbackHttpStatus,
  sendWithRetry
} from "./index.ts";
import {
  acquireCallbackOutboxLock,
  createRetainedOutboxRecord,
  readCallbackOutboxRecords,
  replaceCallbackOutboxRecords,
  type CallbackOutboxRecord
} from "./outbox.ts";

export interface CallbackOutboxReplaySummary {
  processedCount: number;
  deliveredCount: number;
  failedCount: number;
  discardedCount: number;
  remainingCount: number;
  skipped: boolean;
}

export interface CallbackOutboxReplayWorker {
  close: () => Promise<void>;
}

export async function replayCallbackOutbox(
  config: Pick<
    RunnerConfig,
    | "callbackMode"
    | "callbackBaseUrl"
    | "callbackTimeoutMs"
    | "callbackAuthToken"
    | "callbackSignatureSecret"
    | "callbackLogFile"
    | "callbackOutboxFile"
    | "callbackOutboxLockFile"
    | "callbackOutboxLockStaleMs"
    | "callbackOutboxHeartbeatIntervalMs"
    | "callbackOutboxRetentionMs"
    | "callbackOutboxMaxRecords"
    | "callbackRetryDelaysMs"
    | "workerId"
  >
): Promise<CallbackOutboxReplaySummary> {
  const lockHandle = await acquireCallbackOutboxLock(config);
  if (!lockHandle) {
    logOperationalEvent(
      "callback-outbox",
      "replay_skipped_locked",
      {
        workerId: config.workerId,
        outboxFile: config.callbackOutboxFile,
        lockFile: config.callbackOutboxLockFile
      },
      "warn"
    );
    return {
      processedCount: 0,
      deliveredCount: 0,
      failedCount: 0,
      discardedCount: 0,
      remainingCount: 0,
      skipped: true
    };
  }

  const stopHeartbeat = startOutboxLockHeartbeat(
    lockHandle,
    resolveLockHeartbeatInterval(config.callbackOutboxLockStaleMs, config.callbackOutboxHeartbeatIntervalMs)
  );

  try {
    const records = await readCallbackOutboxRecords(config);
    const transportClient = createCallbackTransportClient(config);
    const remainingRecords: CallbackOutboxRecord[] = [];
    let deliveredCount = 0;
    let discardedCount = 0;

    for (const record of records) {
      try {
        await sendWithRetry(config, transportClient, record.callbackType, record.runId, record.payload, {
          appendOutboxOnFailure: false
        });
        deliveredCount += 1;
      } catch (error) {
        if (isNonRetryableCallbackError(error)) {
          discardedCount += 1;
          logOperationalEvent(
            "callback-outbox",
            "non_retryable_record_discarded",
            {
              workerId: config.workerId,
              outboxFile: config.callbackOutboxFile,
              callbackType: record.callbackType,
              runId: record.runId,
              attempts: record.attempts + 1,
              errorMessage: errorMessage(error),
              httpStatus: readCallbackHttpStatus(error),
              responseBodySummary: readCallbackHttpResponseBody(error)
            },
            "error"
          );
          continue;
        }

        remainingRecords.push(
          createRetainedOutboxRecord(record, config, config.callbackRetryDelaysMs.length + 1, errorMessage(error))
        );
      }
    }

    await replaceCallbackOutboxRecords(config, remainingRecords);

    const summary = {
      processedCount: records.length,
      deliveredCount,
      failedCount: remainingRecords.length,
      discardedCount,
      remainingCount: remainingRecords.length,
      skipped: false
    };
    if (summary.processedCount > 0) {
      logOperationalEvent("callback-outbox", "replay_completed", {
        workerId: config.workerId,
        outboxFile: config.callbackOutboxFile,
        ...summary
      });
    }
    return summary;
  } finally {
    await stopHeartbeat();
    await lockHandle.release();
  }
}

export function startCallbackOutboxReplayWorker(
  config: Pick<
    RunnerConfig,
    | "callbackMode"
    | "callbackBaseUrl"
    | "callbackTimeoutMs"
    | "callbackAuthToken"
    | "callbackSignatureSecret"
    | "callbackLogFile"
    | "callbackOutboxFile"
    | "callbackOutboxLockFile"
    | "callbackOutboxLockStaleMs"
    | "callbackOutboxRetentionMs"
    | "callbackOutboxMaxRecords"
    | "callbackRetryDelaysMs"
    | "callbackOutboxReplayIntervalMs"
    | "callbackOutboxHeartbeatIntervalMs"
    | "workerId"
  >
): CallbackOutboxReplayWorker {
  let closed = false;
  let replaying = false;
  let lastHeartbeatAt = 0;

  logOperationalEvent("callback-outbox", "worker_started", {
    workerId: config.workerId,
    outboxFile: config.callbackOutboxFile,
    intervalMs: config.callbackOutboxReplayIntervalMs
  });

  const runReplay = async () => {
    if (closed || replaying) {
      return;
    }

    replaying = true;

    try {
      const summary = await replayCallbackOutbox(config);
      const now = Date.now();

      if (!summary.skipped && summary.processedCount === 0 && now - lastHeartbeatAt >= config.callbackOutboxHeartbeatIntervalMs) {
        logOperationalEvent("callback-outbox", "worker_idle_heartbeat", {
          workerId: config.workerId,
          outboxFile: config.callbackOutboxFile,
          replayIntervalMs: config.callbackOutboxReplayIntervalMs,
          heartbeatIntervalMs: config.callbackOutboxHeartbeatIntervalMs
        });
        lastHeartbeatAt = now;
      }

      if (summary.processedCount > 0) {
        lastHeartbeatAt = now;
      }
    } finally {
      replaying = false;
    }
  };

  void runReplay();
  const intervalHandle = setInterval(() => {
    void runReplay();
  }, config.callbackOutboxReplayIntervalMs);

  return {
    close: async () => {
      closed = true;
      clearInterval(intervalHandle);
      logOperationalEvent("callback-outbox", "worker_stopped", {
        workerId: config.workerId,
        outboxFile: config.callbackOutboxFile
      });
    }
  };
}

function startOutboxLockHeartbeat(
  lockHandle: { heartbeat: () => Promise<boolean> },
  intervalMs: number
): () => Promise<void> {
  let inFlightHeartbeat: Promise<unknown> | null = null;
  const timer = setInterval(() => {
    if (inFlightHeartbeat) {
      return;
    }

    inFlightHeartbeat = lockHandle.heartbeat()
      .catch(() => {})
      .finally(() => {
        inFlightHeartbeat = null;
      });
  }, intervalMs);

  return async () => {
    clearInterval(timer);
    await inFlightHeartbeat;
  };
}

function resolveLockHeartbeatInterval(staleMs: number, heartbeatMs: number): number {
  return Math.max(10, Math.min(heartbeatMs, Math.max(10, Math.floor(staleMs / 2))));
}
