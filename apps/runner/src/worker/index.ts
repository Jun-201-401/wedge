import type { BrowserSessionFactory } from "../browser/playwright/index.ts";
import type { CallbackClient } from "../callback/index.ts";
import type { RunnerConfig } from "../config/index.ts";
import type { CapturePipeline } from "../capture/index.ts";
import { createDeliverySummary, mergeDeliveryIssues, type DeliverySummary } from "../delivery/index.ts";
import { executeScenario, ScenarioExecutionError, type ScenarioExecutionSummary } from "../scenario/executor/index.ts";
import {
  normalizeMessageIdempotencyKey,
  persistMessageIdempotencyResult,
  readMessageIdempotencyResult
} from "../runtime/message-idempotency.ts";
import type { ArtifactStore } from "../storage/index.ts";
import type { AgentArtifactPolicy, RunExecuteMessage, ScenarioPlan } from "../shared/contracts.ts";
import { classifyRunnerFailure, errorMessage, logOperationalEvent, runnerFailureOutcome } from "../shared/utils.ts";
import { emitAcceptedCallback, emitFailedCallback, emitFinishedCallback } from "./callback-policy.ts";

export interface RunnerExecutionResult {
  runId: string;
  workerId: string;
  browserSessionId: string;
  summary: ScenarioExecutionSummary;
  delivery: DeliverySummary;
}

export interface RegisterWorkerInput {
  config: RunnerConfig;
  browserFactory: BrowserSessionFactory;
  callbackClient: CallbackClient;
  capturePipeline: CapturePipeline;
  artifactStore: ArtifactStore;
}

export interface RunnerWorker {
  workerId: string;
  handleMessage: (message: RunExecuteMessage) => Promise<RunnerExecutionResult>;
}

export function registerWorker({
  config,
  browserFactory,
  callbackClient,
  capturePipeline,
  artifactStore
}: RegisterWorkerInput): RunnerWorker {
  const idempotentExecutions = new Map<string, Promise<RunnerExecutionResult>>();

  return {
    workerId: config.workerId,
    async handleMessage(message) {
      const idempotencyKey = normalizeMessageIdempotencyKey(message.idempotencyKey);
      if (idempotencyKey) {
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

        const execution = executeRunMessage({
          message,
          config,
          browserFactory,
          callbackClient,
          capturePipeline,
          artifactStore
        })
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

      return executeRunMessage({
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

async function executeRunMessage({
  message,
  config,
  browserFactory,
  callbackClient,
  capturePipeline,
  artifactStore
}: RegisterWorkerInput & {
  message: RunExecuteMessage;
}): Promise<RunnerExecutionResult> {
  let session: Awaited<ReturnType<BrowserSessionFactory["createSession"]>> | undefined;
  let accepted = false;

  try {
    const plan = applyRunArtifactPolicy(message.payload.scenarioPlan, message.payload.artifactPolicy);

    session = await browserFactory.createSession({
      runId: message.payload.runId,
      plan
    });

    await emitAcceptedCallback({
      callbackClient,
      runId: message.payload.runId,
      workerId: config.workerId,
      browserSessionId: session.id
    });

    accepted = true;

    const executionResult = await executeScenario({
      runId: message.payload.runId,
      plan,
      session,
      callbackClient,
      capturePipeline,
      artifactStore
    });

    const finishedDeliveryIssues = await emitFinishedCallback({
      callbackClient,
      runId: message.payload.runId,
      workerId: config.workerId,
      summary: executionResult.summary
    });
    const delivery = createDeliverySummary(
      mergeDeliveryIssues(executionResult.delivery.issues, finishedDeliveryIssues)
    );

    logOperationalEvent(
      "worker",
      "run_finished",
      {
        runId: message.payload.runId,
        workerId: config.workerId,
        browserSessionId: session.id,
        terminalOutcome: executionResult.summary.stopped ? "STOPPED" : "COMPLETED",
        resultCompleteness: "FINAL",
        summary: executionResult.summary,
        deliveryStatus: delivery.status,
        deliveryIssueCount: delivery.issues.length,
        deliveryIssueScopes: delivery.issues.map((issue) => issue.scope)
      },
      delivery.status === "DELIVERY_COMPLETE" ? "info" : "warn"
    );

    return {
      runId: message.payload.runId,
      workerId: config.workerId,
      browserSessionId: session.id,
      summary: executionResult.summary,
      delivery
    };
  } catch (error) {
    const failureCode = error instanceof ScenarioExecutionError
      ? error.failureCode
      : classifyRunnerFailure(error);
    const resultCompleteness = accepted ? "PARTIAL" : "NONE";

    logOperationalEvent(
      "worker",
      "run_failed",
      {
        runId: message.payload.runId,
        workerId: config.workerId,
        accepted,
        hasSession: session !== undefined,
        resultCompleteness,
        terminalOutcome: runnerFailureOutcome(failureCode),
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
      runId: message.payload.runId,
      workerId: config.workerId,
      error,
      accepted,
      hasSession: session !== undefined,
      summary: error instanceof ScenarioExecutionError ? error.summary : undefined,
      failureCode,
      failureArtifactRefs: error instanceof ScenarioExecutionError ? error.failureArtifactRefs : undefined
    });

    throw error;
  } finally {
    if (session) {
      await session.close();
    }
  }
}

function applyRunArtifactPolicy(
  scenarioPlan: ScenarioPlan,
  artifactPolicy: RunExecuteMessage["payload"]["artifactPolicy"]
): ScenarioPlan {
  const normalizedPolicy = normalizeRunArtifactPolicy(artifactPolicy);
  if (!normalizedPolicy) {
    return scenarioPlan;
  }

  return {
    ...scenarioPlan,
    artifact_policy: {
      ...scenarioPlan.artifact_policy,
      ...normalizedPolicy
    }
  };
}

function normalizeRunArtifactPolicy(
  artifactPolicy: RunExecuteMessage["payload"]["artifactPolicy"]
): AgentArtifactPolicy | null {
  if (!artifactPolicy) {
    return null;
  }

  const normalized: AgentArtifactPolicy = {};
  setOptionalBoolean(normalized, "capture_screenshots", readArtifactPolicyBoolean(artifactPolicy, "capture_screenshots", "captureScreenshot", "captureScreenshots"));
  setOptionalBoolean(normalized, "capture_dom_snapshots", readArtifactPolicyBoolean(artifactPolicy, "capture_dom_snapshots", "captureDomSnapshot", "captureDomSnapshots"));
  setOptionalBoolean(normalized, "capture_ax_tree", readArtifactPolicyBoolean(artifactPolicy, "capture_ax_tree", "captureAxTree"));
  setOptionalBoolean(normalized, "capture_trace", readArtifactPolicyBoolean(artifactPolicy, "capture_trace", "captureTrace"));
  setOptionalBoolean(normalized, "capture_har", readArtifactPolicyBoolean(artifactPolicy, "capture_har", "captureHar"));
  setOptionalBoolean(normalized, "capture_performance", readArtifactPolicyBoolean(artifactPolicy, "capture_performance", "capturePerformance"));

  return Object.keys(normalized).length > 0 ? normalized : null;
}

function readArtifactPolicyBoolean(
  artifactPolicy: RunExecuteMessage["payload"]["artifactPolicy"],
  ...keys: string[]
): boolean | undefined {
  if (!artifactPolicy) {
    return undefined;
  }
  const record = artifactPolicy as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "boolean") {
      return value;
    }
  }
  return undefined;
}

function setOptionalBoolean<K extends keyof AgentArtifactPolicy>(
  policy: AgentArtifactPolicy,
  key: K,
  value: boolean | undefined
): void {
  if (value !== undefined) {
    policy[key] = value;
  }
}
