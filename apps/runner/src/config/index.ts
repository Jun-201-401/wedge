import { hostname } from "node:os";
import { resolve } from "node:path";

export type RunnerBrowserMode = "simulated" | "playwright";
export type RunnerBrowserName = "chromium" | "firefox" | "webkit";
export type RunnerCallbackMode = "file" | "http";
export type RunnerArtifactStoreMode = "filesystem" | "s3";

const DEFAULT_RETRY_DELAYS_MS = [200, 1000, 3000] as const;
const DEFAULT_OUTBOX_LOCK_STALE_MS = 30_000;
const DEFAULT_OUTBOX_REPLAY_INTERVAL_MS = 5_000;
const DEFAULT_OUTBOX_HEARTBEAT_INTERVAL_MS = 60_000;
const DEFAULT_OUTBOX_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_OUTBOX_MAX_RECORDS = 1_000;
const DEFAULT_CALLBACK_TIMEOUT_MS = 5_000;
const DEFAULT_BROWSER_TIMEOUT_MS = 30_000;
const DEFAULT_SIMULATED_DELAY_CAP_MS = 25;

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
  mqPrefetch: number;
  mqRequeueOnFailure: boolean;
  browserMode: RunnerBrowserMode;
  browserName: RunnerBrowserName;
  browserHeadless: boolean;
  browserLaunchTimeoutMs: number;
  browserNavigationTimeoutMs: number;
  playwrightBrowsersPath?: string;
  simulatedDelayCapMs: number;
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
  const mqPrefetch = parseNumber(overrides.mqPrefetch, process.env.RUNNER_MQ_PREFETCH, 1);
  const mqRequeueOnFailure = parseBoolean(
    overrides.mqRequeueOnFailure,
    process.env.RUNNER_MQ_REQUEUE_ON_FAILURE,
    false
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
    mqPrefetch,
    mqRequeueOnFailure,
    browserMode,
    browserName,
    browserHeadless,
    browserLaunchTimeoutMs,
    browserNavigationTimeoutMs,
    playwrightBrowsersPath: overrides.playwrightBrowsersPath ?? process.env.PLAYWRIGHT_BROWSERS_PATH ?? undefined,
    simulatedDelayCapMs: parseNumber(
      overrides.simulatedDelayCapMs,
      process.env.RUNNER_SIMULATED_DELAY_CAP_MS,
      DEFAULT_SIMULATED_DELAY_CAP_MS
    )
  };
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
