#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const DISCOVERY_TERMINAL_STATUSES = new Set(['COMPLETED', 'FAILED', 'CANCELED']);
const DISCOVERY_ACTIVE_STATUSES = new Set(['CREATED', 'QUEUED', 'RUNNING']);
const AUTHORING_TERMINAL_STATUSES = new Set(['SUCCEEDED', 'FAILED', 'CANCELED', 'EXPIRED']);
const AUTHORING_ACTIVE_STATUSES = new Set(['CREATED', 'QUEUED', 'RUNNING']);
const RUN_TERMINAL_STATUSES = new Set(['COMPLETED', 'FAILED', 'STOPPED']);
const RUN_ACTIVE_STATUSES = new Set(['CREATED', 'QUEUED', 'STARTING', 'RUNNING']);
const AUTHORABLE_RECOMMENDATION_LEVELS = new Set(['HIGH', 'MEDIUM']);
const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_TARGET_URL = 'https://www.demoblaze.com/';
const DEFAULT_SMOKE_EMAIL = 'e2e-smoke@wedge.local';
const DEFAULT_SMOKE_PASSWORD = 'wedge-smoke-password';

export function normalizeBaseUrl(value) {
  return String(value).replace(/\/+$/, '');
}

export function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value ?? ''));
}

export function readConfig(env = process.env) {
  return {
    apiBaseUrl: normalizeBaseUrl(env.WEDGE_CHAIN_SMOKE_API_BASE_URL ?? env.WEDGE_SMOKE_API_BASE_URL ?? env.WEDGE_API_BASE_URL ?? 'http://localhost:8080'),
    webBaseUrl: normalizeBaseUrl(env.WEDGE_CHAIN_SMOKE_WEB_BASE_URL ?? env.WEDGE_SMOKE_WEB_BASE_URL ?? env.WEDGE_WEB_BASE_URL ?? 'http://localhost:5173'),
    targetUrl: env.WEDGE_CHAIN_SMOKE_TARGET_URL ?? env.WEDGE_SMOKE_TARGET_URL ?? DEFAULT_TARGET_URL,
    projectId: env.WEDGE_CHAIN_SMOKE_PROJECT_ID ?? env.WEDGE_SMOKE_PROJECT_ID ?? env.VITE_DEV_PROJECT_ID,
    scenarioTemplateVersionId: env.WEDGE_CHAIN_SMOKE_SCENARIO_TEMPLATE_VERSION_ID ?? env.WEDGE_SMOKE_SCENARIO_TEMPLATE_VERSION_ID ?? env.VITE_DEV_SCENARIO_TEMPLATE_VERSION_ID,
    accessToken: env.WEDGE_CHAIN_SMOKE_ACCESS_TOKEN ?? env.WEDGE_SMOKE_ACCESS_TOKEN ?? env.WEDGE_ACCESS_TOKEN,
    email: env.WEDGE_CHAIN_SMOKE_EMAIL ?? env.WEDGE_SMOKE_EMAIL ?? DEFAULT_SMOKE_EMAIL,
    password: env.WEDGE_CHAIN_SMOKE_PASSWORD ?? env.WEDGE_SMOKE_PASSWORD ?? DEFAULT_SMOKE_PASSWORD,
    displayName: env.WEDGE_CHAIN_SMOKE_DISPLAY_NAME ?? env.WEDGE_SMOKE_DISPLAY_NAME ?? 'Wedge Chain E2E Smoke',
    timeoutMs: parsePositiveInt(env.WEDGE_CHAIN_SMOKE_TIMEOUT_MS ?? env.WEDGE_SMOKE_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    pollIntervalMs: parsePositiveInt(env.WEDGE_CHAIN_SMOKE_POLL_INTERVAL_MS ?? env.WEDGE_SMOKE_POLL_INTERVAL_MS, DEFAULT_POLL_INTERVAL_MS),
    healthPath: normalizePath(env.WEDGE_CHAIN_SMOKE_HEALTH_PATH ?? env.WEDGE_SMOKE_HEALTH_PATH ?? '/actuator/health'),
    preferredScenarioType: normalizeOptional(env.WEDGE_CHAIN_SMOKE_PREFERRED_SCENARIO_TYPE),
    expectedRunStatuses: normalizeExpectedRunStatuses(env.WEDGE_CHAIN_SMOKE_EXPECTED_RUN_STATUSES ?? env.WEDGE_CHAIN_SMOKE_EXPECTED_RUN_STATUS ?? 'COMPLETED,STOPPED'),
    requireEvidenceArtifacts: readBoolean(env.WEDGE_CHAIN_SMOKE_REQUIRE_ARTIFACTS ?? env.WEDGE_SMOKE_REQUIRE_ARTIFACTS, false),
  };
}

export async function runChainSmoke(config = readConfig()) {
  validateConfig(config);

  await assertHealth(config);
  const accessToken = config.accessToken ?? await authenticate(config);

  const discovery = await createDiscovery(config, accessToken);
  logStep('discovery.created', { discoveryId: discovery.discoveryId, status: discovery.status });
  const completedDiscovery = await pollDiscoveryUntilCompleted(config, accessToken, discovery.discoveryId);
  const recommendation = selectAuthorableRecommendation(completedDiscovery, config.preferredScenarioType);
  logStep('discovery.completed', {
    discoveryId: completedDiscovery.discoveryId,
    detectedFlowTypes: completedDiscovery.summary?.detectedFlowTypes ?? [],
    selectedRecommendationId: recommendation.recommendationId,
    selectedScenarioType: recommendation.scenarioType,
  });

  const authoringJob = await createAuthoringJob(config, accessToken, completedDiscovery, recommendation);
  logStep('authoring.created', { authoringJobId: authoringJob.authoringJobId, status: authoringJob.status });
  const succeededAuthoringJob = await pollAuthoringUntilSucceeded(config, accessToken, authoringJob.authoringJobId);
  const candidate = selectValidCandidate(succeededAuthoringJob);
  logStep('authoring.succeeded', {
    authoringJobId: succeededAuthoringJob.authoringJobId,
    candidateId: candidate.candidate_id,
    candidateCount: succeededAuthoringJob.candidateCount,
  });

  const confirmed = await confirmCandidate(config, accessToken, succeededAuthoringJob.authoringJobId, candidate.candidate_id);
  logStep('authoring.confirmed', {
    authoringJobId: confirmed.authoringJob.authoringJobId,
    candidateId: confirmed.authoringJob.confirmedCandidateId,
  });

  const run = await createRunFromCandidate(config, accessToken, confirmed.confirmedCandidate);
  logStep('run.created', { runId: run.id, status: run.status });
  await startRun(config, accessToken, run.id);
  logStep('run.started', { runId: run.id });

  const terminalRun = await pollRunUntilAcceptedTerminal(config, accessToken, run.id);
  const evidencePacket = terminalRun.status === 'FAILED'
    ? { checkpoints: [], artifacts: [] }
    : await pollEvidencePacket(config, accessToken, run.id);
  const monitorUrl = `${config.webBaseUrl}/runs/${encodeURIComponent(run.id)}?${new URLSearchParams({
    url: config.targetUrl,
    scenario: String(recommendation.scenarioType ?? 'authored'),
    depth: 'discovery-authoring-chain',
  })}`;

  return {
    discoveryId: completedDiscovery.discoveryId,
    discoveryStatus: completedDiscovery.status,
    selectedRecommendationId: recommendation.recommendationId,
    selectedScenarioType: recommendation.scenarioType,
    authoringJobId: succeededAuthoringJob.authoringJobId,
    authoringStatus: succeededAuthoringJob.status,
    candidateId: candidate.candidate_id,
    runId: run.id,
    runStatus: terminalRun.status,
    resultCompleteness: terminalRun.resultCompleteness,
    failureCode: terminalRun.failureCode,
    failureMessage: terminalRun.failureMessage,
    checkpointCount: evidencePacket.checkpoints.length,
    artifactCount: evidencePacket.artifacts.length,
    monitorUrl,
  };
}

export function validateConfig(config) {
  if (!isUuid(config.projectId)) {
    throw new Error('WEDGE_CHAIN_SMOKE_PROJECT_ID or WEDGE_SMOKE_PROJECT_ID must be a valid project UUID.');
  }

  if (!isUuid(config.scenarioTemplateVersionId)) {
    throw new Error('WEDGE_CHAIN_SMOKE_SCENARIO_TEMPLATE_VERSION_ID or WEDGE_SMOKE_SCENARIO_TEMPLATE_VERSION_ID must be a valid scenario template version UUID.');
  }

  try {
    const url = new URL(config.targetUrl);
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error('unsupported protocol');
    }
  } catch {
    throw new Error('WEDGE_CHAIN_SMOKE_TARGET_URL must be an absolute http(s) URL.');
  }

  if (config.expectedRunStatuses.length === 0 || config.expectedRunStatuses.some((status) => !RUN_TERMINAL_STATUSES.has(status))) {
    throw new Error('WEDGE_CHAIN_SMOKE_EXPECTED_RUN_STATUSES must contain only COMPLETED, STOPPED, or FAILED.');
  }
}

export function selectAuthorableRecommendation(discovery, preferredScenarioType) {
  const recommendations = Array.isArray(discovery.scenarioRecommendations) ? discovery.scenarioRecommendations : [];
  const eligible = recommendations.filter((recommendation) =>
    AUTHORABLE_RECOMMENDATION_LEVELS.has(String(recommendation.recommendationLevel ?? '')) &&
    Number(recommendation.confidence ?? 0) >= 0.55 &&
    Array.isArray(recommendation.evidenceRefs) && recommendation.evidenceRefs.length > 0
  );
  const preferred = preferredScenarioType
    ? eligible.find((recommendation) => recommendation.scenarioType === preferredScenarioType)
    : null;
  const selected = preferred ?? eligible[0];

  if (!selected) {
    const detected = discovery.summary?.detectedFlowTypes?.join(', ') || 'none';
    throw new Error(`Discovery completed but produced no authorable HIGH/MEDIUM recommendation. detectedFlowTypes=${detected}`);
  }

  return selected;
}

export function buildAuthoringRequest(config, discovery, recommendation) {
  return {
    projectId: config.projectId,
    sourceDiscoveryId: discovery.discoveryId,
    selectedRecommendationId: recommendation.recommendationId,
    requestedGoal: `Compile a safe ${recommendation.scenarioType} ScenarioPlan from Discovery recommendation ${recommendation.recommendationId}.`,
    preferredScenarioType: recommendation.scenarioType,
    selectedRecommendation: {
      recommendationId: recommendation.recommendationId,
      scenarioType: recommendation.scenarioType,
    },
    constraints: {
      source: 'infra-real-discovery-authoring-run-e2e-smoke',
      stopBeforeRealPayment: true,
    },
    providerPolicy: {
      providerOrder: ['INTERNAL_LLM', 'RULE_BASED'],
      timeoutMs: 20000,
      fallbackAllowed: true,
      approvalRequired: true,
    },
  };
}

export function selectValidCandidate(authoringJob) {
  const candidates = Array.isArray(authoringJob.candidates) ? authoringJob.candidates : [];
  const selected = candidates.find((candidate) => candidateValidationPassed(candidate));
  if (!selected) {
    throw new Error(`ScenarioAuthoring job ${authoringJob.authoringJobId} produced no valid candidate.`);
  }
  return selected;
}

export function buildRunRequestFromCandidate(config, candidate) {
  const scenarioPlan = candidate?.scenario_plan;
  if (!scenarioPlan || typeof scenarioPlan !== 'object') {
    throw new Error('ScenarioAuthoring confirmed candidate is missing scenario_plan.');
  }

  return {
    projectId: config.projectId,
    name: `Discovery → Authoring → Run E2E Smoke (${scenarioPlan.scenario_type ?? 'authored'})`,
    startUrl: scenarioPlan.start_url ?? config.targetUrl,
    goal: scenarioPlan.goal ?? 'Run an authored ScenarioPlan from Discovery.',
    devicePreset: scenarioPlan.environment?.device ?? 'desktop',
    scenarioTemplateVersionId: config.scenarioTemplateVersionId,
    scenarioOverrides: {
      source: 'infra-real-discovery-authoring-run-e2e-smoke',
      discoveryId: scenarioPlan.source_discovery_id,
      candidateId: candidate.candidate_id,
      mode: 'discovery-authoring-chain',
    },
    scenarioPlan,
  };
}

function candidateValidationPassed(candidate) {
  const validation = candidate?.validation ?? {};
  return validation.schema_valid === true &&
    validation.safety_valid === true &&
    validation.fit_requirements_valid === true &&
    Array.isArray(validation.errors) && validation.errors.length === 0;
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

async function createDiscovery(config, accessToken) {
  const response = await requestJson(config, '/api/discoveries', {
    method: 'POST',
    accessToken,
    headers: {
      'Idempotency-Key': `chain-discovery:${randomUUID()}`,
    },
    body: {
      projectId: config.projectId,
      url: config.targetUrl,
      devicePreset: 'desktop',
      viewport: {
        width: 1440,
        height: 900,
      },
    },
  });
  return response.data;
}

async function pollDiscoveryUntilCompleted(config, accessToken, discoveryId) {
  return pollUntil(config, async () => {
    const response = await requestJson(config, `/api/discoveries/${discoveryId}`, { accessToken });
    const discovery = response.data;
    logStep('poll.discovery', { discoveryId, status: discovery.status, recommendationCount: discovery.scenarioRecommendations?.length ?? 0 });

    if (discovery.status === 'COMPLETED') {
      return discovery;
    }

    if (DISCOVERY_TERMINAL_STATUSES.has(discovery.status)) {
      throw new Error(`Discovery reached terminal status ${discovery.status}: ${discovery.failureCode ?? ''} ${discovery.failureMessage ?? ''}`.trim());
    }

    if (!DISCOVERY_ACTIVE_STATUSES.has(discovery.status)) {
      throw new Error(`Discovery is in unexpected status ${discovery.status}.`);
    }

    return null;
  }, `discovery ${discoveryId} to complete`);
}

async function createAuthoringJob(config, accessToken, discovery, recommendation) {
  const response = await requestJson(config, '/api/scenario-authoring-jobs', {
    method: 'POST',
    accessToken,
    headers: {
      'Idempotency-Key': `chain-authoring:${randomUUID()}`,
    },
    body: buildAuthoringRequest(config, discovery, recommendation),
  });
  return response.data;
}

async function pollAuthoringUntilSucceeded(config, accessToken, authoringJobId) {
  return pollUntil(config, async () => {
    const response = await requestJson(config, `/api/scenario-authoring-jobs/${authoringJobId}`, { accessToken });
    const job = response.data;
    logStep('poll.authoring', { authoringJobId, status: job.status, candidateCount: job.candidateCount });

    if (job.status === 'SUCCEEDED') {
      return job;
    }

    if (AUTHORING_TERMINAL_STATUSES.has(job.status)) {
      throw new Error(`ScenarioAuthoring reached terminal status ${job.status}: ${job.failure?.failure_message ?? ''}`.trim());
    }

    if (!AUTHORING_ACTIVE_STATUSES.has(job.status)) {
      throw new Error(`ScenarioAuthoring job is in unexpected status ${job.status}.`);
    }

    return null;
  }, `scenario authoring job ${authoringJobId} to succeed`);
}

async function confirmCandidate(config, accessToken, authoringJobId, candidateId) {
  const response = await requestJson(config, `/api/scenario-authoring-jobs/${authoringJobId}/confirm`, {
    method: 'POST',
    accessToken,
    body: { candidateId },
  });
  return response.data;
}

async function createRunFromCandidate(config, accessToken, candidate) {
  const response = await requestJson(config, '/api/runs', {
    method: 'POST',
    accessToken,
    headers: {
      'Idempotency-Key': `chain-run:${randomUUID()}`,
    },
    body: buildRunRequestFromCandidate(config, candidate),
  });
  return response.data;
}

async function startRun(config, accessToken, runId) {
  await requestJson(config, `/api/runs/${runId}/start`, {
    method: 'POST',
    accessToken,
    headers: {
      'Idempotency-Key': `chain-start:${runId}`,
    },
  });
}

async function pollRunUntilAcceptedTerminal(config, accessToken, runId) {
  return pollUntil(config, async () => {
    const response = await requestJson(config, `/api/runs/${runId}`, { accessToken });
    const run = response.data;
    logStep('poll.run', { runId, status: run.status, resultCompleteness: run.resultCompleteness });

    if (config.expectedRunStatuses.includes(run.status)) {
      if (run.status === 'FAILED' && (!run.failureCode || !run.failureMessage)) {
        throw new Error(`Run reached FAILED without failureCode/failureMessage: ${run.id ?? runId}`);
      }
      return run;
    }

    if (RUN_TERMINAL_STATUSES.has(run.status)) {
      throw new Error(`Run reached terminal status ${run.status}, expected one of ${config.expectedRunStatuses.join(', ')}: ${run.failureCode ?? ''} ${run.failureMessage ?? ''}`.trim());
    }

    if (!RUN_ACTIVE_STATUSES.has(run.status)) {
      throw new Error(`Run is in unexpected status ${run.status}; expected runner to pick it up from the MQ queue.`);
    }

    return null;
  }, `run ${runId} to reach ${config.expectedRunStatuses.join(' or ')}`);
}

async function pollEvidencePacket(config, accessToken, runId) {
  return pollUntil(config, async () => {
    const response = await requestJson(config, `/api/runs/${runId}/evidence-packet`, { accessToken });
    const packet = response.data;
    const checkpoints = Array.isArray(packet.checkpoints) ? packet.checkpoints : [];
    const artifacts = Array.isArray(packet.artifacts) ? packet.artifacts : [];
    logStep('poll.evidence', { runId, checkpoints: checkpoints.length, artifacts: artifacts.length });

    if (checkpoints.length > 0 && (!config.requireEvidenceArtifacts || artifacts.length > 0)) {
      return { ...packet, checkpoints, artifacts };
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
    error.message.includes('terminal status') ||
    error.message.includes('unexpected status') ||
    error.message.includes('no authorable') ||
    error.message.includes('no valid candidate')
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

function normalizeOptional(value) {
  const normalized = String(value ?? '').trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeExpectedRunStatuses(value) {
  return String(value ?? '')
    .split(',')
    .map((status) => status.trim().toUpperCase())
    .filter(Boolean);
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
  const result = await runChainSmoke(readConfig());
  console.log(JSON.stringify({ step: 'success', ...result }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(JSON.stringify({ step: 'failed', message: error.message }, null, 2));
    process.exitCode = 1;
  });
}
