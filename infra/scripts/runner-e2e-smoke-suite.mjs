#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '../..');

const STEP_DEFINITIONS = Object.freeze({
  discovery: {
    label: 'Runner Discovery local smoke',
    script: 'infra/scripts/real-discovery-smoke.mjs',
    requiresApi: false,
  },
  scenario: {
    label: 'Runner Scenario replay real E2E smoke',
    script: 'infra/scripts/real-run-e2e-smoke.mjs',
    requiresApi: true,
  },
  agent: {
    label: 'Runner Agent runtime real E2E smoke',
    script: 'infra/scripts/real-agent-run-e2e-smoke.mjs',
    requiresApi: true,
  },
});

const DEFAULT_STEP_ORDER = Object.freeze(['discovery', 'scenario', 'agent']);

export function buildRunnerSmokeSuitePlan({ env = process.env, root = repoRoot } = {}) {
  const stepNames = readStepNames(env.WEDGE_RUNNER_SMOKE_SUITE_STEPS);
  return stepNames.map((name) => {
    const definition = STEP_DEFINITIONS[name];
    if (!definition) {
      throw new Error(`Unsupported WEDGE_RUNNER_SMOKE_SUITE_STEPS entry: ${name}`);
    }

    return {
      name,
      label: definition.label,
      requiresApi: definition.requiresApi,
      command: process.execPath,
      args: [join(root, definition.script)],
      cwd: root,
    };
  });
}

export async function runRunnerSmokeSuite({ env = process.env, root = repoRoot, stdio = 'inherit' } = {}) {
  const plan = buildRunnerSmokeSuitePlan({ env, root });
  const results = [];

  for (const step of plan) {
    const startedAt = Date.now();
    console.log(JSON.stringify({ step: 'suite.step.start', name: step.name, label: step.label }));
    const code = await runStep(step, env, stdio);
    const durationMs = Date.now() - startedAt;
    results.push({ name: step.name, code, durationMs });

    if (code !== 0) {
      throw new Error(`Runner E2E smoke suite failed at ${step.name} with exit code ${code}`);
    }

    console.log(JSON.stringify({ step: 'suite.step.done', name: step.name, durationMs }));
  }

  return results;
}

function readStepNames(value) {
  if (!value || String(value).trim().length === 0) {
    return [...DEFAULT_STEP_ORDER];
  }

  const names = String(value)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  return names.length > 0 ? names : [...DEFAULT_STEP_ORDER];
}

function runStep(step, env, stdio) {
  return new Promise((resolveExit) => {
    const child = spawn(step.command, step.args, {
      cwd: step.cwd,
      env: {
        ...env,
        WEDGE_RUNNER_SMOKE_SUITE_STEP: step.name,
      },
      stdio,
    });

    child.once('exit', (code) => {
      resolveExit(code ?? 1);
    });
  });
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
  const results = await runRunnerSmokeSuite();
  console.log(JSON.stringify({ step: 'suite.success', results }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(JSON.stringify({ step: 'suite.failed', message: error.message }, null, 2));
    process.exitCode = 1;
  });
}
