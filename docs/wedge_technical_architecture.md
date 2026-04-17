
---
title: Wedge V1 Technical Architecture & Implementation Specification
document_type: technical-design
status: draft-v1
version: 1.0
last_updated: 2026-04-17
intended_use:
  - team_share
  - ai_tasking
  - implementation_reference
related_documents:
  - wedge_api_spec.md
  - ../packages/contracts/openapi/wedge_openapi.yaml
  - wedge_schema.sql
---

# 1. 문서 목적

본 문서는 Wedge V1의 서버 아키텍처, 데이터 구조, 프로젝트 구조, 인증/인가, 메시징, MCP 연동, 구현 규칙을 정의하는 기술 설계 문서다.

대상 독자는 다음과 같다.

- 백엔드(Spring Boot) 개발자
- Node + Playwright Runner 개발자
- FastAPI Analyzer 개발자
- 프론트엔드 개발자
- DevOps/인프라 담당자
- Claude Code, Codex, 내부 AI 에이전트에 작업을 지시하려는 팀원

이 문서는 다음 질문에 답하기 위해 작성한다.

1. Wedge를 어떤 구조로 구현할 것인가
2. 각 서버와 저장소는 어떤 역할을 맡는가
3. 어떤 이유로 이 기술 스택을 선택했는가
4. 프로젝트/패키지 구조는 어떻게 가져갈 것인가
5. DB와 메시지 큐는 어떤 기준으로 설계할 것인가
6. 외부 에이전트(MCP)와 내부 LLM은 어떤 계약을 공유하는가

---

# 2. 제품 관점 요약

Wedge V1은 단순 자동 테스트 도구가 아니다.  
핵심은 아래 4단계 흐름이다.

1. 시나리오 기반으로 실제 브라우저를 실행한다
2. 실행 과정을 실시간으로 보여준다
3. 스크린샷, DOM, 클릭/입력 로그, 오류 등 evidence를 저장한다
4. 왜 막혔는지(Why)를 해석하고 무엇을 바꿔야 하는지(Nudge)를 제안한다

즉 시스템의 핵심은 **Run → Evidence → Why → Nudge** 흐름이며,  
설계도 이 흐름을 기준으로 정리해야 한다.

---

# 3. 설계 원칙

## 3.1 Spring이 시스템의 기준 서버다

Wedge에서 “현재 이 run이 어떤 상태인지”에 대한 최종 판단 기준은 Spring Boot + PostgreSQL이다.

- Runner는 실행 담당이다
- Analyzer는 분석 담당이다
- 프론트는 표시 담당이다
- Spring은 상태/권한/오케스트레이션 담당이다

이 원칙을 지키면 상태 불일치 문제가 줄어든다.

## 3.2 Runner와 Analyzer는 직접 비즈니스 테이블을 수정하지 않는다

Node Runner와 FastAPI Analyzer는 DB의 핵심 비즈니스 테이블을 직접 갱신하지 않는다.

- Runner는 실행 결과를 Spring에 callback 한다
- Analyzer는 분석 결과를 Spring에 callback 하거나 MQ를 통해 전달한다
- 상태 전이와 최종 기록은 Spring이 수행한다

## 3.3 RabbitMQ는 작업 분배용이다

RabbitMQ는 장시간 비동기 작업을 분배하기 위해 사용한다.

- 실행 요청
- 분석 요청
- 리포트 export 요청

반대로 아래는 RabbitMQ의 책임이 아니다.

- 최종 상태 저장
- 실시간 화면 표시
- artifact 원본 저장

## 3.4 WebSocket은 UI 실시간 표시용이다

WebSocket은 프론트엔드 사용자에게 실시간 진행 상황을 보여주기 위한 채널이다.

- 현재 step
- 현재 action
- 최신 프레임
- 상태 변화
- 감지된 문제 신호

즉 WebSocket은 화면 표시용이고, 상태 기준은 아니다.

## 3.5 MCP는 브라우저 원격 조종기가 아니라 Wedge 기능 호출기다

MCP는 `click(selector)` 같은 저수준 브라우저 제어를 노출하는 용도가 아니다.  
MCP는 아래와 같은 도메인 기능을 노출한다.

- run 생성
- run 시작/중지
- 상태 조회
- evidence 조회
- 분석 요청
- nudge 생성
- report export

이렇게 해야 외부 에이전트가 내부 LLM API를 대체하더라도 시스템 경계가 무너지지 않는다.

## 3.6 버전은 문서/계약으로 관리하고 URI에는 넣지 않는다

공개 API path는 `/api`를 사용한다.  
초기 단계에서 `/api/v1`을 URI에 넣기보다 문서, OpenAPI, 배포 릴리즈로 계약을 관리한다.

이유는 다음과 같다.

- 초기에 path version이 고정되면 오히려 API 정리가 느슨해질 수 있다
- 내부/외부 클라이언트가 아직 제한적이므로 문서 기반 계약 관리가 가능하다
- 향후 실제 breaking change가 생기면 그때 `/api/v2` 또는 별도 versioning 전략을 도입할 수 있다

---

# 4. 확정된 기술 스택과 선택 이유

## 4.1 Frontend
- React

**선택 이유**
- Run 모니터링 화면, evidence viewer, report UI, 프로젝트 관리 화면에 적합
- 실시간 상태/프레임 스트림을 다루기 수월하다

## 4.2 Core API Server
- Spring Boot
- MyBatis

**선택 이유**
- 인증/권한, 상태 관리, 오케스트레이션, MCP, WebSocket을 한곳에서 관리하기 적합
- MyBatis는 SQL 통제가 쉽고, Run/Report/검색성 조회에서 명시적 쿼리 관리가 용이하다

## 4.3 Browser Runner
- Node.js
- Playwright
- Chrome DevTools Protocol(CDP)

**선택 이유**
- Playwright는 현대 웹 자동화, locator, tracing, screenshot, CDP 연동 측면에서 적합
- 브라우저 실행은 일반 API 서버와 성격이 달라 별도 워커로 분리하는 편이 운영상 안전하다

## 4.4 Analyzer
- FastAPI
- Python 기반 모델 및 LLM 호출

**선택 이유**
- DeepGaze, Fuxi CTR, saliency/attention 분석, LLM 기반 Why/Nudge 생성에 Python 생태계가 자연스럽다
- 분석기와 운영 서버를 분리하면 모델 버전 교체와 실험이 쉽다

## 4.5 Database / Storage
- PostgreSQL
- S3-compatible object storage

**선택 이유**
- PostgreSQL은 상태, 메타데이터, 검색/정렬 중심 조회에 적합
- artifact 원본(프레임, 스크린샷, trace, report)은 S3에 저장하는 것이 비용/성능 면에서 유리하다

## 4.6 Messaging / Realtime
- RabbitMQ
- WebSocket

**선택 이유**
- RabbitMQ는 실행/분석/리포트 같은 장시간 작업 분배, 재시도, DLQ 구성에 적합
- WebSocket은 live monitor 화면에 필요한 이벤트/프레임 전달에 적합

## 4.7 Auth / Agent Compatibility
- Spring Authorization Server
- Remote MCP endpoint inside Spring

**선택 이유**
- OAuth 2.1 / OIDC, PKCE, Client Credentials, JWT/opaque token 구성이 가능하다
- Spring이 이미 상태/권한의 기준이므로 MCP와 인증을 같은 생태계 안에서 관리하는 편이 일관적이다

---

# 5. 선택한 구조와 선택하지 않은 구조

## 5.1 왜 Spring 안에 MCP를 두는가

### 선택
- Spring 애플리케이션 안에 MCP adapter를 둔다

### 이유
- 권한, 프로젝트 접근 제어, 상태 기준이 모두 Spring에 있다
- MCP가 호출하는 기능이 곧 Wedge 도메인 기능이다
- 별도 MCP gateway를 두면 인증/권한/로깅이 중복되기 쉽다

### 지금 선택하지 않은 대안
- 별도 MCP adapter 서버

### 보류 이유
- 초기에는 오히려 복잡도가 커진다
- 외부 에이전트 트래픽이 충분히 커질 때 분리해도 늦지 않다

## 5.2 왜 RabbitMQ를 지금 넣는가

### 선택
- 현재 시점부터 RabbitMQ 도입

### 이유
- 실행(run)과 분석(analysis)이 모두 비동기 장시간 작업이다
- 다중 runner / 다중 analyzer 확장 가능성이 높다
- stop, retry, DLQ, backpressure를 설계 초기에 잡는 편이 안전하다

### 지금 선택하지 않은 대안
- HTTP 호출만으로 시작
- Redis만으로 큐를 대체

### 보류/비선택 이유
- HTTP만으로는 재시도와 분산 처리가 금방 불편해진다
- Redis는 캐시/ephemeral state에는 좋지만, 지금 필요한 것은 신뢰성 있는 작업 분배다

## 5.3 왜 상태를 하나의 status 필드로 끝내지 않는가

### 선택
- `status`, `result_completeness`, `analysis_status`를 분리한다

### 이유
- `STOPPED`이면서도 partial result가 남을 수 있다
- `FAILED`이지만 일부 evidence는 저장될 수 있다
- 분석이 실행과 별도로 진행될 수 있다

### 지금 선택하지 않은 대안
- `PARTIAL_COMPLETED` 같은 terminal status를 많이 늘리는 방식

### 비선택 이유
- 상태 수가 빠르게 불어나고 UI/운영 해석이 어려워진다

---

# 6. 권장 시스템 구성

## 6.1 시스템 구성도(텍스트)

- React Web
  - `/api` 호출
  - `/ws` 구독
- Spring Boot
  - REST API
  - MCP endpoint (`/mcp`)
  - Runner/Analyzer callback endpoint (`/internal/**`)
  - RabbitMQ publisher/consumer
  - PostgreSQL access
  - S3 access
- Node Runner
  - RabbitMQ consumer
  - Playwright 실행
  - CDP 수집
  - Spring callback 호출
  - S3 업로드
- FastAPI Analyzer
  - RabbitMQ consumer
  - 분석 수행
  - Spring callback 호출
  - 필요 시 S3/DB 참조
- PostgreSQL
  - run/step/evidence/signal/report metadata
- S3
  - frame/screenshot/trace/report 저장
- RabbitMQ
  - 실행/분석/리포트 작업 분배

## 6.2 책임 요약

| 컴포넌트 | 핵심 책임 | 하지 말아야 할 것 |
|---|---|---|
| React | 사용자 화면, live monitor, report viewer | 상태의 최종 기준 역할 |
| Spring | 권한, 상태 전이, 오케스트레이션, MCP, callback 수신 | 브라우저를 직접 실행하는 것 |
| Node Runner | 브라우저 실행, step 수행, 캡처/수집 | 비즈니스 상태를 직접 DB에 기록 |
| FastAPI | feature extraction, model inference, LLM analysis | run 상태를 직접 통제 |
| RabbitMQ | 장시간 작업 분배 | 상태 저장, live UI 채널 |
| PostgreSQL | 구조화된 데이터 저장 | 큰 원본 artifact 저장 |
| S3 | artifact 원본 저장 | 상태 기준 저장소 역할 |

---

# 7. 권장 런타임 흐름

## 7.1 Run 생성 및 시작

1. 사용자 또는 MCP client가 `POST /api/runs` 호출
2. Spring이 `test_run` 레코드 생성
3. 상태는 `CREATED`
4. 사용자가 `POST /api/runs/{runId}/start` 호출
5. Spring이 상태를 `QUEUED`로 변경
6. Spring이 `run.execute.request` 메시지를 RabbitMQ에 발행
7. Node Runner가 메시지를 consume
8. Runner가 수락 callback을 보내면 Spring이 `STARTING` 또는 `RUNNING`으로 전이

## 7.2 실행 중 live monitor

1. Runner가 step 시작/완료, 최신 프레임, 오류, issue signal을 Spring에 callback
2. Spring이 DB를 갱신
3. Spring이 WebSocket으로 프론트에 이벤트를 push
4. 프론트는 latest frame과 step 상태를 표시

## 7.3 중지 요청

1. 사용자 또는 MCP client가 `POST /api/runs/{runId}/stop` 호출
2. Spring이 `STOP_REQUESTED` 기록
3. Spring이 Runner에 stop 신호 전달
4. Runner는 가능한 안전 지점에서 실행 종료
5. Spring은 실행 종료 결과에 따라 `STOPPED`로 마감
6. evidence가 충분하면 `result_completeness=PARTIAL`, 아니면 `NONE`

## 7.4 분석

1. 실행 종료 후 Spring이 `analysis.request`를 RabbitMQ에 발행
2. FastAPI Analyzer가 consume
3. Analyzer가 evidence를 읽고 feature extraction / model inference / LLM analysis 수행
4. 결과를 Spring에 callback
5. Spring이 `analysis_status`를 `COMPLETED` 또는 `FAILED`로 저장
6. 필요 시 report export를 추가 발행

---

# 8. 상태 모델

## 8.1 Run 상태

### `status`
- `CREATED`
- `QUEUED`
- `STARTING`
- `RUNNING`
- `STOP_REQUESTED`
- `STOPPED`
- `ANALYZING`
- `COMPLETED`
- `FAILED`

### `result_completeness`
- `NONE`
- `PARTIAL`
- `FINAL`

### `analysis_status`
- `NOT_STARTED`
- `QUEUED`
- `RUNNING`
- `COMPLETED`
- `FAILED`

## 8.2 Step 상태

- `PENDING`
- `RUNNING`
- `PASSED`
- `FAILED`
- `SKIPPED`
- `BLOCKED`
- `STOPPED`

## 8.3 상태 모델 해석 예시

| status | result_completeness | analysis_status | 의미 |
|---|---|---|---|
| `RUNNING` | `NONE` | `NOT_STARTED` | 현재 브라우저 실행 중 |
| `STOPPED` | `PARTIAL` | `COMPLETED` | 사용자가 중지했지만 부분 결과 분석은 완료됨 |
| `FAILED` | `NONE` | `NOT_STARTED` | 의미 있는 evidence 없이 실패 |
| `COMPLETED` | `FINAL` | `COMPLETED` | 정상 종료 + 최종 분석 완료 |

---

# 9. 데이터 저장 전략

## 9.1 PostgreSQL에 저장할 것

- workspace / project / template
- run / step 상태
- event 메타데이터
- page snapshot 요약
- issue signal
- analysis finding / nudge
- report 메타데이터
- outbox / processed message / invocation log

## 9.2 S3에 저장할 것

- frame 이미지
- screenshot 이미지
- raw DOM / DOM snapshot 파일
- trace 파일
- raw network dump (필요 시)
- report PDF / Markdown 원본

## 9.3 JSONB 사용 원칙

JSONB는 다음 용도에만 사용한다.

- 구조가 자주 바뀌는 evidence 요약
- 모델 결과 raw payload
- 시나리오 스냅샷
- MCP request summary
- queue payload snapshot

검색/정렬/필터에 자주 쓰는 값은 반드시 일반 컬럼으로 분리한다.

---

# 10. DB 초안 설계 요약

상세 DDL은 `wedge_schema.sql` 문서를 따른다.  
여기서는 주요 테이블의 역할만 요약한다.

| 테이블 | 역할 |
|---|---|
| `user_account` | 애플리케이션 사용자 식별 |
| `workspace` / `workspace_member` | 조직/팀 단위 협업 모델 |
| `project` / `project_member` | 테스트 대상 사이트/서비스 단위 |
| `scenario_template` / `scenario_template_version` | 템플릿과 버전 스냅샷 |
| `test_run` | 테스트 1회 실행의 기준 엔티티 |
| `test_run_step` | run 내 step 상태 |
| `test_run_event` | step/action/frame/error 이벤트 |
| `artifact` | S3 객체 메타데이터 |
| `page_snapshot` | DOM/CTA/form/trust 요약 |
| `issue_signal` | 규칙/모델 기반 문제 신호 |
| `analysis_job` | 분석 작업과 버전 |
| `analysis_finding` | 쿼리 가능한 분석 결과 |
| `nudge` | 수정 제안 |
| `report` | 산출물 메타데이터 |
| `outbox_message` | MQ 발행 신뢰성 |
| `processed_message` | 중복 처리 방지 |
| `mcp_invocation_log` | MCP 감사 로그 |
| `agent_client_policy` | 클라이언트별 허용 정책 |

---

# 11. 메시징 설계

## 11.1 Queue 구성

### 실행
- exchange: `wedge.run`
- routing key: `run.execute.request`
- queue: `run.execute.request`

### 분석
- exchange: `wedge.analysis`
- routing key: `analysis.request`
- queue: `analysis.request`

### 리포트
- exchange: `wedge.report`
- routing key: `report.export.request`
- queue: `report.export.request`

### DLQ
- `run.execute.dlq`
- `analysis.dlq`
- `report.export.dlq`

## 11.2 메시지 설계 원칙

- 모든 메시지는 `message_id`, `event_type`, `occurred_at`, `correlation_id`, `payload_version`을 가진다
- 소비자는 `message_id` 기반 idempotent 처리를 해야 한다
- 메시지는 at-least-once를 전제로 설계한다

## 11.3 왜 callback과 MQ를 같이 쓰는가

### 선택
- 작업 분배는 MQ
- 상태 보고는 Spring callback API

### 이유
- MQ는 일을 분배하기 좋다
- 상태 보고는 Spring이 직접 받아 DB를 갱신하는 편이 단순하다
- live UI 갱신까지 MQ 중심으로 가면 오히려 복잡해진다

---

# 12. 인증, 인가, MCP 설계

## 12.1 외부 API

- base path: `/api`
- bearer token 사용
- scope 기반 접근 제어

## 12.2 내부 API

- base path: `/internal`
- Runner/Analyzer만 호출
- 내부 bearer token + `X-Signature` + `X-Event-Id`
- 필요 시 mTLS 고려

## 12.3 MCP

- endpoint: `/mcp`
- Spring 내부 adapter로 제공
- Remote MCP 기준으로 설계
- 도구 호출은 domain-level로 제한

## 12.4 Scope

- `wedge.read`
- `wedge.execute`
- `wedge.export`
- `wedge.admin`

## 12.5 Claim

- `sub`
- `tenant_id`
- `role`
- `client_type`
- `token_use`

프로젝트 단위 세부 권한은 토큰에 모두 넣지 않는다.  
최종 프로젝트 접근 여부는 Spring DB에서 확인한다.

## 12.6 Approval 정책

- read 계열: 기본 자동 또는 최소 승인
- execute 계열: 기본 승인 필요
- export 계열: 기본 승인 필요
- admin 계열: 강한 승인 + 별도 제한

---

# 13. Monorepo 및 프로젝트 구조 제안

Wedge는 초기에 **monorepo**를 추천한다.

사람이 읽는 설명 문서는 `docs/`에 두고, 서비스들이 직접 참조하는 계약 자산(OpenAPI/JSON Schema/enum)은 `packages/contracts/`에 둔다.

## 13.1 monorepo를 추천하는 이유

- API/WS/MQ/MCP contract를 공통으로 관리하기 쉽다
- 여러 서비스가 동시에 바뀌는 초기 제품에 적합하다
- AI에게 작업을 지시할 때 contract와 구현의 연결이 단순하다
- 문서, OpenAPI, schema, infra 템플릿을 한곳에서 관리할 수 있다

## 13.2 권장 디렉터리 구조

```text
wedge/
├─ apps/
│  ├─ api-server/              # Spring Boot + MyBatis + MCP + WebSocket
│  ├─ runner/                  # Node + Playwright + CDP
│  ├─ analyzer/                # FastAPI + models + LLM
│  └─ web/                     # React frontend
├─ packages/
│  └─ contracts/               # OpenAPI, JSON Schema, MQ payload, WS event, enums
├─ docs/
│  ├─ wedge_technical_architecture.md
│  ├─ wedge_api_spec.md
│  └─ wedge_schema.sql
├─ infra/
│  ├─ docker/
│  ├─ terraform/
│  └─ scripts/
├─ .github/
├─ Makefile
└─ README.md
```

---

# 14. 서비스별 권장 내부 구조

## 14.1 Spring Boot (`apps/api-server`)

### 권장 구조
```text
apps/api-server/
├─ src/main/java/com/wedge/
│  ├─ common/
│  │  ├─ config/
│  │  ├─ error/
│  │  ├─ logging/
│  │  ├─ util/
│  │  └─ security/
│  ├─ auth/
│  ├─ project/
│  │  ├─ api/
│  │  ├─ application/
│  │  ├─ domain/
│  │  └─ infrastructure/
│  ├─ scenario/
│  │  ├─ api/
│  │  ├─ application/
│  │  ├─ domain/
│  │  └─ infrastructure/
│  ├─ run/
│  │  ├─ api/
│  │  ├─ application/
│  │  ├─ domain/
│  │  └─ infrastructure/
│  ├─ evidence/
│  │  ├─ api/
│  │  ├─ application/
│  │  ├─ domain/
│  │  └─ infrastructure/
│  ├─ analysis/
│  │  ├─ api/
│  │  ├─ application/
│  │  ├─ domain/
│  │  └─ infrastructure/
│  ├─ report/
│  │  ├─ api/
│  │  ├─ application/
│  │  ├─ domain/
│  │  └─ infrastructure/
│  ├─ agent/
│  │  ├─ mcp/
│  │  ├─ policy/
│  │  └─ audit/
│  └─ internal/
│     ├─ runner/
│     └─ analyzer/
├─ src/main/resources/
│  ├─ application.yml
│  └─ mapper/
│     ├─ project/
│     ├─ run/
│     ├─ evidence/
│     ├─ analysis/
│     └─ report/
└─ build.gradle
```

### 구조 원칙
- package-by-domain을 사용한다
- `api`는 Controller/DTO
- `application`은 유즈케이스/서비스
- `domain`은 엔티티/정책/상태 전이
- `infrastructure`는 MyBatis mapper, S3, MQ, 외부 연동

### 이 구조를 추천하는 이유
- run/evidence/analysis/report가 서로 다른 속도로 커질 수 있다
- 공통 util 중심 구조보다 기능 중심 구조가 변경 영향 파악이 쉽다
- AI에게 특정 도메인만 수정하라고 지시하기 좋다

## 14.2 Node Runner (`apps/runner`)

```text
apps/runner/
├─ src/
│  ├─ app.ts
│  ├─ config/
│  ├─ messaging/
│  ├─ worker/
│  ├─ scenario/
│  │  ├─ executor/
│  │  ├─ templates/
│  │  └─ actions/
│  ├─ browser/
│  │  ├─ playwright/
│  │  └─ cdp/
│  ├─ capture/
│  ├─ callback/
│  ├─ storage/
│  └─ shared/
└─ package.json
```

### 구조 원칙
- 시나리오 실행과 브라우저 래퍼를 분리한다
- callback client와 S3 uploader를 분리한다
- action 실행기와 capture 로직을 분리한다

## 14.3 FastAPI Analyzer (`apps/analyzer`)

```text
apps/analyzer/
├─ app/
│  ├─ main.py
│  ├─ api/
│  ├─ workers/
│  ├─ schemas/
│  ├─ services/
│  │  ├─ feature_extraction/
│  │  ├─ model_inference/
│  │  ├─ llm_analysis/
│  │  └─ report_support/
│  ├─ clients/
│  └─ shared/
└─ pyproject.toml
```

### 구조 원칙
- feature extraction
- model inference
- LLM analysis

이 세 층을 코드 레벨에서 분리한다.  
같은 FastAPI 서비스 안에 있어도 내부 모듈 경계를 유지해야 한다.

## 14.4 Frontend (`apps/web`)

```text
apps/web/
├─ src/
│  ├─ app/
│  ├─ pages/
│  ├─ features/
│  │  ├─ run-monitor/
│  │  ├─ report-viewer/
│  │  ├─ project-management/
│  │  └─ scenario-builder/
│  ├─ entities/
│  ├─ shared/
│  ├─ api/
│  └─ websocket/
└─ package.json
```

## 14.5 Contracts (`packages/contracts`)

```text
packages/contracts/
├─ openapi/
│  └─ wedge_openapi.yaml
├─ mq/
│  ├─ run.execute.request.schema.json
│  ├─ analysis.request.schema.json
│  └─ report.export.request.schema.json
├─ websocket/
│  └─ events.schema.json
├─ internal/
│  ├─ runner-callback.schema.json
│  └─ analyzer-callback.schema.json
├─ mcp/
│  └─ tools.schema.json
└─ enums/
   └─ run-status.json
```

### 이 폴더를 꼭 두는 이유
- AI가 수정할 때 가장 먼저 참조할 기준 계약이 필요하다
- Spring/Runner/Analyzer/Web이 같은 enum과 payload 정의를 공유할 수 있다
- 문서와 실제 스키마가 가까워진다
- `wedge_openapi.yaml` 같은 기계 친화적 계약은 `docs/`가 아니라 이 위치를 기준으로 관리한다

---

# 15. 비즈니스/기술 규칙(팀 공통)

## 15.1 절대 원칙

1. Runner는 비즈니스 DB를 직접 쓰지 않는다
2. Analyzer는 비즈니스 DB를 직접 쓰지 않는다
3. 상태 전이는 Spring이 수행한다
4. 외부 에이전트는 low-level browser control을 기본적으로 사용하지 않는다
5. 모든 cross-service payload는 `packages/contracts`에 스키마를 둔다
6. 모든 메시지와 callback은 idempotent 해야 한다

## 15.2 구현 권장사항

- Idempotency-Key를 상태 변경 POST에 사용한다
- callback payload에는 반드시 `event_id`, `run_id`, `occurred_at`를 넣는다
- artifact는 DB에 blob로 저장하지 않는다
- raw log 전체보다 요약/구조화 저장을 우선한다
- 분석 결과는 버전 정보를 포함한다

---

# 16. 아직 남아 있지만 지금 당장 막지 않아도 되는 결정

아래 항목은 후속 결정으로 두어도 된다.

1. WebSocket 세부 payload 형태
2. 프레임 압축 포맷(WebP/JPEG)과 주기
3. report export worker 분리 여부
4. raw CDP/network dump 저장 정책의 세밀한 기준
5. MCP 세부 approval 예외 규칙
6. runner/analyzer autoscaling 정책

이 항목들은 현재 구조를 흔들지 않는 범위에서 후속 결정이 가능하다.

---

# 17. 지금 바로 구현에 들어갈 때의 우선순위

1. `packages/contracts` 초안 작성
2. PostgreSQL DDL 확정
3. Spring Application Service / API / Internal Callback 뼈대 생성
4. RabbitMQ exchange / queue / dead letter 구성
5. Node Runner에서 `run.execute.request` consume 및 callback 구현
6. WebSocket live event 뼈대 구현
7. FastAPI Analyzer에서 `analysis.request` consume 및 callback 구현
8. MCP tool façade를 Spring에 붙이기
9. Report export 기능 붙이기

---

# 18. 이 문서 기준 최종 권장안

다시 한 줄로 요약하면 다음과 같다.

**Wedge V1은 Spring을 기준 서버로 두고, Node Runner가 브라우저 실행을 담당하며, FastAPI Analyzer가 Why/Nudge 분석을 수행하고, RabbitMQ가 장시간 작업을 분배하며, PostgreSQL은 구조화된 데이터 저장, S3는 artifact 저장, WebSocket은 live monitor 표시, MCP는 Spring 내부에서 Wedge 기능을 외부 에이전트에 노출하는 구조로 구현하는 것을 권장한다.**

---

# 부록 A. 외부 호환성/표준 참고

아래 항목은 현재 설계의 외부 호환성 가정을 정리한 것이다.

- Spring Authorization Server는 OAuth 2.1 / OpenID Connect 1.0 기반의 경량·커스터마이즈 가능한 Authorization Server를 제공하며, Authorization Code, Client Credentials, Refresh Token, PKCE, JWT/opaque token, OIDC discovery/client registration 등을 지원한다.
- MCP 표준은 현재 `stdio`와 `Streamable HTTP`를 표준 transport로 정의한다.
- Claude Code는 원격 HTTP MCP 서버에 대한 OAuth 2.0 인증을 지원한다.
- OpenAI는 remote MCP server / connector를 Responses API와 ChatGPT 연동에 사용할 수 있고, OAuth access token을 `authorization` 필드로 넘길 수 있다.

문서화 시점 기준으로 위 가정을 사용한다.
