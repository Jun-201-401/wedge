import type { RunnerConfig } from "../config/index.ts";
import type { AgentExecuteMessage } from "../shared/contracts.ts";
import { errorMessage, logOperationalEvent } from "../shared/utils.ts";
import type { AgentRunnerExecutionResult } from "./agent-worker.ts";
import {
  AgentIdempotencyInProgressError,
  createApiAgentIdempotencyStore,
  createLocalAgentIdempotencyStore,
  resolveAgentIdempotencyKey,
  type AgentIdempotencyClaimInput,
  type AgentIdempotencyStore
} from "./agent-idempotency.ts";

interface AgentLeaseRenewal {
  stop: () => Promise<void>;
}

export interface AgentIdempotentExecutionInput {
  config: RunnerConfig;
  message: AgentExecuteMessage;
  terminalIdempotencyStore: AgentIdempotencyStore | null;
  idempotentExecutions: Map<string, Promise<AgentRunnerExecutionResult>>;
  execute: () => Promise<AgentRunnerExecutionResult>;
}

export async function executeAgentMessageWithIdempotency({
  config,
  message,
  terminalIdempotencyStore,
  idempotentExecutions,
  execute
}: AgentIdempotentExecutionInput): Promise<AgentRunnerExecutionResult> {
  const task = message.payload.agentTask;
  const idempotencyKey = resolveAgentIdempotencyKey({
    envelopeIdempotencyKey: message.idempotencyKey,
    taskIdempotencyKey: task.idempotency_key
  });

  if (!idempotencyKey) {
    return execute();
  }

  const claimInput = {
    runId: task.run_id,
    taskId: task.task_id,
    attemptId: task.attempt_id,
    attemptIndex: task.attempt_index
  };
  const existingExecution = idempotentExecutions.get(idempotencyKey);
  if (existingExecution) {
    logOperationalEvent(
      "agent-worker",
      "duplicate_message_suppressed",
      {
        runId: task.run_id,
        taskId: task.task_id,
        idempotencyKey
      },
      "warn"
    );
    return existingExecution;
  }

  let ownsClaim = false;
  let leaseRenewal: AgentLeaseRenewal | null = null;

  if (terminalIdempotencyStore?.claim) {
    const claim = await terminalIdempotencyStore.claim(idempotencyKey, claimInput);

    if (claim.status === "COMPLETED") {
      logOperationalEvent(
        "agent-worker",
        "duplicate_message_replayed",
        {
          runId: task.run_id,
          taskId: task.task_id,
          idempotencyKey,
          originalRunId: claim.result.runId
        },
        "warn"
      );
      return claim.result;
    }

    if (claim.status === "IN_PROGRESS") {
      logOperationalEvent(
        "agent-worker",
        "duplicate_message_in_progress",
        {
          runId: task.run_id,
          taskId: task.task_id,
          idempotencyKey,
          claimedBy: claim.claimedBy,
          leaseExpiresAt: claim.leaseExpiresAt
        },
        "warn"
      );
      throw new AgentIdempotencyInProgressError(idempotencyKey, claim.claimedBy, claim.leaseExpiresAt);
    }

    ownsClaim = true;
    leaseRenewal = startAgentIdempotencyLeaseRenewal({
      config,
      store: terminalIdempotencyStore,
      idempotencyKey,
      claimInput
    });
  } else if (terminalIdempotencyStore) {
    const persistedResult = await terminalIdempotencyStore.read(idempotencyKey);
    if (persistedResult) {
      logOperationalEvent(
        "agent-worker",
        "duplicate_message_replayed",
        {
          runId: task.run_id,
          taskId: task.task_id,
          idempotencyKey,
          originalRunId: persistedResult.runId
        },
        "warn"
      );
      return persistedResult;
    }
  }

  const execution = execute()
    .then(async (result) => {
      await leaseRenewal?.stop();
      if (terminalIdempotencyStore) {
        await terminalIdempotencyStore.persist(idempotencyKey, result);
      }
      if (ownsClaim && terminalIdempotencyStore?.release && shouldReleaseUnstoredAgentResult(result)) {
        await releaseAgentIdempotencyClaimBestEffort({
          store: terminalIdempotencyStore,
          idempotencyKey,
          claimInput,
          taskId: task.task_id
        });
      }
      return result;
    })
    .catch(async (error) => {
      await leaseRenewal?.stop();
      if (ownsClaim && terminalIdempotencyStore?.release) {
        await releaseAgentIdempotencyClaimBestEffort({
          store: terminalIdempotencyStore,
          idempotencyKey,
          claimInput,
          taskId: task.task_id
        });
      }
      idempotentExecutions.delete(idempotencyKey);
      throw error;
    });

  idempotentExecutions.set(idempotencyKey, execution);
  return execution;
}

function startAgentIdempotencyLeaseRenewal({
  config,
  store,
  idempotencyKey,
  claimInput
}: {
  config: RunnerConfig;
  store: AgentIdempotencyStore;
  idempotencyKey: string;
  claimInput: AgentIdempotencyClaimInput;
}): AgentLeaseRenewal | null {
  if (!store.renew) {
    return null;
  }

  let stopped = false;
  let inFlight: Promise<void> | null = null;
  const renew = async () => {
    try {
      const result = await store.renew?.(idempotencyKey, claimInput);
      if (result?.status !== "CLAIMED") {
        logOperationalEvent(
          "agent-worker",
          "idempotency_lease_renew_not_owned",
          {
            runId: claimInput.runId,
            taskId: claimInput.taskId,
            idempotencyKey,
            renewStatus: result?.status,
            claimedBy: result && "claimedBy" in result ? result.claimedBy : null,
            leaseExpiresAt: result && "leaseExpiresAt" in result ? result.leaseExpiresAt : null
          },
          "warn"
        );
      }
    } catch (error) {
      logOperationalEvent(
        "agent-worker",
        "idempotency_lease_renew_failed",
        {
          runId: claimInput.runId,
          taskId: claimInput.taskId,
          idempotencyKey,
          errorMessage: errorMessage(error)
        },
        "warn"
      );
    }
  };
  const interval = setInterval(() => {
    if (stopped || inFlight) {
      return;
    }
    const current = renew();
    inFlight = current.finally(() => {
      if (inFlight === current) {
        inFlight = null;
      }
    });
  }, config.agentIdempotencyRenewIntervalMs);
  interval.unref?.();

  return {
    async stop() {
      stopped = true;
      clearInterval(interval);
      await inFlight;
    }
  };
}

async function releaseAgentIdempotencyClaimBestEffort({
  store,
  idempotencyKey,
  claimInput,
  taskId
}: {
  store: AgentIdempotencyStore;
  idempotencyKey: string;
  claimInput: AgentIdempotencyClaimInput;
  taskId: string;
}): Promise<void> {
  try {
    await store.release?.(idempotencyKey, claimInput);
  } catch (error) {
    logOperationalEvent(
      "agent-worker",
      "idempotency_lease_release_failed",
      {
        runId: claimInput.runId,
        taskId,
        idempotencyKey,
        errorMessage: errorMessage(error)
      },
      "warn"
    );
  }
}

function shouldReleaseUnstoredAgentResult(result: AgentRunnerExecutionResult): boolean {
  return result.trace.outcome.status === "RUNNING" || result.trace.outcome.status === "FAILED";
}

export function createConfiguredAgentIdempotencyStore(config: RunnerConfig): AgentIdempotencyStore {
  return config.agentIdempotencyStoreMode === "api"
    ? createApiAgentIdempotencyStore(config)
    : createLocalAgentIdempotencyStore(config);
}
