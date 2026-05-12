# Runner 운영 Runbook

목적: Runner가 MQ message를 소비하고 브라우저 실행, artifact/callback, terminal summary를 남기는 운영 경로를 점검·장애 대응하기 위한 절차를 고정한다.

## 1. 배포 전 고정 검증

로컬/CI에서 Runner 변경 후 최소 다음을 실행한다.

```bash
cd apps/runner && npm test
cd apps/runner && npx tsc --noEmit
node --test infra/scripts/real-run-e2e-smoke.test.mjs infra/scripts/real-agent-run-e2e-smoke.test.mjs
```

API callback/idempotency schema를 바꿨다면 추가로 실행한다.

```bash
cd apps/api-server && ./gradlew test --tests com.wedge.run.application.RunnerMessageIdempotencyServiceTest
cd apps/api-server && ./gradlew test --tests com.wedge.run.application.RunnerAgentIdempotencyServiceTest
```

## 2. 운영 기본값

```text
RUNNER_MQ_CONSUMER_ENABLED=true
RUNNER_MQ_PREFETCH=4
RUNNER_AGENT_CONCURRENCY=1
RUNNER_MESSAGE_IDEMPOTENCY_STORE_MODE=api
RUNNER_AGENT_IDEMPOTENCY_STORE_MODE=api
RUNNER_MQ_REQUEUE_ON_FAILURE=false
RUNNER_MQ_MAX_DELIVERY_ATTEMPTS=3
RUNNER_CALLBACK_MODE=http
RUNNER_CALLBACK_BASE_URL=<api-server-base-url>
RUNNER_MQ_CALLBACK_OUTBOX_WORKER_ENABLED=true
RUNNER_MQ_ARTIFACT_OUTBOX_WORKER_ENABLED=true
```

동일 Runner process 재전달은 in-memory promise로, process 재시작 후 재전달은 local artifact record로, 여러 Runner replica 재전달은 API/DB idempotency record로 방어한다.

## 3. Real smoke / E2E 절차

### 3.1 Scenario replay smoke

```bash
WEDGE_SMOKE_API_BASE_URL=http://localhost:8080 \
WEDGE_SMOKE_WEB_BASE_URL=http://localhost:5173 \
WEDGE_SMOKE_PROJECT_ID=<project-uuid> \
WEDGE_SMOKE_SCENARIO_TEMPLATE_VERSION_ID=<template-version-uuid> \
WEDGE_SMOKE_TARGET_URL=https://example.com/ \
WEDGE_SMOKE_EXPECTED_STATUS=COMPLETED \
node infra/scripts/real-run-e2e-smoke.mjs
```

성공 기준:
- run status가 `COMPLETED`에 도달한다.
- evidence packet에 checkpoint가 1개 이상 존재한다.
- smoke output의 `monitorUrl`로 UI에서 run을 열 수 있다.

### 3.2 Agent runtime smoke

```bash
WEDGE_SMOKE_API_BASE_URL=http://localhost:8080 \
WEDGE_SMOKE_WEB_BASE_URL=http://localhost:5173 \
WEDGE_SMOKE_PROJECT_ID=<project-uuid> \
WEDGE_SMOKE_TARGET_URL=https://example.com/ \
WEDGE_SMOKE_EXPECTED_STATUS=COMPLETED \
node infra/scripts/real-agent-run-e2e-smoke.mjs
```

성공 기준:
- run status가 `COMPLETED`에 도달한다.
- agent trace artifact 또는 `AGENT_TRACE_PERSISTED` event가 조회된다.

실패 재현 smoke를 실행할 때는 `WEDGE_SMOKE_EXPECTED_STATUS=FAILED`를 명시하고, terminal response에 `failureCode`와 `failureMessage`가 모두 있는지 확인한다.

## 4. 운영 로그 판독 기준

| 이벤트 | 정상/장애 의미 | 즉시 확인할 항목 |
| --- | --- | --- |
| `artifact_manifest` | checkpoint별 artifact 요청/저장/collector 상태 요약 | `storedCount`, `collectorStatus`, `deliveryIssueScopes` |
| `run_finished` | normal finish 또는 stop finish | `terminalOutcome`, `deliveryStatus`, `deliveryIssueScopes` |
| `run_failed` | browser/action/callback fatal 실패 | `failureCode`, `failedStepKey`, `timeoutPhase`, `resultCompleteness` |
| `step_settle_timeout` | settle timeout을 step 완료 상태로 계속 진행 | `timeoutPolicy=continue_with_timeout_settle_status` |
| `duplicate_message_replayed` | idempotency record 기반 재실행 방지 | `idempotencyKey`, `originalRunId` |
| `retry_sequence_exhausted` | callback retry 실패 후 outbox 기록 시도 | `callbackType`, `terminalAction`, `httpStatus` |
| `outbox_record_appended` | callback outbox에 재전송 대상 저장 | outbox worker 활성화 여부 |

## 5. 종료 유형별 대응

- Normal finish: `run_finished.terminalOutcome=COMPLETED`, `deliveryStatus=DELIVERY_COMPLETE`가 기준이다.
- Stop finish: `stop_requested` 후 `run_finished.terminalOutcome=STOPPED`면 정상 중단이다.
- Timeout failure: action timeout은 `RUNNER_TIMEOUT`, `timeoutPhase=action`, `timeoutPolicy=fail_step_and_run`이어야 한다.
- Settle timeout: `step_settle_timeout`과 `STEP_COMPLETED.payload.settle.status=timeout`으로 남고 run 실패로 보지 않는다.
- Browser crash: `RUNNER_BROWSER_CRASH`가 원인 실패이며, crash 이후 screenshot/DOM capture 실패가 원인 실패를 덮으면 안 된다.
- Callback partial failure: `step-events`, `artifact-storage`, `artifacts-callback`, `checkpoints-callback`, `agent-events-callback`, `agent-trace-callback`, `failure-capture`는 `DELIVERY_PARTIAL`이다.
- Finished callback failure: 실행 결과는 보존하지만 `deliveryStatus=DELIVERY_FAILED`로 본다.

## 6. 빠른 복구 체크리스트

1. MQ queue에 poison message가 반복되는지 확인한다. `RUNNER_MQ_MAX_DELIVERY_ATTEMPTS` 이상이면 requeue 없이 reject되어야 한다.
2. callback 실패면 outbox file과 replay worker 활성화 여부를 먼저 본다.
3. idempotency 중복이면 API `/internal/runner/message-idempotency/{scope}/{sha256}` 또는 agent idempotency record를 확인한다.
4. artifact 누락이면 `artifact_manifest`의 `requestedTypes`, `storedTypes`, `collectorStatus`를 비교한다.
5. browser crash/timeout이면 `failureCode`, `timeoutPhase`, `browser_health` observation을 함께 본다.
