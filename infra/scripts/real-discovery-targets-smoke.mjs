#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '../..');
const DEFAULT_TARGET_URLS = Object.freeze([
  'https://www.mgdj.co.kr/',
  'https://www.jinjood.com/',
  'http://hanaro.mrpage.kr/',
]);

export function readDiscoveryTargetsSmokeConfig(env = process.env) {
  const targetUrls = readCsv(env.WEDGE_DISCOVERY_SMOKE_TARGET_URLS)
    ?? readCsv(env.WEDGE_REAL_DISCOVERY_TARGET_URLS)
    ?? [...DEFAULT_TARGET_URLS];
  const expectedFlows = readCsv(env.WEDGE_DISCOVERY_TARGET_SMOKE_EXPECTED_FLOWS)
    ?? readCsv(env.WEDGE_DISCOVERY_SMOKE_EXPECTED_FLOWS)
    ?? [];

  return {
    targetUrls,
    expectedFlows,
    allowPartial: readBoolean(env.WEDGE_DISCOVERY_TARGET_SMOKE_ALLOW_PARTIAL, false),
    requireRecommendation: readBoolean(env.WEDGE_DISCOVERY_TARGET_SMOKE_REQUIRE_RECOMMENDATION, true),
    artifactsRoot: env.WEDGE_DISCOVERY_TARGET_SMOKE_ARTIFACTS_ROOT?.trim() || null,
    maxDurationMs: env.WEDGE_DISCOVERY_TARGET_SMOKE_MAX_DURATION_MS?.trim()
      || env.WEDGE_DISCOVERY_SMOKE_MAX_DURATION_MS?.trim()
      || '15000',
    maxScrollCount: env.WEDGE_DISCOVERY_TARGET_SMOKE_MAX_SCROLL_COUNT?.trim()
      || env.WEDGE_DISCOVERY_SMOKE_MAX_SCROLL_COUNT?.trim()
      || '2',
  };
}

export function buildDiscoveryTargetsSmokePlan({
  env = process.env,
  root = repoRoot,
  artifactsRoot = '<artifacts-root>',
} = {}) {
  const config = readDiscoveryTargetsSmokeConfig(env);
  return config.targetUrls.map((targetUrl, index) => {
    const discoveryId = discoveryIdForTarget(targetUrl, index);
    const targetArtifactsRoot = join(artifactsRoot, `${String(index + 1).padStart(2, '0')}-${slugifyUrl(targetUrl)}`);
    return {
      targetUrl,
      discoveryId,
      artifactsRoot: targetArtifactsRoot,
      resultFile: join(targetArtifactsRoot, 'discoveries', discoveryId, 'site-discovery-result.json'),
      command: process.execPath,
      args: [join(root, 'infra/scripts/real-discovery-smoke.mjs')],
      cwd: root,
      env: {
        WEDGE_DISCOVERY_SMOKE_TARGET_URL: targetUrl,
        WEDGE_DISCOVERY_SMOKE_DISCOVERY_ID: discoveryId,
        WEDGE_DISCOVERY_SMOKE_ARTIFACTS_ROOT: targetArtifactsRoot,
        WEDGE_DISCOVERY_SMOKE_EXPECTED_FLOWS: config.expectedFlows.join(','),
        WEDGE_DISCOVERY_SMOKE_MAX_DURATION_MS: config.maxDurationMs,
        WEDGE_DISCOVERY_SMOKE_MAX_SCROLL_COUNT: config.maxScrollCount,
      },
    };
  });
}

export async function runDiscoveryTargetsSmoke({ env = process.env, root = repoRoot, stdio = 'pipe' } = {}) {
  const config = readDiscoveryTargetsSmokeConfig(env);
  const createdArtifactsRoot = config.artifactsRoot ? null : await mkdtemp(join(tmpdir(), 'wedge-discovery-targets-smoke-'));
  const artifactsRoot = resolve(config.artifactsRoot ?? createdArtifactsRoot);
  const plan = buildDiscoveryTargetsSmokePlan({ env, root, artifactsRoot });
  const results = [];

  try {
    for (const step of plan) {
      console.log(JSON.stringify({ step: 'discovery-target.start', targetUrl: step.targetUrl }));
      const startedAt = Date.now();
      try {
        await runTargetStep(step, env, stdio);
        const result = JSON.parse(await readFile(step.resultFile, 'utf8'));
        const summary = summarizeDiscoveryResult(result);
        if (config.requireRecommendation && summary.runnableRecommendationCount === 0) {
          throw new Error(`Discovery target produced no runnable scenario recommendations: ${step.targetUrl}`);
        }

        const targetResult = {
          ok: true,
          targetUrl: step.targetUrl,
          discoveryId: step.discoveryId,
          resultFile: step.resultFile,
          durationMs: Date.now() - startedAt,
          ...summary,
        };
        results.push(targetResult);
        console.log(JSON.stringify({ step: 'discovery-target.done', ...targetResult }));
      } catch (error) {
        const targetResult = {
          ok: false,
          targetUrl: step.targetUrl,
          discoveryId: step.discoveryId,
          resultFile: step.resultFile,
          durationMs: Date.now() - startedAt,
          error: error instanceof Error ? error.message : String(error),
        };
        results.push(targetResult);
        console.error(JSON.stringify({ step: 'discovery-target.failed', ...targetResult }, null, 2));
        if (!config.allowPartial) {
          throw error;
        }
      }
    }

    return {
      ok: results.every((result) => result.ok),
      artifactsRoot,
      results,
    };
  } finally {
    if (createdArtifactsRoot) {
      await rm(createdArtifactsRoot, { recursive: true, force: true });
    }
  }
}

export function summarizeDiscoveryResult(result) {
  const recommendations = Array.isArray(result?.scenario_recommendations)
    ? result.scenario_recommendations
    : [];
  return {
    detectedFlowTypes: Array.isArray(result?.detected_flow_types) ? result.detected_flow_types : [],
    missingFlowTypes: Array.isArray(result?.missing_flow_types) ? result.missing_flow_types : [],
    recommendationCount: recommendations.length,
    runnableRecommendationCount: recommendations.filter((recommendation) => recommendation?.recommendation_level !== 'NOT_AVAILABLE').length,
    topRecommendations: recommendations
      .filter((recommendation) => recommendation?.recommendation_level !== 'NOT_AVAILABLE')
      .slice(0, 3)
      .map((recommendation) => ({
        scenarioType: recommendation.scenario_type,
        level: recommendation.recommendation_level,
        confidence: recommendation.confidence,
        target: compactTarget(recommendation.suggested_target),
      })),
  };
}

function compactTarget(target) {
  if (!target || typeof target !== 'object') {
    return null;
  }

  for (const key of ['text', 'label', 'placeholder', 'href_contains', 'selector', 'name']) {
    const value = target[key];
    if (typeof value === 'string' && value.trim()) {
      return { [key]: value.trim() };
    }
  }

  return null;
}

function readCsv(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const entries = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  return entries.length > 0 ? entries : [];
}

function readBoolean(value, fallback) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function discoveryIdForTarget(targetUrl, index) {
  const digest = createHash('sha1').update(`${index}:${targetUrl}`).digest('hex').slice(0, 12);
  return `30000000-0000-4000-8000-${digest}`;
}

function slugifyUrl(targetUrl) {
  try {
    const url = new URL(targetUrl);
    return `${url.hostname}${url.pathname}`
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'target';
  } catch {
    return String(targetUrl)
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'target';
  }
}

function runTargetStep(step, env, stdio) {
  return new Promise((resolveExit, reject) => {
    const child = spawn(step.command, step.args, {
      cwd: step.cwd ?? repoRoot,
      env: {
        ...env,
        ...step.env,
      },
      stdio,
    });

    let stdout = '';
    let stderr = '';
    if (stdio === 'pipe') {
      child.stdout?.on('data', (chunk) => { stdout += chunk; });
      child.stderr?.on('data', (chunk) => { stderr += chunk; });
    }

    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) {
        resolveExit();
        return;
      }

      reject(new Error(`Discovery target smoke failed for ${step.targetUrl} with exit code ${code ?? 1}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`));
    });
  });
}

async function main() {
  const summary = await runDiscoveryTargetsSmoke({ stdio: 'pipe' });
  console.log(JSON.stringify({ step: 'discovery-targets.success', ...summary }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(JSON.stringify({ step: 'discovery-targets.failed', message: error.message }, null, 2));
    process.exitCode = 1;
  });
}
