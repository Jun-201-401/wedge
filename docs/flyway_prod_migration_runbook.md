# Flyway Production Migration Runbook

## Purpose

This document defines the safe first-run procedure for introducing Flyway to an existing Wedge production database.

The production database already has application tables. Flyway must not assume that the database is empty. Therefore, the first production rollout requires a one-time baseline before normal `migrate` runs.

## Current Policy

- Flyway runs as a separate Docker Compose service.
- Flyway is not started by the normal production `up -d` command.
- Production migrations must be executed explicitly through the `migration` profile.
- `clean` is disabled in Compose and must not be enabled for production.
- `baselineOnMigrate` stays disabled. Production baseline must be an explicit operator action.

## Commands

Run all commands from the repository root on the production host.

Check Flyway and database state:

```bash
docker compose --env-file .env.prod -f compose.prod.yaml --profile migration run --rm flyway info
```

Apply pending migrations after baseline is complete:

```bash
docker compose --env-file .env.prod -f compose.prod.yaml --profile migration run --rm flyway migrate
```

## First Production Baseline

Use this procedure only once for an existing production database that already has schema objects but does not yet have `flyway_schema_history`.

1. Stop feature deployment work that may change the database.
2. Back up the production database.
3. Confirm which migration version is already represented by the current production schema.
4. Run `flyway info`.
5. Run explicit `flyway baseline` with the confirmed version.
6. Run `flyway info` again.
7. Run `flyway migrate` only if the pending migrations are expected.

Backup example:

```bash
mkdir -p backups/postgres
docker compose --env-file .env.prod -f compose.prod.yaml exec -T postgres sh -lc 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > backups/postgres/wedge-prod-before-flyway-$(date -u +%Y%m%dT%H%M%SZ).dump
```

Baseline example:

```bash
docker compose --env-file .env.prod -f compose.prod.yaml --profile migration run --rm flyway -baselineVersion=20260510 -baselineDescription=existing-prod-schema-before-flyway baseline
```

`20260510` is only an example. Do not copy it blindly. Use the highest migration version that is already fully reflected in the current production schema.

## Safety Rules

- Do not run `migrate` on an existing production DB before the first baseline.
- Do not use `baselineOnMigrate=true` for production.
- Do not run `clean` in production.
- Do not edit an already-applied migration file. Add a new migration instead.
- Do not run `repair` to hide a failed migration. Use `repair` only after the cause is understood and the database state has been verified.

## Expected Steady State

After the one-time baseline, normal production releases should run:

```text
flyway info
flyway migrate
application deploy
```

If `migrate` fails, stop the deployment and inspect the failed migration before starting application containers that depend on the new schema.

## Jenkins Gate

The Jenkins pipeline includes a `RUN_DB_MIGRATION` boolean parameter.

- Default value: `false`
- Before production baseline: keep it `false`
- After production baseline: set it to `true` only for deployments that should run Flyway

When `RUN_DB_MIGRATION=true`, Jenkins runs:

```text
flyway info
flyway migrate
application deploy
```

When `RUN_DB_MIGRATION=false`, Jenkins skips the `Database Migration` stage and continues the normal application deploy.
