import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRunnerApp } from "../src/app.ts";
import { parseRunExecuteMessage } from "../src/messaging/index.ts";
import { createArtifactStore } from "../src/storage/index.ts";
import { registerWorker } from "../src/worker/index.ts";
import type {
  ArtifactBatch,
  Checkpoint,
  RunExecuteMessage,
  RunnerAcceptedPayload,
  RunnerCheckpointsRequest,
  RunnerFailedPayload,
  RunnerFinishedPayload,
  StepEventBatch
} from "../src/shared/contracts.ts";

const currentDir = dirname(fileURLToPath(import.meta.url));
const exampleMessageFile = resolve(currentDir, "../examples/run-execute.request.json");

test("parseRunExecuteMessage validates run.execute.request envelope", async () => {
  const rawMessage = await readFile(exampleMessageFile, "utf8");
  const message = parseRunExecuteMessage(rawMessage);

  assert.equal(message.messageType, "run.execute.request");
  assert.equal(message.payload.scenarioPlan.steps.length, 3);
});

test("parseRunExecuteMessage rejects ScenarioPlan missing required fields", async () => {
  const message = await loadExampleMessage();
  delete (message.payload.scenarioPlan as Record<string, unknown>).start_url;

  assert.throws(
    () => parseRunExecuteMessage(JSON.stringify(message)),
    /scenarioPlan\.start_url is required/
  );
});

test("createRunnerApp executes example scenario and writes callback log", async () => {
  const artifactsRoot = await mkdtemp(join(tmpdir(), "wedge-runner-artifacts-"));
  const callbackLogFile = join(artifactsRoot, "callbacks.jsonl");
  const app = createRunnerApp({
    workerId: "runner-test-worker",
    artifactsRoot,
    callbackLogFile,
    simulatedDelayCapMs: 1
  });

  const result = await app.processMessageFile(exampleMessageFile);
  const callbackLog = await readFile(callbackLogFile, "utf8");

  assert.equal(result.summary.completedStepCount, 3);
  assert.equal(result.summary.failedStepCount, 0);
  assert.match(callbackLog, /"callbackType":"accepted"/);
  assert.match(callbackLog, /"callbackType":"finished"/);
  assert.match(callbackLog, /"callbackType":"checkpoints"/);
});

test("createArtifactStore uses forward slash keys for artifact metadata", async () => {
  const artifactsRoot = await mkdtemp(join(tmpdir(), "wedge-runner-storage-"));
  const artifactStore = createArtifactStore({
    serviceName: "runner",
    workerId: "runner-test-worker",
    artifactsRoot,
    callbackLogFile: join(artifactsRoot, "callbacks.jsonl"),
    artifactBucket: "local-runner",
    simulatedDelayCapMs: 1
  });

  const [artifact] = await artifactStore.persistArtifacts({
    runId: "run-1",
    artifacts: [
      {
        artifactId: "artifact-1",
        artifactType: "SCREENSHOT",
        stepKey: "step:key/with spaces",
        mimeType: "text/plain",
        fileExtension: "txt",
        content: "hello"
      }
    ]
  });

  assert.equal(artifact.key, "run-1/step-key-with-spaces/artifact-1-screenshot.txt");
  assert.equal(artifact.key.includes("\\"), false);
});

test("registerWorker closes session and emits failed callback when accepted callback fails", async () => {
  const message = await loadExampleMessage();
  let closed = false;
  let failedPayload: RunnerFailedPayload | null = null;

  const worker = registerWorker({
    config: {
      serviceName: "runner",
      workerId: "runner-test-worker",
      artifactsRoot: join(tmpdir(), "runner-test-artifacts"),
      callbackLogFile: join(tmpdir(), "runner-test-callbacks.jsonl"),
      artifactBucket: "local-runner",
      simulatedDelayCapMs: 1
    },
    browserFactory: {
      kind: "simulated-playwright",
      createSession: async () => ({
        id: "session-1",
        plan: message.payload.scenarioPlan,
        execute: async () => {
          throw new Error("execute should not be called when accepted fails");
        },
        settle: async () => ({
          strategy: "none",
          durationMs: 0,
          status: "settled"
        }),
        snapshot: () => ({
          currentUrl: message.payload.scenarioPlan.start_url,
          finalUrl: message.payload.scenarioPlan.start_url,
          title: "example",
          viewport: message.payload.scenarioPlan.environment.viewport,
          locale: message.payload.scenarioPlan.environment.locale,
          timezone: message.payload.scenarioPlan.environment.timezone,
          visitedUrls: [message.payload.scenarioPlan.start_url],
          fields: {},
          selectedOptions: {},
          scrollY: 0,
          lastAction: null,
          consoleErrors: [],
          networkErrors: [],
          cdpSession: {
            protocol: "cdp",
            transport: "simulated",
            userAgent: "test",
            tracingEnabled: false,
            createdAt: new Date().toISOString()
          }
        }),
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
  assert.ok(failedPayload);
  assert.equal(failedPayload?.resultCompleteness, "NONE");
});

async function loadExampleMessage(): Promise<RunExecuteMessage> {
  const rawMessage = await readFile(exampleMessageFile, "utf8");
  return parseRunExecuteMessage(rawMessage);
}

function createStubCallbackClient(overrides: Partial<StubCallbackClient> = {}): StubCallbackClient {
  return {
    sendAccepted: async () => {},
    sendStepEvents: async () => {},
    sendArtifacts: async () => {},
    sendCheckpoints: async () => {},
    sendFinished: async () => {},
    sendFailed: async () => {},
    ...overrides
  };
}

interface StubCallbackClient {
  sendAccepted: (runId: string, payload: RunnerAcceptedPayload) => Promise<void>;
  sendStepEvents: (runId: string, payload: StepEventBatch) => Promise<void>;
  sendArtifacts: (runId: string, payload: ArtifactBatch) => Promise<void>;
  sendCheckpoints: (runId: string, payload: RunnerCheckpointsRequest) => Promise<void>;
  sendFinished: (runId: string, payload: RunnerFinishedPayload) => Promise<void>;
  sendFailed: (runId: string, payload: RunnerFailedPayload) => Promise<void>;
}
