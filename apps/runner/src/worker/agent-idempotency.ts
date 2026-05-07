import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { RunnerConfig } from "../config/index.ts";
import { logOperationalEvent } from "../shared/utils.ts";
import type { AgentRunnerExecutionResult } from "./agent-worker.ts";

export interface AgentIdempotencyRecord {
  schemaVersion: "0.1";
  idempotencyKey: string;
  runId: string;
  taskId: string;
  attemptId: string;
  completedAt: string;
  result: AgentRunnerExecutionResult;
}

export function resolveAgentIdempotencyKey(input: {
  envelopeIdempotencyKey?: string;
  taskIdempotencyKey?: string | null;
}): string | null {
  const key = input.taskIdempotencyKey ?? input.envelopeIdempotencyKey;
  return typeof key === "string" && key.trim().length > 0 ? key.trim() : null;
}

export async function readAgentIdempotencyResult(
  config: Pick<RunnerConfig, "artifactsRoot">,
  idempotencyKey: string
): Promise<AgentRunnerExecutionResult | null> {
  const recordPath = agentIdempotencyRecordPath(config, idempotencyKey);

  try {
    const rawRecord = await readFile(recordPath, "utf8");
    const record = JSON.parse(rawRecord) as Partial<AgentIdempotencyRecord>;

    if (record.schemaVersion !== "0.1" || record.idempotencyKey !== idempotencyKey || !record.result) {
      return null;
    }

    return record.result;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }

    logOperationalEvent(
      "agent-idempotency",
      "record_read_failed",
      {
        recordPath,
        errorMessage: error instanceof Error ? error.message : String(error)
      },
      "warn"
    );
    return null;
  }
}

export async function persistAgentIdempotencyResult(
  config: Pick<RunnerConfig, "artifactsRoot" | "workerId">,
  idempotencyKey: string,
  result: AgentRunnerExecutionResult
): Promise<void> {
  if (result.trace.outcome.status === "RUNNING" || result.trace.outcome.status === "FAILED") {
    return;
  }

  const recordPath = agentIdempotencyRecordPath(config, idempotencyKey);
  const tempPath = `${recordPath}.${config.workerId}.${process.pid}.tmp`;
  const record: AgentIdempotencyRecord = {
    schemaVersion: "0.1",
    idempotencyKey,
    runId: result.runId,
    taskId: result.trace.task_id,
    attemptId: result.trace.attempt_id,
    completedAt: new Date().toISOString(),
    result
  };

  await mkdir(dirname(recordPath), { recursive: true });
  await writeFile(tempPath, JSON.stringify(record, null, 2), "utf8");
  await rename(tempPath, recordPath);
}

function agentIdempotencyRecordPath(config: Pick<RunnerConfig, "artifactsRoot">, idempotencyKey: string): string {
  const digest = createHash("sha256").update(idempotencyKey).digest("hex");
  return join(config.artifactsRoot, "agent-idempotency", `${digest}.json`);
}
