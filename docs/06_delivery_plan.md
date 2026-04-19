# 06. Delivery and Jira Plan

## 1. 기간

- 전체 기간: 2026-04-13 ~ 2026-06-02
- 기획 기간: 2026-04-13 ~ 2026-04-17
- 구현 시작: 2026-04-20
- 운영 방식: 월~금 기준, 1주 Sprint

## 2. Team Roles

| Member | Role |
|---|---|
| 강보승 | Product/Tech Lead, Spring Architecture Lead |
| 차지훈 | Node Playwright Runner Lead, Full-stack Integration |
| 장현준 | Infra Lead, Platform Reliability |
| 정관우 | Spring Core Backend |
| 박성환 | PM/Delivery Manager, Backend Support |
| 유지호 | AI/Judge/Rule Lead |

## 3. Jira Issue Type Policy

| Type | Use |
|---|---|
| Epic | 기능 영역 묶음 |
| Story | 데모 가능한 사용자 가치 단위 |
| Task | 설정, 구현, 문서, infra 작업 |
| Sub-task | 큰 Story 하위 구현이 필요할 때만 |
| Bug | 결함 |
| Spike | 조사/불확실성 해소 |

기본은 Epic + Story + Task 중심으로 등록한다.

## 4. Epics

| Epic | Owner |
|---|---|
| Platform Foundation | 강보승 / 정관우 |
| Browser Runner & Evidence Collection | 차지훈 / 장현준 |
| Judge Engine & AI Analyzer | 유지호 |
| Product UI & Report | 강보승 / 차지훈 |
| Realtime, MQ & Deployment | 장현준 |
| MCP / OAuth / Agent Interface | 차지훈 / 정관우 |
| Validation, Calibration & QA | 박성환 / 유지호 |

## 5. Sprint Goals

| Sprint | Dates | Goal |
|---|---|---|
| Sprint 0 | 4/13–4/17 | 기획/설계 완료 |
| Sprint 1 | 4/20–4/24 | 프로젝트 기반 구축 |
| Sprint 2 | 4/27–5/1 | 첫 브라우저 실행과 Evidence 저장 |
| Sprint 3 | 5/4–5/8 | Rule Engine 1차와 첫 리포트 |
| Sprint 4 | 5/11–5/15 | 핵심 시나리오 3개와 리포트 완성 |
| Sprint 5 | 5/18–5/22 | Calibration과 안정화 |
| Sprint 6 | 5/25–5/29 | RC 안정화 |
| Final | 6/1–6/2 | 최종 릴리즈/시연 |

## 6. Sprint 1 Backlog

| Key | Type | Summary | Owner |
|---|---|---|---|
| WEDGE-101 | Story | Spring 프로젝트 구조와 package architecture 정의 | 강보승 |
| WEDGE-102 | Story | Spring Run/Step 기본 도메인과 MyBatis 설정 | 정관우 |
| WEDGE-103 | Task | PostgreSQL schema 1차 적용 | 정관우 |
| WEDGE-104 | Task | Artifact/Report 기본 DTO/Mapper 생성 | 박성환 |
| WEDGE-105 | Story | React app shell, routing, 기본 layout | 강보승 |
| WEDGE-106 | Task | Frontend API client 구조 | 차지훈 |
| WEDGE-107 | Task | RabbitMQ, S3, Docker, Jenkins 기본 구성 | 장현준 |
| WEDGE-108 | Story | Node Playwright Runner skeleton | 차지훈 |
| WEDGE-109 | Story | FastAPI Analyzer skeleton | 유지호 |
| WEDGE-110 | Task | P0 Rule 목록 최종 리뷰 | 유지호 / 강보승 |
| WEDGE-111 | Task | Jira workflow, issue template, 회의록 양식 정리 | 박성환 |

## 7. Sprint 2 Backlog

| Key | Type | Summary | Owner |
|---|---|---|---|
| WEDGE-201 | Story | Landing CTA ScenarioPlan 작성 | 유지호 |
| WEDGE-202 | Story | Signup/Lead Form ScenarioPlan 작성 | 유지호 |
| WEDGE-203 | Story | Playwright goto/click/fill/checkpoint action loop | 차지훈 |
| WEDGE-204 | Task | settle_strategy 처리 | 차지훈 |
| WEDGE-205 | Task | Runner S3 screenshot upload | 장현준 |
| WEDGE-206 | Task | Runner container 안정화 | 장현준 |
| WEDGE-207 | Story | Runner callback API 구현 | 정관우 |
| WEDGE-208 | Story | checkpoint/observation/artifact 저장 | 박성환 |
| WEDGE-209 | Task | Run 상태 전이 구현 | 정관우 |
| WEDGE-210 | Story | Run detail UI 1차 | 강보승 |
| WEDGE-211 | Task | Step timeline UI/API 연동 | 차지훈 |

## 8. Sprint 3 Backlog

| Key | Type | Summary | Owner |
|---|---|---|---|
| WEDGE-301 | Story | RuleRegistry loader 구현 | 유지호 |
| WEDGE-302 | Story | P0 Rule 5개 구현 | 유지호 |
| WEDGE-303 | Task | severity/confidence/priority 계산 | 유지호 |
| WEDGE-304 | Task | LLM explanation generator 1차 | 유지호 |
| WEDGE-305 | Story | analysis.request queue 연동 | 정관우 / 장현준 |
| WEDGE-306 | Story | JudgeResult 저장 API | 박성환 |
| WEDGE-307 | Story | Report Summary API | 박성환 |
| WEDGE-308 | Story | Report Summary / Top Issues UI | 강보승 |
| WEDGE-309 | Story | Evidence Card UI 1차 | 차지훈 |
| WEDGE-310 | Task | WebSocket progress event 1차 | 차지훈 |

## 9. Sprint 4 Backlog

| Key | Type | Summary | Owner |
|---|---|---|---|
| WEDGE-401 | Story | Pricing ScenarioPlan 작성 | 유지호 |
| WEDGE-402 | Story | Pricing scenario Runner flow | 차지훈 |
| WEDGE-403 | Task | Invalid form submit action | 차지훈 |
| WEDGE-404 | Task | Runner timeout/retry 1차 | 장현준 |
| WEDGE-405 | Story | P0 Rule 8~10개 확장 | 유지호 |
| WEDGE-406 | Story | Decision Map UI | 강보승 |
| WEDGE-407 | Story | Nudge Card UI | 차지훈 |
| WEDGE-408 | Story | Report Detail / Share API | 박성환 |
| WEDGE-409 | Task | Report permission check | 정관우 |

## 10. Sprint 5 Backlog

| Key | Type | Summary | Owner |
|---|---|---|---|
| WEDGE-501 | Story | Benchmark URL 20개 수집 | 박성환 / 유지호 |
| WEDGE-502 | Task | Manual labeling sheet 작성 | 박성환 / 유지호 |
| WEDGE-503 | Task | 전원 benchmark labeling 1차 | 전원 |
| WEDGE-504 | Story | Rule false positive 분석 | 유지호 |
| WEDGE-505 | Task | 초기 Rule threshold 조정 | 유지호 |
| WEDGE-506 | Story | processed_message / idempotency 적용 | 정관우 |
| WEDGE-507 | Task | callback 중복 처리 | 박성환 |
| WEDGE-508 | Story | soft delete: project/run/report | 정관우 / 박성환 |
| WEDGE-509 | Story | WebSocket reconnect 처리 | 차지훈 |
| WEDGE-510 | Story | Runner timeout/retry/logging 안정화 | 장현준 |
| WEDGE-511 | Task | Report UI polish | 강보승 |

## 11. Sprint 6 / Final

Sprint 6는 신규 기능보다 RC 안정화에 집중한다.

Priority:

1. P0 bug 0
2. 데모 시나리오 2개 안정 실행
3. sample report 2개 확보
4. API/DB 문서 최신화
5. Known issue 문서화

## 12. Daily Operating Rules

- 매일 10분 stand-up
- 박성환이 blocker, Jira 상태, 오늘 목표를 기록
- 매주 금요일 Sprint demo
- Rule/Judge 변경은 유지호 + 강보승 리뷰
- Spring architecture 변경은 강보승 리뷰
- Runner 변경은 차지훈 + 장현준 리뷰
