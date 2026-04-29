#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const SMOKE_WORKSPACE_ID = '3f3ddc0e-97a9-4dfb-9ec3-064fd5c164b9';
export const SMOKE_PROJECT_ID = '8f06dca8-9c4d-4f20-b1a8-1d5ee40a9923';
export const SMOKE_SCENARIO_TEMPLATE_ID = 'ee2283a4-130f-4f6e-8c2d-d9926bb1c6ad';
export const SMOKE_SCENARIO_TEMPLATE_VERSION_ID = '5c5f4c77-0c32-4ab3-9841-2b6f6cc07a40';

const DEFAULT_DB_CONTAINER = 'wedge-postgres-dev';
const DEFAULT_DB_USER = 'ssafy';
const DEFAULT_DB_NAME = 'wedge_dev';

export function buildSeedSql({
  workspaceId = SMOKE_WORKSPACE_ID,
  projectId = SMOKE_PROJECT_ID,
  scenarioTemplateId = SMOKE_SCENARIO_TEMPLATE_ID,
  scenarioTemplateVersionId = SMOKE_SCENARIO_TEMPLATE_VERSION_ID,
  targetUrl = 'https://example.com/',
} = {}) {
  const escapedTargetUrl = sqlString(targetUrl);

  return `
INSERT INTO workspace (id, name, slug)
VALUES ('${workspaceId}', 'Wedge Smoke Workspace', 'wedge-smoke')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  slug = EXCLUDED.slug,
  updated_at = NOW();

INSERT INTO project (id, workspace_id, name, project_key, base_url, description, status)
VALUES (
  '${projectId}',
  '${workspaceId}',
  'Wedge Smoke Project',
  'wedge-smoke',
  ${escapedTargetUrl},
  'Local project seed for real-run E2E smoke checks.',
  'ACTIVE'
)
ON CONFLICT (id) DO UPDATE SET
  workspace_id = EXCLUDED.workspace_id,
  name = EXCLUDED.name,
  project_key = EXCLUDED.project_key,
  base_url = EXCLUDED.base_url,
  description = EXCLUDED.description,
  status = EXCLUDED.status,
  deleted_at = NULL,
  updated_at = NOW();

INSERT INTO scenario_template (id, template_key, name, description, category, status)
VALUES (
  '${scenarioTemplateId}',
  'landing-cta',
  'Landing CTA Smoke',
  'Local scenario template seed used by real-run E2E smoke checks.',
  'conversion',
  'ACTIVE'
)
ON CONFLICT (id) DO UPDATE SET
  template_key = EXCLUDED.template_key,
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  status = EXCLUDED.status,
  updated_at = NOW();

INSERT INTO scenario_template_version (
  id,
  template_id,
  version_label,
  scenario_schema_version,
  definition_jsonb,
  is_default
)
VALUES (
  '${scenarioTemplateVersionId}',
  '${scenarioTemplateId}',
  'smoke-0.5',
  '0.5',
  $json$${JSON.stringify(buildScenarioDefinition(targetUrl), null, 2)}$json$::jsonb,
  TRUE
)
ON CONFLICT (id) DO UPDATE SET
  template_id = EXCLUDED.template_id,
  version_label = EXCLUDED.version_label,
  scenario_schema_version = EXCLUDED.scenario_schema_version,
  definition_jsonb = EXCLUDED.definition_jsonb,
  is_default = EXCLUDED.is_default;

SELECT
  '${projectId}' AS wedge_smoke_project_id,
  '${scenarioTemplateVersionId}' AS wedge_smoke_scenario_template_version_id;
`.trimStart();
}

export function readConfig(env = process.env) {
  return {
    dbContainer: firstNonEmpty(env.WEDGE_SMOKE_DB_CONTAINER, DEFAULT_DB_CONTAINER),
    dbUser: firstNonEmpty(env.WEDGE_SMOKE_DB_USER, env.POSTGRES_USER, DEFAULT_DB_USER),
    dbName: firstNonEmpty(env.WEDGE_SMOKE_DB_NAME, env.POSTGRES_DB, DEFAULT_DB_NAME),
    targetUrl: firstNonEmpty(env.WEDGE_SMOKE_TARGET_URL, 'https://example.com/'),
  };
}

export function buildEnvLines() {
  return [
    `WEDGE_SMOKE_PROJECT_ID=${SMOKE_PROJECT_ID}`,
    `WEDGE_SMOKE_SCENARIO_TEMPLATE_VERSION_ID=${SMOKE_SCENARIO_TEMPLATE_VERSION_ID}`,
  ];
}

function buildScenarioDefinition(targetUrl) {
  return {
    schema_version: '0.5',
    template_key: 'landing-cta',
    default_start_url: targetUrl,
    supported_depths: ['hero-only'],
    steps: [
      { step_id: 'step_001_goto_start_url', stage: 'FIRST_VIEW', action_type: 'goto', checkpoint: true },
      { step_id: 'step_002_checkpoint_landing_cta', stage: 'CTA', action_type: 'checkpoint', checkpoint: true },
    ],
  };
}

function firstNonEmpty(...values) {
  return values.find((value) => typeof value === 'string' && value.trim() !== '') ?? '';
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function runPsql(config, sql) {
  const result = spawnSync('docker', [
    'exec',
    '-i',
    config.dbContainer,
    'psql',
    '-U',
    config.dbUser,
    '-d',
    config.dbName,
    '-v',
    'ON_ERROR_STOP=1',
  ], {
    input: sql,
    encoding: 'utf8',
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `psql exited with status ${result.status}`);
  }

  return result.stdout;
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

function main() {
  loadDotEnv();
  const config = readConfig();
  const sql = buildSeedSql({ targetUrl: config.targetUrl });
  const output = runPsql(config, sql);

  console.log(output.trim());
  console.log('\nAdd or keep these values in .env:');
  for (const line of buildEnvLines()) {
    console.log(line);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(JSON.stringify({ step: 'failed', message: error.message }, null, 2));
    process.exitCode = 1;
  }
}
