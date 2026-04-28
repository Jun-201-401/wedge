#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const TERMINAL_STATUSES = new Set(['COMPLETED', 'FAILED', 'STOPPED']);
const RUNNER_ACTIVE_STATUSES = new Set(['QUEUED', 'STARTING', 'RUNNING']);
const DEFAULT_TIMEOUT_MS = 90_000;
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_TARGET_URL = 'https://example.com/';
const DEFAULT_SMOKE_EMAIL = 'e2e-smoke@wedge.local';
const DEFAULT_SMOKE_PASSWORD = 'wedge-smoke-password';

export function normalizeBaseUrl(value) {
  return String(value).replace(/\/+$/, '');
}

export function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value ?? ''));
}

export function buildPrototypeScenarioPlan({ targetUrl }) {
  return {
    schema_version: '0.5',
    plan_id: 'smoke_landing_cta_hero_only',
    scenario_type: 'custom_compiled',
    template_key: 'landing-cta',
    goal: 'Real run end-to-end smoke: URL open, checkpoint, evidence callback, API evidence packet.',
    start_url: targetUrl,
    environment: {
      device: 'desktop',
      viewport: {
        width: 1440,
        height: 900,
      },
      locale: 'ko-KR',
      timezone: 'Asia/Seoul',
      permissions: [],
      auth_state: 'anonymous',
      depth_id: 'hero-only',
    },
    safety: {
      allow_external_navigation: false,
      allow_payment_commit: false,
      allow_destructive_action: false,
      use_synthetic_inputs: true,
      stop_before_real_payment: true,
    },
    steps: [
      {
        step_id: 'step_001_goto_start_url',
        stage: 'FIRST_VIEW',
        description: 'Smoke 대상 URL 첫 화면 열기',
        action: {
          type: 'goto',
          target: {
            url: targetUrl,
          },
        },
        settle_strategy: {
          type: 'network_idle',
          timeout_ms: 5000,
        },
        checkpoint: true,
      },
      {
        step_id: 'step_002_checkpoint_landing_cta',
        stage: 'CTA',
        description: 'Landing CTA evidence checkpoint',
        action: {
          type: 'checkpoint',
          target: {
            scenario_id: 'landing-cta',
            depth_id: 'hero-only',
            text: 'hero section, primary button, nav CTA',
          },
        },
        settle_strategy: {
          type: 'fixed_short',
          timeout_ms: 500,
        },
        checkpoint: true,
      },
    ],
  };
}

export function readConfig(env = process.env) {
  const apiBaseUrl = normalizeBaseUrl(env.WEDGE_SMOKE_API_BASE_URL ?? env.WEDGE_API_BASE_URL ?? 'http://localhost:8080');
  const webBaseUrl = normalizeBaseUrl(env.WEDGE_SMOKE_WEB_BASE_URL ?? env.WEDGE_WEB_BASE_URL ?? 'http://localhost:5173');
  const targetUrl = env.WEDGE_SMOKE_TARGET_URL ?? DEFAULT_TARGET_URL;
  const projectId = env.WEDGE_SMOKE_PROJECT_ID ?? env.VITE_DEV_PROJECT_ID;
  const scenarioTemplateVersionId = env.WEDGE_SMOKE_SCENARIO_TEMPLATE_VERSION_ID ?? env.VITE_DEV_SCENARIO_TEMPLATE_VERSION_ID;

  return {
    apiBaseUrl,
    webBaseUrl,
    targetUrl,
    projectId,
    scenarioTemplateVersionId,
    accessToken: env.WEDGE_SMOKE_ACCESS_TOKEN ?? env.WEDGE_ACCESS_TOKEN,
    email: env.WEDGE_SMOKE_EMAIL ?? DEFAULT_SMOKE_EMAIL,
    password: env.WEDGE_SMOKE_PASSWORD ?? DEFAULT_SMOKE_PASSWORD,
    displayName: env.WEDGE_SMOKE_DISPLAY_NAME ?? 'Wedge E2E Smoke',
    timeoutMs: parsePositiveInt(env.WEDGE_SMOKE_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    pollIntervalMs: parsePositiveInt(env.WEDGE_SMOKE_POLL_INTERVAL_MS, DEFAULT_POLL_INTERVAL_MS),
    requireEvidenceArtifacts: readBoolean(env.WEDGE_SMOKE_REQUIRE_ARTIFACTS, false),
  };
}

export async function runSmoke(config = readConfig()) {
  validateConfig(config);

  await assertHealth(config.apiBaseUrl);
  const accessToken = config.accessToken ?? await authenticate(config);
  const createdRun = await createRun(config, accessToken);
  const runId = createdRun.id;
  logStep('created', { runId, status: createdRun.status });

  await startRun(config, accessToken, runId);
  logStep('started', { runId });

  const run = await pollRunUntilTerminal(config, accessToken, runId);
  const evidencePacket = await pollEvidencePacket(config, accessToken, runId);
  const monitorUrl = `${config.webBaseUrl}/runs/${encodeURIComponent(runId)}?${new URLSearchParams({
    url: config.targetUrl,
    scenario: 'landing-cta',
    depth: 'hero-only',
  })}`;

  return {
    runId,
    status: run.status,
    resultCompleteness: run.resultCompleteness,
    checkpointCount: evidencePacket.checkpoints.length,
    artifactCount: evidencePacket.artifacts.length,
    monitorUrl,
  };
}

function validateConfig(config) {
  if (!isUuid(config.projectId)) {
    throw new Error('WEDGE_SMOKE_PROJECT_ID or VITE_DEV_PROJECT_ID must be a valid project UUID.');
  }

  if (!isUuid(config.scenarioTemplateVersionId)) {
    throw new Error('WEDGE_SMOKE_SCENARIO_TEMPLATE_VERSION_ID or VITE_DEV_SCENARIO_TEMPLATE_VERSION_ID must be a valid scenario template version UUID.');
  }

  try {
    new URL(config.targetUrl);
  } catch {
    throw new Error('WEDGE_SMOKE_TARGET_URL must be an absolute http(s) URL.');
  }
}

async function assertHealth(apiBaseUrl) {
  const response = await fetch(`${apiBaseUrl}/health`);
  if (!response.ok) {
    throw new Error(`API health check failed: ${response.status} ${response.statusText}`);
  }
}

async function authenticate(config) {
  const loginPayload = {
    email: config.email,
    password: config.password,
  };

  try {
    const loginResponse = await requestJson(config, '/api/auth/login', {
      method: 'POST',
      body: loginPayload,
      anonymous: true,
    });
    logStep('auth.login', { email: config.email });
    return loginResponse.data.accessToken;
  } catch (loginError) {
    const signupResponse = await requestJson(config, '/api/auth/signup', {
      method: 'POST',
      body: {
        ...loginPayload,
        displayName: config.displayName,
      },
      anonymous: true,
    });
    logStep('auth.signup', { email: config.email, previousLoginError: loginError.message });
    return signupResponse.data.accessToken;
  }
}

async function createRun(config, accessToken) {
  const scenarioPlan = buildPrototypeScenarioPlan({ targetUrl: config.targetUrl });
  const response = await requestJson(config, '/api/runs', {
    method: 'POST',
    accessToken,
    body: {
      projectId: config.projectId,
      name: 'Real Run E2E Smoke',
      startUrl: config.targetUrl,
      goal: scenarioPlan.goal,
      devicePreset: 'desktop',
      scenarioTemplateVersionId: config.scenarioTemplateVersionId,
      scenarioOverrides: {
        source: 'infra-real-run-e2e-smoke',
        depthId: 'hero-only',
      },
      scenarioPlan,
    },
  });
  return response.data;
}

async function startRun(config, accessToken, runId) {
  await requestJson(config, `/api/runs/${runId}/start`, {
    method: 'POST',
    accessToken,
    headers: {
      'Idempotency-Key': `smoke-start:${runId}`,
    },
  });
}

async function pollRunUntilTerminal(config, accessToken, runId) {
  return pollUntil(config, async () => {
    const response = await requestJson(config, `/api/runs/${runId}`, { accessToken });
    const run = response.data;
    logStep('poll.run', { runId, status: run.status, resultCompleteness: run.resultCompleteness });

    if (run.status === 'COMPLETED') {
      return run;
    }

    if (TERMINAL_STATUSES.has(run.status)) {
      throw new Error(`Run reached non-success terminal status ${run.status}: ${run.failureCode ?? ''} ${run.failureMessage ?? ''}`.trim());
    }

    if (!RUNNER_ACTIVE_STATUSES.has(run.status)) {
      throw new Error(`Run is in unexpected status ${run.status}; expected runner to pick it up from the MQ queue.`);
    }

    return null;
  }, `run ${runId} to complete`);
}

async function pollEvidencePacket(config, accessToken, runId) {
  return pollUntil(config, async () => {
    const response = await requestJson(config, `/api/runs/${runId}/evidence-packet`, { accessToken });
    const packet = response.data;
    const checkpoints = Array.isArray(packet.checkpoints) ? packet.checkpoints : [];
    const artifacts = Array.isArray(packet.artifacts) ? packet.artifacts : [];
    logStep('poll.evidence', { runId, checkpoints: checkpoints.length, artifacts: artifacts.length });

    if (checkpoints.length > 0 && (!config.requireEvidenceArtifacts || artifacts.length > 0)) {
      return {
        ...packet,
        checkpoints,
        artifacts,
      };
    }

    return null;
  }, `evidence packet for run ${runId}`);
}

async function pollUntil(config, probe, label) {
  const deadline = Date.now() + config.timeoutMs;
  let lastError;

  while (Date.now() <= deadline) {
    try {
      const result = await probe();
      if (result) {
        return result;
      }
    } catch (error) {
      lastError = error;
      if (isFatalPollError(error)) {
        throw error;
      }
    }

    await sleep(config.pollIntervalMs);
  }

  const hint = lastError ? ` Last error: ${lastError.message}` : '';
  throw new Error(`Timed out waiting for ${label}.${hint}`);
}

function isFatalPollError(error) {
  return error instanceof Error && (
    error.message.includes('non-success terminal status') ||
    error.message.includes('unexpected status')
  );
}

async function requestJson(config, path, options = {}) {
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');

  if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json');
  }

  if (!options.anonymous) {
    headers.set('Authorization', `Bearer ${options.accessToken}`);
  }

  const response = await fetch(`${config.apiBaseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message = payload?.message ?? payload?.error?.message ?? text ?? response.statusText;
    throw new Error(`${options.method ?? 'GET'} ${path} failed: ${response.status} ${message}`);
  }

  return payload;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readBoolean(value, fallback) {
  if (value === undefined) {
    return fallback;
  }

  const normalized = value.toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }

  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return fallback;
}

function sleep(durationMs) {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

function logStep(step, details) {
  console.log(JSON.stringify({ step, ...details }));
}

function loadDotEnv(dotEnvPath = resolve(process.cwd(), '.env')) {
  if (!existsSync(dotEnvPath)) {
    return;
  }

  const lines = readFileSync(dotEnvPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) {
      continue;
    }

    const [rawKey, ...rawValueParts] = trimmed.split('=');
    const key = rawKey.trim();
    const rawValue = rawValueParts.join('=').trim();
    const value = rawValue.replace(/^['"]|['"]$/g, '');
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

async function main() {
  loadDotEnv();
  const result = await runSmoke(readConfig());
  console.log(JSON.stringify({ step: 'success', ...result }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(JSON.stringify({ step: 'failed', message: error.message }, null, 2));
    process.exitCode = 1;
  });
}
