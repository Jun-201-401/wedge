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
  - ../packages/contracts/internal/runner-callback.schema.json
  - ../packages/contracts/mq/messages.schema.json
---

# 1. 목적

이 문서는 `apps/runner`의 기술 선택, 모듈 경계, 현재 구현 방향을 기록한다.

목표는 Wedge Runner가 `run.execute.request`를 안정적으로 소비하고, `ScenarioPlan`을 브라우저 실행으로 변환하며, checkpoint/artifact/internal callback 흐름을 유지보수하기 쉽게 만드는 것이다.

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
- trace/HAR/AX/performance collector는 아직 본격 구현하지 않는다.
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
messaging  -> local JSON file input
callback   -> local JSONL append
storage    -> local filesystem artifact persist
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

# 4. 보류한 기술 선택

다음 항목은 의도적으로 아직 production integration까지 완료하지 않았다.

## 4.1 RabbitMQ consumer

향후 기본 선택: canonical `run.execute.request` MQ consume.

현재는 local file input으로 orchestration을 검증한다.
consumer를 붙일 때는 다음을 함께 정리한다.

- ack / nack / retry 정책
- idempotency key 처리
- poison message 처리
- worker concurrency 정책

## 4.2 Spring internal callback HTTP client

향후 기본 선택: `/internal/runner/runs/{runId}/*` HTTP callback client.

현재는 JSONL 기록으로 payload shape와 순서를 검증한다.
HTTP 전환 시 함께 정리할 항목:

- `X-Event-Id`
- `X-Worker-Id`
- timeout / retry
- duplicate delivery tolerance

## 4.3 S3 artifact storage

향후 기본 선택: artifact binary는 S3, DB에는 metadata/key만 저장.

현재는 local filesystem 저장으로 artifact pipeline을 검증한다.
전환 시 규칙:
- artifact key는 POSIX `/` 의미를 유지한다.
- bucket/key abstraction은 `ArtifactStore` 뒤에 숨긴다.
- content hash, sizeBytes, mimeType은 persist 시점에 확정한다.

## 4.4 Expanded collectors

아직 다음 collector는 최소 skeleton 또는 미구현 상태다.

- AX tree
- layout collector
- network timeline/HAR
- trace
- performance metric
- richer DOM/visibility observation extractor

이들은 `browser` 또는 `capture` 경계를 넘나들 수 있지만, checkpoint contract는 보존해야 한다.

## 4.5 Failure / reliability policy

아직 runner reliability는 production 수준으로 고정하지 않았다.

추후 정리할 항목:
- callback partial failure policy
- per-step timeout policy
- browser crash recovery
- screenshot-on-failure policy
- run cancellation / stop signal consume

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

- RabbitMQ consumer를 붙여 local file input을 transport adapter 뒤로 숨긴다.
- Spring internal callback HTTP client를 붙여 JSONL logger를 대체한다.
- S3 artifact storage를 붙여 local filesystem fallback을 분리한다.
- settle strategy와 collector coverage를 확장한다.
- failure/retry/idempotency/recovery 정책을 문서와 테스트로 고정한다.
- callback/artifact/checkpoint shape 중 shared contract로 승격할 범위를 계속 정리한다.
