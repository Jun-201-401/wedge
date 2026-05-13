import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPsqlArgs,
  compareMigrationFileNames,
  listMigrationFiles,
  readConfig,
} from './apply-dev-db-migrations.mjs';

test('dev migration script reads docker database settings', () => {
  const config = readConfig({
    WEDGE_DEV_DB_CONTAINER: 'custom-db',
    WEDGE_DEV_DB_USER: 'custom-user',
    WEDGE_DEV_DB_NAME: 'custom-name',
    WEDGE_DEV_DB_MIGRATIONS_DIR: 'custom/migrations',
  });

  assert.deepEqual(config, {
    dbContainer: 'custom-db',
    dbUser: 'custom-user',
    dbName: 'custom-name',
    migrationsDir: 'custom/migrations',
  });
});

test('dev migration script falls back to smoke and compose defaults', () => {
  const config = readConfig({
    WEDGE_DEV_DB_CONTAINER: '',
    WEDGE_SMOKE_DB_CONTAINER: 'smoke-db',
    WEDGE_SMOKE_DB_USER: 'smoke-user',
    POSTGRES_DB: 'compose-db',
  });

  assert.equal(config.dbContainer, 'smoke-db');
  assert.equal(config.dbUser, 'smoke-user');
  assert.equal(config.dbName, 'compose-db');
  assert.equal(config.migrationsDir, 'infra/db/migrations');
});

test('dev migration script builds docker psql args', () => {
  assert.deepEqual(buildPsqlArgs({ dbContainer: 'db', dbUser: 'user', dbName: 'name' }), [
    'exec',
    '-i',
    'db',
    'psql',
    '-U',
    'user',
    '-d',
    'name',
    '-v',
    'ON_ERROR_STOP=1',
  ]);
});

test('dev migration script lists checked-in sql migrations in order', () => {
  const files = listMigrationFiles();
  const fileNames = files.map((file) => file.split(/[\\/]/).at(-1));

  assert.ok(files.length >= 3);
  assert.ok(files.some((file) => file.endsWith('V20260430_01__add_evidence_packet_snapshots.sql')));
  assert.ok(files.some((file) => file.endsWith('V20260430__add_report_analysis_unique_index.sql')));
  assert.ok(
    fileNames.indexOf('V20260430__add_report_analysis_unique_index.sql')
      < fileNames.indexOf('V20260430_01__add_evidence_packet_snapshots.sql'),
  );
  assert.ok(
    fileNames.indexOf('V20260506__add_outbox_runtime_tables.sql')
      < fileNames.indexOf('V20260506_01__add_scenario_authoring_jobs.sql'),
  );
  assert.ok(
    fileNames.indexOf('V20260508__add_site_discovery_idempotency_key.sql')
      < fileNames.indexOf('V20260508_01__allow_agent_run_without_scenario_template.sql'),
  );
});

test('dev migration script compares Flyway-style version segments', () => {
  const files = [
    'V20260508_02__add_agent_idempotency_records.sql',
    'V20260508__add_site_discovery_idempotency_key.sql',
    'V20260508_01__allow_agent_run_without_scenario_template.sql',
    'V20260508_10__future.sql',
    'V20260508_03__add_agent_idempotency_leases.sql',
  ];

  assert.deepEqual(files.sort(compareMigrationFileNames), [
    'V20260508__add_site_discovery_idempotency_key.sql',
    'V20260508_01__allow_agent_run_without_scenario_template.sql',
    'V20260508_02__add_agent_idempotency_records.sql',
    'V20260508_03__add_agent_idempotency_leases.sql',
    'V20260508_10__future.sql',
  ]);
});
