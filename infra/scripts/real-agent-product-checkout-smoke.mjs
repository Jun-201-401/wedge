#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const RUN_TERMINAL_STATUSES = new Set(['COMPLETED', 'FAILED', 'STOPPED']);
const RUN_ACTIVE_STATUSES = new Set(['CREATED', 'QUEUED', 'STARTING', 'RUNNING']);
const DEFAULT_TIMEOUT_MS = 150_000;
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_SMOKE_EMAIL = 'e2e-smoke@wedge.local';
const DEFAULT_SMOKE_PASSWORD = 'wedge-smoke-password';

export function readConfig(env = process.env) {
  return {
    apiBaseUrl: normalizeBaseUrl(env.WEDGE_AGENT_CHECKOUT_SMOKE_API_BASE_URL ?? env.WEDGE_SMOKE_API_BASE_URL ?? env.WEDGE_API_BASE_URL ?? 'http://localhost:8080'),
    webBaseUrl: normalizeBaseUrl(env.WEDGE_AGENT_CHECKOUT_SMOKE_WEB_BASE_URL ?? env.WEDGE_SMOKE_WEB_BASE_URL ?? env.WEDGE_WEB_BASE_URL ?? 'http://localhost:5173'),
    projectId: env.WEDGE_AGENT_CHECKOUT_SMOKE_PROJECT_ID ?? env.WEDGE_SMOKE_PROJECT_ID ?? env.VITE_DEV_PROJECT_ID,
    accessToken: env.WEDGE_AGENT_CHECKOUT_SMOKE_ACCESS_TOKEN ?? env.WEDGE_SMOKE_ACCESS_TOKEN ?? env.WEDGE_ACCESS_TOKEN,
    email: env.WEDGE_AGENT_CHECKOUT_SMOKE_EMAIL ?? env.WEDGE_SMOKE_EMAIL ?? DEFAULT_SMOKE_EMAIL,
    password: env.WEDGE_AGENT_CHECKOUT_SMOKE_PASSWORD ?? env.WEDGE_SMOKE_PASSWORD ?? DEFAULT_SMOKE_PASSWORD,
    displayName: env.WEDGE_AGENT_CHECKOUT_SMOKE_DISPLAY_NAME ?? env.WEDGE_SMOKE_DISPLAY_NAME ?? 'Wedge Agent Checkout Smoke',
    timeoutMs: parsePositiveInt(env.WEDGE_AGENT_CHECKOUT_SMOKE_TIMEOUT_MS ?? env.WEDGE_SMOKE_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    pollIntervalMs: parsePositiveInt(env.WEDGE_AGENT_CHECKOUT_SMOKE_POLL_INTERVAL_MS ?? env.WEDGE_SMOKE_POLL_INTERVAL_MS, DEFAULT_POLL_INTERVAL_MS),
    healthPath: normalizePath(env.WEDGE_AGENT_CHECKOUT_SMOKE_HEALTH_PATH ?? env.WEDGE_SMOKE_HEALTH_PATH ?? '/actuator/health'),
    targetUrl: env.WEDGE_AGENT_CHECKOUT_SMOKE_TARGET_URL ?? null,
    fixtureHostForRunner: env.WEDGE_AGENT_CHECKOUT_SMOKE_FIXTURE_HOST_FOR_RUNNER ?? 'host.docker.internal',
    requireExportArtifact: readBoolean(env.WEDGE_AGENT_CHECKOUT_SMOKE_REQUIRE_EXPORT_ARTIFACT, true),
  };
}

export async function runAgentCheckoutSmoke(config = readConfig()) {
  validateConfig(config);
  const fixture = config.targetUrl ? null : await startCheckoutFixture(config.fixtureHostForRunner);

  try {
    const targetUrl = config.targetUrl ?? fixture.productUrl;
    await assertHealth(config);
    const accessToken = config.accessToken ?? await authenticate(config);
    const createdRun = await createAgentRun(config, accessToken, targetUrl);
    logStep('run.created', { runId: createdRun.id, status: createdRun.status, targetUrl });

    await startRun(config, accessToken, createdRun.id);
    logStep('run.started', { runId: createdRun.id });

    const run = await pollRunUntilTerminal(config, accessToken, createdRun.id, ['COMPLETED']);
    const events = await pollAgentEvents(config, accessToken, createdRun.id);
    const evidencePacket = await pollEvidencePacket(config, accessToken, createdRun.id);
    const assertions = assertCheckoutAgentEvents(events, config.requireExportArtifact);
    const monitorUrl = `${config.webBaseUrl}/runs/${encodeURIComponent(createdRun.id)}?${new URLSearchParams({
      url: targetUrl,
      scenario: 'agent-product-checkout',
      depth: 'agent-runtime',
    })}`;

    return {
      runId: createdRun.id,
      status: run.status,
      resultCompleteness: run.resultCompleteness,
      failureCode: run.failureCode,
      failureMessage: run.failureMessage,
      actionCompletedCount: assertions.actionCompletedEvents.length,
      completedTargetKeys: assertions.completedTargetKeys,
      tracePersisted: assertions.tracePersisted,
      scenarioPlanExportStatus: assertions.scenarioPlanExportStatus,
      checkpointCount: evidencePacket.checkpoints.length,
      artifactCount: evidencePacket.artifacts.length,
      monitorUrl,
    };
  } finally {
    await fixture?.close();
  }
}

export function validateConfig(config) {
  if (!isUuid(config.projectId)) {
    throw new Error('WEDGE_AGENT_CHECKOUT_SMOKE_PROJECT_ID or WEDGE_SMOKE_PROJECT_ID must be a valid project UUID.');
  }

  if (config.targetUrl !== null) {
    try {
      const url = new URL(config.targetUrl);
      if (!['http:', 'https:'].includes(url.protocol)) {
        throw new Error('unsupported protocol');
      }
    } catch {
      throw new Error('WEDGE_AGENT_CHECKOUT_SMOKE_TARGET_URL must be an absolute http(s) URL.');
    }
  }
}

export function buildCreateAgentRunRequest(config, targetUrl) {
  return {
    projectId: config.projectId,
    name: 'Real Agent Product Checkout Smoke',
    startUrl: targetUrl,
    goal: 'Find a product checkout entry path: open product, add to cart, view cart, proceed to checkout, and stop before payment or final order commit.',
    devicePreset: 'desktop',
    scenarioOverrides: {
      source: 'infra-real-agent-product-checkout-smoke',
      mode: 'agent-product-checkout',
    },
  };
}

export function assertCheckoutAgentEvents(events, requireExportArtifact = true) {
  const actionCompletedEvents = events.filter((event) => normalizeAgentEventType(event) === 'ACTION_COMPLETED');
  const completedTargetKeys = actionCompletedEvents.map((event) => String(agentEventPayload(event)?.targetKey ?? '')).filter(Boolean);
  const completedFinalUrls = actionCompletedEvents.map((event) => String(agentEventPayload(event)?.finalUrl ?? '')).filter(Boolean);
  const tracePersistedEvent = events.find((event) => normalizeAgentEventType(event) === 'TRACE_PERSISTED');
  const tracePersistedPayload = tracePersistedEvent ? agentEventPayload(tracePersistedEvent) : null;
  const scenarioPlanExportStatus = tracePersistedPayload?.scenarioPlanExportStatus ?? null;
  const scenarioPlanExportArtifactId = tracePersistedPayload?.scenarioPlanExportArtifactId ?? null;

  if (!completedTargetKeys.includes('#add-to-cart')) {
    throw new Error(`Agent checkout smoke did not complete add-to-cart action. completedTargetKeys=${completedTargetKeys.join(',')}`);
  }

  if (!completedTargetKeys.includes('#checkout-link')) {
    throw new Error(`Agent checkout smoke did not complete checkout navigation action. completedTargetKeys=${completedTargetKeys.join(',')}`);
  }

  if (!completedFinalUrls.some((url) => url.includes('/checkout.html'))) {
    throw new Error(`Agent checkout smoke did not reach checkout URL. completedFinalUrls=${completedFinalUrls.join(',')}`);
  }

  if (completedTargetKeys.includes('#pay-now')) {
    throw new Error('Agent checkout smoke clicked the final payment button.');
  }

  if (!tracePersistedEvent) {
    throw new Error('Agent checkout smoke did not persist an AgentTrace.');
  }

  if (requireExportArtifact && (scenarioPlanExportStatus !== 'EXPORTED' || !scenarioPlanExportArtifactId)) {
    throw new Error(`Agent checkout smoke did not export a ScenarioPlan artifact. status=${scenarioPlanExportStatus ?? ''}`);
  }

  return {
    actionCompletedEvents,
    completedTargetKeys,
    tracePersisted: true,
    scenarioPlanExportStatus,
    scenarioPlanExportArtifactId,
  };
}

export async function startCheckoutFixture(hostForRunner = 'host.docker.internal') {
  const server = createServer((request, response) => {
    const url = request.url ?? '/';
    response.setHeader('content-type', 'text/html; charset=utf-8');

    if (url.includes('/cart.html')) {
      response.end(`<!doctype html><html lang="en"><head><meta charset="utf-8" /><title>Cart</title></head><body><main><h1>Cart</h1><p>Smoke product is ready for checkout.</p><a id="checkout-link" href="/checkout.html">Proceed to checkout</a></main></body></html>`);
      return;
    }

    if (url.includes('/checkout.html')) {
      response.end(`<!doctype html><html lang="en"><head><meta charset="utf-8" /><title>Checkout</title></head><body><main><h1>Checkout</h1><label for="card-number">Card number</label><input id="card-number" placeholder="Card number" /><button id="pay-now" type="button">Pay now</button></main><script>document.getElementById("pay-now")?.addEventListener("click", () => { document.body.dataset.paymentCommitted = "true"; });</script></body></html>`);
      return;
    }

    response.end(`<!doctype html><html lang="en"><head><meta charset="utf-8" /><title>Agent Product Fixture</title></head><body><main><h1>Agent Checkout Smoke Product</h1><a id="learn-more" href="#details">Learn more</a><button id="add-to-cart" type="button">Add to cart</button><a id="cart-link" href="/cart.html" hidden>View cart</a><section id="details" style="margin-top: 1200px;">Product details</section></main><script>document.getElementById("add-to-cart")?.addEventListener("click", () => { document.body.dataset.addedToCart = "true"; document.getElementById("cart-link")?.removeAttribute("hidden"); });</script></body></html>`);
  });

  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '0.0.0.0', () => {
      server.off('error', reject);
      resolveListen();
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Unable to start agent checkout fixture server.');
  }

  return {
    port: address.port,
    productUrl: `http://${hostForRunner}:${address.port}/product.html`,
    close: () => new Promise((resolveClose, reject) => {
      server.close((error) => error ? reject(error) : resolveClose());
    }),
  };
}

export async function authenticate(config) {
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

export async function createAgentRun(config, accessToken, targetUrl) {
  const response = await requestJson(config, '/api/runs', {
    method: 'POST',
    accessToken,
    headers: {
      'Idempotency-Key': `agent-checkout-run:${randomUUID()}`,
    },
    body: buildCreateAgentRunRequest(config, targetUrl),
  });
  return response.data;
}

export async function startRun(config, accessToken, runId) {
  await requestJson(config, `/api/runs/${runId}/start`, {
    method: 'POST',
    accessToken,
    headers: {
      'Idempotency-Key': `agent-checkout-start:${runId}`,
    },
  });
}

export async function pollRunUntilTerminal(config, accessToken, runId, expectedStatuses = ['COMPLETED']) {
  return pollUntil(config, async () => {
    const response = await requestJson(config, `/api/runs/${runId}`, { accessToken });
    const run = response.data;
    logStep('poll.run', { runId, status: run.status, resultCompleteness: run.resultCompleteness });

    if (expectedStatuses.includes(run.status)) {
      return run;
    }

    if (RUN_TERMINAL_STATUSES.has(run.status)) {
      throw new Error(`Run reached terminal status ${run.status}, expected ${expectedStatuses.join(' or ')}: ${run.failureCode ?? ''} ${run.failureMessage ?? ''}`.trim());
    }

    if (!RUN_ACTIVE_STATUSES.has(run.status)) {
      throw new Error(`Run is in unexpected status ${run.status}; expected runner to pick it up from the MQ queue.`);
    }

    return null;
  }, `run ${runId} to reach ${expectedStatuses.join(' or ')}`);
}

export async function pollAgentEvents(config, accessToken, runId) {
  return pollUntil(config, async () => {
    const response = await requestJson(config, `/api/runs/${runId}/events?${new URLSearchParams({ limit: '100' })}`, { accessToken });
    const events = Array.isArray(response.data) ? response.data : [];
    logStep('poll.agent-events', { runId, events: events.length });

    const hasTrace = events.some((event) => normalizeAgentEventType(event) === 'TRACE_PERSISTED');
    const hasCheckout = events.some((event) => normalizeAgentEventType(event) === 'ACTION_COMPLETED' && agentEventPayload(event)?.targetKey === '#checkout-link');
    return hasTrace && hasCheckout ? events : null;
  }, `agent checkout events for run ${runId}`);
}

export function normalizeAgentEventType(event) {
  const eventType = String(event?.eventType ?? event?.payload?.agentEventType ?? '');
  return eventType.startsWith('AGENT_') ? eventType.slice('AGENT_'.length) : eventType;
}

export function agentEventPayload(event) {
  const payload = event?.payload;
  return payload && typeof payload.payload === 'object' && payload.payload !== null
    ? payload.payload
    : payload;
}

export async function pollEvidencePacket(config, accessToken, runId) {
  return pollUntil(config, async () => {
    const response = await requestJson(config, `/api/runs/${runId}/evidence-packet`, { accessToken });
    const packet = response.data;
    const checkpoints = Array.isArray(packet.checkpoints) ? packet.checkpoints : [];
    const artifacts = Array.isArray(packet.artifacts) ? packet.artifacts : [];
    logStep('poll.evidence', { runId, checkpoints: checkpoints.length, artifacts: artifacts.length });
    return artifacts.length > 0 ? { ...packet, checkpoints, artifacts } : null;
  }, `evidence packet for run ${runId}`);
}

export async function requestJson(config, path, options = {}) {
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

export async function assertHealth(config) {
  const response = await fetch(`${config.apiBaseUrl}${config.healthPath}`);
  if (!response.ok) {
    const details = await response.text();
    const suffix = details ? ` ${details}` : ` ${response.statusText}`;
    throw new Error(`API health check failed at ${config.healthPath}: ${response.status}${suffix}`);
  }
}

export async function pollUntil(config, probe, label) {
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
    error.message.includes('terminal status') ||
    error.message.includes('unexpected status') ||
    error.message.includes('final payment')
  );
}

export function normalizeBaseUrl(value) {
  return String(value).replace(/\/+$/, '');
}

export function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value ?? ''));
}

function normalizePath(value) {
  const path = String(value ?? '').trim();
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

  const normalized = String(value).toLowerCase();
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
    const value = rawValue.replace(/^[\'"]|[\'"]$/g, '');
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

async function main() {
  loadDotEnv();
  const result = await runAgentCheckoutSmoke(readConfig());
  console.log(JSON.stringify({ step: 'success', ...result }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(JSON.stringify({ step: 'failed', message: error.message }, null, 2));
    process.exitCode = 1;
  });
}
