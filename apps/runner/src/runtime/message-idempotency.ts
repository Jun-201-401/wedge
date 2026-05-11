import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { RunnerConfig } from "../config/index.ts";
import { logOperationalEvent } from "../shared/utils.ts";

interface MessageIdempotencyRecord<T> {
  schemaVersion: "0.1";
  scope: MessageIdempotencyScope;
  idempotencyKey: string;
  completedAt: string;
  result: T;
}

export type MessageIdempotencyScope = "run" | "discovery";

export function normalizeMessageIdempotencyKey(idempotencyKey: string | undefined): string | null {
  if (!idempotencyKey || idempotencyKey.trim().length === 0) {
    return null;
  }
  return idempotencyKey.trim();
}

export async function readMessageIdempotencyResult<T>(
  config: Pick<RunnerConfig, "artifactsRoot">,
  scope: MessageIdempotencyScope,
  idempotencyKey: string
): Promise<T | null> {
  try {
    const record = JSON.parse(await readFile(messageIdempotencyRecordPath(config, scope, idempotencyKey), "utf8")) as Partial<MessageIdempotencyRecord<T>>;
    if (record.schemaVersion !== "0.1" || record.scope !== scope || record.idempotencyKey !== idempotencyKey || !record.result) {
      return null;
    }
    return record.result;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      logOperationalEvent(
        "message-idempotency",
        "read_failed",
        {
          scope,
          errorMessage: error instanceof Error ? error.message : String(error)
        },
        "warn"
      );
    }
    return null;
  }
}

export async function persistMessageIdempotencyResult<T>(
  config: Pick<RunnerConfig, "artifactsRoot">,
  scope: MessageIdempotencyScope,
  idempotencyKey: string,
  result: T
): Promise<void> {
  const recordPath = messageIdempotencyRecordPath(config, scope, idempotencyKey);
  await mkdir(dirname(recordPath), { recursive: true });
  const record: MessageIdempotencyRecord<T> = {
    schemaVersion: "0.1",
    scope,
    idempotencyKey,
    completedAt: new Date().toISOString(),
    result
  };
  await writeFile(recordPath, JSON.stringify(record, null, 2), "utf8");
}

export function messageIdempotencyKeyHash(idempotencyKey: string): string {
  return createHash("sha256").update(idempotencyKey).digest("hex");
}

function messageIdempotencyRecordPath(
  config: Pick<RunnerConfig, "artifactsRoot">,
  scope: MessageIdempotencyScope,
  idempotencyKey: string
): string {
  return join(config.artifactsRoot, "message-idempotency", scope, `${messageIdempotencyKeyHash(idempotencyKey)}.json`);
}
