# 00. Master Decisions

## 1. 목적

이 문서는 Wedge의 canonical 설계 결정을 한 곳에 정리한다.  
현재 기준 문서의 목적은 기존 문서를 단순 병합하는 데 있지 않다. 구현 기준을 다음 두 계층으로 분리해 명확히 하는 데 있다.

```text
Domain payload contract
  ScenarioPlan / EvidencePacket / RuleRegistry / JudgeResult

Operational transport contract
  REST API / Internal Callback / RabbitMQ / WebSocket / MCP
```

## 2. 제품 정의

Wedge는 특정 URL을 입력받아 먼저 lightweight Site Discovery / Preflight를 수행하고, 가능한 사용자 시나리오를 추천한 뒤, 사용자가 선택/수정한 시나리오를 실제 브라우저에서 실행해 UX/전환 리스크를 리포트하는 시스템이다.

Wedge는 단순 URL 정적 분석기가 아니다.

```text
URL
  → Site Discovery / Preflight
  → Scenario Recommendation
  → User confirmation or guided scenario edit
  → Browser execution
  → Checkpoint evidence
  → Rule-based judgment
  → LLM explanation
  → Why/Nudge report
```

## 3. 핵심 결정

| 영역 | 결정 | 이유 |
|---|---|---|
| 기본 UX | URL-first Site Discovery before Full Run | 일반 사용자가 자기 URL에 맞는 시나리오를 먼저 알기 어렵기 때문 |
| 실행 방식 | 시나리오 기반 Playwright 실행 | SPA, modal, form, CTA click 이후 상태 확인에 필요 |
| Evidence 구조 | action 이후 checkpoint 생성 | 문제 발생 순간과 근거를 연결하기 위해 필요 |
| 판단 방식 | Rule Engine 우선, LLM 후해석 | 재현성, explainability, false positive 관리 |
| API base path | `/api` | `/api/v1`은 개발용 느낌이 강해 제외 |
| Internal API | `/internal` | Runner/Analyzer callback과 사용자 API 분리 |
| WebSocket | `/ws/runs/{runId}` | Live UI 전용 |
| MCP | `/mcp` | Wedge 기능 호출기, 브라우저 원격 조종기 아님 |
| 상태 기준 | Spring + PostgreSQL | Runner/FastAPI/WS는 전달자, 최종 상태는 Spring DB |
| 비동기 작업 | RabbitMQ | 장시간 브라우저 실행과 분석 작업 분배 |
| Artifact | S3-compatible object storage | screenshot/trace/raw snapshot은 DB에 저장하지 않음 |
| DB | PostgreSQL + MyBatis | 구조화된 상태/근거 저장 |
| Auth | Human auth와 agent/client auth 분리 | V1 human web login은 first-party email/password + JWT로 빠르게 제공하고, MCP/agent client는 OAuth-style client identity, scope, agent_client_policy 기반으로 분리한다 |
| 문서 구조 | 소수의 canonical 문서 + machine-readable contract | 팀 공유와 AI 작업 지시를 동시에 지원 |

### Decision: URL-first Site Discovery before Full Run

Wedge V1의 기본 UX는 사용자가 시나리오를 먼저 고르고 곧바로 실행하는 방식이 아니다. 기본 흐름은 URL 입력 후 lightweight Site Discovery를 수행하고, 발견된 CTA/form/pricing/checkout/contact 후보를 바탕으로 추천 시나리오를 제안한 뒤, 사용자가 선택하거나 guided custom scenario로 수정해 정식 Run을 실행하는 방식이다.

결정 이유:

- 일반 사용자와 1인 제작자는 자기 URL에 어떤 시나리오가 적합한지 모를 수 있다.
- 구매 시나리오를 선택했지만 제출 URL에 구매/결제 흐름이 없을 수 있다.
- 이런 경우 단순 `FAILED`로 처리하면 제품이나 Runner가 실패한 것처럼 보인다.
- Discovery를 먼저 수행하면 “이 URL에서는 랜딩 CTA / 문의 / 회원가입 흐름이 적합합니다”처럼 안내할 수 있다.
- Wedge가 단순 실행기가 아니라 사이트를 이해하고 적절한 분석을 제안하는 도구처럼 보인다.

결정:

- Site Discovery를 V1 기본 UX에 포함한다.
- Discovery는 full analysis가 아니라 10~30초 내 lightweight 탐색으로 제한한다.
- Discovery는 checkpoint, observation, artifact 구조를 재사용하지만 JudgeResult를 반드시 만들지는 않는다.
- 정식 Run에서도 scenario fit check를 수행한다.
- Scenario mismatch는 system failure가 아니라 product outcome으로 처리한다.
- mismatch가 발생하면 `FAILED`가 아니라 `result_completeness=PARTIAL`, `scenario_fit_status=NOT_APPLICABLE` 같은 fit 결과로 표현한다. V1 기본 정책은 사용자가 실행을 요청했으나 시나리오 적용이 불가능한 경우 `status=COMPLETED`, `result_completeness=PARTIAL`, `analysis_status=COMPLETED`로 종료하고 mismatch report를 제공하는 것이다. 사이트 차단/안전 제한은 `scenario_fit_status=BLOCKED_BY_SITE` 또는 `UNSAFE_OR_RESTRICTED`로 구분한다.

추가 상태:

```text
scenarioFitStatus:
- UNKNOWN
- APPLICABLE
- LOW_CONFIDENCE
- NOT_APPLICABLE
- BLOCKED_BY_SITE
- UNSAFE_OR_RESTRICTED
```

사용자-facing 원칙:

- “분석 실패”라고 하지 않는다.
- “선택한 시나리오를 이 URL에서 진행할 수 없습니다”라고 표현한다.
- 대체 추천 시나리오를 제공한다.

예시:

```text
URL = example.com
사용자 선택 = 구매/결제 흐름
Discovery/Run 결과 = 가격, 장바구니, 결제 CTA 없음

출력 = 이 URL에서는 구매/결제 흐름을 시작할 진입점을 찾지 못했습니다. 대신 랜딩 CTA 또는 문의/회원가입 흐름이 더 적합해 보입니다.
```

## 4. V1 범위

### 반드시 포함

- URL-first Site Discovery / Preflight
- Scenario Recommendation
- Scenario Fit Status / Scenario Mismatch Report
- URL + template scenario
- desktop/mobile 실행
- landing / signup form / pricing 시나리오
- 최종 시연 안정화 단계에서는 landing/signup 2개 시나리오를 우선 고정하고, pricing은 V1 범위 안에서 후순위로 둔다.
- Playwright Runner
- checkpoint evidence 수집
- screenshot, DOM, layout, AX, network, console 기본 수집
- EvidencePacket 저장
- P0 Rule 7~10개
- JudgeResult 저장
- LLM 기반 explanation/Nudge
- Summary / Decision Map / Evidence Card / Nudge Card
- Report share
- RabbitMQ 기반 비동기 실행
- S3 artifact 저장
- WebSocket progress event

### 가능하면 포함

- MCP read tools
- OAuth 최소 검증
- report export 최소판
- before/after rerun 기반

### V1 제외

- 완전한 natural-language custom scenario planner
- 완전 자율 Browser Agent Runtime. Checkout-entry Agent Runtime은 `docs/runner_agent_runtime_implementation_plan.md`의 별도 contract-first 후속 계획으로 관리한다.
- 실제 결제 완료
- CAPTCHA/OAuth 우회
- authenticated flow 전체 지원
- 실제 사용자 analytics 연동
- 완전한 heatmap/CTR 실측 분석
- usage/billing system
- 고급 saliency model

## 5. V1 경량형 판단

초기 사용자는 개발팀뿐 아니라 개인 제작자, 1인 개발자, 바이브코딩 사용자도 포함한다.  
따라서 다음은 V1 핵심 DB/UX에서 제외한다.

| 제외 항목 | 이유 |
|---|---|
| `project_environment` | production/staging/dev 모델은 초기 일반 사용자에게 과함 |
| `test_account` | 로그인 credential 저장은 보안 설계가 무거움 |
| `approval_request` | 승인 workflow는 초기 UX를 복잡하게 함 |
| `usage_meter` | 과금/플랜 정책 확정 전에는 과함 |

대신 다음은 V1에 포함한다.

| 포함 항목 | 이유 |
|---|---|
| `report_share` | 결과 공유는 초기부터 가치가 큼 |
| `deleted_at` | 실수 삭제/복구 고려 |
| `version` | optimistic concurrency |
| `outbox_message` | DB write와 MQ publish 일관성 |
| `processed_message` | callback/message idempotency |
| `mcp_invocation_log` | agent 호출 감사 로그 |
| `agent_client_policy` | MCP client별 tool/scope 제어 |

## 6. API 응답과 Auth 정책

- Public REST success response는 `data` + `meta` envelope를 사용한다.
- Public REST error response는 `error` + `meta` envelope를 사용한다.
- 성공 응답에는 서버 주도 `code/message`를 기본 포함하지 않는다. 성공 UX copy는 frontend가 관리한다.
- Error code는 client/agent 분기를 위해 stable `snake_case` 값을 사용한다.
- Human web auth와 MCP/agent auth는 분리한다. V1 human auth는 email/password credential을 `user_account`와 분리 저장하고 JWT access/refresh token을 발급한다.
- MCP/agent auth는 OAuth-style client identity, `wedge.read`/`wedge.execute`/`wedge.export`/`wedge.admin` scope, `agent_client_policy`, `mcp_invocation_log` 방향을 유지한다.

## 7. Canonical source 정책

- 사람이 읽는 기준: `docs/`
- DB 기준: `docs/wedge_schema.sql`
- REST 기준: `packages/contracts/openapi/wedge_openapi.yaml`
- Runner/Analyzer domain payload 기준: `packages/contracts/schemas/*.schema.json`
- Transport 기준: `packages/contracts/{mq,internal,websocket,mcp}/`
- Research basis: `docs/07_research_basis.md`

원본 리서치 아카이브를 별도 canonical 기준으로 만들지 않는다.  
필수 근거만 `docs/07_research_basis.md`로 정리한다.
