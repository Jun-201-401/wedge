import { createAgentRuntimePlan, executeAgentRun } from "../agent/index.ts";
import type { BrowserSessionFactory } from "../browser/playwright/index.ts";
import type { CallbackClient } from "../callback/index.ts";
import type { CapturePipeline } from "../capture/index.ts";
import type { RunnerConfig } from "../config/index.ts";
import { createDeliverySummary, mergeDeliveryIssues, type DeliverySummary } from "../delivery/index.ts";
import { ScenarioExecutionError, type ScenarioExecutionSummary } from "../scenario/executor/index.ts";
import type { AgentExecuteMessage, Artifact } from "../shared/contracts.ts";
import { classifyRunnerFailure, errorMessage, logOperationalEvent } from "../shared/utils.ts";
import type { ArtifactStore } from "../storage/index.ts";
import type { AgentTrace } from "../agent/trace.ts";
import { emitAcceptedCallback, emitFailedCallback, emitFinishedCallback } from "./callback-policy.ts";

export interface AgentRunnerExecutionResult {
  runId: string;
  workerId: string;
  browserSessionId: string;
  summary: ScenarioExecutionSummary;
  delivery: DeliverySummary;
  trace: AgentTrace;
  traceArtifact?: Artifact;
}

export interface RegisterAgentWorkerInput {
  config: RunnerConfig;
  browserFactory: BrowserSessionFactory;
  callbackClient: CallbackClient;
  capturePipeline: CapturePipeline;
  artifactStore: ArtifactStore;
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
  artifactStore
}: RegisterAgentWorkerInput): AgentRunnerWorker {
  return {
    workerId: config.workerId,
    async handleMessage(message) {
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
          artifactStore
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
  };
}
