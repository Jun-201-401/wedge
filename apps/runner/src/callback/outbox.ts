import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { RunnerConfig } from "../config/index.ts";
import { errorMessage, logOperationalEvent, toIsoTimestamp } from "../shared/utils.ts";
import type { CallbackType } from "./client.ts";

export interface CallbackOutboxRecord {
  callbackType: CallbackType;
  runId: string;
  failedAt: string;
  payload: unknown;
  attempts: number;
  retryDelaysMs: number[];
  errorMessage: string;
}

export interface CallbackOutboxLockRecord {
  workerId: string;
  acquiredAt: string;
  heartbeatAt: string;
}

export interface CallbackOutboxLockHandle {
  heartbeat: () => Promise<boolean>;
  release: () => Promise<void>;
}

export async function appendCallbackOutboxRecord(
  config: Pick<
    RunnerConfig,
    "callbackOutboxFile" | "callbackRetryDelaysMs" | "callbackOutboxRetentionMs" | "callbackOutboxMaxRecords"
  >,
  input: {
    callbackType: CallbackType;
    runId: string;
    payload: unknown;
    attempts: number;
    errorMessage: string;
  }
): Promise<void> {
  const record: CallbackOutboxRecord = {
    callbackType: input.callbackType,
    runId: input.runId,
    failedAt: toIsoTimestamp(),
    payload: input.payload,
    attempts: input.attempts,
    retryDelaysMs: [...config.callbackRetryDelaysMs],
    errorMessage: input.errorMessage
  };

  await mkdir(dirname(config.callbackOutboxFile), { recursive: true });
  await appendFile(config.callbackOutboxFile, `${JSON.stringify(record)}\n`, "utf8");
  await pruneCallbackOutboxRecords(config);
}

export async function readCallbackOutboxRecords(
  config: Pick<RunnerConfig, "callbackOutboxFile" | "callbackOutboxRetentionMs" | "callbackOutboxMaxRecords">
): Promise<CallbackOutboxRecord[]> {
  const records = await readCallbackOutboxRecordsRaw(config);
  const prunedRecords = pruneCallbackRecords(records, config.callbackOutboxRetentionMs, config.callbackOutboxMaxRecords);

  if (prunedRecords.length !== records.length) {
    await replaceCallbackOutboxRecords(config, prunedRecords);
  }

  return prunedRecords;
}

export async function replaceCallbackOutboxRecords(
  config: Pick<RunnerConfig, "callbackOutboxFile">,
  records: CallbackOutboxRecord[]
): Promise<void> {
  if (records.length === 0) {
    await rm(config.callbackOutboxFile, { force: true });
    return;
  }

  await mkdir(dirname(config.callbackOutboxFile), { recursive: true });
  await writeFile(
    config.callbackOutboxFile,
    `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
    "utf8"
  );
}

export function createRetainedOutboxRecord(
  record: CallbackOutboxRecord,
  config: Pick<RunnerConfig, "callbackRetryDelaysMs">,
  additionalAttempts: number,
  errorMessageValue: string
): CallbackOutboxRecord {
  return {
    ...record,
    attempts: record.attempts + additionalAttempts,
    retryDelaysMs: [...config.callbackRetryDelaysMs],
    errorMessage: errorMessageValue
  };
}

export async function pruneCallbackOutboxRecords(
  config: Pick<RunnerConfig, "callbackOutboxFile" | "callbackOutboxRetentionMs" | "callbackOutboxMaxRecords">
): Promise<void> {
  const records = await readCallbackOutboxRecordsRaw(config);
  const prunedRecords = pruneCallbackRecords(records, config.callbackOutboxRetentionMs, config.callbackOutboxMaxRecords);

  if (prunedRecords.length !== records.length) {
    await replaceCallbackOutboxRecords(config, prunedRecords);
    logOperationalEvent("callback-outbox", "records_pruned", {
      outboxFile: config.callbackOutboxFile,
      removedCount: records.length - prunedRecords.length,
      remainingCount: prunedRecords.length
    });
  }
}

export async function acquireCallbackOutboxLock(
  config: Pick<RunnerConfig, "callbackOutboxLockFile" | "callbackOutboxLockStaleMs" | "workerId">
): Promise<CallbackOutboxLockHandle | null> {
  await mkdir(dirname(config.callbackOutboxLockFile), { recursive: true });
  const acquiredAt = toIsoTimestamp();

  const lockRecord: CallbackOutboxLockRecord = {
    workerId: config.workerId,
    acquiredAt,
    heartbeatAt: acquiredAt
  };

  if (await tryWriteLockFile(config.callbackOutboxLockFile, lockRecord)) {
    return createLockHandle(config.callbackOutboxLockFile, lockRecord);
  }

  const existingLock = await readCallbackOutboxLockRecord(config);
  if (existingLock && isStaleLock(existingLock, config.callbackOutboxLockStaleMs)) {
    logOperationalEvent("callback-outbox", "stale_lock_recovered", {
      workerId: config.workerId,
      staleWorkerId: existingLock.workerId,
      lockFile: config.callbackOutboxLockFile
    });
    await rm(config.callbackOutboxLockFile, { force: true });

    if (await tryWriteLockFile(config.callbackOutboxLockFile, lockRecord)) {
      return createLockHandle(config.callbackOutboxLockFile, lockRecord);
    }
  }

  return null;
}

async function tryWriteLockFile(path: string, record: CallbackOutboxLockRecord): Promise<boolean> {
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

async function readCallbackOutboxLockRecord(
  config: Pick<RunnerConfig, "callbackOutboxLockFile">
): Promise<CallbackOutboxLockRecord | null> {
  return readCallbackOutboxLockRecordFromPath(config.callbackOutboxLockFile);
}

async function readCallbackOutboxLockRecordFromPath(path: string): Promise<CallbackOutboxLockRecord | null> {
  try {
    const raw = await readFile(path, "utf8");
    return parseCallbackOutboxLockRecord(raw);
  } catch (error) {
    if (errorMessage(error).includes("ENOENT")) {
      return null;
    }

    throw error;
  }
}

function parseCallbackOutboxLockRecord(raw: string): CallbackOutboxLockRecord | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed) as Partial<CallbackOutboxLockRecord>;
    if (
      typeof parsed.workerId !== "string" ||
      typeof parsed.acquiredAt !== "string" ||
      (parsed.heartbeatAt !== undefined && typeof parsed.heartbeatAt !== "string")
    ) {
      return null;
    }
    return {
      workerId: parsed.workerId,
      acquiredAt: parsed.acquiredAt,
      heartbeatAt: parsed.heartbeatAt ?? parsed.acquiredAt
    };
  } catch {
    return null;
  }
}

function isStaleLock(record: CallbackOutboxLockRecord, staleMs: number): boolean {
  const heartbeatAt = Date.parse(record.heartbeatAt ?? record.acquiredAt);
  if (!Number.isFinite(heartbeatAt)) {
    return true;
  }

  return Date.now() - heartbeatAt > staleMs;
}

function createLockHandle(path: string, lockRecord: CallbackOutboxLockRecord): CallbackOutboxLockHandle {
  return {
    heartbeat: async () => {
      const nextHeartbeatAt = toIsoTimestamp();

      try {
        const currentLock = await readCallbackOutboxLockRecordFromPath(path);

        if (!currentLock || currentLock.workerId !== lockRecord.workerId || currentLock.acquiredAt !== lockRecord.acquiredAt) {
          return false;
        }

        const nextLock = {
          ...currentLock,
          heartbeatAt: nextHeartbeatAt
        };
        await replaceCallbackLockFile(path, nextLock);
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
        const currentLock = await readCallbackOutboxLockRecordFromPath(path);

        if (!currentLock || currentLock.workerId !== lockRecord.workerId || currentLock.acquiredAt !== lockRecord.acquiredAt) {
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

async function replaceCallbackLockFile(path: string, record: CallbackOutboxLockRecord): Promise<void> {
  const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(tempPath, `${JSON.stringify(record)}\n`, { encoding: "utf8", flag: "wx" });
    await rename(tempPath, path);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}

async function readCallbackOutboxRecordsRaw(
  config: Pick<RunnerConfig, "callbackOutboxFile">
): Promise<CallbackOutboxRecord[]> {
  try {
    const raw = await readFile(config.callbackOutboxFile, "utf8");
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as CallbackOutboxRecord);
  } catch (error) {
    if (errorMessage(error).includes("ENOENT")) {
      return [];
    }

    throw error;
  }
}

function pruneCallbackRecords(
  records: CallbackOutboxRecord[],
  retentionMs: number,
  maxRecords: number
): CallbackOutboxRecord[] {
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
