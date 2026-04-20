import type { BrowserSessionFactory } from "../browser/playwright/index.ts";
import type { CallbackClient } from "../callback/index.ts";
import type { RunnerConfig } from "../config/index.ts";
import type { CapturePipeline } from "../capture/index.ts";
import { executeScenario, type ScenarioExecutionSummary } from "../scenario/executor/index.ts";
import type { ArtifactStore } from "../storage/index.ts";
import type { RunExecuteMessage } from "../shared/contracts.ts";
import { errorMessage, toIsoTimestamp } from "../shared/utils.ts";

export interface RunnerExecutionResult {
  runId: string;
  workerId: string;
  browserSessionId: string;
  summary: ScenarioExecutionSummary;
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
  return {
    workerId: config.workerId,
    async handleMessage(message) {
      let session: Awaited<ReturnType<BrowserSessionFactory["createSession"]>> | undefined;
      let accepted = false;

      try {
        session = await browserFactory.createSession({
          runId: message.payload.runId,
          plan: message.payload.scenarioPlan
        });

        await callbackClient.sendAccepted(message.payload.runId, {
          workerId: config.workerId,
          acceptedAt: toIsoTimestamp(),
          browserSessionId: session.id
        });

        accepted = true;

        const summary = await executeScenario({
          runId: message.payload.runId,
          plan: message.payload.scenarioPlan,
          session,
          callbackClient,
          capturePipeline,
          artifactStore
        });

        await callbackClient.sendFinished(message.payload.runId, {
          workerId: config.workerId,
          executionFinishedAt: toIsoTimestamp(),
          summary
        });

        return {
          runId: message.payload.runId,
          workerId: config.workerId,
          browserSessionId: session.id,
          summary
        };
      } catch (error) {
        if (session) {
          try {
            await callbackClient.sendFailed(message.payload.runId, {
              workerId: config.workerId,
              failedAt: toIsoTimestamp(),
              failureCode: "RUNNER_EXECUTION_FAILED",
              failureMessage: errorMessage(error),
              resultCompleteness: accepted ? "PARTIAL" : "NONE"
            });
          } catch (sendFailedError) {
            throw new Error(
              `runner execution failed: ${errorMessage(error)}; failed callback emission failed: ${errorMessage(sendFailedError)}`
            );
          }
        }

        throw error;
      } finally {
        if (session) {
          await session.close();
        }
      }
    }
  };
}
