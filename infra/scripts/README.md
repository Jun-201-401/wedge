# Infra Smoke Scripts

Runner 운영 smoke 고정 스크립트 모음이다.

## Production compose wrapper

```bash
bash infra/scripts/prod-compose.sh ps
```

`prod-compose.sh`는 `.env.prod`와 Jenkins가 검증 후 승격한 `.deploy/current.env`를 함께 사용한다.
운영에서 수동으로 app 서비스를 재기동할 때도 이 wrapper를 사용해야 Jenkins가 검증한 이미지 태그가 유지된다.

## Unit-level script checks

```bash
node --test infra/scripts/real-run-e2e-smoke.test.mjs infra/scripts/real-agent-run-e2e-smoke.test.mjs
```

## Real E2E smoke

전체 Runner smoke gate는 Discovery(local fixture), Scenario replay(real API/MQ), Agent runtime(real API/MQ)을 순서대로 실행한다. Runner 변경 후 배포 전에는 이 단일 명령을 기본으로 사용한다.

```bash
node infra/scripts/runner-e2e-smoke-suite.mjs
# 또는 apps/runner 기준
cd apps/runner && npm run smoke:e2e
```

`WEDGE_RUNNER_SMOKE_SUITE_STEPS=discovery,scenario,agent`로 실행 순서/범위를 좁힐 수 있다. `scenario`와 `agent` 단계는 API server, RabbitMQ consumer Runner, DB migration, callback base URL이 준비된 환경이 필요하다.

Scenario replay:

```bash
node infra/scripts/real-run-e2e-smoke.mjs
```

Agent runtime:

```bash
node infra/scripts/real-agent-run-e2e-smoke.mjs
```

Agent product/checkout runtime:

```bash
node infra/scripts/real-agent-product-checkout-smoke.mjs
```

Agent trace export replay runtime:

```bash
node infra/scripts/real-agent-trace-export-replay-smoke.mjs
```

Discovery → Scenario Authoring → Run chain:

```bash
node infra/scripts/real-discovery-authoring-run-e2e-smoke.mjs
```

필수/주요 환경변수는 `docs/runner_operational_runbook.md`를 따른다. 실제 smoke는 API server, RabbitMQ consumer Runner, DB migration, callback base URL이 준비된 환경에서만 실행한다.
