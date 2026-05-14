import type { RunnerConfig } from "../config/index.ts";
import {
  normalizeMessageIdempotencyKey,
  persistMessageIdempotencyResult,
  readMessageIdempotencyResult
} from "../runtime/message-idempotency.ts";
import type { RunExecuteMessage } from "../shared/contracts.ts";
import { logOperationalEvent } from "../shared/utils.ts";
import type { RunnerExecutionResult } from "./index.ts";

export interface RunIdempotentExecutionInput {
  config: RunnerConfig;
  message: RunExecuteMessage;
  idempotentExecutions: Map<string, Promise<RunnerExecutionResult>>;
  execute: () => Promise<RunnerExecutionResult>;
}

export async function executeRunMessageWithIdempotency({
  config,
  message,
  idempotentExecutions,
  execute
}: RunIdempotentExecutionInput): Promise<RunnerExecutionResult> {
  const idempotencyKey = normalizeMessageIdempotencyKey(message.idempotencyKey);
  if (!idempotencyKey) {
    return execute();
  }

  const existingExecution = idempotentExecutions.get(idempotencyKey);
  if (existingExecution) {
    logOperationalEvent(
      "worker",
      "duplicate_message_suppressed",
      {
        runId: message.payload.runId,
        idempotencyKey
      },
      "warn"
    );
    return existingExecution;
  }

  const persistedResult = await readMessageIdempotencyResult<RunnerExecutionResult>(config, "run", idempotencyKey);
  if (persistedResult) {
    logOperationalEvent(
      "worker",
      "duplicate_message_replayed",
      {
        runId: message.payload.runId,
        idempotencyKey,
        originalRunId: persistedResult.runId
      },
      "warn"
    );
    return persistedResult;
  }

  const execution = execute()
    .then(async (result) => {
      await persistMessageIdempotencyResult(config, "run", idempotencyKey, result);
      idempotentExecutions.delete(idempotencyKey);
      return result;
    })
    .catch((error) => {
      idempotentExecutions.delete(idempotencyKey);
      throw error;
    });

  idempotentExecutions.set(idempotencyKey, execution);
  return execution;
}
