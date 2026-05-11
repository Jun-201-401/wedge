#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { readConfig, runSmoke } from './real-run-e2e-smoke.mjs';

export function readAgentConfig(env = process.env) {
  return {
    ...readConfig({
      ...env,
      WEDGE_SMOKE_EXECUTION_MODE: 'agent',
    }),
    executionMode: 'agent',
    scenarioTemplateVersionId: undefined,
  };
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
  const result = await runSmoke(readAgentConfig());
  console.log(JSON.stringify({ step: 'success', ...result }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(JSON.stringify({ step: 'failed', message: error.message }, null, 2));
    process.exitCode = 1;
  });
}
