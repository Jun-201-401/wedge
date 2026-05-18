---
title: Wedge Runner Architecture & Implementation Decisions
document_type: runner-architecture
status: current-draft
last_updated: 2026-04-21
intended_use:
  - implementation_reference
  - ai_tasking
  - team_share
related_documents:
  - 01_architecture_and_project_structure.md
  - 04_domain_payload_contracts.md
  - ../apps/runner/README.md
  - wedge_runner_agent_execution.md
  - ../packages/contracts/internal/runner-callback.schema.json
  - ../packages/contracts/mq/messages.schema.json
---

# 1. 목적

이 문서는 `apps/runner`의 기술 선택, 모듈 경계, 현재 구현 방향을 기록한다.

목표는 Wedge Runner가 `run.execute.request`를 안정적으로 소비하고, `ScenarioPlan`을 브라우저 실행으로 변환하며, checkpoint/artifact/internal callback 흐름을 유지보수하기 쉽게 만드는 것이다.

단, 사용자-facing 실행 방향은 `docs/wedge_runner_agent_execution.md`의 goal 기반 Runner Agent target design을 따른다. 이 문서의 기존 `ScenarioPlan` executor 설명은 scripted/replay 경로의 현재 baseline으로 유지한다.

이 문서는 `docs/wedge_frontend_architecture.md`와 같은 역할을 runner 영역에서 수행한다. 즉, 세부 구현 코드보다 먼저 “어디에 어떤 책임을 둘지”를 정한다.

# 2. 현재 runner stack

`apps/runner`는 현재 다음 stack을 사용한다.

- Node.js 24+
- TypeScript
- ESM (`"type": "module"`)
- `node --experimental-strip-types` 기반 실행
- Playwright
- `node:test`

현재 working command:

```bash
npm run start -- --message-file examples/run-execute.request.json
npm test
npx tsc --noEmit
```

# 3. 현재 결정 요약

## 3.1 Node + TypeScript + Playwright 기반 유지

결정: runner는 당분간 Node.js + TypeScript + Playwright 조합을 유지한다.

근거:
- 실행 대상이 browser automation이므로 Playwright가 가장 직접적인 runtime adapter다.
- 현재 runner는 UI가 아닌 worker 성격이므로 React-style framework나 server-rendering 결정이 필요 없다.
- `node --experimental-strip-types`를 사용하면 초기 scaffold를 단순하게 유지할 수 있다.

현재 package baseline:

```text
apps/runner/package.json
- start: node --experimental-strip-types src/index.ts
- test: node --experimental-strip-types --test test/**/*.test.ts
- playwright dependency 사용
```

보류:
- build output directory를 만드는 별도 compile step은 아직 도입하지 않는다.
- worker framework나 queue framework를 먼저 들이지 않는다.

## 3.2 Orchestration과 내부 실행 로직 분리

결정: runner도 frontend 문서와 마찬가지로 orchestration과 내부 구현을 분리한다.

현재 패턴:

```text
src/
├─ index.ts
├─ app.ts
├─ config/
├─ messaging/
├─ worker/
├─ scenario/
├─ browser/
├─ capture/
├─ callback/
├─ storage/
└─ shared/
```

규칙:
- `index.ts`는 CLI entrypoint만 담당한다.
- `app.ts`는 config 로딩과 dependency 조립만 담당한다.
- `worker/*`는 run 단위 lifecycle orchestration만 담당한다.
- `scenario/*`는 step loop와 실행 순서를 소유한다.
- `browser/*`는 브라우저 액션/settle/snapshot/capture adapter를 소유한다.
- `capture/*`는 checkpoint/observation/artifact draft 생성 로직을 소유한다.
- `callback/*`, `storage/*`, `messaging/*`는 transport/infrastructure adapter를 소유한다.
- `shared/*`는 contract type과 범용 util만 둔다.
- scenario logic이 callback/storage transport 세부사항을 직접 알지 않게 한다.

## 3.3 Worker는 run lifecycle만 관리한다

결정: run 단위 제어 흐름은 `worker`에 고정한다.

현재 lifecycle:

```text
message load/parse
→ browser session create
→ accepted callback
→ scenario execute
→ finished or failed callback
→ session close
```

규칙:
- accepted 이전 실패와 accepted 이후 실패를 구분한다.
- session이 생성되었다면 실패 시에도 `close()`를 보장한다.
- 실행 결과 요약(`completedStepCount`, `failedStepCount`, `stopped`)은 worker 최종 결과와 finished callback에서 같은 의미를 유지한다.

현재 파일:

```text
src/worker/index.ts
src/worker/callback-policy.ts
```

## 3.4 Scenario executor는 step contract 중심으로 동작한다

결정: runner의 핵심 use-case는 `ScenarioPlan`의 step을 순서대로 실행하는 것이다.

각 step 실행 흐름:

```text
STEP_STARTED event
→ action execute
→ ACTION_EXECUTED event
→ settle
→ snapshot
→ optional checkpoint/artifact emission
→ STEP_COMPLETED event
```

규칙:
- step 식별자는 domain contract의 `step_id`를 기준으로 유지한다.
- operational callback payload에서는 camelCase `stepKey`를 사용하되 의미는 동일해야 한다.
- `stop_when`은 별도 action으로 취급하고, stop 여부는 executor가 아니라 action result를 통해 상위로 전달한다.
- checkpoint 생성 시점은 “의미 있는 상태 전이 이후”를 기본으로 한다.

현재 파일:

```text
src/scenario/executor/index.ts
src/scenario/executor/step-executor.ts
src/scenario/executor/checkpoint-emitter.ts
src/scenario/actions/
```

## 3.5 Browser adapter는 session interface 뒤에 숨긴다

결정: 상위 계층은 Playwright 세부 구현 대신 `BrowserSession` interface에만 의존한다.

현재 interface:

```text
createSession()
execute(action, step)
settle(strategy)
snapshot()
captureArtifacts()
close()
```

규칙:
- `scenario/*`는 Playwright `page`, `locator`, `context`를 직접 다루지 않는다.
- simulated mode와 real Playwright mode는 같은 session interface를 유지한다.
- action handler 추가나 settle 전략 확장은 가능하되, 상위 orchestration 계약은 보존한다.
- browser adapter는 page state를 `snapshot()`으로 표준화해서 상위에 넘긴다.

현재 구현 상태:
- 기본 fallback은 simulated mode다.
- `RUNNER_BROWSER_MODE=playwright`일 때 real Playwright browser/context/page를 사용할 수 있다.
- real mode에서 `goto`, `click`, `fill`, `select`, `hover`, `wait_for`, screenshot, DOM snapshot이 연결되어 있다.
- real mode의 settle strategy 중 `none`, `network_idle`, `locator_visible`, `spinner_hidden`, `url_change`, `response`, `item_count_change`는 dedicated wait path가 있다.
- `response`는 현재 `url_includes`, `method`, `status` 조건으로 response wait를 표현한다.
- `item_count_change`는 현재 selector 기반 count polling + optional `expected_count`, `min_count`, `max_count`, `count_delta` 조건으로 동작한다.

보류:
- trace/HAR/performance collector는 `artifact_policy.capture_trace`, `capture_har`,
  `capture_performance` 기반 1차 checkpoint 수집까지 구현되어 있다. 다만 full browser tracing,
  complete HAR timing/body capture, Core Web Vitals calibration은 별도 후속 범위다.
- AX collector는 `capture_ax_tree` 기반 1차 artifact/summary 수집까지만 구현되어 있다.
- `item_count_change`는 현재 count 변화 검출까지 구현되었고, 필요하면 이후 DOM collection contract와 observation 구조를 더 정교화한다.

## 3.6 Checkpoint 중심 capture pipeline 유지

결정: runner evidence 수집의 핵심 단위는 page 전체가 아니라 action 이후 checkpoint다.

checkpoint pipeline:

```text
action/settle 이후 page snapshot
→ checkpoint draft 생성
→ screenshot / DOM snapshot / console log artifact draft 생성
→ artifact store persist
→ artifact callback
→ checkpoint callback
```

규칙:
- checkpoint는 `trigger`, `settle`, `state`, `observations`, `deltas`, `artifactRefs`를 포함해야 한다.
- observation은 raw dump가 아니라 구조화된 fact여야 한다.
- finished/failed callback에는 full EvidencePacket을 싣지 않는다.
- artifact metadata와 checkpoint payload는 contracts 용어와 shape를 우선한다.

현재 기본 수집 범위:
- screenshot
- DOM snapshot
- console error
- network error
- response settle match metadata (`matched_url`, `method`, `status_code`)
- item count settle metadata (`baseline_count`, `current_count`, `expected_count`, `count_delta`)
- field 입력 상태
- selected option 상태
- visited URL / title / viewport / locale / timezone

## 3.7 Transport / storage adapter를 격리한다

결정: 입력, callback 전송, artifact 저장은 각각 독립 adapter로 분리한다.

현재 구현:

```text
messaging  -> local JSON file input + RabbitMQ consumer
callback   -> local JSONL append + Spring internal HTTP callback + callback outbox replay
storage    -> local filesystem artifact persist + S3-compatible artifact store + artifact outbox replay
```

규칙:
- 입력 transport를 MQ로 바꾸더라도 scenario/worker 구조는 유지한다.
- callback transport를 HTTP client로 바꾸더라도 payload shape는 유지한다.
- artifact 저장소를 S3로 바꾸더라도 상위 계층은 `ArtifactStore`만 사용한다.
- local implementation은 production integration 이전의 검증용 fallback으로 유지할 수 있다.

이 의미는 현재 구현이 임시여도 throwaway code가 아니라는 것이다. adapter만 바꾸면 상위 실행 흐름은 재사용 가능해야 한다.

## 3.8 Contract-first validation 유지

결정: runner는 실행 전에 envelope/payload/ScenarioPlan 최소 검증을 수행한다.

검증 대상:
- `run.execute.request` envelope
- payload의 `runId`, `projectId`, `startUrl`, `goal`, `devicePreset`, `scenarioTemplateVersionId`
- `ScenarioPlan`의 `schema_version`, `plan_id`, `scenario_type`, `goal`, `start_url`, `environment`, `safety`, `steps`
- payload와 scenarioPlan 사이의 `startUrl`, `goal`, `devicePreset` consistency

규칙:
- transport contract는 camelCase, domain contract는 schema_version 기반 payload를 그대로 존중한다.
- validation 오류는 브라우저 실행 전에 실패해야 한다.
- contract shape가 바뀌면 `packages/contracts`를 먼저 수정하고 runner를 맞춘다.

## 3.9 Pure logic과 adapter seam을 테스트 가능하게 유지

결정: runner도 browser를 꼭 띄우지 않아도 검증 가능한 seam을 유지한다.

현재 테스트 축:
- message validation test
- worker failure policy test
- executor/checkpoint ordering test
- artifact storage regression test
- real Playwright focused regression test

규칙:
- pure shaping logic은 브라우저 없이 test 가능해야 한다.
- adapter replacement가 예상되는 경계는 interface 기반 test seam을 남긴다.
- real Playwright test는 얇고 목적이 분명해야 한다.

# 4. 운영 adapter와 보류한 기술 선택

다음 항목은 현재 구현된 adapter와 아직 production hardening이 남은 영역을 구분한다.

## 4.1 RabbitMQ consumer

기본 운영 선택: canonical `run.execute.request` / `discovery.execute.request` MQ consume.

현재 `--consume-mq` 또는 `RUNNER_MQ_CONSUMER_ENABLED=true`로 consumer를 실행할 수 있다. MQ consumer mode는 callback/artifact outbox replay worker를 기본으로 함께 띄우며, 별도 replay process가 있을 때만 다음 env로 끈다.

```text
RUNNER_MQ_CALLBACK_OUTBOX_WORKER_ENABLED=false
RUNNER_MQ_ARTIFACT_OUTBOX_WORKER_ENABLED=false
```

구현된 hardening:

- agent worker는 동일 `AgentTask.idempotency_key` 중복 delivery를 같은 process 안에서 재실행하지 않고 기존 실행 promise/result를 재사용한다.
- run/discovery worker는 `RUNNER_MESSAGE_IDEMPOTENCY_STORE_MODE=api`에서 `/internal/runner/message-idempotency/{scope}/{sha256}`로 terminal result를 first-writer-wins 저장/조회해 여러 Runner replica가 같은 `idempotencyKey`를 재실행하지 않는다.
- terminal agent execution result는 `artifactsRoot/agent-idempotency/`에 저장되어 runner process 재시작 후에도 같은 idempotency key를 재실행하지 않는다.
- API-backed idempotency mode는 agent 실행 전 CLAIMED lease를 잡고, 긴 실행 중 lease를 renew하며, terminal record 없이 실패한 attempt는 owned claim을 release한다.
- MQ consumer는 `RUNNER_MQ_REQUEUE_ON_FAILURE=true`여도 `RUNNER_MQ_MAX_DELIVERY_ATTEMPTS` 이상 관측된 poison message를 requeue 없이 reject한다.
- worker concurrency 정책은 static run/discovery는 `RUNNER_MQ_PREFETCH`, agent는 `RUNNER_AGENT_CONCURRENCY`로 분리한다.

운영 기본값:

```text
RUNNER_REPLICAS=3
RUNNER_MQ_PREFETCH=1
RUNNER_AGENT_CONCURRENCY=1
RUNNER_MESSAGE_IDEMPOTENCY_STORE_MODE=api
RUNNER_MQ_REQUEUE_ON_FAILURE=false
RUNNER_MQ_MAX_DELIVERY_ATTEMPTS=3
```

Playwright browser job은 장시간 실행될 수 있으므로 운영 병렬 처리량은 단일 process의 prefetch를 크게 키우기보다 Runner replica 수를 늘리는 방식으로 확장한다.

로컬 dev 기본 compose는 runner metrics를 `127.0.0.1:9101`로 publish하므로 같은 runner service를 여러 replica로 늘리면 host port 충돌이 발생한다. 로컬에서 runner scale을 검증할 때는 `infra/compose/compose.dev.runner-scale.yaml` override를 추가해 metrics host port publish를 제거하고, API-backed idempotency mode로 여러 replica의 중복 delivery 방어를 맞춘다.

남은 hardening:

- processed_message 기반 consume-level 중복 방지와 terminal result idempotency record를 하나의 운영 dashboard로 연결한다.
- production traffic 기준 concurrency scaling guide를 부하 테스트 결과로 확정한다.

## 4.2 Spring internal callback HTTP client

기본 운영 선택: `/internal/runner/runs/{runId}/*`와 `/internal/runner/discoveries/{discoveryId}/*` HTTP callback client.

현재 `RUNNER_CALLBACK_BASE_URL`이 있으면 HTTP callback mode로 전환되며, `X-Event-Id`, `X-Worker-Id`, bearer token, optional HMAC signature, timeout/retry, callback outbox persistence가 연결되어 있다. JSONL 기록은 local fallback으로 유지한다.

현재 duplicate delivery tolerance:

- API callback은 `X-Event-Id` 기반 processed_message로 중복 callback을 duplicate ack 처리한다.
- Runner HTTP callback client는 timeout/retry 후 callback outbox에 남기고 replay worker가 재전송한다.

현재 partial failure policy:

- `accepted` 이전 실패는 실행을 시작하지 않은 것으로 보고 failed callback의 `resultCompleteness=NONE`을 사용한다.
- step events, artifact storage/callback, checkpoint callback, agent events/trace callback, failure evidence capture 실패는 실행 결과를 덮지 않고 `DELIVERY_PARTIAL` issue로 남긴다.
- `finished` callback 실패는 terminal 완료 통지가 누락된 것이므로 실행 자체는 성공으로 보존하되 delivery status는 `DELIVERY_FAILED`로 승격한다.
- `failed` callback까지 실패하면 원래 실행 실패와 failed callback 실패를 결합해 예외를 다시 던진다.

## 4.2.1 Agent decision client

기본값은 rule-based heuristic decision client다.

```text
RUNNER_AGENT_DECISION_MODE=heuristic
```

LLM decision client는 명시적으로만 활성화한다.

```text
RUNNER_AGENT_DECISION_MODE=llm
RUNNER_AGENT_LLM_ENDPOINT=<OpenAI-compatible or internal decision endpoint>
RUNNER_AGENT_LLM_API_KEY=<optional bearer token>
RUNNER_AGENT_LLM_MODEL=<model-or-router-name>
RUNNER_AGENT_LLM_TIMEOUT_MS=10000
```

LLM이 활성화되어도 pre-decision verifier, risk policy, fixed browser tool runtime은 그대로 우선 적용된다. LLM 응답이 invalid JSON이거나 관찰되지 않은 target을 선택하면 heuristic으로 fallback한다.


## 4.2.2 AgentTrace ScenarioPlan export

성공한 AgentTrace는 TRACE artifact와 별개로 `agent_scenario_plan_export` JSON artifact로 변환될 수 있다. Export 결과는 `custom_compiled` ScenarioPlan 후보이며, Agent가 실제 완료한 replayable action(`goto`, `click`, `scroll`, `checkpoint`)만 step으로 복사한다.

안전 경계:

- `trace.outcome.status=SUCCESS`인 trace만 export한다.
- login/CAPTCHA/blocker/policy-blocked trace는 reusable ScenarioPlan으로 만들지 않는다.
- policy가 허용했고 actionResult가 completed인 turn만 export한다.
- export plan 끝에는 final checkpoint와 `stop_when` guard를 추가해 payment/final order/destructive terminal action 직전 중단을 정적 plan에도 보존한다.

이 export는 Runner가 ScenarioAuthoring provider가 된다는 뜻이 아니다. Agent가 찾은 경로를 후속 검증/승인 단계에서 재사용 가능한 ScenarioPlan 후보로 넘기기 위한 artifact boundary다.

## 4.3 S3 artifact storage

기본 운영 선택: artifact binary는 S3-compatible storage, DB에는 metadata/key만 저장.

현재 `RUNNER_ARTIFACT_STORAGE=s3`로 S3/MinIO-compatible upload를 사용할 수 있고, local filesystem은 fallback으로 유지한다.

규칙:
- artifact key는 POSIX `/` 의미를 유지한다.
- bucket/key abstraction은 `ArtifactStore` 뒤에 숨긴다.
- content hash, sizeBytes, mimeType은 persist 시점에 확정한다.

## 4.4 Expanded collectors

다음 collector는 production-grade 확장 여지가 남아 있지만, checkpoint evidence용 1차 collector는 연결되어 있다.

- layout collector: checkpoint `layout_collector` observation과 `state.layout_collector_summary`
- network timeline/HAR: bounded `network_timeline` observation과 `capture_har=true`일 때 `HAR` artifact
- trace: `capture_trace=true`일 때 checkpoint runtime `TRACE` artifact
- performance metric: `capture_performance=true`일 때 `performance_metric` observation과 state summary

`AX tree collector`는 1차 구현으로 `artifact_policy.capture_ax_tree=true`인 checkpoint에서
`AX_TREE` artifact, `state.ax_tree_summary`, `ax_tree` observation을 남긴다. 단, WCAG
audit/규칙 기반 접근성 판정이나 full accessibility issue collector는 아직 별도 후속 범위다.

`richer DOM/visibility observation extractor`는 1차 구현으로 checkpoint `state.dom_summary`,
`state.layout_summary`, `visible_text_blocks` observation, interactive component별 visibility/layout
signal을 남긴다. 단, 전체 layout tree/paint order 수준의 production layout collector는 위
`layout collector` 범위로 계속 남아 있다.

이들은 `browser` 또는 `capture` 경계를 넘나들 수 있지만, checkpoint contract는 보존해야 한다.

## 4.5 Failure / reliability policy

아직 runner reliability는 production 수준으로 고정하지 않았다.

현재 구현:
- step 실행 실패 후에도 session snapshot/capture가 가능하면 failure checkpoint를 남긴다.
- failure checkpoint는 일반 checkpoint와 같은 artifact 저장/콜백 경로를 사용하며, failed callback에는 저장에 성공한 `failureArtifactRefs`를 포함한다.
- browser/session이 이미 깨져 failure evidence capture가 실패하면 원래 실패를 덮지 않고 `failure-capture` delivery issue로 degrade 처리한다.
- HTTP callback mode에서는 step 사이에 `/internal/runner/runs/{runId}/control-state`를 조회해 `STOP_REQUESTED`를 소비하고, 다음 step 실행 전 stopped summary로 정상 종료한다.
- Playwright page crash/browser disconnect/context close 신호는 `browser_health` state/observation으로 남기며, 실행 실패는 `RUNNER_BROWSER_CRASH`로 분류한다. Crash 이후 screenshot/DOM capture가 실패해도 원래 crash failure를 보존한다.
- `run.execute.request`와 `discovery.execute.request`의 `idempotencyKey`가 있으면 runner-local terminal record를 `artifactsRoot/message-idempotency/{scope}`에 남기고, 같은 key의 재전달은 browser/session을 새로 열지 않고 이전 결과를 재사용한다.
- callback partial failure impact는 코드의 `DELIVERY_FAILURE_IMPACT_BY_SCOPE`에 고정되어 있으며, `finished-callback`만 fatal delivery issue로 분류한다.
- action timeout은 `RUNNER_TIMEOUT`으로 step/run 실패 처리하며 `STEP_FAILED` payload와 operational log에 `timeoutPhase=action`, `timeoutMs`, `timeoutPolicy=fail_step_and_run`을 남긴다.
- settle timeout은 브라우저 실행 실패가 아니라 관측된 settle 상태로 취급한다. step은 계속 완료될 수 있고 `STEP_COMPLETED.payload.settle.status=timeout` 및 `step_settle_timeout` log의 `timeoutPolicy=continue_with_timeout_settle_status`로 남긴다.
- 운영 smoke/E2E와 장애 대응 절차는 `docs/runner_operational_runbook.md`를 기준으로 한다.

추후 정리할 항목:
- API/DB 기반 cross-runner idempotency lease

# 5. Agent 구현 규칙

`apps/runner`를 변경할 때:

1. 먼저 이 문서와 `docs/01_architecture_and_project_structure.md`, `docs/04_domain_payload_contracts.md`를 확인한다.
2. contract 변경이 필요하면 `packages/contracts`를 먼저 수정한다.
3. 새 코드는 가장 작은 책임 경계에 둔다.
4. scenario orchestration과 transport adapter를 섞지 않는다.
5. browser 세부 구현을 상위 executor로 새지 않게 한다.
6. checkpoint 중심 evidence 흐름을 유지한다.
7. 다음 명령을 실행한다.

```bash
cd apps/runner
npm test
npx tsc --noEmit
```

8. entrypoint 또는 example flow를 건드렸다면 다음 명령도 실행한다.

```bash
cd apps/runner
npm run start -- --message-file examples/run-execute.request.json
```

# 6. 현재 follow-up

- MQ consumer 운영 모드에서 callback/artifact outbox replay worker 동시 실행 정책을 유지하고 smoke/e2e로 검증한다.
- duplicate callback/message idempotency와 poison message 처리를 고정한다.
- settle strategy와 collector coverage를 확장한다.
- failure/retry/idempotency/recovery 정책을 운영 runbook과 테스트로 고정한다.
- callback/artifact/checkpoint shape 중 shared contract로 승격할 범위를 계속 정리한다.
