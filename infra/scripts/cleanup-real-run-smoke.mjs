#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import {
  DEFAULT_SMOKE_EMAIL,
  SMOKE_PROJECT_ID,
  SMOKE_SCENARIO_TEMPLATE_ID,
  SMOKE_SCENARIO_TEMPLATE_VERSION_ID,
  SMOKE_WORKSPACE_ID,
} from './seed-real-run-smoke.mjs';

const DEFAULT_DB_CONTAINER = 'wedge-postgres-dev';
const DEFAULT_DB_USER = 'ssafy';
const DEFAULT_DB_NAME = 'wedge_dev';

const CONFIRM_FLAG = '--confirm';

export function readConfig(env = process.env) {
  return {
    dbContainer: firstNonEmpty(env.WEDGE_SMOKE_DB_CONTAINER, DEFAULT_DB_CONTAINER),
    dbUser: firstNonEmpty(env.WEDGE_SMOKE_DB_USER, env.POSTGRES_USER, DEFAULT_DB_USER),
    dbName: firstNonEmpty(env.WEDGE_SMOKE_DB_NAME, env.POSTGRES_DB, DEFAULT_DB_NAME),
    smokeUserEmail: firstNonEmpty(env.WEDGE_SMOKE_EMAIL, DEFAULT_SMOKE_EMAIL),
  };
}

export function buildCleanupSql({ confirm = false, smokeUserEmail = DEFAULT_SMOKE_EMAIL } = {}) {
  const escapedSmokeUserEmail = sqlString(smokeUserEmail);
  return `
BEGIN;

CREATE TEMP TABLE smoke_workspace_ids ON COMMIT DROP AS
SELECT id
FROM workspace
WHERE id = '${SMOKE_WORKSPACE_ID}'
  AND slug = 'wedge-smoke';

CREATE TEMP TABLE smoke_project_ids ON COMMIT DROP AS
SELECT p.id
FROM project p
JOIN smoke_workspace_ids sw ON sw.id = p.workspace_id
WHERE p.id = '${SMOKE_PROJECT_ID}'
  AND p.project_key = 'wedge-smoke';

CREATE TEMP TABLE smoke_scenario_template_ids ON COMMIT DROP AS
SELECT id
FROM scenario_template
WHERE id = '${SMOKE_SCENARIO_TEMPLATE_ID}'
  AND template_key = 'landing-cta';

CREATE TEMP TABLE smoke_scenario_template_version_ids ON COMMIT DROP AS
SELECT stv.id
FROM scenario_template_version stv
JOIN smoke_scenario_template_ids st ON st.id = stv.template_id
WHERE stv.id = '${SMOKE_SCENARIO_TEMPLATE_VERSION_ID}';

CREATE TEMP TABLE smoke_run_ids ON COMMIT DROP AS
SELECT tr.id
FROM test_run tr
JOIN smoke_project_ids sp ON sp.id = tr.project_id;

CREATE TEMP TABLE smoke_discovery_ids ON COMMIT DROP AS
SELECT sd.id
FROM site_discovery sd
JOIN smoke_project_ids sp ON sp.id = sd.project_id;

CREATE TEMP TABLE smoke_analysis_job_ids ON COMMIT DROP AS
SELECT aj.id
FROM analysis_job aj
JOIN smoke_run_ids sr ON sr.id = aj.run_id;

CREATE TEMP TABLE smoke_report_ids ON COMMIT DROP AS
SELECT r.id
FROM report r
JOIN smoke_run_ids sr ON sr.id = r.run_id;

CREATE TEMP TABLE smoke_evidence_packet_ids ON COMMIT DROP AS
SELECT ep.id
FROM evidence_packet ep
WHERE ep.run_id IN (SELECT id FROM smoke_run_ids)
   OR ep.discovery_id IN (SELECT id FROM smoke_discovery_ids);

CREATE TEMP TABLE smoke_artifact_ids ON COMMIT DROP AS
SELECT a.id
FROM artifact a
WHERE a.run_id IN (SELECT id FROM smoke_run_ids)
   OR a.discovery_id IN (SELECT id FROM smoke_discovery_ids);

CREATE TEMP TABLE smoke_checkpoint_ids ON COMMIT DROP AS
SELECT c.id
FROM checkpoint c
WHERE c.run_id IN (SELECT id FROM smoke_run_ids)
   OR c.discovery_id IN (SELECT id FROM smoke_discovery_ids);

SELECT
  ${confirm ? "'confirm'" : "'dry-run'"} AS cleanup_mode,
  (SELECT COUNT(*) FROM smoke_workspace_ids) AS workspace_count,
  (SELECT COUNT(*) FROM smoke_project_ids) AS project_count,
  (SELECT COUNT(*) FROM smoke_scenario_template_ids) AS scenario_template_count,
  (SELECT COUNT(*) FROM smoke_scenario_template_version_ids) AS scenario_template_version_count,
  (SELECT COUNT(*) FROM smoke_discovery_ids) AS discovery_count,
  (SELECT COUNT(*) FROM smoke_run_ids) AS run_count,
  (SELECT COUNT(*) FROM smoke_analysis_job_ids) AS analysis_job_count,
  (SELECT COUNT(*) FROM smoke_report_ids) AS report_count,
  (SELECT COUNT(*) FROM smoke_evidence_packet_ids) AS evidence_packet_count,
  (SELECT COUNT(*) FROM smoke_artifact_ids) AS artifact_count,
  (SELECT COUNT(*) FROM smoke_checkpoint_ids) AS checkpoint_count,
  (
    SELECT COUNT(*)
    FROM user_account
    WHERE email = ${escapedSmokeUserEmail}
  ) AS smoke_user_count;

${confirm ? buildDeleteSql(escapedSmokeUserEmail) : ''}

COMMIT;
`.trimStart();
}

function buildDeleteSql(escapedSmokeUserEmail) {
  return `
UPDATE agent_client_policy
SET default_project_id = NULL,
    updated_at = NOW()
WHERE default_project_id IN (SELECT id FROM smoke_project_ids);

DELETE FROM mcp_invocation_log
WHERE project_id IN (SELECT id FROM smoke_project_ids);

DELETE FROM outbox_message
WHERE aggregate_id IN (
  SELECT id FROM smoke_project_ids
  UNION SELECT id FROM smoke_discovery_ids
  UNION SELECT id FROM smoke_run_ids
  UNION SELECT id FROM smoke_analysis_job_ids
  UNION SELECT id FROM smoke_evidence_packet_ids
);

DELETE FROM report_share
WHERE report_id IN (SELECT id FROM smoke_report_ids);

DELETE FROM report
WHERE id IN (SELECT id FROM smoke_report_ids);

DELETE FROM nudge
WHERE analysis_job_id IN (SELECT id FROM smoke_analysis_job_ids);

DELETE FROM analysis_finding
WHERE analysis_job_id IN (SELECT id FROM smoke_analysis_job_ids);

DELETE FROM rule_hit
WHERE analysis_job_id IN (SELECT id FROM smoke_analysis_job_ids);

DELETE FROM analysis_job
WHERE id IN (SELECT id FROM smoke_analysis_job_ids);

DELETE FROM observation
WHERE checkpoint_id IN (SELECT id FROM smoke_checkpoint_ids)
   OR run_id IN (SELECT id FROM smoke_run_ids)
   OR discovery_id IN (SELECT id FROM smoke_discovery_ids);

DELETE FROM evidence_packet
WHERE id IN (SELECT id FROM smoke_evidence_packet_ids);

DELETE FROM checkpoint
WHERE id IN (SELECT id FROM smoke_checkpoint_ids);

DELETE FROM artifact
WHERE id IN (SELECT id FROM smoke_artifact_ids);

DELETE FROM test_run_event
WHERE run_id IN (SELECT id FROM smoke_run_ids);

DELETE FROM test_run_step
WHERE run_id IN (SELECT id FROM smoke_run_ids);

DELETE FROM test_run
WHERE id IN (SELECT id FROM smoke_run_ids);

DELETE FROM scenario_recommendation
WHERE discovery_id IN (SELECT id FROM smoke_discovery_ids);

DELETE FROM site_discovery
WHERE id IN (SELECT id FROM smoke_discovery_ids);

DELETE FROM project_member
WHERE project_id IN (SELECT id FROM smoke_project_ids);

DELETE FROM workspace_member
WHERE workspace_id IN (SELECT id FROM smoke_workspace_ids)
  AND user_id IN (
    SELECT id
    FROM user_account
    WHERE email = ${escapedSmokeUserEmail}
  );

DELETE FROM project
WHERE id IN (SELECT id FROM smoke_project_ids);

DELETE FROM scenario_template_version
WHERE id IN (SELECT id FROM smoke_scenario_template_version_ids);

DELETE FROM scenario_template
WHERE id IN (SELECT id FROM smoke_scenario_template_ids);

DELETE FROM workspace
WHERE id IN (SELECT id FROM smoke_workspace_ids)
  AND NOT EXISTS (
    SELECT 1
    FROM project p
    WHERE p.workspace_id IN (SELECT id FROM smoke_workspace_ids)
  )
  AND NOT EXISTS (
    SELECT 1
    FROM workspace_member wm
    WHERE wm.workspace_id IN (SELECT id FROM smoke_workspace_ids)
  );

SELECT
  'deleted' AS cleanup_result,
  (SELECT COUNT(*) FROM project WHERE id = '${SMOKE_PROJECT_ID}') AS remaining_project_count,
  (SELECT COUNT(*) FROM scenario_template_version WHERE id = '${SMOKE_SCENARIO_TEMPLATE_VERSION_ID}') AS remaining_scenario_template_version_count,
  (SELECT COUNT(*) FROM test_run WHERE project_id = '${SMOKE_PROJECT_ID}') AS remaining_run_count;
`;
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

function printUsage() {
  console.log(`Usage:
  node infra/scripts/cleanup-real-run-smoke.mjs
  node infra/scripts/cleanup-real-run-smoke.mjs --confirm

Default mode is dry-run. Add --confirm to delete smoke data.`);
}

function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help') || argv.includes('-h')) {
    printUsage();
    return;
  }

  loadDotEnv();
  const confirm = argv.includes(CONFIRM_FLAG);
  const config = readConfig();
  const sql = buildCleanupSql({ confirm, smokeUserEmail: config.smokeUserEmail });
  const output = runPsql(config, sql);

  console.log(output.trim());
  if (!confirm) {
    console.log(`\nDry-run only. Re-run with ${CONFIRM_FLAG} to delete the smoke data shown above.`);
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
