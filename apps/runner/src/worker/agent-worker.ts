import { createAgentDecisionClient, createAgentRuntimePlan, executeAgentRun, type AgentTrace, type AgentTraceScenarioPlanExport } from "../agent/index.ts";
import type { BrowserSessionFactory } from "../browser/playwright/index.ts";
import type { CallbackClient } from "../callback/index.ts";
import type { CapturePipeline } from "../capture/index.ts";
import type { RunnerConfig } from "../config/index.ts";
import { createDeliverySummary, mergeDeliveryIssues, type DeliverySummary } from "../delivery/index.ts";
import { ScenarioExecutionError, type ScenarioExecutionSummary } from "../scenario/executor/index.ts";
import type { AgentExecuteMessage, Artifact } from "../shared/contracts.ts";
import { classifyRunnerFailure, errorMessage, logOperationalEvent } from "../shared/utils.ts";
import type { ArtifactStore } from "../storage/index.ts";
import {
  AgentIdempotencyInProgressError,
  createApiAgentIdempotencyStore,
  createLocalAgentIdempotencyStore,
  resolveAgentIdempotencyKey,
  type AgentIdempotencyClaimInput,
  type AgentIdempotencyStore
} from "./agent-idempotency.ts";
import { emitAcceptedCallback, emitFailedCallback, emitFinishedCallback } from "./callback-policy.ts";

export interface AgentRunnerExecutionResult {
  runId: string;
  workerId: string;
  browserSessionId: string;
  summary: ScenarioExecutionSummary;
  delivery: DeliverySummary;
  trace: AgentTrace;
  traceArtifact?: Artifact;
  scenarioPlanExport?: AgentTraceScenarioPlanExport;
  scenarioPlanExportArtifact?: Artifact;
}

export interface RegisterAgentWorkerInput {
  config: RunnerConfig;
  browserFactory: BrowserSessionFactory;
  callbackClient: CallbackClient;
  capturePipeline: CapturePipeline;
  artifactStore: ArtifactStore;
  agentIdempotencyStore?: AgentIdempotencyStore;
}

export interface AgentRunnerWorker {
  workerId: string;
  handleMessage: (message: AgentExecuteMessage) => Promise<AgentRunnerExecutionResult>;
}

interface AgentLeaseRenewal {
  stop: () => Promise<void>;
}

export function registerAgentWorker({
  config,
  browserFactory,
  callbackClient,
  capturePipeline,
  artifactStore,
  agentIdempotencyStore
}: RegisterAgentWorkerInput): AgentRunnerWorker {
  const idempotentExecutions = new Map<string, Promise<AgentRunnerExecutionResult>>();
  const terminalIdempotencyStore = config.agentIdempotencyStoreEnabled
    ? agentIdempotencyStore ?? createConfiguredAgentIdempotencyStore(config)
    : null;

  return {
    workerId: config.workerId,
    async handleMessage(message) {
      const idempotencyKey = resolveAgentIdempotencyKey({
        envelopeIdempotencyKey: message.idempotencyKey,
        taskIdempotencyKey: message.payload.agentTask.idempotency_key
      });
      if (idempotencyKey) {
        const claimInput = {
          runId: message.payload.agentTask.run_id,
          taskId: message.payload.agentTask.task_id,
          attemptId: message.payload.agentTask.attempt_id,
          attemptIndex: message.payload.agentTask.attempt_index
        };
        let ownsClaim = false;
        let leaseRenewal: AgentLeaseRenewal | null = null;
        const existingExecution = idempotentExecutions.get(idempotencyKey);
        if (existingExecution) {
          logOperationalEvent(
            "agent-worker",
            "duplicate_message_suppressed",
            {
              runId: message.payload.agentTask.run_id,
              taskId: message.payload.agentTask.task_id,
              idempotencyKey
            },
            "warn"
          );
          return existingExecution;
        }

        if (terminalIdempotencyStore?.claim) {
          const claim = await terminalIdempotencyStore.claim(idempotencyKey, claimInput);

          if (claim.status === "COMPLETED") {
            logOperationalEvent(
              "agent-worker",
              "duplicate_message_replayed",
              {
                runId: message.payload.agentTask.run_id,
                taskId: message.payload.agentTask.task_id,
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
                runId: message.payload.agentTask.run_id,
                taskId: message.payload.agentTask.task_id,
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
                runId: message.payload.agentTask.run_id,
                taskId: message.payload.agentTask.task_id,
                idempotencyKey,
                originalRunId: persistedResult.runId
              },
              "warn"
            );
            return persistedResult;
          }
        }

        const execution = executeAgentMessage({
          message,
          config,
          browserFactory,
          callbackClient,
          capturePipeline,
          artifactStore
        })
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
                taskId: message.payload.agentTask.task_id
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
                taskId: message.payload.agentTask.task_id
              });
            }
            idempotentExecutions.delete(idempotencyKey);
            throw error;
          });
        idempotentExecutions.set(idempotencyKey, execution);
        return execution;
      }

      return executeAgentMessage({
        message,
        config,
        browserFactory,
        callbackClient,
        capturePipeline,
        artifactStore
      });
    }
  };
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

function createConfiguredAgentIdempotencyStore(config: RunnerConfig): AgentIdempotencyStore {
  return config.agentIdempotencyStoreMode === "api"
    ? createApiAgentIdempotencyStore(config)
    : createLocalAgentIdempotencyStore(config);
}

async function executeAgentMessage({
  message,
  config,
  browserFactory,
  callbackClient,
  capturePipeline,
  artifactStore
}: RegisterAgentWorkerInput & {
  message: AgentExecuteMessage;
}): Promise<AgentRunnerExecutionResult> {
  const task = message.payload.agentTask;
  let session: Awaited<ReturnType<BrowserSessionFactory["createSession"]>> | undefined;
  let accepted = false;

  try {
    const plan = createAgentRuntimePlan(task);

    session = await browserFactory.createSession({
      runId: task.run_id,
      plan
    });

    await emitAcceptedCallback({
      callbackClient,
      runId: task.run_id,
      workerId: config.workerId,
      browserSessionId: session.id
    });

    accepted = true;

    const executionResult = await executeAgentRun({
      runId: task.run_id,
      task,
      runtimePlan: plan,
      session,
      callbackClient,
      capturePipeline,
      artifactStore,
      decisionClient: createAgentDecisionClient(config)
    });

    const finishedDeliveryIssues = await emitFinishedCallback({
      callbackClient,
      runId: task.run_id,
      workerId: config.workerId,
      summary: executionResult.summary
    });

    return {
      runId: task.run_id,
      workerId: config.workerId,
      browserSessionId: session.id,
      summary: executionResult.summary,
      trace: executionResult.trace,
      traceArtifact: executionResult.traceArtifact,
      scenarioPlanExport: executionResult.scenarioPlanExport,
      scenarioPlanExportArtifact: executionResult.scenarioPlanExportArtifact,
      delivery: createDeliverySummary(
        mergeDeliveryIssues(executionResult.delivery.issues, finishedDeliveryIssues)
      )
    };
  } catch (error) {
    const failureCode = error instanceof ScenarioExecutionError
      ? error.failureCode
      : classifyRunnerFailure(error);
    const resultCompleteness = accepted ? "PARTIAL" : "NONE";

    logOperationalEvent(
      "agent-worker",
      "run_failed",
      {
        runId: task.run_id,
        taskId: task.task_id,
        workerId: config.workerId,
        accepted,
        hasSession: session !== undefined,
        resultCompleteness,
        failureCode,
        failureMessage: errorMessage(error),
        failedStepKey: error instanceof ScenarioExecutionError ? error.failedStepKey : null,
        failedStepOrder: error instanceof ScenarioExecutionError ? error.failedStepOrder : null,
        summary: error instanceof ScenarioExecutionError ? error.summary : undefined
      },
      "error"
    );

    await emitFailedCallback({
      callbackClient,
      runId: task.run_id,
      workerId: config.workerId,
      error,
      accepted,
      hasSession: session !== undefined,
      summary: error instanceof ScenarioExecutionError ? error.summary : undefined,
      failureCode
    });

    throw error;
  } finally {
    if (session) {
      await session.close();
    }
  }
}
