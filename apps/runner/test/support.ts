import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  BrowserCapturedArtifacts,
  BrowserPageSnapshot,
  BrowserSession,
  BrowserSettleResult
} from "../src/browser/playwright/index.ts";
import type { RunnerConfig } from "../src/config/index.ts";
import { parseRunExecuteMessage } from "../src/messaging/index.ts";
import type {
  ArtifactBatch,
  RunExecuteMessage,
  RunnerAcceptedPayload,
  RunnerCheckpointsRequest,
  RunnerFailedPayload,
  RunnerFinishedPayload,
  ScenarioPlan,
  StepEventBatch
} from "../src/shared/contracts.ts";

const currentDir = dirname(fileURLToPath(import.meta.url));

export const exampleMessageFile = resolve(currentDir, "../examples/run-execute.request.json");

export async function loadExampleMessage(): Promise<RunExecuteMessage> {
  const rawMessage = await readFile(exampleMessageFile, "utf8");
  return parseRunExecuteMessage(rawMessage);
}

export function cloneMessage(message: RunExecuteMessage): RunExecuteMessage {
  return JSON.parse(JSON.stringify(message)) as RunExecuteMessage;
}

export function createMinimalPlan(): ScenarioPlan {
  return {
    schema_version: "0.5",
    plan_id: "plan-1",
    scenario_type: "template",
    goal: "test plan",
    start_url: "https://example.com",
    environment: {
      device: "desktop",
      viewport: {
        width: 1440,
        height: 900
      },
      locale: "ko-KR",
      timezone: "Asia/Seoul",
      auth_state: "anonymous"
    },
    safety: {
      allow_external_navigation: false,
      allow_payment_commit: false,
      allow_destructive_action: false,
      use_synthetic_inputs: true
    },
    steps: []
  };
}

export function createRunnerTestConfig(overrides: Partial<RunnerConfig> = {}): RunnerConfig {
  const artifactsRoot = overrides.artifactsRoot ?? join(tmpdir(), "runner-test-artifacts");

  return {
    serviceName: "runner",
    workerId: "runner-test-worker",
    artifactsRoot,
    callbackLogFile: overrides.callbackLogFile ?? join(artifactsRoot, "callbacks.jsonl"),
    callbackOutboxFile: overrides.callbackOutboxFile ?? join(artifactsRoot, "callback-outbox.jsonl"),
    callbackOutboxLockFile: overrides.callbackOutboxLockFile ?? join(artifactsRoot, "callback-outbox.lock"),
    callbackOutboxLockStaleMs: 50,
    callbackOutboxReplayIntervalMs: 10,
    callbackOutboxHeartbeatIntervalMs: 30,
    callbackOutboxRetentionMs: 60_000,
    callbackOutboxMaxRecords: 100,
    callbackMode: "file",
    callbackRetryDelaysMs: [1, 1],
    callbackBaseUrl: undefined,
    callbackTimeoutMs: 5_000,
    callbackAuthToken: undefined,
    callbackSignatureSecret: undefined,
    artifactBucket: "local-runner",
    artifactOutboxFile: overrides.artifactOutboxFile ?? join(artifactsRoot, "artifact-outbox.jsonl"),
    artifactOutboxLockFile: overrides.artifactOutboxLockFile ?? join(artifactsRoot, "artifact-outbox.lock"),
    artifactOutboxLockStaleMs: 50,
    artifactOutboxReplayIntervalMs: 10,
    artifactOutboxHeartbeatIntervalMs: 30,
    artifactOutboxRetentionMs: 60_000,
    artifactOutboxMaxRecords: 100,
    artifactRetryDelaysMs: [1, 1],
    mqConsumerEnabled: false,
    mqUrl: "amqp://localhost",
    mqQueueRunExecute: "run.execute.request",
    mqPrefetch: 1,
    mqRequeueOnFailure: false,
    browserMode: "simulated",
    browserName: "chromium",
    browserHeadless: true,
    browserLaunchTimeoutMs: 30_000,
    browserNavigationTimeoutMs: 30_000,
    playwrightBrowsersPath: undefined,
    simulatedDelayCapMs: 1,
    ...overrides
  };
}

export function createSimulatedPageSnapshot(
  plan: ScenarioPlan,
  overrides: Partial<BrowserPageSnapshot> = {}
): BrowserPageSnapshot {
  return {
    currentUrl: plan.start_url,
    finalUrl: plan.start_url,
    title: "example",
    viewport: plan.environment.viewport,
    locale: plan.environment.locale,
    timezone: plan.environment.timezone,
    visitedUrls: [plan.start_url],
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
    },
    ...overrides
  };
}

export function createSettledResult(overrides: Partial<BrowserSettleResult> = {}): BrowserSettleResult {
  return {
    strategy: "none",
    durationMs: 0,
    status: "settled",
    ...overrides
  };
}

export function createSimulatedSession(
  plan: ScenarioPlan,
  overrides: Partial<BrowserSession> = {}
): BrowserSession {
  const pageSnapshot = createSimulatedPageSnapshot(plan);

  return {
    id: "session-1",
    plan,
    execute: async (action) => ({
      actionType: action.type,
      targetSummary: null,
      stopRequested: false,
      details: {}
    }),
    settle: async () => createSettledResult(),
    snapshot: () => pageSnapshot,
    captureArtifacts: async (): Promise<BrowserCapturedArtifacts> => ({}),
    close: async () => {},
    ...overrides
  };
}

export function createStubCallbackClient(overrides: Partial<StubCallbackClient> = {}): StubCallbackClient {
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

export interface StubCallbackClient {
  sendAccepted: (runId: string, payload: RunnerAcceptedPayload) => Promise<void>;
  sendStepEvents: (runId: string, payload: StepEventBatch) => Promise<void>;
  sendArtifacts: (runId: string, payload: ArtifactBatch) => Promise<void>;
  sendCheckpoints: (runId: string, payload: RunnerCheckpointsRequest) => Promise<void>;
  sendFinished: (runId: string, payload: RunnerFinishedPayload) => Promise<void>;
  sendFailed: (runId: string, payload: RunnerFailedPayload) => Promise<void>;
}
