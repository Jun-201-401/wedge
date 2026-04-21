# AI_CONTEXT_GUIDE

Codex, Claude Code, 내부 LLM Agent에게 작업을 지시할 때 참조할 파일을 정리한다.
전체 패키지를 매번 태그하지 말고, 작업에 필요한 최소 문서만 태그한다.

## 공통 원칙

- 먼저 `docs/README.md`로 현재 기준 문서와 legacy 경계를 확인한다.
- 계약을 바꾸는 작업은 `packages/contracts`를 먼저 수정하고, 그 다음 앱 코드를 맞춘다.
- API 작업은 `docs/03_api_reference.md`의 `data/meta` 및 `error/meta` response envelope, validation error shape, Auth/Scope 분리 정책을 먼저 확인한다.
- `docs/07_research_basis.md`는 Judge/scoring 기준 변경이나 calibration 때만 추가한다.
- 오래된 문서는 별도 legacy 폴더로 복사하지 않는다. 필요하면 Git history에서 확인한다.

## 1. Spring API / MyBatis 구현

필수 참조:

```text
docs/00_master_decisions.md
docs/01_architecture_and_project_structure.md
docs/02_data_model_and_db.md
docs/03_api_reference.md
docs/wedge_schema.sql
packages/contracts/openapi/wedge_openapi.yaml
```

필요할 때 추가 참조:

```text
packages/contracts/internal/runner-callback.schema.json
packages/contracts/internal/analyzer-callback.schema.json
packages/contracts/mq/messages.schema.json
```

## 2. Node Playwright Runner 구현

필수 참조:

```text
docs/01_architecture_and_project_structure.md
docs/04_domain_payload_contracts.md
packages/contracts/schemas/scenario-plan.schema.json
packages/contracts/internal/runner-callback.schema.json
packages/contracts/mq/messages.schema.json
```

필요할 때 fixture 참조:

```text
packages/contracts/examples/sample-scenario-plan-signup.json
packages/contracts/examples/sample-evidence-packet.json
```

## 3. FastAPI Analyzer / Rule Engine 구현

필수 참조:

```text
docs/04_domain_payload_contracts.md
docs/05_judge_scoring_validation.md
packages/contracts/schemas/evidence-packet.schema.json
packages/contracts/schemas/rule-registry.schema.json
packages/contracts/schemas/judge-result.schema.json
packages/contracts/internal/analyzer-callback.schema.json
packages/contracts/mq/messages.schema.json
```

필요할 때 fixture/calibration 참조:

```text
packages/contracts/examples/sample-evidence-packet.json
packages/contracts/examples/sample-judge-result.json
docs/07_research_basis.md
```

## 4. React UI 구현

필수 참조:

```text
docs/wedge_frontend_architecture.md
docs/03_api_reference.md
packages/contracts/openapi/wedge_openapi.yaml
packages/contracts/websocket/events.schema.json
```

필요할 때 fixture 참조:

```text
packages/contracts/examples/sample-judge-result.json
packages/contracts/examples/sample-evidence-packet.json
```

## 5. MCP 구현

필수 참조:

```text
docs/03_api_reference.md
packages/contracts/mcp/tools.schema.json
packages/contracts/openapi/wedge_openapi.yaml
```

필요할 때 추가 참조:

```text
packages/contracts/examples/sample-judge-result.json
```

## 6. Judge 기준 재검토 / Calibration

필수 참조:

```text
docs/05_judge_scoring_validation.md
docs/07_research_basis.md
packages/contracts/schemas/rule-registry.schema.json
packages/contracts/schemas/judge-result.schema.json
packages/contracts/examples/sample-judge-result.json
```

## 7. Site Discovery / Preflight 구현

Discovery는 full analysis가 아니며, JudgeResult 생성보다 시나리오 추천이 목적이다. 작업 지시 시 아래 파일 세트를 함께 태그한다.

### Spring API / DB 구현 시

- `docs/00_master_decisions.md`
- `docs/01_architecture_and_project_structure.md`
- `docs/02_data_model_and_db.md`
- `docs/03_api_reference.md`
- `docs/wedge_schema.sql`
- `packages/contracts/openapi/wedge_openapi.yaml`

### Runner Discovery 구현 시

- `docs/01_architecture_and_project_structure.md`
- `docs/04_domain_payload_contracts.md`
- `packages/contracts/schemas/scenario-plan.schema.json`
- `packages/contracts/schemas/evidence-packet.schema.json`
- `packages/contracts/internal/runner-callback.schema.json`
- `packages/contracts/mq/messages.schema.json`

### Discovery Recommendation / Analyzer 구현 시

- `docs/04_domain_payload_contracts.md`
- `docs/05_judge_scoring_validation.md`
- `packages/contracts/schemas/evidence-packet.schema.json`
- `packages/contracts/schemas/site-discovery-result.schema.json`

### React UI 구현 시

- `docs/03_api_reference.md`
- `packages/contracts/openapi/wedge_openapi.yaml`
- `packages/contracts/websocket/events.schema.json`
