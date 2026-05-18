import { hostname } from "node:os";
import { resolve } from "node:path";

export type RunnerBrowserMode = "simulated" | "playwright";
export type RunnerBrowserName = "chromium" | "firefox" | "webkit";
export type RunnerCallbackMode = "file" | "http";
export type RunnerArtifactStoreMode = "filesystem" | "s3";
export type RunnerAgentDecisionMode = "heuristic" | "llm" | "mcp";
export type RunnerAgentIdempotencyStoreMode = "local" | "api";
export type RunnerMessageIdempotencyStoreMode = "local" | "api";

const DEFAULT_RETRY_DELAYS_MS = [200, 1000, 3000] as const;
const DEFAULT_OUTBOX_LOCK_STALE_MS = 30_000;
const DEFAULT_OUTBOX_REPLAY_INTERVAL_MS = 5_000;
const DEFAULT_OUTBOX_HEARTBEAT_INTERVAL_MS = 60_000;
const DEFAULT_OUTBOX_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_OUTBOX_MAX_RECORDS = 1_000;
const DEFAULT_CALLBACK_TIMEOUT_MS = 5_000;
const DEFAULT_BROWSER_TIMEOUT_MS = 30_000;
const DEFAULT_SIMULATED_DELAY_CAP_MS = 25;
const DEFAULT_MQ_MAX_DELIVERY_ATTEMPTS = 3;
const DEFAULT_AGENT_LLM_TIMEOUT_MS = 10_000;
const DEFAULT_SCENARIO_AUTHORING_LLM_TIMEOUT_MS = 45_000;
const DEFAULT_AGENT_MCP_GATEWAY_TIMEOUT_MS = 10_000;
const DEFAULT_AGENT_IDEMPOTENCY_LEASE_TTL_MS = 300_000;
const DEFAULT_AGENT_IDEMPOTENCY_RENEW_INTERVAL_MS = 60_000;
const MIN_AGENT_IDEMPOTENCY_RENEW_INTERVAL_MS = 1_000;
const DEFAULT_METRICS_PORT = 9101;
export const RUNNER_MQ_CALLBACK_OUTBOX_WORKER_ENABLED_ENV = "RUNNER_MQ_CALLBACK_OUTBOX_WORKER_ENABLED";
export const RUNNER_MQ_ARTIFACT_OUTBOX_WORKER_ENABLED_ENV = "RUNNER_MQ_ARTIFACT_OUTBOX_WORKER_ENABLED";

export interface RunnerConfig {
  serviceName: string;
  workerId: string;
  artifactsRoot: string;
  callbackLogFile: string;
  callbackOutboxFile: string;
  callbackOutboxLockFile: string;
  callbackOutboxLockStaleMs: number;
  callbackOutboxReplayIntervalMs: number;
  callbackOutboxHeartbeatIntervalMs: number;
  callbackOutboxRetentionMs: number;
  callbackOutboxMaxRecords: number;
  callbackMode: RunnerCallbackMode;
  callbackRetryDelaysMs: number[];
  callbackBaseUrl?: string;
  callbackTimeoutMs: number;
  callbackAuthToken?: string;
  callbackSignatureSecret?: string;
  artifactStoreMode: RunnerArtifactStoreMode;
  artifactBucket: string;
  artifactS3Endpoint?: string;
  artifactS3Region: string;
  artifactS3AccessKeyId?: string;
  artifactS3SecretAccessKey?: string;
  artifactS3ForcePathStyle: boolean;
  artifactOutboxFile: string;
  artifactOutboxLockFile: string;
  artifactOutboxLockStaleMs: number;
  artifactOutboxReplayIntervalMs: number;
  artifactOutboxHeartbeatIntervalMs: number;
  artifactOutboxRetentionMs: number;
  artifactOutboxMaxRecords: number;
  artifactRetryDelaysMs: number[];
  mqConsumerEnabled: boolean;
  mqUrl: string;
  mqQueueRunExecute: string;
  mqQueueAgentExecute: string;
  mqQueueDiscoveryExecute: string;
  mqQueueScenarioAuthoringExecute: string;
  mqPrefetch: number;
  agentConcurrency: number;
  agentIdempotencyStoreEnabled: boolean;
  agentIdempotencyStoreMode: RunnerAgentIdempotencyStoreMode;
  messageIdempotencyStoreMode: RunnerMessageIdempotencyStoreMode;
  agentIdempotencyLeaseTtlMs: number;
  agentIdempotencyRenewIntervalMs: number;
  mqRequeueOnFailure: boolean;
  mqMaxDeliveryAttempts: number;
  mqCallbackOutboxWorkerEnabled: boolean;
  mqArtifactOutboxWorkerEnabled: boolean;
  browserMode: RunnerBrowserMode;
  browserName: RunnerBrowserName;
  browserHeadless: boolean;
  browserLaunchTimeoutMs: number;
  browserNavigationTimeoutMs: number;
  playwrightSlowMoMs: number;
  playwrightBrowsersPath?: string;
  simulatedDelayCapMs: number;
  agentDecisionMode: RunnerAgentDecisionMode;
  agentLlmEndpoint?: string;
  agentLlmApiKey?: string;
  agentLlmModel: string;
  agentLlmTimeoutMs: number;
  scenarioAuthoringLlmEndpoint?: string;
  scenarioAuthoringLlmApiKey?: string;
  scenarioAuthoringLlmModel: string;
  scenarioAuthoringLlmTimeoutMs: number;
  agentMcpGatewayUrl?: string;
  agentMcpServiceToken?: string;
  agentMcpGatewayTimeoutMs: number;
  metricsEnabled: boolean;
  metricsHost: string;
  metricsPort: number;
}

export function loadRunnerConfig(overrides: Partial<RunnerConfig> = {}): RunnerConfig {
  const serviceName = overrides.serviceName ?? process.env.RUNNER_SERVICE_NAME ?? "runner";
  const artifactsRoot =
    overrides.artifactsRoot ??
    resolve(process.cwd(), process.env.RUNNER_ARTIFACTS_ROOT ?? ".runner-artifacts");
  const callbackBaseUrl = overrides.callbackBaseUrl ?? process.env.RUNNER_CALLBACK_BASE_URL ?? undefined;
  const callbackMode = resolveCallbackMode(
    overrides.callbackMode ?? process.env.RUNNER_CALLBACK_MODE,
    callbackBaseUrl
  );
  const callbackRetryDelaysMs =
    overrides.callbackRetryDelaysMs ?? parseNumberList(process.env.RUNNER_CALLBACK_RETRY_DELAYS_MS, DEFAULT_RETRY_DELAYS_MS);
  const callbackOutboxLockStaleMs = parseNumber(
    overrides.callbackOutboxLockStaleMs,
    process.env.RUNNER_CALLBACK_OUTBOX_LOCK_STALE_MS,
    DEFAULT_OUTBOX_LOCK_STALE_MS
  );
  const callbackOutboxReplayIntervalMs = parseNumber(
    overrides.callbackOutboxReplayIntervalMs,
    process.env.RUNNER_CALLBACK_OUTBOX_REPLAY_INTERVAL_MS,
    DEFAULT_OUTBOX_REPLAY_INTERVAL_MS
  );
  const callbackOutboxHeartbeatIntervalMs = parseNumber(
    overrides.callbackOutboxHeartbeatIntervalMs,
    process.env.RUNNER_CALLBACK_OUTBOX_HEARTBEAT_INTERVAL_MS,
    DEFAULT_OUTBOX_HEARTBEAT_INTERVAL_MS
  );
  const callbackOutboxRetentionMs = parseNumber(
    overrides.callbackOutboxRetentionMs,
    process.env.RUNNER_CALLBACK_OUTBOX_RETENTION_MS,
    DEFAULT_OUTBOX_RETENTION_MS
  );
  const callbackOutboxMaxRecords = parseNumber(
    overrides.callbackOutboxMaxRecords,
    process.env.RUNNER_CALLBACK_OUTBOX_MAX_RECORDS,
    DEFAULT_OUTBOX_MAX_RECORDS
  );
  const callbackTimeoutMs = parseNumber(
    overrides.callbackTimeoutMs,
    process.env.RUNNER_CALLBACK_TIMEOUT_MS,
    DEFAULT_CALLBACK_TIMEOUT_MS
  );
  const callbackAuthToken = overrides.callbackAuthToken ?? process.env.RUNNER_CALLBACK_AUTH_TOKEN ?? undefined;
  const callbackSignatureSecret =
    overrides.callbackSignatureSecret ?? process.env.RUNNER_CALLBACK_SIGNATURE_SECRET ?? undefined;
  const artifactStoreMode = resolveArtifactStoreMode(overrides.artifactStoreMode ?? process.env.RUNNER_ARTIFACT_STORAGE);
  const artifactRetryDelaysMs =
    overrides.artifactRetryDelaysMs ?? parseNumberList(process.env.RUNNER_ARTIFACT_RETRY_DELAYS_MS, DEFAULT_RETRY_DELAYS_MS);
  const artifactOutboxLockStaleMs = parseNumber(
    overrides.artifactOutboxLockStaleMs,
    process.env.RUNNER_ARTIFACT_OUTBOX_LOCK_STALE_MS,
    DEFAULT_OUTBOX_LOCK_STALE_MS
  );
  const artifactOutboxReplayIntervalMs = parseNumber(
    overrides.artifactOutboxReplayIntervalMs,
    process.env.RUNNER_ARTIFACT_OUTBOX_REPLAY_INTERVAL_MS,
    DEFAULT_OUTBOX_REPLAY_INTERVAL_MS
  );
  const artifactOutboxHeartbeatIntervalMs = parseNumber(
    overrides.artifactOutboxHeartbeatIntervalMs,
    process.env.RUNNER_ARTIFACT_OUTBOX_HEARTBEAT_INTERVAL_MS,
    DEFAULT_OUTBOX_HEARTBEAT_INTERVAL_MS
  );
  const artifactOutboxRetentionMs = parseNumber(
    overrides.artifactOutboxRetentionMs,
    process.env.RUNNER_ARTIFACT_OUTBOX_RETENTION_MS,
    DEFAULT_OUTBOX_RETENTION_MS
  );
  const artifactOutboxMaxRecords = parseNumber(
    overrides.artifactOutboxMaxRecords,
    process.env.RUNNER_ARTIFACT_OUTBOX_MAX_RECORDS,
    DEFAULT_OUTBOX_MAX_RECORDS
  );
  const mqConsumerEnabled = parseBoolean(
    overrides.mqConsumerEnabled,
    process.env.RUNNER_MQ_CONSUMER_ENABLED,
    false
  );
  const mqUrl = overrides.mqUrl ?? process.env.RUNNER_MQ_URL ?? "amqp://localhost";
  const mqQueueRunExecute =
    overrides.mqQueueRunExecute ?? process.env.RUNNER_MQ_QUEUE_RUN_EXECUTE ?? "run.execute.request";
  const mqQueueAgentExecute =
    overrides.mqQueueAgentExecute ?? process.env.RUNNER_MQ_QUEUE_AGENT_EXECUTE ?? "agent.execute.request";
  const mqQueueDiscoveryExecute =
    overrides.mqQueueDiscoveryExecute ?? process.env.RUNNER_MQ_QUEUE_DISCOVERY_EXECUTE ?? "discovery.execute.request";
  const mqQueueScenarioAuthoringExecute =
    overrides.mqQueueScenarioAuthoringExecute ??
    process.env.RUNNER_MQ_QUEUE_SCENARIO_AUTHORING_EXECUTE ??
    "scenario-authoring.execute.request";
  const mqPrefetch = parseNumber(overrides.mqPrefetch, process.env.RUNNER_MQ_PREFETCH, 1);
  const agentConcurrency = parsePositiveInteger(overrides.agentConcurrency, process.env.RUNNER_AGENT_CONCURRENCY, 1);
  const agentIdempotencyStoreEnabled = parseBoolean(
    overrides.agentIdempotencyStoreEnabled,
    process.env.RUNNER_AGENT_IDEMPOTENCY_STORE_ENABLED,
    true
  );
  const agentIdempotencyStoreMode = resolveAgentIdempotencyStoreMode(
    overrides.agentIdempotencyStoreMode ?? process.env.RUNNER_AGENT_IDEMPOTENCY_STORE_MODE
  );
  const agentIdempotencyLeaseTtlMs = parsePositiveInteger(
    overrides.agentIdempotencyLeaseTtlMs,
    process.env.RUNNER_AGENT_IDEMPOTENCY_LEASE_TTL_MS,
    DEFAULT_AGENT_IDEMPOTENCY_LEASE_TTL_MS
  );
  const agentIdempotencyRenewIntervalMs = resolveAgentIdempotencyRenewIntervalMs(
    overrides.agentIdempotencyRenewIntervalMs,
    process.env.RUNNER_AGENT_IDEMPOTENCY_RENEW_INTERVAL_MS,
    agentIdempotencyLeaseTtlMs
  );
  const messageIdempotencyStoreMode = resolveMessageIdempotencyStoreMode(
    overrides.messageIdempotencyStoreMode ?? process.env.RUNNER_MESSAGE_IDEMPOTENCY_STORE_MODE
  );
  const mqRequeueOnFailure = parseBoolean(
    overrides.mqRequeueOnFailure,
    process.env.RUNNER_MQ_REQUEUE_ON_FAILURE,
    false
  );
  const mqMaxDeliveryAttempts = parsePositiveInteger(
    overrides.mqMaxDeliveryAttempts,
    process.env.RUNNER_MQ_MAX_DELIVERY_ATTEMPTS,
    DEFAULT_MQ_MAX_DELIVERY_ATTEMPTS
  );
  const mqCallbackOutboxWorkerEnabled = parseBoolean(
    overrides.mqCallbackOutboxWorkerEnabled,
    process.env[RUNNER_MQ_CALLBACK_OUTBOX_WORKER_ENABLED_ENV],
    true
  );
  const mqArtifactOutboxWorkerEnabled = parseBoolean(
    overrides.mqArtifactOutboxWorkerEnabled,
    process.env[RUNNER_MQ_ARTIFACT_OUTBOX_WORKER_ENABLED_ENV],
    true
  );
  const browserMode = parseBrowserMode(overrides.browserMode ?? process.env.RUNNER_BROWSER_MODE);
  const browserName = parseBrowserName(overrides.browserName ?? process.env.RUNNER_BROWSER_NAME);
  const browserHeadless = parseBoolean(overrides.browserHeadless, process.env.RUNNER_BROWSER_HEADLESS, true);
  const browserLaunchTimeoutMs = parseNumber(
    overrides.browserLaunchTimeoutMs,
    process.env.RUNNER_BROWSER_LAUNCH_TIMEOUT_MS,
    DEFAULT_BROWSER_TIMEOUT_MS
  );
  const browserNavigationTimeoutMs = parseNumber(
    overrides.browserNavigationTimeoutMs,
    process.env.RUNNER_BROWSER_NAVIGATION_TIMEOUT_MS,
    DEFAULT_BROWSER_TIMEOUT_MS
  );
  const playwrightSlowMoMs = parseNumber(
    overrides.playwrightSlowMoMs,
    process.env.RUNNER_PLAYWRIGHT_SLOW_MO_MS,
    0
  );
  const agentDecisionMode = resolveAgentDecisionMode(overrides.agentDecisionMode ?? process.env.RUNNER_AGENT_DECISION_MODE);
  const agentLlmTimeoutMs = parsePositiveInteger(
    overrides.agentLlmTimeoutMs,
    process.env.RUNNER_AGENT_LLM_TIMEOUT_MS,
    DEFAULT_AGENT_LLM_TIMEOUT_MS
  );
  const scenarioAuthoringLlmTimeoutMs = parsePositiveInteger(
    overrides.scenarioAuthoringLlmTimeoutMs,
    firstNonBlank(
      process.env.RUNNER_SCENARIO_AUTHORING_LLM_TIMEOUT_MS,
      process.env.GMS_DEFAULT_TIMEOUT_MS,
      process.env.RUNNER_AGENT_LLM_TIMEOUT_MS
    ),
    DEFAULT_SCENARIO_AUTHORING_LLM_TIMEOUT_MS
  );
  const agentMcpGatewayTimeoutMs = parsePositiveInteger(
    overrides.agentMcpGatewayTimeoutMs,
    process.env.RUNNER_AGENT_MCP_GATEWAY_TIMEOUT_MS,
    DEFAULT_AGENT_MCP_GATEWAY_TIMEOUT_MS
  );
  const metricsEnabled = parseBoolean(
    overrides.metricsEnabled,
    process.env.RUNNER_METRICS_ENABLED,
    false
  );
  const metricsPort = parsePositiveInteger(
    overrides.metricsPort,
    process.env.RUNNER_METRICS_PORT,
    DEFAULT_METRICS_PORT
  );

  return {
    serviceName,
    workerId: overrides.workerId ?? `${serviceName}-${hostname()}-${process.pid}`,
    artifactsRoot,
    callbackLogFile:
      overrides.callbackLogFile ??
      resolve(artifactsRoot, process.env.RUNNER_CALLBACK_LOG_FILE ?? "callbacks.jsonl"),
    callbackOutboxFile:
      overrides.callbackOutboxFile ??
      resolve(artifactsRoot, process.env.RUNNER_CALLBACK_OUTBOX_FILE ?? "callback-outbox.jsonl"),
    callbackOutboxLockFile:
      overrides.callbackOutboxLockFile ??
      resolve(artifactsRoot, process.env.RUNNER_CALLBACK_OUTBOX_LOCK_FILE ?? "callback-outbox.lock"),
    callbackOutboxLockStaleMs,
    callbackOutboxReplayIntervalMs,
    callbackOutboxHeartbeatIntervalMs,
    callbackOutboxRetentionMs,
    callbackOutboxMaxRecords,
    callbackMode,
    callbackRetryDelaysMs,
    callbackBaseUrl,
    callbackTimeoutMs,
    callbackAuthToken,
    callbackSignatureSecret,
    artifactStoreMode,
    artifactBucket: overrides.artifactBucket ?? process.env.RUNNER_ARTIFACT_BUCKET ?? "local-runner",
    artifactS3Endpoint: overrides.artifactS3Endpoint ?? process.env.RUNNER_ARTIFACT_S3_ENDPOINT ?? undefined,
    artifactS3Region: overrides.artifactS3Region ?? process.env.RUNNER_ARTIFACT_S3_REGION ?? process.env.AWS_REGION ?? "us-east-1",
    artifactS3AccessKeyId: overrides.artifactS3AccessKeyId ?? process.env.RUNNER_ARTIFACT_S3_ACCESS_KEY_ID ?? process.env.AWS_ACCESS_KEY_ID ?? undefined,
    artifactS3SecretAccessKey: overrides.artifactS3SecretAccessKey ?? process.env.RUNNER_ARTIFACT_S3_SECRET_ACCESS_KEY ?? process.env.AWS_SECRET_ACCESS_KEY ?? undefined,
    artifactS3ForcePathStyle: parseBoolean(
      overrides.artifactS3ForcePathStyle,
      process.env.RUNNER_ARTIFACT_S3_FORCE_PATH_STYLE,
      false
    ),
    artifactOutboxFile:
      overrides.artifactOutboxFile ??
      resolve(artifactsRoot, process.env.RUNNER_ARTIFACT_OUTBOX_FILE ?? "artifact-outbox.jsonl"),
    artifactOutboxLockFile:
      overrides.artifactOutboxLockFile ??
      resolve(artifactsRoot, process.env.RUNNER_ARTIFACT_OUTBOX_LOCK_FILE ?? "artifact-outbox.lock"),
    artifactOutboxLockStaleMs,
    artifactOutboxReplayIntervalMs,
    artifactOutboxHeartbeatIntervalMs,
    artifactOutboxRetentionMs,
    artifactOutboxMaxRecords,
    artifactRetryDelaysMs,
    mqConsumerEnabled,
    mqUrl,
    mqQueueRunExecute,
    mqQueueAgentExecute,
    mqQueueDiscoveryExecute,
    mqQueueScenarioAuthoringExecute,
    mqPrefetch,
    agentConcurrency,
    agentIdempotencyStoreEnabled,
    agentIdempotencyStoreMode,
    messageIdempotencyStoreMode,
    agentIdempotencyLeaseTtlMs,
    agentIdempotencyRenewIntervalMs,
    mqRequeueOnFailure,
    mqMaxDeliveryAttempts,
    mqCallbackOutboxWorkerEnabled,
    mqArtifactOutboxWorkerEnabled,
    browserMode,
    browserName,
    browserHeadless,
    browserLaunchTimeoutMs,
    browserNavigationTimeoutMs,
    playwrightSlowMoMs,
    playwrightBrowsersPath: overrides.playwrightBrowsersPath ?? process.env.PLAYWRIGHT_BROWSERS_PATH ?? undefined,
    simulatedDelayCapMs: parseNumber(
      overrides.simulatedDelayCapMs,
      process.env.RUNNER_SIMULATED_DELAY_CAP_MS,
      DEFAULT_SIMULATED_DELAY_CAP_MS
    ),
    agentDecisionMode,
    agentLlmEndpoint: overrides.agentLlmEndpoint ?? process.env.RUNNER_AGENT_LLM_ENDPOINT ?? undefined,
    agentLlmApiKey: overrides.agentLlmApiKey ?? process.env.RUNNER_AGENT_LLM_API_KEY ?? undefined,
    agentLlmModel: overrides.agentLlmModel ?? process.env.RUNNER_AGENT_LLM_MODEL ?? "agent-decision",
    agentLlmTimeoutMs,
    scenarioAuthoringLlmEndpoint: overrides.scenarioAuthoringLlmEndpoint ?? firstNonBlank(
      process.env.RUNNER_SCENARIO_AUTHORING_LLM_ENDPOINT,
      process.env.GMS_OPENAI_CHAT_COMPLETIONS_ENDPOINT,
      process.env.RUNNER_AGENT_LLM_ENDPOINT
    ),
    scenarioAuthoringLlmApiKey: overrides.scenarioAuthoringLlmApiKey ?? firstNonBlank(
      process.env.RUNNER_SCENARIO_AUTHORING_LLM_API_KEY,
      process.env.GMS_API_KEY,
      process.env.RUNNER_AGENT_LLM_API_KEY
    ),
    scenarioAuthoringLlmModel: overrides.scenarioAuthoringLlmModel ?? firstNonBlank(
      process.env.RUNNER_SCENARIO_AUTHORING_LLM_MODEL,
      process.env.GMS_DEFAULT_MODEL,
      process.env.RUNNER_AGENT_LLM_MODEL
    ) ?? "gpt-5.2-pro",
    scenarioAuthoringLlmTimeoutMs,
    agentMcpGatewayUrl: overrides.agentMcpGatewayUrl ?? process.env.RUNNER_AGENT_MCP_GATEWAY_URL ?? undefined,
    agentMcpServiceToken: overrides.agentMcpServiceToken ?? process.env.RUNNER_AGENT_MCP_SERVICE_TOKEN ?? undefined,
    agentMcpGatewayTimeoutMs,
    metricsEnabled,
    metricsHost: overrides.metricsHost ?? process.env.RUNNER_METRICS_HOST ?? "0.0.0.0",
    metricsPort
  };
}

function firstNonBlank(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => value !== undefined && value.trim().length > 0);
}

function resolveCallbackMode(
  value: RunnerConfig["callbackMode"] | string | undefined,
  callbackBaseUrl?: string
): RunnerCallbackMode {
  if (value === "file" || value === "http") {
    return value;
  }

  if (callbackBaseUrl) {
    return "http";
  }

  return "file";
}

function resolveArtifactStoreMode(value: RunnerArtifactStoreMode | string | undefined): RunnerArtifactStoreMode {
  if (value === "filesystem" || value === "local" || value === "file") {
    return "filesystem";
  }

  if (value === "s3" || value === "minio") {
    return "s3";
  }

  return "filesystem";
}

function parseBrowserMode(value: RunnerConfig["browserMode"] | string | undefined): RunnerBrowserMode {
  if (value === "simulated" || value === "playwright") {
    return value;
  }

  return "simulated";
}

function parseBrowserName(value: RunnerConfig["browserName"] | string | undefined): RunnerBrowserName {
  if (value === "chromium" || value === "firefox" || value === "webkit") {
    return value;
  }

  return "chromium";
}

function resolveAgentDecisionMode(value: RunnerAgentDecisionMode | string | undefined): RunnerAgentDecisionMode {
  return value === "llm" || value === "mcp" ? value : "heuristic";
}

function resolveAgentIdempotencyStoreMode(value: RunnerAgentIdempotencyStoreMode | string | undefined): RunnerAgentIdempotencyStoreMode {
  return value === "api" ? "api" : "local";
}

function resolveMessageIdempotencyStoreMode(value: RunnerMessageIdempotencyStoreMode | string | undefined): RunnerMessageIdempotencyStoreMode {
  return value === "api" ? "api" : "local";
}

function resolveAgentIdempotencyRenewIntervalMs(
  overrideValue: number | undefined,
  envValue: string | undefined,
  leaseTtlMs: number
): number {
  const maxRenewIntervalMs = Math.max(
    MIN_AGENT_IDEMPOTENCY_RENEW_INTERVAL_MS,
    Math.floor(leaseTtlMs / 3)
  );
  const defaultRenewIntervalMs = Math.min(
    DEFAULT_AGENT_IDEMPOTENCY_RENEW_INTERVAL_MS,
    maxRenewIntervalMs
  );
  const requestedRenewIntervalMs = parsePositiveInteger(
    overrideValue,
    envValue,
    defaultRenewIntervalMs
  );

  return Math.max(
    MIN_AGENT_IDEMPOTENCY_RENEW_INTERVAL_MS,
    Math.min(requestedRenewIntervalMs, maxRenewIntervalMs)
  );
}

function parseBoolean(
  overrideValue: boolean | undefined,
  envValue: string | undefined,
  defaultValue: boolean
): boolean {
  if (typeof overrideValue === "boolean") {
    return overrideValue;
  }

  if (!envValue) {
    return defaultValue;
  }

  if (envValue === "1" || envValue.toLowerCase() === "true" || envValue.toLowerCase() === "yes") {
    return true;
  }

  if (envValue === "0" || envValue.toLowerCase() === "false" || envValue.toLowerCase() === "no") {
    return false;
  }

  return defaultValue;
}

function parsePositiveInteger(
  overrideValue: number | undefined,
  envValue: string | undefined,
  defaultValue: number
): number {
  const parsed = parseNumber(overrideValue, envValue, defaultValue);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : defaultValue;
}

function parseNumber(
  overrideValue: number | undefined,
  envValue: string | undefined,
  defaultValue: number
): number {
  if (typeof overrideValue === "number" && Number.isFinite(overrideValue)) {
    return overrideValue;
  }

  if (!envValue) {
    return defaultValue;
  }

  const parsed = Number(envValue);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

function parseNumberList(envValue: string | undefined, defaultValue: readonly number[]): number[] {
  if (!envValue) {
    return [...defaultValue];
  }

  const parsed = envValue
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((value) => Number.isFinite(value) && value >= 0);

  return parsed.length > 0 ? parsed : [...defaultValue];
}
