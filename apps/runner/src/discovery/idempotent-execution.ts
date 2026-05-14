import type { RunnerConfig } from "../config/index.ts";
import {
  normalizeMessageIdempotencyKey,
  persistMessageIdempotencyResult,
  readMessageIdempotencyResult
} from "../runtime/message-idempotency.ts";
import type { DiscoveryExecuteMessage } from "../shared/contracts.ts";
import type { DiscoveryExecutionResult } from "./index.ts";

export interface DiscoveryIdempotentExecutionInput {
  config: RunnerConfig;
  message: DiscoveryExecuteMessage;
  idempotentExecutions: Map<string, Promise<DiscoveryExecutionResult>>;
  execute: () => Promise<DiscoveryExecutionResult>;
}

export async function executeDiscoveryWithIdempotency({
  config,
  message,
  idempotentExecutions,
  execute
}: DiscoveryIdempotentExecutionInput): Promise<DiscoveryExecutionResult> {
  const idempotencyKey = normalizeMessageIdempotencyKey(message.idempotencyKey);
  if (!idempotencyKey) {
    return execute();
  }

  const existingExecution = idempotentExecutions.get(idempotencyKey);
  if (existingExecution) {
    return existingExecution;
  }

  const persistedResult = await readMessageIdempotencyResult<DiscoveryExecutionResult>(config, "discovery", idempotencyKey);
  if (persistedResult) {
    return persistedResult;
  }

  const execution = execute()
    .then(async (result) => {
      await persistMessageIdempotencyResult(config, "discovery", idempotencyKey, result);
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
