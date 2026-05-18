import { createAgentDecisionClient, createAgentRuntimePlan, executeAgentRun, type AgentTrace, type AgentTraceScenarioPlanExport } from "../agent/index.ts";
import type { BrowserSessionFactory } from "../browser/playwright/index.ts";
import type { CallbackClient } from "../callback/index.ts";
import type { CapturePipeline } from "../capture/index.ts";
import type { RunnerConfig } from "../config/index.ts";
import { createDeliverySummary, mergeDeliveryIssues, type DeliverySummary } from "../delivery/index.ts";
import { ScenarioExecutionError, type ScenarioExecutionSummary } from "../scenario/executor/index.ts";
import type { AgentExecuteMessage, Artifact } from "../shared/contracts.ts";
import { classifyRunnerFailure, errorMessage, logOperationalEvent, runnerFailureOutcome } from "../shared/utils.ts";
import type { ArtifactStore } from "../storage/index.ts";
import { createScenarioBackedAgentActionRuntime } from "./agent-action-runtime.ts";
import type { AgentIdempotencyStore } from "./agent-idempotency.ts";
import {
  createConfiguredAgentIdempotencyStore,
  executeAgentMessageWithIdempotency
} from "./agent-idempotent-execution.ts";
import { emitAcceptedCallback, emitFailedCallback, emitFinishedCallback, resolveFailureResultCompleteness } from "./callback-policy.ts";

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
      return executeAgentMessageWithIdempotency({
        config,
        message,
        terminalIdempotencyStore,
        idempotentExecutions,
        execute: () => executeAgentMessage({
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


function agentTerminalFailure(trace: AgentTrace): Error | null {
  if (trace.outcome.status !== "EXHAUSTED" && trace.outcome.status !== "FAILED") {
    return null;
  }
  return new Error(`Agent goal was not satisfied: ${trace.outcome.reason_code} - ${trace.outcome.reason}`);
}

async function emitAgentTerminalFailedCallback({
  callbackClient,
  runId,
  workerId,
  error,
  accepted,
  summary,
  traceArtifact
}: {
  callbackClient: CallbackClient;
  runId: string;
  workerId: string;
  error: Error;
  accepted: boolean;
  summary: ScenarioExecutionSummary;
  traceArtifact?: Artifact;
}): Promise<[]> {
  await emitFailedCallback({
    callbackClient,
    runId,
    workerId,
    error,
    accepted,
    hasSession: true,
    summary,
    failureCode: "RUNNER_EXECUTION_FAILED",
    failureArtifactRefs: traceArtifact ? [traceArtifact.artifactId] : undefined
  });
  return [];
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
      actionRuntime: createScenarioBackedAgentActionRuntime(),
      decisionClient: createAgentDecisionClient(config)
    });

    const agentTerminalError = agentTerminalFailure(executionResult.trace);
    const terminalDeliveryIssues = agentTerminalError
      ? await emitAgentTerminalFailedCallback({
          callbackClient,
          runId: task.run_id,
          workerId: config.workerId,
          error: agentTerminalError,
          accepted,
          summary: executionResult.summary,
          traceArtifact: executionResult.traceArtifact
        })
      : await emitFinishedCallback({
          callbackClient,
          runId: task.run_id,
          workerId: config.workerId,
          summary: executionResult.summary
        });
    const delivery = createDeliverySummary(
      mergeDeliveryIssues(executionResult.delivery.issues, terminalDeliveryIssues)
    );

    logOperationalEvent(
      "agent-worker",
      agentTerminalError ? "run_failed" : "run_finished",
      {
        runId: task.run_id,
        taskId: task.task_id,
        workerId: config.workerId,
        browserSessionId: session.id,
        terminalOutcome: agentTerminalError ? "FAILED_ERROR" : executionResult.summary.stopped ? "STOPPED" : "COMPLETED",
        resultCompleteness: agentTerminalError ? "PARTIAL" : "FINAL",
        agentOutcome: executionResult.trace.outcome.status,
        agentOutcomeReason: executionResult.trace.outcome.reason,
        summary: executionResult.summary,
        deliveryStatus: delivery.status,
        deliveryIssueCount: delivery.issues.length,
        deliveryIssueScopes: delivery.issues.map((issue) => issue.scope)
      },
      agentTerminalError || delivery.status !== "DELIVERY_COMPLETE" ? "warn" : "info"
    );

    return {
      runId: task.run_id,
      workerId: config.workerId,
      browserSessionId: session.id,
      summary: executionResult.summary,
      trace: executionResult.trace,
      traceArtifact: executionResult.traceArtifact,
      scenarioPlanExport: executionResult.scenarioPlanExport,
      scenarioPlanExportArtifact: executionResult.scenarioPlanExportArtifact,
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
      "agent-worker",
      "run_failed",
      {
        runId: task.run_id,
        taskId: task.task_id,
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
      runId: task.run_id,
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
