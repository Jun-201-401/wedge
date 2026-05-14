import { randomUUID } from "node:crypto";
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
import { parseAgentExecuteMessage, parseRunExecuteMessage } from "../src/messaging/index.ts";
import type {
  AgentEventBatch,
  AgentExecuteMessage,
  AgentTraceCallbackPayload,
  ArtifactBatch,
  RunExecuteMessage,
  RunnerAcceptedPayload,
  RunnerCheckpointsRequest,
  RunnerControlStatePayload,
  RunnerFailedPayload,
  RunnerFinishedPayload,
  ScenarioPlan,
  StepEventBatch
} from "../src/shared/contracts.ts";

const currentDir = dirname(fileURLToPath(import.meta.url));

export const exampleMessageFile = resolve(currentDir, "../examples/run-execute.request.json");
export const agentExampleMessageFile = resolve(currentDir, "../examples/run-execute.agent.request.json");

export async function loadExampleMessage(): Promise<RunExecuteMessage> {
  const rawMessage = await readFile(exampleMessageFile, "utf8");
  return parseRunExecuteMessage(rawMessage);
}

export async function loadAgentExampleMessage(): Promise<AgentExecuteMessage> {
  const rawMessage = await readFile(agentExampleMessageFile, "utf8");
  return parseAgentExecuteMessage(rawMessage);
}

export function cloneMessage(message: RunExecuteMessage): RunExecuteMessage {
  return JSON.parse(JSON.stringify(message)) as RunExecuteMessage;
}

export function cloneAgentMessage(message: AgentExecuteMessage): AgentExecuteMessage {
  return JSON.parse(JSON.stringify(message)) as AgentExecuteMessage;
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
  const artifactsRoot = overrides.artifactsRoot ?? join(tmpdir(), `runner-test-artifacts-${process.pid}-${randomUUID()}`);

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
    artifactStoreMode: "filesystem",
    artifactBucket: "local-runner",
    artifactS3Endpoint: undefined,
    artifactS3Region: "us-east-1",
    artifactS3AccessKeyId: undefined,
    artifactS3SecretAccessKey: undefined,
    artifactS3ForcePathStyle: true,
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
    mqQueueAgentExecute: "agent.execute.request",
    mqQueueDiscoveryExecute: "discovery.execute.request",
    mqQueueScenarioAuthoringExecute: "scenario-authoring.execute.request",
    mqPrefetch: 1,
    agentConcurrency: 1,
    agentIdempotencyStoreEnabled: false,
    agentIdempotencyStoreMode: "local",
    messageIdempotencyStoreMode: overrides.messageIdempotencyStoreMode ?? "local",
    agentIdempotencyLeaseTtlMs: 300_000,
    agentIdempotencyRenewIntervalMs: 150_000,
    mqRequeueOnFailure: false,
    mqCallbackOutboxWorkerEnabled: true,
    mqArtifactOutboxWorkerEnabled: true,
    browserMode: "simulated",
    browserName: "chromium",
    browserHeadless: true,
    browserLaunchTimeoutMs: 30_000,
    browserNavigationTimeoutMs: 30_000,
    playwrightSlowMoMs: 0,
    playwrightBrowsersPath: undefined,
    simulatedDelayCapMs: 1,
    agentDecisionMode: "heuristic",
    agentLlmEndpoint: undefined,
    agentLlmApiKey: undefined,
    agentLlmModel: "agent-decision",
    agentLlmTimeoutMs: 10_000,
    agentMcpGatewayUrl: undefined,
    agentMcpServiceToken: undefined,
    agentMcpGatewayTimeoutMs: 10_000,
    ...overrides,
    metricsEnabled: overrides.metricsEnabled ?? false,
    metricsHost: overrides.metricsHost ?? "127.0.0.1",
    metricsPort: overrides.metricsPort ?? 9101,
    mqMaxDeliveryAttempts: overrides.mqMaxDeliveryAttempts ?? 3
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
    interactiveComponents: [],
    visibleTextBlocks: [],
    domSummary: {
      visible_text_block_count: 0,
      heading_count: 0,
      link_count: 0,
      button_count: 0,
      form_control_count: 0,
      required_field_count: 0,
      disabled_control_count: 0,
      cta_candidate_count: 0
    },
    layoutSummary: {
      viewport_width: plan.environment.viewport.width,
      viewport_height: plan.environment.viewport.height,
      scroll_y: 0,
      interactive_component_count: 0,
      above_fold_interactive_count: 0,
      primary_like_component_count: 0,
      fixed_or_sticky_count: 0,
      overlay_candidate_count: 0,
      max_z_index: null
    },
    consoleErrors: [],
    networkErrors: [],
    networkEvents: [],
    performanceSummary: null,
    breadcrumb: [],
    toastTexts: [],
    loadingState: {
      has_spinner: false,
      has_progressbar: false,
      status_text: [],
      clicked_submit_disabled: null,
      aria_busy: false
    },
    stepIndicators: [],
    backLinkCandidates: [],
    accordionStates: [],
    checkoutContext: {
      is_checkout_flow: false,
      flow_subtype: "unknown",
      has_order_summary: false,
      has_editable_summary: false,
      has_final_submit: false,
      order_summary_text: [],
      final_submit_text: null,
      checkout_keywords: [],
      final_submit_relation: null
    },
    keyboardFocusState: {
      sampled: false,
      tab_stop_count: 0,
      modal_open: false,
      keyboard_trap_candidate: false,
      focus_order: [],
      reason: "not_sampled"
    },
    repeatedGenericLinkGrouping: [],
    cartCount: null,
    visiblePrices: [],
    productImages: [],
    productCards: [],
    selectedFilters: [],
    searchQuery: null,
    domSignature: null,
    browserHealth: {
      status: "ok",
      reason: null,
      observedAt: null
    },
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
    sendAgentEvents: async () => {},
    sendAgentTrace: async () => {},
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
  sendAgentEvents: (runId: string, payload: AgentEventBatch) => Promise<void>;
  sendAgentTrace: (runId: string, payload: AgentTraceCallbackPayload) => Promise<void>;
  readRunControlState?: (runId: string) => Promise<RunnerControlStatePayload>;
}
