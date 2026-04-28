import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SMOKE_PROJECT_ID,
  SMOKE_SCENARIO_TEMPLATE_VERSION_ID,
  buildEnvLines,
  buildSeedSql,
  readConfig,
} from './seed-real-run-smoke.mjs';

test('seed script exposes stable smoke ids for .env reuse', () => {
  assert.match(SMOKE_PROJECT_ID, /^[0-9a-f-]{36}$/);
  assert.match(SMOKE_SCENARIO_TEMPLATE_VERSION_ID, /^[0-9a-f-]{36}$/);
  assert.deepEqual(buildEnvLines(), [
    `WEDGE_SMOKE_PROJECT_ID=${SMOKE_PROJECT_ID}`,
    `WEDGE_SMOKE_SCENARIO_TEMPLATE_VERSION_ID=${SMOKE_SCENARIO_TEMPLATE_VERSION_ID}`,
  ]);
});

test('seed script builds idempotent workspace/project/scenario SQL', () => {
  const sql = buildSeedSql({ targetUrl: 'https://example.com/' });

  assert.match(sql, /INSERT INTO workspace/);
  assert.match(sql, /INSERT INTO project/);
  assert.match(sql, /INSERT INTO scenario_template/);
  assert.match(sql, /INSERT INTO scenario_template_version/);
  assert.match(sql, /ON CONFLICT \(id\) DO UPDATE/);
  assert.match(sql, new RegExp(SMOKE_PROJECT_ID));
  assert.match(sql, new RegExp(SMOKE_SCENARIO_TEMPLATE_VERSION_ID));
  assert.match(sql, /landing-cta/);
});

test('seed script reads docker postgres settings from dev env names', () => {
  const config = readConfig({
    WEDGE_SMOKE_DB_CONTAINER: 'custom-postgres',
    POSTGRES_USER: 'dev-user',
    POSTGRES_DB: 'dev-db',
    WEDGE_SMOKE_TARGET_URL: 'https://wedge.example/',
  });

  assert.equal(config.dbContainer, 'custom-postgres');
  assert.equal(config.dbUser, 'dev-user');
  assert.equal(config.dbName, 'dev-db');
  assert.equal(config.targetUrl, 'https://wedge.example/');
});

test('seed script falls back when .env contains blank docker settings', () => {
  const config = readConfig({
    WEDGE_SMOKE_DB_CONTAINER: '',
    POSTGRES_USER: '',
    POSTGRES_DB: '',
    WEDGE_SMOKE_TARGET_URL: '',
  });

  assert.equal(config.dbContainer, 'wedge-postgres-dev');
  assert.equal(config.dbUser, 'ssafy');
  assert.equal(config.dbName, 'wedge_dev');
  assert.equal(config.targetUrl, 'https://example.com/');
});
