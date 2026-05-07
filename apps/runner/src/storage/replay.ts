import type { RunnerConfig } from "../config/index.ts";
import { errorMessage, logOperationalEvent } from "../shared/utils.ts";
import { createArtifactTransportStore, type ArtifactStore } from "./index.ts";
import {
  acquireArtifactOutboxLock,
  createRetainedArtifactOutboxRecord,
  readArtifactOutboxRecords,
  replaceArtifactOutboxRecords
} from "./outbox.ts";

export interface ArtifactOutboxReplaySummary {
  processedCount: number;
  storedCount: number;
  failedCount: number;
  remainingCount: number;
  skipped: boolean;
}

export interface ArtifactOutboxReplayWorker {
  close: () => Promise<void>;
}

export async function replayArtifactOutbox(
  config: Pick<
    RunnerConfig,
    | "artifactsRoot"
    | "artifactStoreMode"
    | "artifactBucket"
    | "artifactS3Endpoint"
    | "artifactS3Region"
    | "artifactS3AccessKeyId"
    | "artifactS3SecretAccessKey"
    | "artifactS3ForcePathStyle"
    | "artifactOutboxFile"
    | "artifactOutboxLockFile"
    | "artifactOutboxLockStaleMs"
    | "artifactOutboxHeartbeatIntervalMs"
    | "artifactOutboxRetentionMs"
    | "artifactOutboxMaxRecords"
    | "artifactRetryDelaysMs"
    | "workerId"
  >,
  transportStore: ArtifactStore = createArtifactTransportStore(config)
): Promise<ArtifactOutboxReplaySummary> {
  const lockHandle = await acquireArtifactOutboxLock(config);
  if (!lockHandle) {
    logOperationalEvent(
      "artifact-outbox",
      "replay_skipped_locked",
      {
        workerId: config.workerId,
        outboxFile: config.artifactOutboxFile,
        lockFile: config.artifactOutboxLockFile
      },
      "warn"
    );
    return {
      processedCount: 0,
      storedCount: 0,
      failedCount: 0,
      remainingCount: 0,
      skipped: true
    };
  }

  const stopHeartbeat = startOutboxLockHeartbeat(
    lockHandle,
    resolveLockHeartbeatInterval(config.artifactOutboxLockStaleMs, config.artifactOutboxHeartbeatIntervalMs)
  );

  try {
    const records = await readArtifactOutboxRecords(config);
    const remainingRecords = [];
    let storedCount = 0;
    const maxAttempts = config.artifactRetryDelaysMs.length + 1;

    for (const record of records) {
      try {
        await transportStore.persistArtifacts({
          runId: record.runId,
          artifacts: record.artifacts
        });
        storedCount += 1;
      } catch (error) {
        remainingRecords.push(
          createRetainedArtifactOutboxRecord(record, config, maxAttempts, errorMessage(error))
        );
      }
    }

    await replaceArtifactOutboxRecords(config, remainingRecords);

    const summary = {
      processedCount: records.length,
      storedCount,
      failedCount: remainingRecords.length,
      remainingCount: remainingRecords.length,
      skipped: false
    };
    if (summary.processedCount > 0) {
      logOperationalEvent("artifact-outbox", "replay_completed", {
        workerId: config.workerId,
        outboxFile: config.artifactOutboxFile,
        ...summary
      });
    }
    return summary;
  } finally {
    await stopHeartbeat();
    await lockHandle.release();
  }
}

export function startArtifactOutboxReplayWorker(
  config: Pick<
    RunnerConfig,
    | "artifactsRoot"
    | "artifactStoreMode"
    | "artifactBucket"
    | "artifactS3Endpoint"
    | "artifactS3Region"
    | "artifactS3AccessKeyId"
    | "artifactS3SecretAccessKey"
    | "artifactS3ForcePathStyle"
    | "artifactOutboxFile"
    | "artifactOutboxLockFile"
    | "artifactOutboxLockStaleMs"
    | "artifactOutboxRetentionMs"
    | "artifactOutboxMaxRecords"
    | "artifactRetryDelaysMs"
    | "artifactOutboxReplayIntervalMs"
    | "artifactOutboxHeartbeatIntervalMs"
    | "workerId"
  >,
  transportStore: ArtifactStore = createArtifactTransportStore(config)
): ArtifactOutboxReplayWorker {
  let closed = false;
  let replaying = false;
  let lastHeartbeatAt = 0;

  logOperationalEvent("artifact-outbox", "worker_started", {
    workerId: config.workerId,
    outboxFile: config.artifactOutboxFile,
    intervalMs: config.artifactOutboxReplayIntervalMs
  });

  const runReplay = async () => {
    if (closed || replaying) {
      return;
    }

    replaying = true;

    try {
      const summary = await replayArtifactOutbox(config, transportStore);
      const now = Date.now();

      if (!summary.skipped && summary.processedCount === 0 && now - lastHeartbeatAt >= config.artifactOutboxHeartbeatIntervalMs) {
        logOperationalEvent("artifact-outbox", "worker_idle_heartbeat", {
          workerId: config.workerId,
          outboxFile: config.artifactOutboxFile,
          replayIntervalMs: config.artifactOutboxReplayIntervalMs,
          heartbeatIntervalMs: config.artifactOutboxHeartbeatIntervalMs
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
  }, config.artifactOutboxReplayIntervalMs);

  return {
    close: async () => {
      closed = true;
      clearInterval(intervalHandle);
      logOperationalEvent("artifact-outbox", "worker_stopped", {
        workerId: config.workerId,
        outboxFile: config.artifactOutboxFile
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
