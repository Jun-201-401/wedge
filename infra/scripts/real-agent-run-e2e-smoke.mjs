#!/usr/bin/env node
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const TERMINAL_STATUSES = new Set(['COMPLETED', 'FAILED', 'STOPPED']);
const RUNNER_ACTIVE_STATUSES = new Set(['QUEUED', 'STARTING', 'RUNNING']);
const DEFAULT_TIMEOUT_MS = 90_000;
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_SMOKE_EMAIL = 'e2e-smoke@wedge.local';
const DEFAULT_SMOKE_PASSWORD = 'wedge-smoke-password';
const DEFAULT_EXPECTED_STATUS = 'STOPPED';
const DEFAULT_FIXTURE_PUBLIC_HOST = 'host.docker.internal';

export function normalizeBaseUrl(value) {
  return String(value).replace(/\/+$/, '');
}

export function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value ?? ''));
}

export function buildAgentSmokeScenarioPlan({ targetUrl }) {
  return {
    schema_version: '0.5',
    plan_id: 'smoke_agent_checkout_entry_metadata',
    scenario_type: 'custom_compiled',
    template_key: 'agent-checkout-entry',
    goal: 'Agent smoke: find and open the signup CTA entrypoint.',
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
      depth_id: 'agent-smoke',
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
        step_id: 'step_001_agent_metadata_goto',
        stage: 'FIRST_VIEW',
        description: 'Agent smoke metadata plan placeholder for run creation validation.',
        action: {
          type: 'goto',
          target: {
            url: targetUrl,
          },
        },
        settle_strategy: {
          type: 'network_idle',
          timeout_ms: 1000,
        },
        checkpoint: false,
      },
    ],
  };
}

export function buildFixtureHomeHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Wedge Agent Smoke Landing</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 48px; }
    .primary-cta { display: inline-block; padding: 14px 20px; background: #111827; color: white; border-radius: 10px; text-decoration: none; font-weight: 700; }
  </style>
</head>
<body>
  <main>
    <h1>Wedge Agent Smoke Landing</h1>
    <p>Fixture page for validating the Runner Agent execution path.</p>
    <a id="signup-cta" class="primary-cta" href="/signup">Start signup</a>
  </main>
</body>
</html>`;
}

export function buildFixtureSignupHtml() {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><title>Signup Complete Entry</title></head>
<body>
  <main>
    <h1>Signup entry reached</h1>
    <p>The agent reached the signup CTA destination.</p>
  </main>
</body>
</html>`;
}

export function readConfig(env = process.env) {
  const explicitTargetUrl = firstNonEmpty(env.WEDGE_AGENT_SMOKE_TARGET_URL, env.WEDGE_SMOKE_TARGET_URL);
  const apiBaseUrl = normalizeBaseUrl(env.WEDGE_AGENT_SMOKE_API_BASE_URL ?? env.WEDGE_SMOKE_API_BASE_URL ?? env.WEDGE_API_BASE_URL ?? 'http://localhost:8080');
  const webBaseUrl = normalizeBaseUrl(env.WEDGE_AGENT_SMOKE_WEB_BASE_URL ?? env.WEDGE_SMOKE_WEB_BASE_URL ?? env.WEDGE_WEB_BASE_URL ?? 'http://localhost:5173');
  const projectId = env.WEDGE_AGENT_SMOKE_PROJECT_ID ?? env.WEDGE_SMOKE_PROJECT_ID ?? env.VITE_DEV_PROJECT_ID;
  const scenarioTemplateVersionId = env.WEDGE_AGENT_SMOKE_SCENARIO_TEMPLATE_VERSION_ID ?? env.WEDGE_SMOKE_SCENARIO_TEMPLATE_VERSION_ID ?? env.VITE_DEV_SCENARIO_TEMPLATE_VERSION_ID;

  return {
    apiBaseUrl,
    webBaseUrl,
    targetUrl: explicitTargetUrl || null,
    projectId,
    scenarioTemplateVersionId,
    accessToken: env.WEDGE_AGENT_SMOKE_ACCESS_TOKEN ?? env.WEDGE_SMOKE_ACCESS_TOKEN ?? env.WEDGE_ACCESS_TOKEN,
    email: env.WEDGE_AGENT_SMOKE_EMAIL ?? env.WEDGE_SMOKE_EMAIL ?? DEFAULT_SMOKE_EMAIL,
    password: env.WEDGE_AGENT_SMOKE_PASSWORD ?? env.WEDGE_SMOKE_PASSWORD ?? DEFAULT_SMOKE_PASSWORD,
    displayName: env.WEDGE_AGENT_SMOKE_DISPLAY_NAME ?? env.WEDGE_SMOKE_DISPLAY_NAME ?? 'Wedge Agent E2E Smoke',
    timeoutMs: parsePositiveInt(env.WEDGE_AGENT_SMOKE_TIMEOUT_MS ?? env.WEDGE_SMOKE_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    pollIntervalMs: parsePositiveInt(env.WEDGE_AGENT_SMOKE_POLL_INTERVAL_MS ?? env.WEDGE_SMOKE_POLL_INTERVAL_MS, DEFAULT_POLL_INTERVAL_MS),
    expectedStatus: normalizeExpectedStatus(env.WEDGE_AGENT_SMOKE_EXPECTED_STATUS ?? env.WEDGE_SMOKE_EXPECTED_STATUS ?? DEFAULT_EXPECTED_STATUS),
    healthPath: normalizePath(env.WEDGE_AGENT_SMOKE_HEALTH_PATH ?? env.WEDGE_SMOKE_HEALTH_PATH ?? '/actuator/health'),
    verifyReplayHints: readBoolean(env.WEDGE_AGENT_SMOKE_VERIFY_REPLAY, true),
    requireTraceArtifact: readBoolean(env.WEDGE_AGENT_SMOKE_REQUIRE_TRACE_ARTIFACT, true),
    fixtureBindHost: env.WEDGE_AGENT_SMOKE_FIXTURE_BIND_HOST ?? '0.0.0.0',
    fixturePublicHost: env.WEDGE_AGENT_SMOKE_FIXTURE_PUBLIC_HOST ?? DEFAULT_FIXTURE_PUBLIC_HOST,
  };
}

export async function runSmoke(config = readConfig()) {
  let fixture;
  const effectiveConfig = { ...config };

  if (!effectiveConfig.targetUrl) {
    fixture = await startFixtureSite(effectiveConfig);
    effectiveConfig.targetUrl = fixture.url;
    logStep('fixture.started', { url: fixture.url });
  }

  try {
    validateConfig(effectiveConfig);

    await assertHealth(effectiveConfig);
    const accessToken = effectiveConfig.accessToken ?? await authenticate(effectiveConfig);
    const first = await runAgentAttempt({
      config: effectiveConfig,
      accessToken,
      label: 'first',
      expectReplayHintPlanner: false,
    });

    let replay = null;
    if (effectiveConfig.verifyReplayHints) {
      replay = await runAgentAttempt({
        config: effectiveConfig,
        accessToken,
        label: 'replay',
        expectReplayHintPlanner: true,
      });
    }

    const monitorUrl = `${effectiveConfig.webBaseUrl}/runs/${encodeURIComponent(replay?.runId ?? first.runId)}?${new URLSearchParams({
      url: effectiveConfig.targetUrl,
      scenario: 'agent-checkout-entry',
      depth: 'agent-smoke',
    })}`;

    return {
      runId: first.runId,
      status: first.status,
      resultCompleteness: first.resultCompleteness,
      finalOutcome: first.trace?.final_outcome ?? null,
      traceArtifactCount: first.traceArtifactCount,
      replayRunId: replay?.runId ?? null,
      replayStatus: replay?.status ?? null,
      replayFinalOutcome: replay?.trace?.final_outcome ?? null,
      replayHintDecisionCount: replay?.replayHintDecisionCount ?? 0,
      monitorUrl,
    };
  } finally {
    if (fixture) {
      await fixture.close();
      logStep('fixture.stopped', { url: fixture.url });
    }
  }
}

async function runAgentAttempt({ config, accessToken, label, expectReplayHintPlanner }) {
  const createdRun = await createRun(config, accessToken, label);
  const runId = createdRun.id;
  logStep(`${label}.created`, { runId, status: createdRun.status });

  await startAgentRun(config, accessToken, runId, label);
  logStep(`${label}.started`, { runId });

  const run = await pollRunUntilTerminal(config, accessToken, runId, label);
  validateTerminalDetails(run, config.expectedStatus);

  const traceResult = config.requireTraceArtifact || expectReplayHintPlanner
    ? await pollAgentTraceArtifact(config, accessToken, runId, { expectReplayHintPlanner })
    : { trace: null, traceArtifactCount: 0, replayHintDecisionCount: 0 };

  return {
    runId,
    status: run.status,
    resultCompleteness: run.resultCompleteness,
    failureCode: run.failureCode,
    failureMessage: run.failureMessage,
    ...traceResult,
  };
}

function validateConfig(config) {
  if (!isUuid(config.projectId)) {
    throw new Error('WEDGE_AGENT_SMOKE_PROJECT_ID, WEDGE_SMOKE_PROJECT_ID, or VITE_DEV_PROJECT_ID must be a valid project UUID.');
  }

  if (!isUuid(config.scenarioTemplateVersionId)) {
    throw new Error('WEDGE_AGENT_SMOKE_SCENARIO_TEMPLATE_VERSION_ID, WEDGE_SMOKE_SCENARIO_TEMPLATE_VERSION_ID, or VITE_DEV_SCENARIO_TEMPLATE_VERSION_ID must be a valid scenario template version UUID.');
  }

  try {
    new URL(config.targetUrl);
  } catch {
    throw new Error('WEDGE_AGENT_SMOKE_TARGET_URL must be an absolute http(s) URL.');
  }

  if (!TERMINAL_STATUSES.has(config.expectedStatus)) {
    throw new Error('WEDGE_AGENT_SMOKE_EXPECTED_STATUS must be one of COMPLETED, FAILED, STOPPED.');
  }
}

async function assertHealth(config) {
  const response = await fetch(`${config.apiBaseUrl}${config.healthPath}`);
  if (!response.ok) {
    const details = await response.text();
    const suffix = details ? ` ${details}` : ` ${response.statusText}`;
    throw new Error(`API health check failed at ${config.healthPath}: ${response.status}${suffix}`);
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

async function createRun(config, accessToken, label) {
  const scenarioPlan = buildAgentSmokeScenarioPlan({ targetUrl: config.targetUrl });
  const response = await requestJson(config, '/api/runs', {
    method: 'POST',
    accessToken,
    body: {
      projectId: config.projectId,
      name: `Real Agent Run E2E Smoke (${label})`,
      startUrl: config.targetUrl,
      goal: scenarioPlan.goal,
      devicePreset: 'desktop',
      scenarioTemplateVersionId: config.scenarioTemplateVersionId,
      scenarioOverrides: {
        source: 'infra-real-agent-run-e2e-smoke',
        depthId: 'agent-smoke',
        label,
      },
      scenarioPlan,
    },
  });
  return response.data;
}

async function startAgentRun(config, accessToken, runId, label) {
  await requestJson(config, `/api/runs/${runId}/agent/start`, {
    method: 'POST',
    accessToken,
    headers: {
      'Idempotency-Key': `agent-smoke-start:${label}:${runId}`,
    },
  });
}

async function pollRunUntilTerminal(config, accessToken, runId, label) {
  return pollUntil(config, async () => {
    const response = await requestJson(config, `/api/runs/${runId}`, { accessToken });
    const run = response.data;
    logStep(`${label}.poll.run`, { runId, status: run.status, resultCompleteness: run.resultCompleteness });

    if (run.status === config.expectedStatus) {
      return run;
    }

    if (TERMINAL_STATUSES.has(run.status)) {
      throw new Error(`Agent run reached terminal status ${run.status}, expected ${config.expectedStatus}: ${run.failureCode ?? ''} ${run.failureMessage ?? ''}`.trim());
    }

    if (!RUNNER_ACTIVE_STATUSES.has(run.status)) {
      throw new Error(`Agent run is in unexpected status ${run.status}; expected runner to pick it up from the MQ queue.`);
    }

    return null;
  }, `agent run ${runId} to reach ${config.expectedStatus}`);
}

async function pollAgentTraceArtifact(config, accessToken, runId, { expectReplayHintPlanner }) {
  return pollUntil(config, async () => {
    const artifactsResponse = await requestJson(config, `/api/runs/${runId}/artifacts`, { accessToken });
    const artifacts = Array.isArray(artifactsResponse.data) ? artifactsResponse.data : [];
    const traceArtifacts = artifacts.filter((artifact) => artifact.artifactType === 'TRACE');
    logStep('poll.agentTraceArtifact', { runId, traceArtifacts: traceArtifacts.length, totalArtifacts: artifacts.length });

    if (traceArtifacts.length === 0) {
      return null;
    }

    const traceArtifact = traceArtifacts[0];
    const traceText = await requestText(config, traceArtifact.contentUrl, { accessToken });
    const trace = JSON.parse(traceText);
    const replayHintDecisionCount = validateAgentTrace(trace, { expectReplayHintPlanner });
    return {
      trace,
      traceArtifactCount: traceArtifacts.length,
      replayHintDecisionCount,
    };
  }, `AgentTrace TRACE artifact for run ${runId}`);
}

export function validateAgentTrace(trace, { expectReplayHintPlanner = false } = {}) {
  if (!trace || typeof trace !== 'object' || Array.isArray(trace)) {
    throw new Error('AgentTrace artifact must be a JSON object.');
  }

  if (!isUuid(trace.trace_id)) {
    throw new Error('AgentTrace.trace_id must be a UUID.');
  }

  if (trace.final_outcome !== 'SUCCESS_CHECKOUT_ENTRY_REACHED') {
    throw new Error(`AgentTrace.final_outcome must be SUCCESS_CHECKOUT_ENTRY_REACHED, got ${trace.final_outcome}.`);
  }

  if (!Array.isArray(trace.decisions) || trace.decisions.length === 0) {
    throw new Error('AgentTrace.decisions must contain at least one decision.');
  }

  if (!Array.isArray(trace.events) || !trace.events.some((event) => event.event_type === 'AGENT_ACTION_COMPLETED')) {
    throw new Error('AgentTrace.events must include AGENT_ACTION_COMPLETED.');
  }

  const replayHintDecisionCount = trace.decisions.filter((decision) => decision.planner_source === 'replay_hint').length;
  if (expectReplayHintPlanner && replayHintDecisionCount === 0) {
    throw new Error('Replay Agent run did not use any replay_hint planner decisions.');
  }

  return replayHintDecisionCount;
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

export function isFatalPollError(error) {
  return error instanceof Error && (
    error.message.includes('terminal status') ||
    error.message.includes('unexpected status') ||
    error.message.includes('AgentTrace.final_outcome') ||
    error.message.includes('Replay Agent run did not use')
  );
}

export function validateTerminalDetails(run, expectedStatus) {
  if (expectedStatus === 'FAILED' && (!run.failureCode || !run.failureMessage)) {
    throw new Error(`Agent run reached FAILED without failureCode/failureMessage: ${run.id ?? run.runId ?? ''}`.trim());
  }
}

async function requestJson(config, path, options = {}) {
  const text = await requestText(config, path, options);
  return text ? JSON.parse(text) : null;
}

async function requestText(config, path, options = {}) {
  const headers = new Headers(options.headers);
  headers.set('Accept', options.accept ?? 'application/json');

  if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json');
  }

  if (!options.anonymous) {
    headers.set('Authorization', `Bearer ${options.accessToken}`);
  }

  const url = path.startsWith('http://') || path.startsWith('https://')
    ? path
    : `${config.apiBaseUrl}${path}`;
  const response = await fetch(url, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const text = await response.text();

  if (!response.ok) {
    let message = text || response.statusText;
    try {
      const payload = text ? JSON.parse(text) : null;
      message = payload?.message ?? payload?.error?.message ?? text ?? response.statusText;
    } catch {
      // Keep raw text as the error details.
    }
    throw new Error(`${options.method ?? 'GET'} ${path} failed: ${response.status} ${message}`);
  }

  return text;
}

async function startFixtureSite(config) {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://fixture.local');
    if (url.pathname === '/' || url.pathname === '/index.html') {
      sendHtml(response, buildFixtureHomeHtml());
      return;
    }

    if (url.pathname === '/signup') {
      sendHtml(response, buildFixtureSignupHtml());
      return;
    }

    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('not found');
  });

  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, config.fixtureBindHost, () => {
      server.off('error', rejectListen);
      resolveListen();
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to resolve fixture server address.');
  }

  const url = `http://${config.fixturePublicHost}:${address.port}/`;
  return {
    url,
    close: () => new Promise((resolveClose, rejectClose) => {
      server.close((error) => error ? rejectClose(error) : resolveClose());
    }),
  };
}

function sendHtml(response, html) {
  response.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(html);
}

function normalizePath(value) {
  const path = String(value ?? '').trim();
  if (!path) {
    return '/actuator/health';
  }

  return path.startsWith('/') ? path : `/${path}`;
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

function normalizeExpectedStatus(value) {
  return String(value ?? DEFAULT_EXPECTED_STATUS).trim().toUpperCase();
}

function firstNonEmpty(...values) {
  return values.find((value) => typeof value === 'string' && value.trim() !== '') ?? '';
}

function sleep(durationMs) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, durationMs));
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
    const value = rawValue.replace(/^["']|["']$/g, '');
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
