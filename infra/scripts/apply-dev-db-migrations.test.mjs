import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPsqlArgs,
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

  assert.ok(files.length >= 3);
  assert.deepEqual([...files].sort(), files);
  assert.ok(files.some((file) => file.endsWith('V20260430_01__add_evidence_packet_snapshots.sql')));
  assert.ok(files.some((file) => file.endsWith('V20260430__add_report_analysis_unique_index.sql')));
});
