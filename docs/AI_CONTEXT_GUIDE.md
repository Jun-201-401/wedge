# AI_CONTEXT_GUIDE

Codex, Claude Code, 내부 LLM Agent에게 작업을 지시할 때 참조할 파일을 정리한다.
전체 패키지를 매번 태그하지 말고, 작업에 필요한 최소 문서만 태그한다.

## 공통 원칙

- 먼저 `docs/README.md`로 현재 기준 문서와 legacy 경계를 확인한다.
- 계약을 바꾸는 작업은 `packages/contracts`를 먼저 수정하고, 그 다음 앱 코드를 맞춘다. 단, 계약 방향을 문서로만 제안하는 작업은 구현 deferred 상태를 명시하고 앱/contract 파일을 수정하지 않는다.
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
docs/wedge_runner_architecture.md
docs/wedge_runner_agent_execution.md
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

## 7. Site Discovery / Preflight / ScenarioAuthoring 구현

Discovery는 full analysis가 아니며, JudgeResult 생성보다 시나리오 추천이 목적이다. ScenarioAuthoring은 Discovery recommendation과 Run materialization 사이에서 사용자 실행 의도를 고정하는 계약 단계다. 작업 지시 시 아래 파일 세트를 함께 태그한다.

### Spring API / DB 구현 시

- `docs/00_master_decisions.md`
- `docs/01_architecture_and_project_structure.md`
- `docs/02_data_model_and_db.md`
- `docs/03_api_reference.md`
- `docs/wedge_schema.sql`
- `packages/contracts/openapi/wedge_openapi.yaml`

### ScenarioAuthoring 계약/구현 시

아래 `scenario-authoring` 계약/fixture 파일이 아직 없으면 `packages/contracts`에 먼저 추가한 뒤 앱 구현을 진행한다.

- `docs/01_architecture_and_project_structure.md`
- `docs/02_data_model_and_db.md`
- `docs/03_api_reference.md`
- `docs/04_domain_payload_contracts.md`
- `packages/contracts/schemas/scenario-authoring.schema.json`
- `packages/contracts/examples/sample-scenario-authoring-job.json`
- `packages/contracts/examples/sample-scenario-authoring-result.json`
- `packages/contracts/mcp/tools.schema.json`
- `packages/contracts/openapi/wedge_openapi.yaml`

주의:

- ScenarioAuthoring은 Discovery recommendation과 Run materialization 사이의 경계다.
- ScenarioAuthoring result는 별도 실행 DSL이 아니며, candidate는 기존 `ScenarioPlan` schema를 만족해야 한다.
- ScenarioAuthoring 기반 Run 경로에서 Runner는 고정된 ScenarioPlan executor로 유지한다. authoring job/result를 실행하거나 수정하지 않는다.
- Runner Agent Runtime은 ScenarioAuthoring과 별도 경로다. 정식 구현은 `docs/runner_agent_runtime_implementation_plan.md`의 `agent.execute.request` / `AgentTask` / `AgentTrace` 기준을 따른다. `docs/wedge_runner_agent_execution.md`는 goal 기반 UX Agent 전환 배경과 MVP spike 기록으로만 참조한다.
- MCP는 Wedge API tool surface이며 browser-control surface가 아니다.
- 문서-only 작업이면 위 contract/app 파일은 수정하지 말고 deferred 상태를 명시한다.

### Runner Discovery 구현 시

- `docs/01_architecture_and_project_structure.md`
- `docs/04_domain_payload_contracts.md`
- `packages/contracts/schemas/scenario-plan.schema.json`
- `packages/contracts/schemas/evidence-packet.schema.json`
- `packages/contracts/internal/runner-callback.schema.json`
- `packages/contracts/mq/messages.schema.json`

### Discovery Recommendation / Analyzer 구현 시

아래 `site-discovery-result` 계약 파일이 아직 없으면 `packages/contracts`에 먼저 추가한 뒤 Analyzer/Discovery 구현을 진행한다.

- `docs/04_domain_payload_contracts.md`
- `docs/05_judge_scoring_validation.md`
- `packages/contracts/schemas/evidence-packet.schema.json`
- `packages/contracts/schemas/site-discovery-result.schema.json`

### React UI 구현 시

- `docs/03_api_reference.md`
- `packages/contracts/openapi/wedge_openapi.yaml`
- `packages/contracts/websocket/events.schema.json`


## 8. StageResolver / DecisionMap 구현

필수 참조:

```text
docs/05_judge_scoring_validation.md
docs/04_domain_payload_contracts.md
packages/contracts/schemas/evidence-packet.schema.json
packages/contracts/schemas/rule-registry.schema.json
packages/contracts/schemas/judge-result.schema.json
docs/01_architecture_and_project_structure.md
```

작업 지시 예시:

- StageResolver를 구현해라. `ScenarioStep.stage`, `Checkpoint.primaryStage`, `Observation.type`을 기준으로 `Observation.stage`를 결정한다. LLM은 stage source of truth가 아니다.
- Rule Engine이 StageContext별로 `applicableStages`가 맞는 rule만 실행하도록 수정해라.
- Report UI에서 DecisionMap을 stage별로 표시하되 `FIRST_VIEW` 같은 enum 대신 `첫 화면 이해` 같은 사용자-facing label을 사용해라.

## 9. Runner Agent Runtime 구현 계획

Runner Agent Runtime을 실제로 구현하거나 외부 AI/개발자에게 구현을 위임할 때 참조한다. 구현 착수 시에는 아래 계획 문서를 기준으로 contract-first 순서를 따른다.

필수 참조:

```text
docs/runner_agent_runtime_implementation_plan.md
docs/01_architecture_and_project_structure.md
docs/04_domain_payload_contracts.md
packages/contracts/schemas/scenario-plan.schema.json
packages/contracts/mq/messages.schema.json
packages/contracts/internal/runner-callback.schema.json
apps/runner/src/app.ts
apps/runner/src/worker/index.ts
apps/runner/src/scenario/executor/step-executor.ts
apps/runner/src/scenario/policy.ts
apps/runner/src/browser/playwright/index.ts
```

구현 순서:

- `packages/contracts`에 AgentTask/Observation/Decision/PolicyResult/VerificationResult/Event/Outcome/Trace와 `agent.execute.request`를 먼저 추가한다.
- fixture 기반 테스트 하네스를 만든 뒤 observer, candidate extractor, policy, verifier를 구현한다.
- LLM 연동 전 heuristic agent loop를 fixtures에서 검증한다.
- AgentTrace는 TRACE artifact로 저장하고, `ScenarioPlan` replay와 agent exploration report가 섞이지 않게 한다.
