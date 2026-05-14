# Runner 운영 Runbook

목적: Runner가 MQ message를 소비하고 브라우저 실행, artifact/callback, terminal summary를 남기는 운영 경로를 점검·장애 대응하기 위한 절차를 고정한다.

## 1. 배포 전 고정 검증

로컬/CI에서 Runner 변경 후 최소 다음을 실행한다.

```bash
cd apps/runner && npm test
cd apps/runner && npx tsc --noEmit
node --test infra/scripts/runner-e2e-smoke-suite.test.mjs infra/scripts/real-run-e2e-smoke.test.mjs infra/scripts/real-agent-run-e2e-smoke.test.mjs
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
RUNNER_AGENT_IDEMPOTENCY_LEASE_TTL_MS=300000
RUNNER_AGENT_IDEMPOTENCY_RENEW_INTERVAL_MS=60000
RUNNER_MQ_REQUEUE_ON_FAILURE=false
RUNNER_MQ_MAX_DELIVERY_ATTEMPTS=3
RUNNER_CALLBACK_MODE=http
RUNNER_CALLBACK_BASE_URL=<api-server-base-url>
RUNNER_MQ_CALLBACK_OUTBOX_WORKER_ENABLED=true
RUNNER_MQ_ARTIFACT_OUTBOX_WORKER_ENABLED=true
```

동일 Runner process 재전달은 in-memory promise로, process 재시작 후 재전달은 local artifact record로, 여러 Runner replica 재전달은 API/DB idempotency record로 방어한다.

Agent API idempotency lease는 운영 기본값으로 5분 TTL, 60초 renewal을 사용한다. Renewal interval은 lease TTL의 1/3 이하로 유지해야 하며 Runner는 더 큰 값을 자동으로 clamp한다. Agent 실행 시간이 더 긴 환경에서는 TTL을 먼저 늘리고, renewal 실패 로그(`idempotency_lease_renew_failed`)가 반복되면 API callback 경로/서명/네트워크를 확인한다. Runner crash 이후 중복 재실행 허용 대기시간은 최대 lease TTL에 비례하므로 TTL을 무작정 늘리지 않는다.

## 3. Real smoke / E2E 절차

### 3.0 Runner smoke suite gate

Runner 변경 후 배포 전 기본 smoke gate는 아래 단일 명령이다. Discovery local fixture smoke를 먼저 실행한 뒤, 실제 API/MQ 기반 Scenario replay와 Agent runtime smoke를 순서대로 실행한다.

```bash
node infra/scripts/runner-e2e-smoke-suite.mjs
# apps/runner 기준
cd apps/runner && npm run smoke:e2e
```

부분 실행이 필요하면 `WEDGE_RUNNER_SMOKE_SUITE_STEPS=discovery,scenario,agent` 값을 쉼표로 지정한다. `scenario`와 `agent` 단계는 API server, RabbitMQ consumer Runner, DB migration, callback base URL, smoke project/template seed가 준비되어 있어야 한다.

실제 사이트 Discovery 회귀만 반복 확인하려면 별도 target sweep smoke를 실행한다. 이 smoke는 API server 없이 Runner local message-file 경로로 동작하며, 기본 대상은 운영 안정화에 사용한 `https://www.mgdj.co.kr/`, `https://www.jinjood.com/`, `http://hanaro.mrpage.kr/` 세 곳이다.

```bash
# repo root 기준
node infra/scripts/real-discovery-targets-smoke.mjs

# apps/runner 기준
cd apps/runner && npm run smoke:discovery-targets
```

대상을 바꾸거나 일부 사이트 장애를 summary로만 남기려면 다음 환경변수를 사용한다.

```bash
WEDGE_DISCOVERY_SMOKE_TARGET_URLS=https://www.mgdj.co.kr/,https://www.jinjood.com/ \
WEDGE_DISCOVERY_TARGET_SMOKE_ALLOW_PARTIAL=true \
WEDGE_DISCOVERY_TARGET_SMOKE_ARTIFACTS_ROOT=/tmp/wedge-discovery-targets \
node infra/scripts/real-discovery-targets-smoke.mjs
```

성공 기준:
- 각 target이 `site-discovery-result.json`을 생성한다.
- `recommendation_level`이 `NOT_AVAILABLE`이 아닌 실행 가능한 recommendation이 1개 이상 생성된다.
- checkout 추천은 배송/마감/혜택 안내 문구가 아니라 장바구니/구매/결제 같은 실제 action 진입점으로 잡힌다.
- 이미지 alt 기반 링크는 `selector`/`href_contains`가 부모 링크를 가리켜야 하며, 로그인 페이지가 나오면 그 지점은 마찰로 기록하고 로그인 뒤는 탐색하지 않는다.

기본 suite에 실제 외부 URL을 넣지 않는 이유는 외부 사이트 가용성·네트워크·WAF 정책에 따라 CI가 흔들릴 수 있기 때문이다. 배포 전 수동 gate 또는 야간 smoke에서 `WEDGE_RUNNER_SMOKE_SUITE_STEPS=discovery-targets`로 편입한다.

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
