import assert from "node:assert/strict";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerWorker } from "../src/worker/index.ts";
import {
  createRunnerTestConfig,
  createSettledResult,
  createSimulatedPageSnapshot,
  createSimulatedSession,
  createStubCallbackClient,
  loadExampleMessage
} from "./support.ts";
import type { RunnerFailedPayload } from "../src/shared/contracts.ts";

test("[Worker lifecycle] accepted callback 실패 시 session을 닫고 failed callback을 보낸다", async () => {
  const message = await loadExampleMessage();
  let closed = false;
  let failedPayload: RunnerFailedPayload | null = null;

  const worker = registerWorker({
    config: createRunnerTestConfig({
      artifactsRoot: join(tmpdir(), "runner-test-artifacts"),
      callbackLogFile: join(tmpdir(), "runner-test-callbacks.jsonl")
    }),
    browserFactory: {
      kind: "simulated-playwright",
      createSession: async () =>
        createSimulatedSession(message.payload.scenarioPlan, {
          execute: async () => {
            throw new Error("execute should not be called when accepted fails");
          },
          settle: async () => createSettledResult(),
          snapshot: () => createSimulatedPageSnapshot(message.payload.scenarioPlan),
          close: async () => {
            closed = true;
          }
        })
    },
    callbackClient: createStubCallbackClient({
      sendAccepted: async () => {
        throw new Error("accepted callback failed");
      },
      sendFailed: async (_runId, payload) => {
        failedPayload = payload;
      }
    }),
    capturePipeline: {
      collectCheckpoint: async () => {
        throw new Error("checkpoint collection should not be called when accepted fails");
      }
    },
    artifactStore: {
      persistArtifacts: async () => []
    }
  });

  await assert.rejects(() => worker.handleMessage(message), /accepted callback failed/);
  assert.equal(closed, true);
  if (failedPayload === null) {
    throw new Error("failed payload was not captured");
  }

  const capturedFailedPayload = failedPayload as RunnerFailedPayload;
  assert.equal(capturedFailedPayload.resultCompleteness, "NONE");
});

test("[Worker lifecycle] 실행 자체가 성공했다면 finished callback 실패만으로 실행 실패로 바꾸지 않는다", async () => {
  const message = await loadExampleMessage();
  message.payload.scenarioPlan.steps = [
    {
      step_id: "step_001_fill_email",
      stage: "INPUT",
      description: "fill email once",
      action: {
        type: "fill",
        target: {
          label: "Email"
        },
        value: "test@example.com"
      },
      settle_strategy: {
        type: "fixed_short",
        timeout_ms: 1
      },
      checkpoint: false
    }
  ];

  const worker = registerWorker({
    config: createRunnerTestConfig({
      artifactsRoot: join(tmpdir(), "runner-test-artifacts"),
      callbackLogFile: join(tmpdir(), "runner-test-callbacks.jsonl")
    }),
    browserFactory: {
      kind: "simulated-playwright",
      createSession: async () =>
        createSimulatedSession(message.payload.scenarioPlan, {
          execute: async (action) => ({
            actionType: action.type,
            targetSummary: "label=Email",
            stopRequested: false,
            details: {}
          }),
          settle: async () =>
            createSettledResult({
              strategy: "fixed_short",
              durationMs: 1
            }),
          snapshot: () => createSimulatedPageSnapshot(message.payload.scenarioPlan),
          close: async () => {}
        })
    },
    callbackClient: createStubCallbackClient({
      sendFinished: async () => {
        throw new Error("finished callback failed");
      }
    }),
    capturePipeline: {
      collectCheckpoint: async () => {
        throw new Error("checkpoint collection should not be called");
      }
    },
    artifactStore: {
      persistArtifacts: async () => []
    }
  });

  const result = await worker.handleMessage(message);
  assert.equal(result.summary.completedStepCount, 1);
  assert.equal(result.delivery.status, "DELIVERY_FAILED");
  assert.deepEqual(result.delivery.issues.map((issue) => issue.scope), ["finished-callback"]);
});
