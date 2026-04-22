import { appendFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { RunnerConfig } from "../config/index.ts";
import type { ArtifactDraft } from "../shared/contracts.ts";
import { errorMessage, logOperationalEvent, toIsoTimestamp } from "../shared/utils.ts";

export interface ArtifactOutboxRecord {
  runId: string;
  artifacts: ArtifactDraft[];
  failedAt: string;
  attempts: number;
  retryDelaysMs: number[];
  errorMessage: string;
}

export interface ArtifactOutboxLockRecord {
  workerId: string;
  acquiredAt: string;
  heartbeatAt: string;
}

export interface ArtifactOutboxLockHandle {
  heartbeat: () => Promise<boolean>;
  release: () => Promise<void>;
}

export async function appendArtifactOutboxRecord(
  config: Pick<
    RunnerConfig,
    "artifactOutboxFile" | "artifactRetryDelaysMs" | "artifactOutboxRetentionMs" | "artifactOutboxMaxRecords"
  >,
  input: {
    runId: string;
    artifacts: ArtifactDraft[];
    attempts: number;
    errorMessage: string;
  }
): Promise<void> {
  const record: ArtifactOutboxRecord = {
    runId: input.runId,
    artifacts: input.artifacts,
    failedAt: toIsoTimestamp(),
    attempts: input.attempts,
    retryDelaysMs: [...config.artifactRetryDelaysMs],
    errorMessage: input.errorMessage
  };

  await mkdir(dirname(config.artifactOutboxFile), { recursive: true });
  await appendFile(config.artifactOutboxFile, `${JSON.stringify(record)}\n`, "utf8");
  await pruneArtifactOutboxRecords(config);
}

export async function readArtifactOutboxRecords(
  config: Pick<RunnerConfig, "artifactOutboxFile" | "artifactOutboxRetentionMs" | "artifactOutboxMaxRecords">
): Promise<ArtifactOutboxRecord[]> {
  const records = await readArtifactOutboxRecordsRaw(config);
  const prunedRecords = pruneArtifactRecords(records, config.artifactOutboxRetentionMs, config.artifactOutboxMaxRecords);

  if (prunedRecords.length !== records.length) {
    await replaceArtifactOutboxRecords(config, prunedRecords);
  }

  return prunedRecords;
}

export async function replaceArtifactOutboxRecords(
  config: Pick<RunnerConfig, "artifactOutboxFile">,
  records: ArtifactOutboxRecord[]
): Promise<void> {
  if (records.length === 0) {
    await rm(config.artifactOutboxFile, { force: true });
    return;
  }

  await mkdir(dirname(config.artifactOutboxFile), { recursive: true });
  await writeFile(config.artifactOutboxFile, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`, "utf8");
}

export function createRetainedArtifactOutboxRecord(
  record: ArtifactOutboxRecord,
  config: Pick<RunnerConfig, "artifactRetryDelaysMs">,
  additionalAttempts: number,
  errorMessageValue: string
): ArtifactOutboxRecord {
  return {
    ...record,
    failedAt: toIsoTimestamp(),
    attempts: record.attempts + additionalAttempts,
    retryDelaysMs: [...config.artifactRetryDelaysMs],
    errorMessage: errorMessageValue
  };
}

export async function pruneArtifactOutboxRecords(
  config: Pick<RunnerConfig, "artifactOutboxFile" | "artifactOutboxRetentionMs" | "artifactOutboxMaxRecords">
): Promise<void> {
  const records = await readArtifactOutboxRecordsRaw(config);
  const prunedRecords = pruneArtifactRecords(records, config.artifactOutboxRetentionMs, config.artifactOutboxMaxRecords);

  if (prunedRecords.length !== records.length) {
    await replaceArtifactOutboxRecords(config, prunedRecords);
    logOperationalEvent("artifact-outbox", "records_pruned", {
      outboxFile: config.artifactOutboxFile,
      removedCount: records.length - prunedRecords.length,
      remainingCount: prunedRecords.length
    });
  }
}

export async function acquireArtifactOutboxLock(
  config: Pick<RunnerConfig, "artifactOutboxLockFile" | "artifactOutboxLockStaleMs" | "workerId">
): Promise<ArtifactOutboxLockHandle | null> {
  await mkdir(dirname(config.artifactOutboxLockFile), { recursive: true });
  const acquiredAt = toIsoTimestamp();

  const lockRecord: ArtifactOutboxLockRecord = {
    workerId: config.workerId,
    acquiredAt,
    heartbeatAt: acquiredAt
  };

  if (await tryWriteArtifactLockFile(config.artifactOutboxLockFile, lockRecord)) {
    return createArtifactLockHandle(config.artifactOutboxLockFile, lockRecord);
  }

  const existingLock = await readArtifactOutboxLockRecord(config);
  if (existingLock && isStaleArtifactLock(existingLock, config.artifactOutboxLockStaleMs)) {
    logOperationalEvent("artifact-outbox", "stale_lock_recovered", {
      workerId: config.workerId,
      staleWorkerId: existingLock.workerId,
      lockFile: config.artifactOutboxLockFile
    });
    await rm(config.artifactOutboxLockFile, { force: true });

    if (await tryWriteArtifactLockFile(config.artifactOutboxLockFile, lockRecord)) {
      return createArtifactLockHandle(config.artifactOutboxLockFile, lockRecord);
    }
  }

  return null;
}

async function tryWriteArtifactLockFile(path: string, record: ArtifactOutboxLockRecord): Promise<boolean> {
  try {
    await writeFile(path, `${JSON.stringify(record)}\n`, { encoding: "utf8", flag: "wx" });
    return true;
  } catch (error) {
    if (errorMessage(error).includes("EEXIST")) {
      return false;
    }

    throw error;
  }
}

async function readArtifactOutboxLockRecord(
  config: Pick<RunnerConfig, "artifactOutboxLockFile">
): Promise<ArtifactOutboxLockRecord | null> {
  try {
    const raw = await readFile(config.artifactOutboxLockFile, "utf8");
    return JSON.parse(raw.trim()) as ArtifactOutboxLockRecord;
  } catch (error) {
    if (errorMessage(error).includes("ENOENT")) {
      return null;
    }

    throw error;
  }
}

function isStaleArtifactLock(record: ArtifactOutboxLockRecord, staleMs: number): boolean {
  const heartbeatAt = Date.parse(record.heartbeatAt ?? record.acquiredAt);
  if (!Number.isFinite(heartbeatAt)) {
    return true;
  }

  return Date.now() - heartbeatAt > staleMs;
}

function createArtifactLockHandle(path: string, lockRecord: ArtifactOutboxLockRecord): ArtifactOutboxLockHandle {
  return {
    heartbeat: async () => {
      const nextHeartbeatAt = toIsoTimestamp();

      try {
        const raw = await readFile(path, "utf8");
        const currentLock = JSON.parse(raw.trim()) as ArtifactOutboxLockRecord;

        if (currentLock.workerId !== lockRecord.workerId || currentLock.acquiredAt !== lockRecord.acquiredAt) {
          return false;
        }

        const nextLock = {
          ...currentLock,
          heartbeatAt: nextHeartbeatAt
        };
        await writeFile(path, `${JSON.stringify(nextLock)}\n`, "utf8");
        lockRecord.heartbeatAt = nextHeartbeatAt;
        return true;
      } catch (error) {
        if (errorMessage(error).includes("ENOENT")) {
          return false;
        }

        throw error;
      }
    },
    release: async () => {
      try {
        const raw = await readFile(path, "utf8");
        const currentLock = JSON.parse(raw.trim()) as ArtifactOutboxLockRecord;

        if (currentLock.workerId !== lockRecord.workerId || currentLock.acquiredAt !== lockRecord.acquiredAt) {
          return;
        }
      } catch (error) {
        if (errorMessage(error).includes("ENOENT")) {
          return;
        }

        throw error;
      }

      await rm(path, { force: true });
    }
  };
}

async function readArtifactOutboxRecordsRaw(
  config: Pick<RunnerConfig, "artifactOutboxFile">
): Promise<ArtifactOutboxRecord[]> {
  try {
    const raw = await readFile(config.artifactOutboxFile, "utf8");
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as ArtifactOutboxRecord);
  } catch (error) {
    if (errorMessage(error).includes("ENOENT")) {
      return [];
    }

    throw error;
  }
}

function pruneArtifactRecords(
  records: ArtifactOutboxRecord[],
  retentionMs: number,
  maxRecords: number
): ArtifactOutboxRecord[] {
  const now = Date.now();
  const retained = records.filter((record) => {
    const failedAt = Date.parse(record.failedAt);
    if (!Number.isFinite(failedAt)) {
      return false;
    }

    return now - failedAt <= retentionMs;
  });

  if (retained.length <= maxRecords) {
    return retained;
  }

  return retained.slice(retained.length - maxRecords);
}
