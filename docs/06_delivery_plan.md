# 06. Delivery and Jira Plan

이 문서는 Wedge의 **canonical delivery/Jira 실행 계획서**입니다.
기존 `06_delivery_plan.md`의 Sprint-level 계획과 `wedge_daily_jira_execution_plan.md`의 일별 Jira 등록 단위를 병합했습니다.

- Sprint 목표와 주요 backlog는 주간 planning/grooming 기준으로 사용합니다.
- 일별 계획의 `WDAY-*`는 Jira에 등록하기 전 임시 키입니다. 실제 Jira 등록 후에는 Jira key로 치환하거나 comment에 매핑합니다.
- Contract/API/DB/MQ/WebSocket/MCP 변경은 `packages/contracts`와 관련 문서를 먼저 갱신한 뒤 구현합니다.

## 1. 기간과 운영 캘린더

| 구분 | 기간 | 운영 메모 |
|---|---:|---|
| 전체 기간 | 2026-04-13 ~ 2026-06-02 | 월~금 기준, 1주 단위 Sprint |
| Sprint 0 / 기획 | 2026-04-13 ~ 2026-04-17 | 기획/설계 완료, Jira seed 준비 |
| 구현 시작 | 2026-04-20 | Sprint 1 착수 |
| Final | 2026-06-01 ~ 2026-06-02 | 최종 릴리즈/시연 |

### 휴무/버퍼

| 날짜 | 처리 |
|---|---|
| 2026-05-01 금요일 | 노동절, Sprint 2 버퍼로 처리 |
| 2026-05-05 화요일 | 어린이날, Sprint 3 휴무 |
| 2026-05-25 월요일 | 부처님오신날 대체공휴일, Sprint 6 휴무 |

## 2. 팀 역할과 책임

| 이름 | 역할 | 운영 기준 |
|---|---|---|
| 강보승 | Product/Tech Lead + Spring Architecture Lead | 방향성, Spring 구조, UX/Report 품질 기준, 최종 리뷰 |
| 차지훈 | Node Playwright Runner Lead + Full-stack Integration | Runner 실행 로직, ScenarioPlan 실행, WebSocket/UI 연동, MCP 최소판 |
| 장현준 | Infra Lead + Platform Reliability | RabbitMQ, S3, Docker/Jenkins, Runner 운영 안정성, 배포 |
| 정관우 | Spring Core Backend | Run/Step 상태, MyBatis, API, Queue 연동, 권한/상태 전이 |
| 박성환 | PM/Delivery Manager + Backend Support | Jira, 회의록, QA, 문서, Report/Evidence 백엔드 보조 |
| 유지호 | AI/Judge/Rule Lead | Rule Engine, Scoring, FastAPI Analyzer, LLM Explanation, Calibration |

## 3. Jira 등록 방식

| Type | 사용 기준 |
|---|---|
| Epic | 기능 영역 묶음. 먼저 `wedge_jira_epics.csv` 또는 Jira Epic으로 등록합니다. |
| Story | 데모 가능한 사용자 가치 단위. Sprint 목표와 주요 기능 흐름을 관리합니다. |
| Task | 그날 수행 가능한 구현/검증 단위. 일별 계획의 대부분은 Task로 등록합니다. |
| Sub-task | 큰 Story 하위 구현이 필요할 때만 사용합니다. 6명 팀에서는 처음부터 과도하게 만들지 않습니다. |
| Bug | 결함, 회귀, 데모 blocker |
| Spike | 조사/불확실성 해소 |

### 등록 원칙

1. 기본은 **Epic + Story + Task** 중심으로 등록합니다.
2. `WEDGE-*`는 Sprint backlog 관리용 key 후보, `WDAY-*`는 일별 등록용 임시 key입니다.
3. Jira 등록 시 `Epic`, `Component`, `Priority`, `Owner`, `완료 기준`, `의존성`을 함께 입력합니다.
4. 금요일 Sprint demo 이후 미완료 Task는 다음 Sprint backlog로 재분류합니다.

## 4. Epic 구성

| Epic Key | Epic Name | Owner | 설명 |
|---|---|---|---|
| WEDGE-EPIC-01 | Platform Foundation | 강보승 / 정관우 | Spring API, DB, Run lifecycle, core architecture |
| WEDGE-EPIC-02 | Browser Runner & Evidence Collection | 차지훈 / 장현준 | Node Playwright runner, ScenarioPlan execution, checkpoint/evidence collection |
| WEDGE-EPIC-03 | Judge Engine & AI Analyzer | 유지호 | Rule Engine, scoring, FastAPI analyzer, LLM explanation |
| WEDGE-EPIC-04 | Product UI & Report | 강보승 / 차지훈 | Run UI, Report UI, Evidence Card, Decision Map, Nudge Card |
| WEDGE-EPIC-05 | Realtime, MQ & Deployment | 장현준 | RabbitMQ, WebSocket, S3, Jenkins, Docker, runner reliability |
| WEDGE-EPIC-06 | MCP, OAuth & Agent Interface | 차지훈 / 정관우 | Spring MCP adapter, OAuth, external agent tool surface |
| WEDGE-EPIC-07 | Validation, Calibration & QA | 박성환 / 유지호 | Benchmark, labeling, rule calibration, regression QA |
| WEDGE-EPIC-08 | Project Management & Documentation | 박성환 | Jira, meeting notes, release notes, API/DB docs |

## 5. Sprint 목표와 릴리즈 게이트

| Sprint | Dates | Goal | Gate |
|---|---|---|---|
| Sprint 0 | 4/13–4/17 | 기획/설계 완료 | 구현 착수 가능한 문서, 역할, Jira seed 확보 |
| Sprint 1 | 4/20–4/24 | 프로젝트 기반 구축 | Spring/React/Runner/FastAPI/DB/MQ/S3 최소 실행 골격 |
| Sprint 2 | 4/27–5/1 | 첫 브라우저 실행과 Evidence 저장 | Landing CTA scenario E2E 최소 완성 |
| Sprint 3 | 5/4–5/8 | Rule Engine 1차와 첫 리포트 | EvidencePacket → JudgeResult → Report UI 연결 |
| Sprint 4 | 5/11–5/15 | 핵심 시나리오 3개와 리포트 완성 | Landing/Signup/Pricing + Rule 8~10개 + Report Share |
| Sprint 5 | 5/18–5/22 | Calibration과 안정화 | Benchmark labeling, false positive 조정, sharing/replay 안정화 |
| Sprint 6 | 5/25–5/29 | RC 안정화 | P0 bug 제거, 데모 시나리오 고정, 문서 최신화 |
| Final | 6/1–6/2 | 최종 릴리즈/시연 | 최종 release build, sample report, demo script 고정 |

### RC / Final 우선순위

1. P0 bug 0건
2. 데모 시나리오 2개 안정 실행
3. Sample report 2개 확보
4. API/DB/Contract 문서 최신화
5. Known issue / release note 문서화

## 6. Sprint Backlog 요약

### Site Discovery / Preflight 일정 오버레이

`rewritedocs.txt` 기준 변경으로 Sprint 1~5에는 URL-first Discovery와 Scenario Recommendation 작업이 포함된다. 기존 Run/Evidence/Judge 흐름을 폐기하지 않고, 정식 Run 앞에 lightweight Preflight를 추가한다.

| Sprint | 추가/조정 범위 |
|---|---|
| Sprint 1 | URL-first create flow UI skeleton, Discovery result mock UI, Discovery API skeleton, `site_discovery` / `scenario_recommendation` DB 초안, `discovery.execute.request` MQ contract 초안 |
| Sprint 2 | Runner discovery executor, first-view checkpoint collection, CTA/form/pricing/contact candidate extractor 1차, `POST /api/discoveries`, `GET /api/discoveries/{discoveryId}`, scenario recommendation mock 또는 rule-based 1차 |
| Sprint 3 | 실제 recommendation 생성, ScenarioRecommendation UI, Run 생성 시 `sourceDiscoveryId` 연결, `scenarioFitStatus` field 표시 |
| Sprint 4 | full run 안의 scenario fit check, scenario mismatch report, low-fit warning UI, guided custom scenario skeleton |
| Sprint 5 | mismatch benchmark case 검증, recommendation false positive/false negative 검토, recommendation threshold 조정 |

담당 배치:

- 강보승: Discovery UX flow, scenario recommendation 제품 기준
- 차지훈: Runner discovery executor, discovery UI/API integration
- 장현준: discovery MQ/runner infra, timeout/retry
- 정관우: discovery API, DB, status model
- 박성환: Jira/QA, discovery docs, recommendation table/API 보조
- 유지호: flow candidate extraction, recommendation logic, mismatch criteria

### Sprint 1 Backlog — 프로젝트 기반 구축

| Key | Type | Summary | Owner | Epic |
|---|---|---|---|---|
| WEDGE-101 | Story | Spring 프로젝트 구조와 package architecture 정의 | 강보승 | WEDGE-EPIC-01 |
| WEDGE-102 | Story | Spring Run/Step 기본 도메인과 MyBatis 설정 | 정관우 | WEDGE-EPIC-01 |
| WEDGE-103 | Task | PostgreSQL schema 1차 적용 | 정관우 | WEDGE-EPIC-01 |
| WEDGE-104 | Task | Artifact/Report 기본 DTO/Mapper 생성 | 박성환 | WEDGE-EPIC-01 |
| WEDGE-105 | Story | React app shell, routing, 기본 layout | 강보승 | WEDGE-EPIC-04 |
| WEDGE-106 | Task | Frontend API client 구조 | 차지훈 | WEDGE-EPIC-04 |
| WEDGE-107 | Task | RabbitMQ, S3, Docker, Jenkins 기본 구성 | 장현준 | WEDGE-EPIC-05 |
| WEDGE-108 | Story | Node Playwright Runner skeleton | 차지훈 | WEDGE-EPIC-02 |
| WEDGE-109 | Story | FastAPI Analyzer skeleton | 유지호 | WEDGE-EPIC-03 |
| WEDGE-110 | Task | P0 Rule 목록 최종 리뷰 | 유지호 / 강보승 | WEDGE-EPIC-03 |
| WEDGE-111 | Task | Jira workflow, issue template, 회의록 양식 정리 | 박성환 | WEDGE-EPIC-08 |

### Sprint 2 Backlog — 첫 브라우저 실행과 Evidence 저장

| Key | Type | Summary | Owner | Epic |
|---|---|---|---|---|
| WEDGE-201 | Story | Landing CTA ScenarioPlan 작성 | 유지호 | WEDGE-EPIC-03 |
| WEDGE-202 | Story | Signup/Lead Form ScenarioPlan 작성 | 유지호 | WEDGE-EPIC-03 |
| WEDGE-203 | Story | Playwright goto/click/fill/checkpoint action loop | 차지훈 | WEDGE-EPIC-02 |
| WEDGE-204 | Task | settle_strategy 처리 | 차지훈 | WEDGE-EPIC-02 |
| WEDGE-205 | Task | Runner S3 screenshot upload | 장현준 | WEDGE-EPIC-05 |
| WEDGE-206 | Task | Runner container 안정화 | 장현준 | WEDGE-EPIC-05 |
| WEDGE-207 | Story | Runner callback API 구현 | 정관우 | WEDGE-EPIC-01 |
| WEDGE-208 | Story | checkpoint/observation/artifact 저장 | 박성환 | WEDGE-EPIC-01 |
| WEDGE-209 | Task | Run 상태 전이 구현 | 정관우 | WEDGE-EPIC-01 |
| WEDGE-210 | Story | Run detail UI 1차 | 강보승 | WEDGE-EPIC-04 |
| WEDGE-211 | Task | Step timeline UI/API 연동 | 차지훈 | WEDGE-EPIC-04 |

### Sprint 3 Backlog — Rule Engine 1차와 첫 리포트

| Key | Type | Summary | Owner | Epic |
|---|---|---|---|---|
| WEDGE-301 | Story | RuleRegistry loader 구현 | 유지호 | WEDGE-EPIC-03 |
| WEDGE-302 | Story | P0 Rule 5개 구현 | 유지호 | WEDGE-EPIC-03 |
| WEDGE-303 | Task | severity/confidence/priority 계산 | 유지호 | WEDGE-EPIC-03 |
| WEDGE-304 | Task | LLM explanation generator 1차 | 유지호 | WEDGE-EPIC-03 |
| WEDGE-305 | Story | analysis.request queue 연동 | 정관우 / 장현준 | WEDGE-EPIC-05 |
| WEDGE-306 | Story | JudgeResult 저장 API | 박성환 | WEDGE-EPIC-01 |
| WEDGE-307 | Story | Report Summary API | 박성환 | WEDGE-EPIC-01 |
| WEDGE-308 | Story | Report Summary / Top Issues UI | 강보승 | WEDGE-EPIC-04 |
| WEDGE-309 | Story | Evidence Card UI 1차 | 차지훈 | WEDGE-EPIC-04 |
| WEDGE-310 | Task | WebSocket progress event 1차 | 차지훈 | WEDGE-EPIC-04 |

### Sprint 4 Backlog — 핵심 시나리오와 리포트 완성

| Key | Type | Summary | Owner | Epic |
|---|---|---|---|---|
| WEDGE-401 | Story | Pricing ScenarioPlan 작성 | 유지호 | WEDGE-EPIC-03 |
| WEDGE-402 | Story | Pricing scenario Runner flow | 차지훈 | WEDGE-EPIC-02 |
| WEDGE-403 | Task | Invalid form submit action | 차지훈 | WEDGE-EPIC-02 |
| WEDGE-404 | Task | Runner timeout/retry 1차 | 장현준 | WEDGE-EPIC-05 |
| WEDGE-405 | Story | P0 Rule 8~10개 확장 | 유지호 | WEDGE-EPIC-03 |
| WEDGE-406 | Story | Decision Map UI | 강보승 | WEDGE-EPIC-04 |
| WEDGE-407 | Story | Nudge Card UI | 차지훈 | WEDGE-EPIC-04 |
| WEDGE-408 | Story | Report Detail / Share API | 박성환 | WEDGE-EPIC-01 |
| WEDGE-409 | Task | Report permission check | 정관우 | WEDGE-EPIC-01 |

### Sprint 5 Backlog — Calibration과 안정화

| Key | Type | Summary | Owner | Epic |
|---|---|---|---|---|
| WEDGE-501 | Story | Benchmark URL 20개 수집 | 박성환 / 유지호 | WEDGE-EPIC-07 |
| WEDGE-502 | Task | Manual labeling sheet 작성 | 박성환 / 유지호 | WEDGE-EPIC-07 |
| WEDGE-503 | Task | 전원 benchmark labeling 1차 | 전원 | WEDGE-EPIC-07 |
| WEDGE-504 | Story | Rule false positive 분석 | 유지호 | WEDGE-EPIC-07 |
| WEDGE-505 | Task | 초기 Rule threshold 조정 | 유지호 | WEDGE-EPIC-07 |
| WEDGE-506 | Story | processed_message / idempotency 적용 | 정관우 | WEDGE-EPIC-01 |
| WEDGE-507 | Task | callback 중복 처리 | 박성환 | WEDGE-EPIC-01 |
| WEDGE-508 | Story | soft delete: project/run/report | 정관우 / 박성환 | WEDGE-EPIC-01 |
| WEDGE-509 | Story | WebSocket reconnect 처리 | 차지훈 | WEDGE-EPIC-04 |
| WEDGE-510 | Story | Runner timeout/retry/logging 안정화 | 장현준 | WEDGE-EPIC-05 |
| WEDGE-511 | Task | Report UI polish | 강보승 | WEDGE-EPIC-04 |

### Sprint 6 / Final Backlog — RC 안정화와 최종 시연

Sprint 6와 Final은 신규 기능보다 안정화, 문서화, 시연 재현성에 집중합니다.

| Area | Priority | 완료 기준 |
|---|---|---|
| Bug triage | P0 | P0 bug owner 지정, release blocker 여부 결정 |
| Demo scenario | P0 | 최종 demo URL/script 2개 이상 안정 실행 |
| Sample report | P0 | 공유 가능한 sample report 2개 확보 |
| Docs/Contracts | P0 | API/DB/Contract 문서가 구현 상태와 일치 |
| MCP/OAuth minimum | P1 | MCP read tool 1~2개와 OAuth/Security limitation 검증 |
| Release note | P0 | Known issue와 release note 최종화 |

## 7. 일별 Jira 실행 계획

### 2026-04-13 (월) — Sprint 0
**Day Goal:** 기획/설계 완료 내용 정리와 구현 착수 준비

| Jira Temp Key | 담당 | Epic | Component | Priority | 그날 할 일 | 완료 기준 | 의존성 |
|---|---|---|---|---|---|---|---|
| WDAY-001 | 강보승 | WEDGE-EPIC-08 | pm | P2 | PRD 핵심 문제/가치 제안 정리 | PRD 핵심 정의와 V1 목표가 문서화되어 팀에 공유됨 |  |
| WDAY-002 | 박성환 | WEDGE-EPIC-08 | pm | P2 | 기획 산출물/회의록 저장 구조 생성 | 기획 문서와 회의록 위치가 정해지고 링크가 공유됨 |  |

### 2026-04-14 (화) — Sprint 0
**Day Goal:** 기획/설계 완료 내용 정리와 구현 착수 준비

| Jira Temp Key | 담당 | Epic | Component | Priority | 그날 할 일 | 완료 기준 | 의존성 |
|---|---|---|---|---|---|---|---|
| WDAY-003 | 강보승 | WEDGE-EPIC-01 | spring-api | P2 | 초기 기술 스택/역할 분리안 정리 | 서버별 역할과 책임 경계가 결정 문서에 반영됨 |  |
| WDAY-004 | 장현준 | WEDGE-EPIC-05 | infra | P2 | 인프라 후보 검토 | 인프라 기본 선택지가 문서화됨 |  |

### 2026-04-15 (수) — Sprint 0
**Day Goal:** 기획/설계 완료 내용 정리와 구현 착수 준비

| Jira Temp Key | 담당 | Epic | Component | Priority | 그날 할 일 | 완료 기준 | 의존성 |
|---|---|---|---|---|---|---|---|
| WDAY-005 | 유지호 | WEDGE-EPIC-03 | analyzer | P2 | Judge/Evidence 구조 리뷰 | P0 rule 후보와 scoring 방향이 정리됨 |  |
| WDAY-006 | 강보승 | WEDGE-EPIC-04 | report | P2 | Report 결과물 UX 방향 정리 | 리포트 구성 초안이 문서화됨 |  |

### 2026-04-16 (목) — Sprint 0
**Day Goal:** 기획/설계 완료 내용 정리와 구현 착수 준비

| Jira Temp Key | 담당 | Epic | Component | Priority | 그날 할 일 | 완료 기준 | 의존성 |
|---|---|---|---|---|---|---|---|
| WDAY-007 | 강보승 | WEDGE-EPIC-01 | spring-api | P2 | DB/API/MQ/MCP 결정 초안 정리 | 핵심 기술 결정사항이 문서화됨 |  |
| WDAY-008 | 정관우 | WEDGE-EPIC-01 | database | P2 | Spring/MyBatis 관점 스키마 검토 | 스키마 이슈와 수정 의견이 기록됨 |  |

### 2026-04-17 (금) — Sprint 0
**Day Goal:** 기획/설계 완료 내용 정리와 구현 착수 준비

| Jira Temp Key | 담당 | Epic | Component | Priority | 그날 할 일 | 완료 기준 | 의존성 |
|---|---|---|---|---|---|---|---|
| WDAY-009 | 박성환 | WEDGE-EPIC-08 | pm | P2 | 초기 Backlog 초안 작성 | 초기 Jira 후보 backlog가 작성됨 |  |
| WDAY-010 | 강보승 | WEDGE-EPIC-08 | pm | P2 | Sprint 1 착수 기준 확정 | Sprint 1 목표와 팀 역할이 공유됨 |  |

### 2026-04-20 (월) — Sprint 1
**Day Goal:** 프로젝트 기반 구축: Spring/React/Runner/FastAPI/DB/MQ/S3 최소 실행 골격

| Jira Temp Key | 담당 | Epic | Component | Priority | 그날 할 일 | 완료 기준 | 의존성 |
|---|---|---|---|---|---|---|---|
| WDAY-011 | 강보승 | WEDGE-EPIC-01 | spring-api | P0 | Spring 아키텍처 기준선 확정 | 패키지 구조안과 코드 리뷰 기준이 문서화되고 팀에 공유됨 |  |
| WDAY-012 | 차지훈 | WEDGE-EPIC-02 | runner | P0 | Node Runner repository skeleton 생성 | Runner가 로컬에서 실행되고 기본 entrypoint가 존재함 |  |
| WDAY-013 | 장현준 | WEDGE-EPIC-05 | infra | P0 | 개발용 Docker Compose 초안 작성 | 로컬 infra compose up이 가능하고 서비스 endpoint가 확인됨 |  |
| WDAY-014 | 정관우 | WEDGE-EPIC-01 | spring-api | P0 | Spring Boot 프로젝트 초기화 | Spring app이 실행되고 DB connection 확인됨 |  |
| WDAY-015 | 박성환 | WEDGE-EPIC-08 | pm | P0 | Jira Epic/Workflow 등록 | Jira board에 Epic과 기본 workflow가 생성됨 |  |
| WDAY-016 | 유지호 | WEDGE-EPIC-03 | analyzer | P0 | FastAPI/RuleRegistry skeleton 생성 | FastAPI healthcheck와 RuleRegistry placeholder가 동작함 |  |

### 2026-04-21 (화) — Sprint 1
**Day Goal:** 프로젝트 기반 구축: Spring/React/Runner/FastAPI/DB/MQ/S3 최소 실행 골격

| Jira Temp Key | 담당 | Epic | Component | Priority | 그날 할 일 | 완료 기준 | 의존성 |
|---|---|---|---|---|---|---|---|
| WDAY-017 | 강보승 | WEDGE-EPIC-01 | spring-api | P0 | Run 상태 모델/API naming 리뷰 | Run 상태 모델과 API naming rule이 문서화됨 | WDAY-011 |
| WDAY-018 | 차지훈 | WEDGE-EPIC-02 | runner | P0 | ScenarioPlan loader 초안 구현 | sample scenario plan을 load하고 step count를 출력함 | WDAY-012 |
| WDAY-019 | 장현준 | WEDGE-EPIC-05 | infra | P0 | RabbitMQ exchange/queue 초안 구성 | RabbitMQ management UI에서 queue/binding이 확인됨 | WDAY-013 |
| WDAY-020 | 정관우 | WEDGE-EPIC-01 | database | P0 | Project/Run/Step Mapper 초안 | 기본 insert/select mapper 테스트가 통과함 | WDAY-014 |
| WDAY-021 | 박성환 | WEDGE-EPIC-01 | database | P1 | Artifact/Report DTO/Mapper 초안 | artifact/report 기본 select/insert skeleton이 존재함 | WDAY-014 |
| WDAY-022 | 유지호 | WEDGE-EPIC-03 | analyzer | P0 | P0 criteria 상세 명세 정리 | P0 5개 rule 명세가 markdown 또는 registry 초안에 반영됨 | WDAY-016 |

### 2026-04-22 (수) — Sprint 1
**Day Goal:** 프로젝트 기반 구축: Spring/React/Runner/FastAPI/DB/MQ/S3 최소 실행 골격

| Jira Temp Key | 담당 | Epic | Component | Priority | 그날 할 일 | 완료 기준 | 의존성 |
|---|---|---|---|---|---|---|---|
| WDAY-023 | 강보승 | WEDGE-EPIC-04 | frontend | P0 | Run 생성 화면 UX skeleton | React 화면에서 입력 form이 표시됨 | WDAY-017 |
| WDAY-024 | 차지훈 | WEDGE-EPIC-04 | frontend | P0 | Frontend API client 구조 구현 | Run 생성 API 호출 함수가 mock 또는 실제 API로 동작함 | WDAY-023 |
| WDAY-025 | 장현준 | WEDGE-EPIC-05 | infra | P0 | RabbitMQ dummy publish/consume 검증 | dummy message가 consume되고 로그로 확인됨 | WDAY-019 |
| WDAY-026 | 정관우 | WEDGE-EPIC-01 | spring-api | P0 | /api/runs 생성/조회 API 1차 | POST/GET /api/runs가 기본 응답을 반환함 | WDAY-020 |
| WDAY-027 | 박성환 | WEDGE-EPIC-08 | docs | P1 | API 공통 응답/에러 예시 정리 | API response example 문서가 작성됨 | WDAY-022,WDAY-026 |
| WDAY-028 | 유지호 | WEDGE-EPIC-03 | analyzer | P0 | First-view observation mapping 정의 | Observation 필드 정의가 RuleRegistry와 Evidence contract에 반영됨 | WDAY-022 |

### 2026-04-23 (목) — Sprint 1
**Day Goal:** 프로젝트 기반 구축: Spring/React/Runner/FastAPI/DB/MQ/S3 최소 실행 골격

| Jira Temp Key | 담당 | Epic | Component | Priority | 그날 할 일 | 완료 기준 | 의존성 |
|---|---|---|---|---|---|---|---|
| WDAY-029 | 강보승 | WEDGE-EPIC-08 | pm | P0 | PR/Code Review 기준 확정 | 팀별 PR reviewer 규칙이 문서화됨 |  |
| WDAY-030 | 차지훈 | WEDGE-EPIC-02 | runner | P0 | Runner dummy consume + callback 구현 | Runner가 accepted callback을 Spring에 보냄 | WDAY-024,WDAY-025 |
| WDAY-031 | 장현준 | WEDGE-EPIC-05 | infra | P0 | Runner container base 구성 | container 안에서 Playwright basic launch가 성공함 | WDAY-013,WDAY-024 |
| WDAY-032 | 정관우 | WEDGE-EPIC-01 | spring-api | P0 | Internal runner callback skeleton | internal callback endpoint가 요청을 수신하고 로그를 남김 | WDAY-026 |
| WDAY-033 | 박성환 | WEDGE-EPIC-08 | docs | P1 | Runner callback payload 예시 작성 | callback payload examples가 docs에 추가됨 | WDAY-028 |
| WDAY-034 | 유지호 | WEDGE-EPIC-03 | analyzer | P0 | EvidencePacket fixture 검증 | Rule Engine 입력 최소 필드 체크리스트가 작성됨 | WDAY-027 |

### 2026-04-24 (금) — Sprint 1
**Day Goal:** 프로젝트 기반 구축: Spring/React/Runner/FastAPI/DB/MQ/S3 최소 실행 골격

| Jira Temp Key | 담당 | Epic | Component | Priority | 그날 할 일 | 완료 기준 | 의존성 |
|---|---|---|---|---|---|---|---|
| WDAY-035 | 강보승 | WEDGE-EPIC-08 | pm | P0 | Sprint 1 통합 리뷰와 Sprint 2 범위 확정 | Sprint 2 목표와 blocker가 정리됨 | WDAY-029,WDAY-030,WDAY-031,WDAY-032 |
| WDAY-036 | 차지훈 | WEDGE-EPIC-02 | runner | P0 | Runner dummy integration demo 준비 | 팀이 runner dummy flow를 재현 가능함 | WDAY-030 |
| WDAY-037 | 장현준 | WEDGE-EPIC-05 | infra | P0 | CI/Jenkins base build 확인 | Jenkins에서 최소 build가 성공함 | WDAY-031 |
| WDAY-038 | 정관우 | WEDGE-EPIC-01 | database | P0 | DB migration 점검 | migration 재실행/초기화 절차가 확인됨 | WDAY-020,WDAY-026 |
| WDAY-039 | 박성환 | WEDGE-EPIC-08 | pm | P0 | Sprint 1 회고/Jira 상태 정리 | Sprint 1 회고와 Sprint 2 backlog가 정리됨 |  |
| WDAY-040 | 유지호 | WEDGE-EPIC-03 | analyzer | P0 | Rule Engine 착수 준비 점검 | Evidence 수집 요구사항이 Runner 팀에 전달됨 | WDAY-027 |

### 2026-04-27 (월) — Sprint 2
**Day Goal:** 첫 브라우저 실행과 Evidence 저장: Landing CTA scenario E2E 최소 완성

| Jira Temp Key | 담당 | Epic | Component | Priority | 그날 할 일 | 완료 기준 | 의존성 |
|---|---|---|---|---|---|---|---|
| WDAY-041 | 강보승 | WEDGE-EPIC-04 | frontend | P0 | Run detail UX와 checkpoint 표시 기준 확정 | Run detail UI 구조가 팀에 공유됨 |  |
| WDAY-042 | 차지훈 | WEDGE-EPIC-02 | runner | P0 | Playwright goto action 구현 | goto→settle 함수가 동작하고 로그가 남음 | WDAY-030,WDAY-031 |
| WDAY-043 | 장현준 | WEDGE-EPIC-05 | infra | P0 | Runner container에서 Playwright browser dependency 검증 | containerized runner에서 example.com screenshot 가능 | WDAY-031 |
| WDAY-044 | 정관우 | WEDGE-EPIC-01 | spring-api | P0 | Runner callback 상세 계약 확정 | callback contract가 문서와 endpoint skeleton에 반영됨 | WDAY-032 |
| WDAY-045 | 박성환 | WEDGE-EPIC-01 | database | P0 | checkpoint/artifact 저장 mapper 초안 | checkpoint/artifact insert mapper skeleton이 존재함 | WDAY-022 |
| WDAY-046 | 유지호 | WEDGE-EPIC-03 | analyzer | P0 | Landing CTA ScenarioPlan 작성 | sample-scenario-plan landing 버전이 저장됨 | WDAY-027 |

### 2026-04-28 (화) — Sprint 2
**Day Goal:** 첫 브라우저 실행과 Evidence 저장: Landing CTA scenario E2E 최소 완성

| Jira Temp Key | 담당 | Epic | Component | Priority | 그날 할 일 | 완료 기준 | 의존성 |
|---|---|---|---|---|---|---|---|
| WDAY-047 | 강보승 | WEDGE-EPIC-04 | frontend | P0 | Run detail 화면 구현 시작 | Run detail route가 표시되고 API placeholder와 연결됨 | WDAY-035 |
| WDAY-048 | 차지훈 | WEDGE-EPIC-02 | runner | P0 | goto→settle→checkpoint 구현 | 첫 checkpoint JSON이 생성됨 | WDAY-036 |
| WDAY-049 | 장현준 | WEDGE-EPIC-05 | infra | P0 | Screenshot S3 upload 연결 | screenshot artifact URL/key가 생성됨 | WDAY-037 |
| WDAY-050 | 정관우 | WEDGE-EPIC-01 | spring-api | P0 | callback 수신 후 Run/Step 상태 갱신 | accepted/step callback 후 DB 상태가 갱신됨 | WDAY-038 |
| WDAY-051 | 박성환 | WEDGE-EPIC-01 | database | P0 | checkpoint 저장 API/mapper 구현 | checkpoint insert 후 run_id로 조회 가능 | WDAY-039 |
| WDAY-052 | 유지호 | WEDGE-EPIC-03 | analyzer | P0 | First-view observation 후보 정의 | observation field list가 Runner/Analyzer에 공유됨 | WDAY-040 |

### 2026-04-29 (수) — Sprint 2
**Day Goal:** 첫 브라우저 실행과 Evidence 저장: Landing CTA scenario E2E 최소 완성

| Jira Temp Key | 담당 | Epic | Component | Priority | 그날 할 일 | 완료 기준 | 의존성 |
|---|---|---|---|---|---|---|---|
| WDAY-053 | 강보승 | WEDGE-EPIC-04 | frontend | P0 | Run detail screenshot/step 표시 연결 | UI에서 step status와 screenshot ref가 보임 | WDAY-041 |
| WDAY-054 | 차지훈 | WEDGE-EPIC-02 | runner | P0 | click/fill action 구현 | sample signup scenario의 click/fill step이 실행됨 | WDAY-042 |
| WDAY-055 | 장현준 | WEDGE-EPIC-05 | infra | P0 | Runner failure trace/log 저장 방식 정리 | failure artifact 저장 정책이 문서화됨 | WDAY-043 |
| WDAY-056 | 정관우 | WEDGE-EPIC-01 | spring-api | P0 | Step 상태 모델 구현 | step 상태 전이 테스트가 통과함 | WDAY-044 |
| WDAY-057 | 박성환 | WEDGE-EPIC-01 | database | P0 | observation/artifact metadata 저장 | checkpoint→observation/artifact 관계가 DB에 저장됨 | WDAY-045 |
| WDAY-058 | 유지호 | WEDGE-EPIC-03 | analyzer | P0 | Signup/Lead Form ScenarioPlan 작성 | signup scenario sample이 저장되고 loader 검증 통과 | WDAY-040 |

### 2026-04-30 (목) — Sprint 2
**Day Goal:** 첫 브라우저 실행과 Evidence 저장: Landing CTA scenario E2E 최소 완성

| Jira Temp Key | 담당 | Epic | Component | Priority | 그날 할 일 | 완료 기준 | 의존성 |
|---|---|---|---|---|---|---|---|
| WDAY-059 | 강보승 | WEDGE-EPIC-04 | frontend | P0 | Landing scenario E2E UI 검증 | UI QA 이슈가 Jira에 등록됨 | WDAY-047 |
| WDAY-060 | 차지훈 | WEDGE-EPIC-02 | runner | P0 | Landing CTA scenario E2E 실행 | 2개 URL 중 1개 이상 checkpoint 2개 이상 생성 | WDAY-048 |
| WDAY-061 | 장현준 | WEDGE-EPIC-05 | infra | P0 | S3/RabbitMQ/Runner 로그 점검 | E2E 로그가 추적 가능하고 artifact upload 실패가 없음 | WDAY-049 |
| WDAY-062 | 정관우 | WEDGE-EPIC-01 | spring-api | P0 | 상태 전이 bug fix | E2E 후 run 상태가 올바르게 저장됨 | WDAY-050 |
| WDAY-063 | 박성환 | WEDGE-EPIC-01 | database | P0 | Evidence 저장 결과 검증 | DB 검증 결과와 누락 이슈가 문서화됨 | WDAY-051 |
| WDAY-064 | 유지호 | WEDGE-EPIC-03 | analyzer | P0 | 수집 observation 품질 검토 | 부족한 observation 목록이 Runner 팀에 전달됨 | WDAY-052 |

### 2026-05-01 (금) — Sprint 2
**Day Goal:** 노동절 휴무/버퍼: blocker만 정리

| Jira Temp Key | 담당 | Epic | Component | Priority | 그날 할 일 | 완료 기준 | 의존성 |
|---|---|---|---|---|---|---|---|
| WDAY-065 | 박성환 | WEDGE-EPIC-08 | pm | P2 | 노동절 버퍼: Sprint 2 상태 정리 | Sprint 2 remaining issue가 정리됨 |  |

### 2026-05-04 (월) — Sprint 3
**Day Goal:** Rule Engine 1차와 첫 리포트: EvidencePacket → JudgeResult → Report UI 연결

| Jira Temp Key | 담당 | Epic | Component | Priority | 그날 할 일 | 완료 기준 | 의존성 |
|---|---|---|---|---|---|---|---|
| WDAY-066 | 강보승 | WEDGE-EPIC-04 | report | P0 | 첫 리포트 UX 기준 정의 | Report UI 우선순위와 문장 톤 기준이 정리됨 |  |
| WDAY-067 | 차지훈 | WEDGE-EPIC-04 | frontend | P0 | Evidence Card UI skeleton | Evidence Card component가 mock 데이터로 렌더링됨 | WDAY-053 |
| WDAY-068 | 장현준 | WEDGE-EPIC-05 | infra | P0 | FastAPI analyzer container 연결 | Spring 또는 MQ에서 analyzer endpoint 접근 가능 | WDAY-058 |
| WDAY-069 | 정관우 | WEDGE-EPIC-01 | spring-api | P0 | execution 완료 후 analysis.request 발행 | execution_finished 이벤트 후 analysis_status=QUEUED | WDAY-050 |
| WDAY-070 | 박성환 | WEDGE-EPIC-01 | database | P0 | JudgeResult 저장 구조 구현 시작 | analysis result 저장 DTO/mapper skeleton 존재 | WDAY-051 |
| WDAY-071 | 유지호 | WEDGE-EPIC-03 | analyzer | P0 | RuleRegistry loader 구현 | registry 파일 로드와 rule count 출력 성공 | WDAY-052 |

### 2026-05-05 (화) — Sprint 3
**Day Goal:** 어린이날 휴무

| Jira Temp Key | 담당 | Epic | Component | Priority | 그날 할 일 | 완료 기준 | 의존성 |
|---|---|---|---|---|---|---|---|
| WDAY-072 | 박성환 | WEDGE-EPIC-08 | pm | P2 | 어린이날 휴무: 작업 배정 없음 | 업데이트가 필요한 blocker만 Jira comment로 남김 |  |

### 2026-05-06 (수) — Sprint 3
**Day Goal:** Rule Engine 1차와 첫 리포트: EvidencePacket → JudgeResult → Report UI 연결

| Jira Temp Key | 담당 | Epic | Component | Priority | 그날 할 일 | 완료 기준 | 의존성 |
|---|---|---|---|---|---|---|---|
| WDAY-073 | 강보승 | WEDGE-EPIC-04 | report | P0 | Report Summary UI 구현 | summary block이 mock 또는 API 데이터로 렌더링됨 | WDAY-054 |
| WDAY-074 | 차지훈 | WEDGE-EPIC-04 | frontend | P0 | Evidence Card evidence_refs 표시 | Evidence Card에서 evidence ref가 보임 | WDAY-055 |
| WDAY-075 | 장현준 | WEDGE-EPIC-05 | infra | P0 | Analyzer queue consume 안정화 | analysis job이 analyzer에서 처리 시작됨 | WDAY-057 |
| WDAY-076 | 정관우 | WEDGE-EPIC-01 | spring-api | P0 | AnalysisJob 상태 전이 구현 | analysis status가 DB에 정확히 반영됨 | WDAY-057 |
| WDAY-077 | 박성환 | WEDGE-EPIC-01 | database | P0 | issue/finding 저장 mapper 구현 | finding 조회 API에서 저장 결과 확인 가능 | WDAY-059 |
| WDAY-078 | 유지호 | WEDGE-EPIC-03 | analyzer | P0 | P0 Rule 3개 구현 | sample evidence로 3개 rule 결과가 생성됨 | WDAY-060 |

### 2026-05-07 (목) — Sprint 3
**Day Goal:** Rule Engine 1차와 첫 리포트: EvidencePacket → JudgeResult → Report UI 연결

| Jira Temp Key | 담당 | Epic | Component | Priority | 그날 할 일 | 완료 기준 | 의존성 |
|---|---|---|---|---|---|---|---|
| WDAY-079 | 강보승 | WEDGE-EPIC-04 | report | P0 | Top Issues UI 구현 | Report에서 top issue list가 표시됨 | WDAY-066 |
| WDAY-080 | 차지훈 | WEDGE-EPIC-04 | websocket | P1 | WebSocket run progress event 1차 | UI에서 progress event를 받아 상태를 갱신함 | WDAY-063 |
| WDAY-081 | 장현준 | WEDGE-EPIC-05 | infra | P0 | Analyzer timeout/log 처리 | analysis 실패 시 error log와 status가 남음 | WDAY-064 |
| WDAY-082 | 정관우 | WEDGE-EPIC-01 | spring-api | P0 | 분석 완료 후 run.analysis_status 갱신 | analysis 완료 후 run 조회에서 COMPLETED 확인 | WDAY-063 |
| WDAY-083 | 박성환 | WEDGE-EPIC-01 | spring-api | P0 | Report Summary API 구현 | Report Summary UI가 호출 가능한 API 존재 | WDAY-065 |
| WDAY-084 | 유지호 | WEDGE-EPIC-03 | analyzer | P0 | P0 Rule 2개 추가 + LLM explanation 1차 | sample judge result에 summary/recommendation 생성 | WDAY-066 |

### 2026-05-08 (금) — Sprint 3
**Day Goal:** Rule Engine 1차와 첫 리포트: EvidencePacket → JudgeResult → Report UI 연결

| Jira Temp Key | 담당 | Epic | Component | Priority | 그날 할 일 | 완료 기준 | 의존성 |
|---|---|---|---|---|---|---|---|
| WDAY-085 | 강보승 | WEDGE-EPIC-04 | report | P0 | 첫 Judge Report 사용자-facing 리뷰 | 수정 필요한 문장/우선순위 이슈가 Jira에 등록됨 | WDAY-066,WDAY-067 |
| WDAY-086 | 차지훈 | WEDGE-EPIC-04 | frontend | P0 | Report UI bug fix | Demo에서 report 화면이 깨지지 않음 | WDAY-068 |
| WDAY-087 | 장현준 | WEDGE-EPIC-05 | infra | P0 | Infra/Runner stability check | E2E 실패 로그가 식별 가능함 | WDAY-069 |
| WDAY-088 | 정관우 | WEDGE-EPIC-01 | spring-api | P0 | Backend integration bug fix | Run→Report API 흐름이 성공함 | WDAY-069 |
| WDAY-089 | 박성환 | WEDGE-EPIC-07 | qa-calibration | P0 | Sprint 3 QA checklist 작성 | Sprint 4부터 사용할 QA checklist가 작성됨 |  |
| WDAY-090 | 유지호 | WEDGE-EPIC-03 | analyzer | P0 | Rule 결과와 LLM 문장 검토 | unsupported claim 목록이 0개 또는 known issue로 정리됨 | WDAY-067 |

### 2026-05-11 (월) — Sprint 4
**Day Goal:** 핵심 시나리오 완성: Landing/Signup/Pricing + Rule 8~10개 + Report Share

| Jira Temp Key | 담당 | Epic | Component | Priority | 그날 할 일 | 완료 기준 | 의존성 |
|---|---|---|---|---|---|---|---|
| WDAY-091 | 강보승 | WEDGE-EPIC-04 | report | P0 | 리포트 완성도 기준 정리 | Sprint 4 report acceptance 기준이 공유됨 |  |
| WDAY-092 | 차지훈 | WEDGE-EPIC-02 | runner | P0 | Pricing Runner flow 설계 | pricing scenario step 설계가 완료됨 | WDAY-071 |
| WDAY-093 | 장현준 | WEDGE-EPIC-05 | infra | P0 | Runner timeout/retry 정책 초안 | timeout/retry 정책이 문서화됨 |  |
| WDAY-094 | 정관우 | WEDGE-EPIC-01 | spring-api | P0 | Report permission 구조 설계 | 권한 체크 service interface가 정의됨 |  |
| WDAY-095 | 박성환 | WEDGE-EPIC-01 | spring-api | P0 | Report Detail API 초안 | Report detail response DTO가 정의됨 | WDAY-065 |
| WDAY-096 | 유지호 | WEDGE-EPIC-03 | analyzer | P0 | Pricing ScenarioPlan 작성 | pricing scenario sample이 loader 검증 통과 | WDAY-067 |

### 2026-05-12 (화) — Sprint 4
**Day Goal:** 핵심 시나리오 완성: Landing/Signup/Pricing + Rule 8~10개 + Report Share

| Jira Temp Key | 담당 | Epic | Component | Priority | 그날 할 일 | 완료 기준 | 의존성 |
|---|---|---|---|---|---|---|---|
| WDAY-097 | 강보승 | WEDGE-EPIC-04 | report | P0 | Decision Map UI 구현 시작 | Decision Map이 mock 또는 API 데이터로 표시됨 | WDAY-074 |
| WDAY-098 | 차지훈 | WEDGE-EPIC-02 | runner | P0 | Pricing scenario 실행 + invalid form submit action | pricing/form scenario가 최소 1개 사이트에서 실행됨 | WDAY-072 |
| WDAY-099 | 장현준 | WEDGE-EPIC-05 | infra | P0 | Timeout/retry와 failure logging 구현 | timeout 발생 시 failure reason과 artifact가 남음 | WDAY-073 |
| WDAY-100 | 정관우 | WEDGE-EPIC-01 | spring-api | P0 | Report 권한 체크 구현 | 권한 없는 report 접근이 거부됨 | WDAY-075 |
| WDAY-101 | 박성환 | WEDGE-EPIC-01 | spring-api | P0 | Nudge persistence 구조 구현 | nudge가 analysis result와 함께 저장/조회됨 | WDAY-077 |
| WDAY-102 | 유지호 | WEDGE-EPIC-03 | analyzer | P0 | FRICTION-FORM-003 구현 | sample invalid form evidence에서 rule hit 생성 | WDAY-073 |

### 2026-05-13 (수) — Sprint 4
**Day Goal:** 핵심 시나리오 완성: Landing/Signup/Pricing + Rule 8~10개 + Report Share

| Jira Temp Key | 담당 | Epic | Component | Priority | 그날 할 일 | 완료 기준 | 의존성 |
|---|---|---|---|---|---|---|---|
| WDAY-103 | 강보승 | WEDGE-EPIC-04 | report | P0 | Decision Map UI 완성 | stage 클릭 시 관련 issue가 확인됨 | WDAY-078 |
| WDAY-104 | 차지훈 | WEDGE-EPIC-04 | report | P0 | Nudge Card UI 구현 | Nudge Card가 report detail에 표시됨 | WDAY-081 |
| WDAY-105 | 장현준 | WEDGE-EPIC-05 | infra | P0 | Runner stability check | 반복 실행 로그와 실패 원인이 기록됨 | WDAY-079 |
| WDAY-106 | 정관우 | WEDGE-EPIC-01 | spring-api | P0 | report_share 권한/토큰 검증 | share token으로 report 접근 가능, revoked는 불가 | WDAY-080 |
| WDAY-107 | 박성환 | WEDGE-EPIC-01 | spring-api | P0 | Report share API 구현 | share URL 생성 API가 동작함 | WDAY-080 |
| WDAY-108 | 유지호 | WEDGE-EPIC-03 | analyzer | P0 | Contrast/Target Size Rule 구현 | sample evidence로 2개 rule 결과 생성 | WDAY-077 |

### 2026-05-14 (목) — Sprint 4
**Day Goal:** 핵심 시나리오 완성: Landing/Signup/Pricing + Rule 8~10개 + Report Share

| Jira Temp Key | 담당 | Epic | Component | Priority | 그날 할 일 | 완료 기준 | 의존성 |
|---|---|---|---|---|---|---|---|
| WDAY-109 | 강보승 | WEDGE-EPIC-04 | report | P0 | Report UX 문장/우선순위 검토 | 수정 이슈가 Jira에 등록됨 | WDAY-084 |
| WDAY-110 | 차지훈 | WEDGE-EPIC-02 | runner | P0 | Landing/Signup/Pricing E2E 통합 실행 | 3개 시나리오 중 2개 이상 E2E 성공 | WDAY-078,WDAY-079 |
| WDAY-111 | 장현준 | WEDGE-EPIC-05 | infra | P0 | Runner/Infra bug fix | P0 infra blocker가 없음 | WDAY-085 |
| WDAY-112 | 정관우 | WEDGE-EPIC-01 | spring-api | P0 | 상태 전이/report API bug fix | E2E 후 상태와 report 조회가 일관됨 | WDAY-086 |
| WDAY-113 | 박성환 | WEDGE-EPIC-07 | qa-calibration | P0 | Share URL/Report API QA | QA 결과가 Jira에 기록됨 | WDAY-087 |
| WDAY-114 | 유지호 | WEDGE-EPIC-03 | analyzer | P0 | Rule 8~10개 결과 검토 | evidence_refs 누락 issue가 정리됨 | WDAY-083 |

### 2026-05-15 (금) — Sprint 4
**Day Goal:** 핵심 시나리오 완성: Landing/Signup/Pricing + Rule 8~10개 + Report Share

| Jira Temp Key | 담당 | Epic | Component | Priority | 그날 할 일 | 완료 기준 | 의존성 |
|---|---|---|---|---|---|---|---|
| WDAY-115 | 강보승 | WEDGE-EPIC-08 | pm | P0 | Feature Complete Beta 승인/보류 판단 | Beta 진입 여부와 known issues가 확정됨 | WDAY-084 |
| WDAY-116 | 차지훈 | WEDGE-EPIC-04 | frontend | P0 | UI/Runner known issue 정리 | known issue가 Jira label로 분류됨 | WDAY-085 |
| WDAY-117 | 장현준 | WEDGE-EPIC-05 | infra | P0 | Runner/Infra known issue 정리 | infra known issue 목록이 작성됨 | WDAY-085 |
| WDAY-118 | 정관우 | WEDGE-EPIC-01 | spring-api | P0 | Backend known issue 정리 | backend known issue 목록이 작성됨 | WDAY-086 |
| WDAY-119 | 박성환 | WEDGE-EPIC-08 | pm | P0 | Sprint 4 QA 결과/Jira 정리 | Sprint 5 calibration backlog가 Ready 상태 |  |
| WDAY-120 | 유지호 | WEDGE-EPIC-03 | analyzer | P0 | Rule 8~10개 동작 여부 정리 | calibration 대상 rule 목록이 작성됨 | WDAY-089 |

### 2026-05-18 (월) — Sprint 5
**Day Goal:** Calibration과 안정화: benchmark labeling, false positive 조정, sharing/replay 안정화

| Jira Temp Key | 담당 | Epic | Component | Priority | 그날 할 일 | 완료 기준 | 의존성 |
|---|---|---|---|---|---|---|---|
| WDAY-121 | 강보승 | WEDGE-EPIC-07 | qa-calibration | P0 | Calibration 기준 설명/사례 리뷰 | 팀 calibration 기준이 정리됨 | WDAY-095 |
| WDAY-122 | 차지훈 | WEDGE-EPIC-04 | websocket | P0 | WebSocket reconnect 설계 | reconnect strategy가 문서화됨 | WDAY-087 |
| WDAY-123 | 장현준 | WEDGE-EPIC-05 | infra | P0 | Runner retry/logging 개선 계획 | stability 개선 체크리스트가 작성됨 | WDAY-092 |
| WDAY-124 | 정관우 | WEDGE-EPIC-01 | spring-api | P0 | Idempotency 설계 | idempotency design이 문서화됨 | WDAY-086 |
| WDAY-125 | 박성환 | WEDGE-EPIC-07 | qa-calibration | P0 | Benchmark URL 후보 수집 시작 | benchmark 후보 20개 draft 작성 |  |
| WDAY-126 | 유지호 | WEDGE-EPIC-07 | qa-calibration | P0 | Manual labeling sheet 초안 | labeling sheet가 작성됨 | WDAY-095 |

### 2026-05-19 (화) — Sprint 5
**Day Goal:** Calibration과 안정화: benchmark labeling, false positive 조정, sharing/replay 안정화

| Jira Temp Key | 담당 | Epic | Component | Priority | 그날 할 일 | 완료 기준 | 의존성 |
|---|---|---|---|---|---|---|---|
| WDAY-127 | 강보승 | WEDGE-EPIC-07 | qa-calibration | P0 | False positive 판단 기준 리뷰 | false positive 판단 원칙이 sheet에 반영됨 | WDAY-096 |
| WDAY-128 | 차지훈 | WEDGE-EPIC-04 | websocket | P0 | WebSocket reconnect 구현 | 새로고침/끊김 후 run 상태가 복구됨 | WDAY-097 |
| WDAY-129 | 장현준 | WEDGE-EPIC-05 | infra | P0 | Batch run 안정성 확인 | batch run 로그와 실패 원인 목록이 생성됨 | WDAY-098 |
| WDAY-130 | 정관우 | WEDGE-EPIC-01 | spring-api | P0 | processed_message 구현 | 동일 eventId 재전송 시 중복 반영되지 않음 | WDAY-099 |
| WDAY-131 | 박성환 | WEDGE-EPIC-07 | qa-calibration | P0 | Benchmark labeling 1차 진행 관리 | 최소 10개 benchmark에 human label 초안 입력 | WDAY-100 |
| WDAY-132 | 유지호 | WEDGE-EPIC-07 | qa-calibration | P0 | 자동 Rule 결과와 human label 비교 방식 정리 | 비교 기준이 calibration sheet에 반영됨 | WDAY-101 |

### 2026-05-20 (수) — Sprint 5
**Day Goal:** Calibration과 안정화: benchmark labeling, false positive 조정, sharing/replay 안정화

| Jira Temp Key | 담당 | Epic | Component | Priority | 그날 할 일 | 완료 기준 | 의존성 |
|---|---|---|---|---|---|---|---|
| WDAY-133 | 강보승 | WEDGE-EPIC-04 | report | P0 | Report UI polish 리뷰 | Report UI 수정 목록이 Jira에 등록됨 | WDAY-102 |
| WDAY-134 | 차지훈 | WEDGE-EPIC-04 | frontend | P0 | Report/UI 연동 bug fix | P0 UI 연동 버그가 해결됨 | WDAY-103 |
| WDAY-135 | 장현준 | WEDGE-EPIC-05 | infra | P0 | Timeout/retry/logging 구현 | 실패 로그가 runId/stepId로 추적 가능 | WDAY-104 |
| WDAY-136 | 정관우 | WEDGE-EPIC-01 | spring-api | P0 | Soft delete 적용 | 삭제된 project/run/report가 기본 조회에서 제외됨 | WDAY-099 |
| WDAY-137 | 박성환 | WEDGE-EPIC-01 | spring-api | P0 | Callback 중복 처리 구현 | 동일 checkpoint callback 재전송 시 duplicate insert 없음 | WDAY-105 |
| WDAY-138 | 유지호 | WEDGE-EPIC-07 | qa-calibration | P0 | Rule false positive 목록화 | rule별 false positive/negative 목록이 작성됨 | WDAY-106 |

### 2026-05-21 (목) — Sprint 5
**Day Goal:** Calibration과 안정화: benchmark labeling, false positive 조정, sharing/replay 안정화

| Jira Temp Key | 담당 | Epic | Component | Priority | 그날 할 일 | 완료 기준 | 의존성 |
|---|---|---|---|---|---|---|---|
| WDAY-139 | 강보승 | WEDGE-EPIC-07 | qa-calibration | P0 | Threshold 조정 결과 제품 리뷰 | threshold 변경 승인/보류 목록이 정리됨 | WDAY-107 |
| WDAY-140 | 차지훈 | WEDGE-EPIC-04 | frontend | P0 | UI polish 및 reconnect QA | disconnect 후 UI 복구 시나리오 통과 | WDAY-103 |
| WDAY-141 | 장현준 | WEDGE-EPIC-05 | infra | P0 | 배포 환경 E2E 반복 실행 | 배포 환경 E2E 결과가 기록됨 | WDAY-104 |
| WDAY-142 | 정관우 | WEDGE-EPIC-01 | spring-api | P0 | Backend failure handling 보강 | 실패 케이스가 UI/API에서 일관되게 보임 | WDAY-105 |
| WDAY-143 | 박성환 | WEDGE-EPIC-07 | qa-calibration | P0 | Benchmark 결과 문서화 | benchmark summary가 문서화됨 | WDAY-106 |
| WDAY-144 | 유지호 | WEDGE-EPIC-07 | qa-calibration | P0 | Rule threshold 조정 v0.2 | RuleRegistry v0.2 후보 생성 | WDAY-106 |

### 2026-05-22 (금) — Sprint 5
**Day Goal:** Calibration과 안정화: benchmark labeling, false positive 조정, sharing/replay 안정화

| Jira Temp Key | 담당 | Epic | Component | Priority | 그날 할 일 | 완료 기준 | 의존성 |
|---|---|---|---|---|---|---|---|
| WDAY-145 | 강보승 | WEDGE-EPIC-08 | pm | P0 | Calibrated Beta 승인/RC 진입 판단 | RC 진입 기준 충족/미충족 항목이 정리됨 | WDAY-108 |
| WDAY-146 | 차지훈 | WEDGE-EPIC-04 | frontend | P0 | Frontend known issue 정리 | P0/P1/P2로 분류된 UI issue 목록 생성 | WDAY-109 |
| WDAY-147 | 장현준 | WEDGE-EPIC-05 | infra | P0 | Infra/Runner known issue 정리 | infra issue 목록과 owner가 지정됨 | WDAY-110 |
| WDAY-148 | 정관우 | WEDGE-EPIC-01 | spring-api | P0 | Backend known issue 정리 | backend issue 목록과 owner가 지정됨 | WDAY-111 |
| WDAY-149 | 박성환 | WEDGE-EPIC-07 | qa-calibration | P0 | QA 결과 정리와 RC backlog 구성 | Sprint 6 backlog가 Ready 상태 | WDAY-112 |
| WDAY-150 | 유지호 | WEDGE-EPIC-03 | analyzer | P0 | Rule threshold freeze 후보 정리 | threshold freeze 후보와 remaining risk 문서화 | WDAY-113 |

### 2026-05-25 (월) — Sprint 6
**Day Goal:** 부처님오신날 대체공휴일 휴무

| Jira Temp Key | 담당 | Epic | Component | Priority | 그날 할 일 | 완료 기준 | 의존성 |
|---|---|---|---|---|---|---|---|
| WDAY-151 | 박성환 | WEDGE-EPIC-08 | pm | P2 | 부처님오신날 대체공휴일: 작업 배정 없음 | 5/26 오전에 P0 bug triage를 시작할 수 있도록 기존 이슈만 정리 |  |

### 2026-05-26 (화) — Sprint 6
**Day Goal:** Release Candidate 안정화: P0 bug 제거, 데모 시나리오 고정, 문서 최신화

| Jira Temp Key | 담당 | Epic | Component | Priority | 그날 할 일 | 완료 기준 | 의존성 |
|---|---|---|---|---|---|---|---|
| WDAY-152 | 강보승 | WEDGE-EPIC-08 | pm | P0 | RC 기준/P0 bug triage | P0 bug 목록과 owner가 지정됨 | WDAY-114 |
| WDAY-153 | 차지훈 | WEDGE-EPIC-02 | runner | P0 | Runner/UI critical issue 점검 | Runner/UI P0 이슈가 분류됨 | WDAY-115 |
| WDAY-154 | 장현준 | WEDGE-EPIC-05 | infra | P0 | RC 배포 환경 점검 | RC 배포 체크리스트가 통과됨 | WDAY-116 |
| WDAY-155 | 정관우 | WEDGE-EPIC-01 | spring-api | P0 | Backend critical issue 점검 | backend P0 이슈가 분류됨 | WDAY-117 |
| WDAY-156 | 박성환 | WEDGE-EPIC-08 | pm | P0 | Bug list/Known issue 문서화 | known issue 문서가 최신화됨 | WDAY-118 |
| WDAY-157 | 유지호 | WEDGE-EPIC-03 | analyzer | P0 | Rule threshold freeze 후보 확정 | RuleRegistry freeze 후보가 저장됨 | WDAY-119 |

### 2026-05-27 (수) — Sprint 6
**Day Goal:** Release Candidate 안정화: P0 bug 제거, 데모 시나리오 고정, 문서 최신화

| Jira Temp Key | 담당 | Epic | Component | Priority | 그날 할 일 | 완료 기준 | 의존성 |
|---|---|---|---|---|---|---|---|
| WDAY-158 | 강보승 | WEDGE-EPIC-04 | report | P0 | UX/Report 최종 품질 리뷰 | 수정 필요 사항이 P0/P1로 분류됨 | WDAY-121 |
| WDAY-159 | 차지훈 | WEDGE-EPIC-02 | runner | P0 | Runner critical bug fix | Runner 관련 P0 bug 해결 | WDAY-122 |
| WDAY-160 | 장현준 | WEDGE-EPIC-05 | infra | P0 | Infra/Runner deployment bug fix | RC 환경에서 runner가 안정 실행됨 | WDAY-123 |
| WDAY-161 | 정관우 | WEDGE-EPIC-01 | spring-api | P0 | Backend critical bug fix | backend P0 bug 해결 | WDAY-124 |
| WDAY-162 | 박성환 | WEDGE-EPIC-08 | docs | P0 | API 문서/sample data 정리 | 문서가 구현 상태와 일치함 | WDAY-125 |
| WDAY-163 | 유지호 | WEDGE-EPIC-03 | analyzer | P0 | Sample report Judge 결과 검토 | sample report 2개에 대한 Judge 검수 완료 | WDAY-126 |

### 2026-05-28 (목) — Sprint 6
**Day Goal:** Release Candidate 안정화: P0 bug 제거, 데모 시나리오 고정, 문서 최신화

| Jira Temp Key | 담당 | Epic | Component | Priority | 그날 할 일 | 완료 기준 | 의존성 |
|---|---|---|---|---|---|---|---|
| WDAY-164 | 강보승 | WEDGE-EPIC-08 | pm | P0 | Demo scenario 2개 확정 | 최종 demo script와 URL이 정리됨 | WDAY-127 |
| WDAY-165 | 차지훈 | WEDGE-EPIC-04 | frontend | P0 | UI/Runner integration test | 데모 시나리오 2개가 UI에서 연속 성공 | WDAY-128 |
| WDAY-166 | 장현준 | WEDGE-EPIC-05 | infra | P0 | RC deploy | RC URL 또는 서버에서 smoke test 가능 | WDAY-129 |
| WDAY-167 | 정관우 | WEDGE-EPIC-01 | spring-api | P0 | Backend smoke test | 핵심 API smoke test 통과 | WDAY-130 |
| WDAY-168 | 박성환 | WEDGE-EPIC-08 | docs | P0 | API/DB 문서 최신화 | 문서와 SQL/OpenAPI 차이가 없음 | WDAY-131 |
| WDAY-169 | 유지호 | WEDGE-EPIC-03 | analyzer | P0 | Judge 결과 freeze | demo sample JudgeResult가 저장됨 | WDAY-132 |

### 2026-05-29 (금) — Sprint 6
**Day Goal:** Release Candidate 안정화: P0 bug 제거, 데모 시나리오 고정, 문서 최신화

| Jira Temp Key | 담당 | Epic | Component | Priority | 그날 할 일 | 완료 기준 | 의존성 |
|---|---|---|---|---|---|---|---|
| WDAY-170 | 강보승 | WEDGE-EPIC-08 | pm | P0 | 최종 RC 승인 | RC 승인 또는 release blocker가 명확히 결정됨 | WDAY-133 |
| WDAY-171 | 차지훈 | WEDGE-EPIC-06 | mcp | P1 | MCP read tool 최소 검증 | MCP read tool 1~2개가 최소 동작함 | WDAY-134 |
| WDAY-172 | 장현준 | WEDGE-EPIC-05 | infra | P0 | 배포 백업 플랜 작성 | backup plan이 문서화됨 | WDAY-135 |
| WDAY-173 | 정관우 | WEDGE-EPIC-06 | spring-api | P1 | OAuth/Security 최소 검증 | 보안 관련 known limitation이 문서화됨 | WDAY-136 |
| WDAY-174 | 박성환 | WEDGE-EPIC-08 | docs | P0 | Known issue / release note 초안 | release note 초안이 작성됨 | WDAY-137 |
| WDAY-175 | 유지호 | WEDGE-EPIC-03 | analyzer | P0 | Sample report 2개 생성 | sample report 2개가 공유 가능 상태 | WDAY-138 |

### 2026-06-01 (월) — Final
**Day Goal:** 최종 릴리즈/시연 고정

| Jira Temp Key | 담당 | Epic | Component | Priority | 그날 할 일 | 완료 기준 | 의존성 |
|---|---|---|---|---|---|---|---|
| WDAY-176 | 강보승 | WEDGE-EPIC-08 | pm | P0 | Demo script 최종화 | 최종 demo script가 팀에 공유됨 | WDAY-139 |
| WDAY-177 | 차지훈 | WEDGE-EPIC-04 | frontend | P0 | Backup screenshots/recording 준비 | backup 자료가 저장소에 업로드됨 | WDAY-140 |
| WDAY-178 | 장현준 | WEDGE-EPIC-05 | infra | P0 | Final release build | final build가 배포되고 URL이 공유됨 | WDAY-141 |
| WDAY-179 | 정관우 | WEDGE-EPIC-01 | spring-api | P0 | Backend final smoke test | backend smoke test 통과 | WDAY-142 |
| WDAY-180 | 박성환 | WEDGE-EPIC-08 | docs | P0 | Known issue 최종 문서화 | known issue 문서가 최종화됨 | WDAY-143 |
| WDAY-181 | 유지호 | WEDGE-EPIC-03 | analyzer | P0 | Final sample report 검수 | sample report가 시연 자료와 일치함 | WDAY-144 |

### 2026-06-02 (화) — Final
**Day Goal:** 최종 릴리즈/시연 고정

| Jira Temp Key | 담당 | Epic | Component | Priority | 그날 할 일 | 완료 기준 | 의존성 |
|---|---|---|---|---|---|---|---|
| WDAY-182 | 강보승 | WEDGE-EPIC-08 | pm | P0 | 최종 발표/시연 리드 | 시연 완료 | WDAY-145 |
| WDAY-183 | 차지훈 | WEDGE-EPIC-04 | frontend | P0 | UI/API 긴급 대응 대기 | 시연 중 blocker 대응 가능 | WDAY-146 |
| WDAY-184 | 장현준 | WEDGE-EPIC-05 | infra | P0 | 배포/인프라 긴급 대응 대기 | 시연 중 infra blocker 대응 가능 | WDAY-147 |
| WDAY-185 | 정관우 | WEDGE-EPIC-01 | spring-api | P0 | Backend 긴급 대응 대기 | 시연 중 backend blocker 대응 가능 | WDAY-148 |
| WDAY-186 | 박성환 | WEDGE-EPIC-08 | pm | P0 | 최종 체크리스트/릴리즈 노트 관리 | 릴리즈 노트와 체크리스트가 최종 상태 | WDAY-149 |
| WDAY-187 | 유지호 | WEDGE-EPIC-03 | analyzer | P0 | Judge/Report 설명 지원 | Judge 관련 질문에 답변 가능 | WDAY-150 |

## 8. 운영 체크리스트와 Done 기준

### 매일 운영 체크리스트

- 오전 stand-up에서 전날 Done / 오늘 할 일 / blocker를 10분 내로 확인합니다.
- 박성환은 매일 Jira 상태와 blocker를 정리합니다.
- 강보승은 매일 P0 blocker와 제품 품질 리스크만 확인합니다.
- 각 담당자는 퇴근 전 본인 Task에 진행상황 comment를 남깁니다.
- 금요일은 Sprint demo, QA, 다음 Sprint backlog grooming을 진행합니다.

### Review 규칙

- Rule/Judge 변경은 유지호 + 강보승 리뷰를 거칩니다.
- Spring architecture 변경은 강보승 리뷰를 거칩니다.
- Runner 변경은 차지훈 + 장현준 리뷰를 거칩니다.
- Contract/API/DB/Schema 변경은 관련 문서와 예시를 같은 PR에서 갱신합니다.

### Done 기준

- 코드가 PR로 올라갔거나 main/develop에 병합되었습니다.
- 수동 검증 또는 테스트 결과가 Jira comment에 남았습니다.
- API/DB/Schema/Contract 변경 시 관련 문서 또는 예시가 갱신되었습니다.
- Runner/Evidence/Judge 관련 작업은 sample payload 또는 fixture로 검증되었습니다.
- P0 작업은 Sprint demo에서 재현 가능합니다.

## 9. 병합 이력

- `docs/06_delivery_plan.md`: Sprint 목표, Epic, 주요 backlog, 운영 규칙의 원본입니다.
- `docs/wedge_daily_jira_execution_plan.md`: 일별 Jira Task, 완료 기준, 의존성, 휴무/버퍼의 원본입니다.
- 병합 후 canonical 문서는 이 파일입니다. 세부 일별 계획도 이 문서의 `7. 일별 Jira 실행 계획`에서 관리합니다.
