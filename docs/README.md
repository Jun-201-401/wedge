# Wedge Documentation

이 폴더의 기준 문서는 파일명에 버전 번호를 넣지 않고, 현재 구현 기준을 나타내는 canonical 이름으로 관리한다.

## 현재 기준 문서

읽는 순서:

1. `00_master_decisions.md` — 최종 설계 결정과 유지/보류 범위
2. `01_architecture_and_project_structure.md` — 시스템 아키텍처와 모노레포 구조
3. `02_data_model_and_db.md` — 데이터 모델과 DB 기준
4. `03_api_reference.md` — REST, internal callback, MQ, WebSocket, MCP reference
5. `04_domain_payload_contracts.md` — ScenarioPlan, EvidencePacket, RuleRegistry, JudgeResult
6. `05_judge_scoring_validation.md` — Judge/scoring/validation 기준
7. `06_delivery_plan.md` — Jira/일정 기반 delivery plan
8. `07_research_basis.md` — Judge/scoring 근거와 calibration 기준
9. `AI_CONTEXT_GUIDE.md` — Codex/AI 작업별 참조 파일 선택 가이드

## 추가 참조 문서

- `api_catalog.md` — 이미지형 관리 화면 스타일의 표형 API 대장
- `ddd_architecture_guide.md` — DDD를 처음 보는 팀원을 위한 Wedge 구조 해설
- `wedge_frontend_architecture.md` — `apps/web` 프론트엔드 스택과 경계
- `wedge_runner_architecture.md` — `apps/runner` 실행 구조와 경계
- `mcp_server_design.md` — `apps/api-server` 내부 MCP adapter V1 범위와 구현 기준
- `mcp_pending_decision_e2e_verification.md` — MCP pending decision 로컬 E2E 검증 절차와 성공/실패 판정 기준
- `flyway_prod_migration_runbook.md` — 기존 운영 DB에 Flyway를 도입할 때의 baseline/migrate 절차
- `wedge_runner_agent_execution.md` — Runner를 goal 기반 UX Agent로 전환하기 위한 target design
- `wedge_api_spec.md` — 최종 human-readable API 명세서
- `runner_agent_runtime_implementation_plan.md` — Runner Agent Runtime 후속 구현 계획과 contract-first 작업 순서
- `wedge_schema.sql` — 현재 PostgreSQL DDL 기준
- `git_conventions.md` — commit/PR 규칙
