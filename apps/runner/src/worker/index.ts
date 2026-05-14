import type { BrowserSessionFactory } from "../browser/playwright/index.ts";
import type { CallbackClient } from "../callback/index.ts";
import type { RunnerConfig } from "../config/index.ts";
import type { CapturePipeline } from "../capture/index.ts";
import { createDeliverySummary, mergeDeliveryIssues, type DeliverySummary } from "../delivery/index.ts";
import { executeScenario, ScenarioExecutionError, type ScenarioExecutionSummary } from "../scenario/executor/index.ts";
import type { ArtifactStore } from "../storage/index.ts";
import type { RunExecuteMessage } from "../shared/contracts.ts";
import { classifyRunnerFailure, errorMessage, logOperationalEvent, runnerFailureOutcome } from "../shared/utils.ts";
import { emitAcceptedCallback, emitFailedCallback, emitFinishedCallback, resolveFailureResultCompleteness } from "./callback-policy.ts";
import { applyRunArtifactPolicy } from "./run-artifact-policy.ts";
import { executeRunMessageWithIdempotency } from "./run-idempotent-execution.ts";

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
      return executeRunMessageWithIdempotency({
        config,
        message,
        idempotentExecutions,
        execute: () => executeRunMessage({
          message,
          config,
          browserFactory,
          callbackClient,
          capturePipeline,
          artifactStore
        })
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
    const resultCompleteness = resolveFailureResultCompleteness({
      accepted,
      summary: error instanceof ScenarioExecutionError ? error.summary : undefined,
      lastCheckpointId: error instanceof ScenarioExecutionError ? error.failureCheckpointId : undefined,
      failureArtifactRefs: error instanceof ScenarioExecutionError ? error.failureArtifactRefs : undefined
    });

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
        timeoutPhase: error instanceof ScenarioExecutionError ? error.timeoutPhase : undefined,
        timeoutMs: error instanceof ScenarioExecutionError ? error.timeoutMs : undefined,
        timeoutPolicy: error instanceof ScenarioExecutionError ? error.timeoutPolicy : undefined,
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
      failedStepKey: error instanceof ScenarioExecutionError ? error.failedStepKey : undefined,
      failedStepOrder: error instanceof ScenarioExecutionError ? error.failedStepOrder : undefined,
      lastCheckpointId: error instanceof ScenarioExecutionError ? error.failureCheckpointId : undefined,
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
