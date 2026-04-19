# AI_CONTEXT_GUIDE

Codex, Claude Code, 내부 LLM Agent에게 작업을 지시할 때 참조할 파일을 정리한다.
전체 패키지를 매번 태그하지 말고, 작업에 필요한 최소 문서만 태그한다.

## 공통 원칙

- 먼저 `docs/README.md`로 current baseline과 legacy 경계를 확인한다.
- 계약을 바꾸는 작업은 `packages/contracts`를 먼저 수정하고, 그 다음 앱 코드를 맞춘다.
- `docs/07_research_basis.md`는 Judge/scoring 기준 변경이나 calibration 때만 추가한다.
- 오래된 문서는 별도 legacy 폴더로 복사하지 않는다. 필요하면 Git history에서 확인한다.

## 1. Spring API / MyBatis 구현

Must read:

```text
docs/00_master_decisions.md
docs/01_architecture_and_project_structure.md
docs/02_data_model_and_db.md
docs/03_api_reference.md
docs/wedge_schema.sql
packages/contracts/openapi/wedge_openapi.yaml
```

Optional when relevant:

```text
packages/contracts/internal/runner-callback.schema.json
packages/contracts/internal/analyzer-callback.schema.json
packages/contracts/mq/messages.schema.json
```

## 2. Node Playwright Runner 구현

Must read:

```text
docs/01_architecture_and_project_structure.md
docs/04_domain_payload_contracts.md
packages/contracts/schemas/scenario-plan.schema.json
packages/contracts/internal/runner-callback.schema.json
packages/contracts/mq/messages.schema.json
```

Optional fixtures:

```text
packages/contracts/examples/sample-scenario-plan-signup.json
packages/contracts/examples/sample-evidence-packet.json
```

## 3. FastAPI Analyzer / Rule Engine 구현

Must read:

```text
docs/04_domain_payload_contracts.md
docs/05_judge_scoring_validation.md
packages/contracts/schemas/evidence-packet.schema.json
packages/contracts/schemas/rule-registry.schema.json
packages/contracts/schemas/judge-result.schema.json
packages/contracts/internal/analyzer-callback.schema.json
packages/contracts/mq/messages.schema.json
```

Optional fixtures / calibration:

```text
packages/contracts/examples/sample-evidence-packet.json
packages/contracts/examples/sample-judge-result.json
docs/07_research_basis.md
```

## 4. React UI 구현

Must read:

```text
docs/wedge_frontend_architecture.md
docs/03_api_reference.md
packages/contracts/openapi/wedge_openapi.yaml
packages/contracts/websocket/events.schema.json
```

Optional fixtures:

```text
packages/contracts/examples/sample-judge-result.json
packages/contracts/examples/sample-evidence-packet.json
```

## 5. MCP 구현

Must read:

```text
docs/03_api_reference.md
packages/contracts/mcp/tools.schema.json
packages/contracts/openapi/wedge_openapi.yaml
```

Optional:

```text
packages/contracts/examples/sample-judge-result.json
```

## 6. Judge 기준 재검토 / Calibration

Must read:

```text
docs/05_judge_scoring_validation.md
docs/07_research_basis.md
packages/contracts/schemas/rule-registry.schema.json
packages/contracts/schemas/judge-result.schema.json
packages/contracts/examples/sample-judge-result.json
```
