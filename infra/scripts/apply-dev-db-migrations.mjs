#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, resolve } from 'node:path';
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
    .sort(compareMigrationFileNames)
    .map((file) => resolve(absoluteDir, file));
}

export function compareMigrationFileNames(left, right) {
  const leftName = basename(left);
  const rightName = basename(right);
  const leftMigration = parseMigrationFileName(leftName);
  const rightMigration = parseMigrationFileName(rightName);

  if (!leftMigration || !rightMigration) {
    return leftName.localeCompare(rightName);
  }

  const versionDelta = compareVersionSegments(leftMigration.versionSegments, rightMigration.versionSegments);
  if (versionDelta !== 0) {
    return versionDelta;
  }

  return leftMigration.description.localeCompare(rightMigration.description);
}

function parseMigrationFileName(fileName) {
  const match = /^V(.+)__(.+)\.sql$/u.exec(fileName);
  if (!match) {
    return null;
  }

  return {
    versionSegments: match[1].split(/[._-]/u).map(parseVersionSegment),
    description: match[2],
  };
}

function parseVersionSegment(segment) {
  return /^\d+$/u.test(segment)
    ? { type: 'number', value: BigInt(segment) }
    : { type: 'text', value: segment };
}

function compareVersionSegments(left, right) {
  const maxLength = Math.max(left.length, right.length);
  for (let index = 0; index < maxLength; index += 1) {
    const leftSegment = left[index];
    const rightSegment = right[index];

    if (!leftSegment) {
      return -1;
    }

    if (!rightSegment) {
      return 1;
    }

    const segmentDelta = compareVersionSegment(leftSegment, rightSegment);
    if (segmentDelta !== 0) {
      return segmentDelta;
    }
  }

  return 0;
}

function compareVersionSegment(left, right) {
  if (left.type === 'number' && right.type === 'number') {
    if (left.value < right.value) {
      return -1;
    }

    if (left.value > right.value) {
      return 1;
    }

    return 0;
  }

  if (left.type !== right.type) {
    return left.type === 'number' ? -1 : 1;
  }

  return left.value.localeCompare(right.value);
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(JSON.stringify({ step: 'failed', message: error.message }, null, 2));
    process.exitCode = 1;
  }
}
