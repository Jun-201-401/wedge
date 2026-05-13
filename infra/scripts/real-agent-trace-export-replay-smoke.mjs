#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  agentEventPayload,
  assertCheckoutAgentEvents,
  assertHealth,
  authenticate,
  createAgentRun,
  isUuid,
  normalizeBaseUrl,
  normalizeAgentEventType,
  pollAgentEvents,
  pollEvidencePacket,
  pollRunUntilTerminal,
  requestJson,
  startCheckoutFixture,
} from './real-agent-product-checkout-smoke.mjs';

const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_SMOKE_EMAIL = 'e2e-smoke@wedge.local';
const DEFAULT_SMOKE_PASSWORD = 'wedge-smoke-password';

export function readConfig(env = process.env) {
  return {
    apiBaseUrl: normalizeBaseUrl(env.WEDGE_AGENT_EXPORT_REPLAY_SMOKE_API_BASE_URL ?? env.WEDGE_SMOKE_API_BASE_URL ?? env.WEDGE_API_BASE_URL ?? 'http://localhost:8080'),
    webBaseUrl: normalizeBaseUrl(env.WEDGE_AGENT_EXPORT_REPLAY_SMOKE_WEB_BASE_URL ?? env.WEDGE_SMOKE_WEB_BASE_URL ?? env.WEDGE_WEB_BASE_URL ?? 'http://localhost:5173'),
    projectId: env.WEDGE_AGENT_EXPORT_REPLAY_SMOKE_PROJECT_ID ?? env.WEDGE_AGENT_CHECKOUT_SMOKE_PROJECT_ID ?? env.WEDGE_SMOKE_PROJECT_ID ?? env.VITE_DEV_PROJECT_ID,
    scenarioTemplateVersionId: env.WEDGE_AGENT_EXPORT_REPLAY_SMOKE_SCENARIO_TEMPLATE_VERSION_ID ?? env.WEDGE_SMOKE_SCENARIO_TEMPLATE_VERSION_ID ?? env.VITE_DEV_SCENARIO_TEMPLATE_VERSION_ID,
    accessToken: env.WEDGE_AGENT_EXPORT_REPLAY_SMOKE_ACCESS_TOKEN ?? env.WEDGE_AGENT_CHECKOUT_SMOKE_ACCESS_TOKEN ?? env.WEDGE_SMOKE_ACCESS_TOKEN ?? env.WEDGE_ACCESS_TOKEN,
    email: env.WEDGE_AGENT_EXPORT_REPLAY_SMOKE_EMAIL ?? env.WEDGE_SMOKE_EMAIL ?? DEFAULT_SMOKE_EMAIL,
    password: env.WEDGE_AGENT_EXPORT_REPLAY_SMOKE_PASSWORD ?? env.WEDGE_SMOKE_PASSWORD ?? DEFAULT_SMOKE_PASSWORD,
    displayName: env.WEDGE_AGENT_EXPORT_REPLAY_SMOKE_DISPLAY_NAME ?? env.WEDGE_SMOKE_DISPLAY_NAME ?? 'Wedge Agent Export Replay Smoke',
    timeoutMs: parsePositiveInt(env.WEDGE_AGENT_EXPORT_REPLAY_SMOKE_TIMEOUT_MS ?? env.WEDGE_SMOKE_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    pollIntervalMs: parsePositiveInt(env.WEDGE_AGENT_EXPORT_REPLAY_SMOKE_POLL_INTERVAL_MS ?? env.WEDGE_SMOKE_POLL_INTERVAL_MS, DEFAULT_POLL_INTERVAL_MS),
    healthPath: normalizePath(env.WEDGE_AGENT_EXPORT_REPLAY_SMOKE_HEALTH_PATH ?? env.WEDGE_SMOKE_HEALTH_PATH ?? '/actuator/health'),
    targetUrl: env.WEDGE_AGENT_EXPORT_REPLAY_SMOKE_TARGET_URL ?? null,
    fixtureHostForRunner: env.WEDGE_AGENT_EXPORT_REPLAY_SMOKE_FIXTURE_HOST_FOR_RUNNER ?? env.WEDGE_AGENT_CHECKOUT_SMOKE_FIXTURE_HOST_FOR_RUNNER ?? 'host.docker.internal',
  };
}

export async function runAgentTraceExportReplaySmoke(config = readConfig()) {
  validateConfig(config);
  const fixture = config.targetUrl ? null : await startCheckoutFixture(config.fixtureHostForRunner);

  try {
    const targetUrl = config.targetUrl ?? fixture.productUrl;
    await assertHealth(config);
    const accessToken = config.accessToken ?? await authenticate(config);

    const agentRun = await createAgentRun(config, accessToken, targetUrl);
    logStep('agent.run.created', { runId: agentRun.id, status: agentRun.status, targetUrl });
    await startRun(config, accessToken, agentRun.id, 'agent-export-replay-agent-start');
    logStep('agent.run.started', { runId: agentRun.id });

    const terminalAgentRun = await pollRunUntilTerminal(config, accessToken, agentRun.id, ['COMPLETED']);
    const events = await pollAgentEvents(config, accessToken, agentRun.id);
    const checkoutAssertions = assertCheckoutAgentEvents(events, true);
    const exportArtifactId = selectScenarioPlanExportArtifactId(events);
    const exportArtifact = parseScenarioPlanExportArtifact(
      await requestText(config, `/api/runs/${agentRun.id}/artifacts/${exportArtifactId}/content`, { accessToken })
    );
    const scenarioPlan = exportArtifact.scenario_plan;
    const replayableAssertions = assertScenarioPlanReplayable(scenarioPlan);

    const replayRun = await createReplayRun(config, accessToken, {
      scenarioPlan,
      sourceAgentRunId: agentRun.id,
      exportArtifactId,
    });
    logStep('replay.run.created', { runId: replayRun.id, status: replayRun.status });
    await startRun(config, accessToken, replayRun.id, 'agent-export-replay-static-start');
    logStep('replay.run.started', { runId: replayRun.id });

    const terminalReplayRun = await pollRunUntilTerminal(config, accessToken, replayRun.id, ['STOPPED', 'COMPLETED']);
    const replayEvidencePacket = await pollEvidencePacket(config, accessToken, replayRun.id);
    const replayEvidenceAssertions = await assertReplayEvidence(config, accessToken, replayEvidencePacket);
    const monitorUrl = `${config.webBaseUrl}/runs/${encodeURIComponent(replayRun.id)}?${new URLSearchParams({
      url: scenarioPlan.start_url,
      scenario: 'agent-trace-export-replay',
      depth: 'agent-export-replay',
      sourceRun: agentRun.id,
    })}`;

    return {
      agentRunId: agentRun.id,
      agentStatus: terminalAgentRun.status,
      agentResultCompleteness: terminalAgentRun.resultCompleteness,
      agentCompletedTargetKeys: checkoutAssertions.completedTargetKeys,
      exportArtifactId,
      exportedStepCount: scenarioPlan.steps.length,
      replayHintStepCount: replayableAssertions.replayHintStepCount,
      hasStopWhen: replayableAssertions.hasStopWhen,
      replayRunId: replayRun.id,
      replayStatus: terminalReplayRun.status,
      replayResultCompleteness: terminalReplayRun.resultCompleteness,
      replayCheckpointCount: replayEvidencePacket.checkpoints.length,
      replayArtifactCount: replayEvidencePacket.artifacts.length,
      replayCheckoutDomArtifactCount: replayEvidenceAssertions.checkoutDomArtifactCount,
      monitorUrl,
    };
  } finally {
    await fixture?.close();
  }
}

export function validateConfig(config) {
  if (!isUuid(config.projectId)) {
    throw new Error('WEDGE_AGENT_EXPORT_REPLAY_SMOKE_PROJECT_ID or WEDGE_SMOKE_PROJECT_ID must be a valid project UUID.');
  }

  if (!isUuid(config.scenarioTemplateVersionId)) {
    throw new Error('WEDGE_AGENT_EXPORT_REPLAY_SMOKE_SCENARIO_TEMPLATE_VERSION_ID or WEDGE_SMOKE_SCENARIO_TEMPLATE_VERSION_ID must be a valid scenario template version UUID.');
  }

  if (config.targetUrl !== null) {
    try {
      const url = new URL(config.targetUrl);
      if (!['http:', 'https:'].includes(url.protocol)) {
        throw new Error('unsupported protocol');
      }
    } catch {
      throw new Error('WEDGE_AGENT_EXPORT_REPLAY_SMOKE_TARGET_URL must be an absolute http(s) URL.');
    }
  }
}

export function selectScenarioPlanExportArtifactId(events) {
  const tracePersistedEvent = events.find((event) => normalizeAgentEventType(event) === 'TRACE_PERSISTED');
  const payload = tracePersistedEvent ? agentEventPayload(tracePersistedEvent) : null;
  const exportStatus = payload?.scenarioPlanExportStatus ?? null;
  const exportArtifactId = payload?.scenarioPlanExportArtifactId ?? null;

  if (exportStatus !== 'EXPORTED' || !exportArtifactId) {
    throw new Error(`Agent trace did not export a ScenarioPlan artifact. status=${exportStatus ?? ''}`);
  }

  return String(exportArtifactId);
}

export function parseScenarioPlanExportArtifact(content) {
  let payload;
  try {
    payload = JSON.parse(content);
  } catch (error) {
    throw new Error(`Agent ScenarioPlan export artifact must be JSON: ${error.message}`);
  }

  if (payload?.status !== 'EXPORTED') {
    throw new Error(`Agent ScenarioPlan export artifact status must be EXPORTED. status=${payload?.status ?? ''}`);
  }

  if (!payload.scenario_plan || !Array.isArray(payload.scenario_plan.steps)) {
    throw new Error('Agent ScenarioPlan export artifact is missing scenario_plan.steps.');
  }

  return payload;
}

export function assertScenarioPlanReplayable(scenarioPlan) {
  const steps = Array.isArray(scenarioPlan?.steps) ? scenarioPlan.steps : [];
  const replayHintStepCount = steps.filter((step) => Boolean(step?.action?.options?.replay_hint)).length;
  const hasStopWhen = steps.some((step) => step?.action?.type === 'stop_when');
  const includesFinalPaymentTarget = steps.some((step) => JSON.stringify(step).includes('#pay-now'));

  if (steps.length === 0) {
    throw new Error('Exported ScenarioPlan has no replay steps.');
  }

  if (replayHintStepCount === 0) {
    throw new Error('Exported ScenarioPlan has no replay_hint-backed steps.');
  }

  if (!hasStopWhen) {
    throw new Error('Exported ScenarioPlan must include a final stop_when boundary.');
  }

  if (includesFinalPaymentTarget) {
    throw new Error('Exported ScenarioPlan must not include the final payment target.');
  }

  return {
    replayHintStepCount,
    hasStopWhen,
  };
}

export function buildReplayRunRequest(config, { scenarioPlan, sourceAgentRunId, exportArtifactId }) {
  return {
    projectId: config.projectId,
    name: 'Real Agent Trace Export Replay Smoke',
    startUrl: scenarioPlan.start_url,
    goal: scenarioPlan.goal,
    devicePreset: scenarioPlan.environment?.device ?? 'desktop',
    scenarioTemplateVersionId: config.scenarioTemplateVersionId,
    scenarioOverrides: {
      source: 'infra-real-agent-trace-export-replay-smoke',
      mode: 'agent-trace-export-replay',
      sourceAgentRunId,
      exportArtifactId,
    },
    scenarioPlan,
  };
}

export async function createReplayRun(config, accessToken, input) {
  const response = await requestJson(config, '/api/runs', {
    method: 'POST',
    accessToken,
    headers: {
      'Idempotency-Key': `agent-export-replay-run:${randomUUID()}`,
    },
    body: buildReplayRunRequest(config, input),
  });
  return response.data;
}

export async function startRun(config, accessToken, runId, idempotencyPrefix) {
  await requestJson(config, `/api/runs/${runId}/start`, {
    method: 'POST',
    accessToken,
    headers: {
      'Idempotency-Key': `${idempotencyPrefix}:${runId}`,
    },
  });
}

export async function assertReplayEvidence(config, accessToken, evidencePacket) {
  const artifacts = Array.isArray(evidencePacket?.artifacts) ? evidencePacket.artifacts : [];
  const domArtifacts = artifacts.filter((artifact) => String(artifact.type ?? artifact.artifactType ?? '').toLowerCase() === 'dom_snapshot');
  let checkoutDomArtifactCount = 0;

  for (const artifact of domArtifacts) {
    const contentPath = artifact.uri ?? artifact.contentUrl;
    if (!contentPath) {
      continue;
    }
    const content = await requestText(config, contentPath, { accessToken });
    if (content.includes('<h1>Checkout</h1>') || content.includes('Checkout')) {
      checkoutDomArtifactCount += 1;
    }
    if (content.includes('data-payment-committed="true"')) {
      throw new Error('Replay evidence shows the final payment button was committed.');
    }
  }

  if (checkoutDomArtifactCount === 0) {
    throw new Error('Replay evidence did not include a checkout DOM snapshot.');
  }

  return { checkoutDomArtifactCount };
}

export async function requestText(config, path, options = {}) {
  const headers = new Headers(options.headers);
  headers.set('Accept', '*/*');

  if (!options.anonymous) {
    headers.set('Authorization', `Bearer ${options.accessToken}`);
  }

  const response = await fetch(`${config.apiBaseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers,
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`${options.method ?? 'GET'} ${path} failed: ${response.status} ${text || response.statusText}`);
  }

  return text;
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
    const value = rawValue.replace(/^[\'\"]|[\'\"]$/g, '');
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

async function main() {
  loadDotEnv();
  const result = await runAgentTraceExportReplaySmoke(readConfig());
  console.log(JSON.stringify({ step: 'success', ...result }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(JSON.stringify({ step: 'failed', message: error.message }, null, 2));
    process.exitCode = 1;
  });
}
