# Infra Smoke Scripts

Runner 운영 smoke 고정 스크립트 모음이다.

## Unit-level script checks

```bash
node --test infra/scripts/real-run-e2e-smoke.test.mjs infra/scripts/real-agent-run-e2e-smoke.test.mjs
```

## Real E2E smoke

Scenario replay:

```bash
node infra/scripts/real-run-e2e-smoke.mjs
```

Agent runtime:

```bash
node infra/scripts/real-agent-run-e2e-smoke.mjs
```

필수/주요 환경변수는 `docs/runner_operational_runbook.md`를 따른다. 실제 smoke는 API server, RabbitMQ consumer Runner, DB migration, callback base URL이 준비된 환경에서만 실행한다.
