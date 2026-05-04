#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const DEFAULT_DB_CONTAINER = 'wedge-postgres-dev';
const DEFAULT_DB_USER = 'ssafy';
const DEFAULT_DB_NAME = 'wedge_dev';
const DEFAULT_MIGRATIONS_DIR = 'infra/db/migrations';

export function readConfig(env = process.env) {
  return {
    dbContainer: firstNonEmpty(env.WEDGE_DEV_DB_CONTAINER, env.WEDGE_SMOKE_DB_CONTAINER, DEFAULT_DB_CONTAINER),
    dbUser: firstNonEmpty(env.WEDGE_DEV_DB_USER, env.WEDGE_SMOKE_DB_USER, env.POSTGRES_USER, DEFAULT_DB_USER),
    dbName: firstNonEmpty(env.WEDGE_DEV_DB_NAME, env.WEDGE_SMOKE_DB_NAME, env.POSTGRES_DB, DEFAULT_DB_NAME),
    migrationsDir: firstNonEmpty(env.WEDGE_DEV_DB_MIGRATIONS_DIR, DEFAULT_MIGRATIONS_DIR),
  };
}

export function listMigrationFiles(migrationsDir = DEFAULT_MIGRATIONS_DIR) {
  const absoluteDir = resolve(process.cwd(), migrationsDir);
  return readdirSync(absoluteDir)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .map((file) => resolve(absoluteDir, file));
}

export function buildPsqlArgs(config) {
  return [
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
  ];
}

function runPsql(config, sql) {
  const result = spawnSync('docker', buildPsqlArgs(config), {
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

function firstNonEmpty(...values) {
  return values.find((value) => typeof value === 'string' && value.trim() !== '') ?? '';
}

function main() {
  loadDotEnv();
  const config = readConfig();
  const files = listMigrationFiles(config.migrationsDir);

  for (const file of files) {
    const sql = readFileSync(file, 'utf8');
    runPsql(config, sql);
    console.log(JSON.stringify({ step: 'migration.applied', file }));
  }

  console.log(JSON.stringify({ step: 'complete', migrationCount: files.length }));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(JSON.stringify({ step: 'failed', message: error.message }, null, 2));
    process.exitCode = 1;
  }
}
