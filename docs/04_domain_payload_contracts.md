# 04. Domain Payload 계약

## 1. 목적

이 문서는 Runner와 Analyzer가 주고받는 domain payload 계약을 정의한다.

Operational transport 계약과 domain payload 계약은 구분한다.

```text
Operational transport:
  REST / Internal callback / RabbitMQ / WebSocket / MCP
  → camelCase 중심

Domain payload:
  ScenarioPlan / EvidencePacket / RuleRegistry / JudgeResult
  → schema_version 포함, snake_case 허용
```

## 2. Canonical schema

| Contract | File |
|---|---|
| ScenarioPlan | `packages/contracts/schemas/scenario-plan.schema.json` |
| EvidencePacket | `packages/contracts/schemas/evidence-packet.schema.json` |
| RuleRegistry | `packages/contracts/schemas/rule-registry.schema.json` |
| JudgeResult | `packages/contracts/schemas/judge-result.schema.json` |

## 3. ScenarioPlan

ScenarioPlan은 사용자의 시나리오 선택 또는 자연어 요청을 실행 가능한 step plan으로 변환한 결과다.

V1에서는 완전한 natural-language planner를 구현하지 않는다.
템플릿 기반 ScenarioPlan을 우선 사용한다.

지원 action:

```text
goto
click
fill
select
scroll
hover
wait_for
checkpoint
stop_when
```

각 step은 다음 값을 정의한다.

- `step_id`
- `stage`
- `description`
- `action`
- `settle_strategy`
- `checkpoint`
- optional `stop_condition`
### Step 식별자 경계

Domain payloads use `step_id` as a stable scenario key. Operational transport uses camelCase `stepKey` for the same value when Runner sends callbacks. Spring resolves `stepKey` to the DB UUID `test_run_step.id`; public REST paths such as `/api/runs/{runId}/steps/{stepId}` use the DB UUID.

## 4. EvidencePacket

EvidencePacket은 Spring이 Runner checkpoint/artifact callback을 기준으로 materialize하는 normalized evidence snapshot이다. Runner는 checkpoint와 artifact metadata를 전송하고, full EvidencePacket blob은 finished/failed callback에 싣지 않는다.

Pipeline:

```text
ScenarioPlan
  → ScenarioValidator
  → BrowserWorker action/settle
  → checkpoint + artifact callbacks
  → Spring evidence materializer
  → EvidencePacket stored with evidencePacketId
  → analysis.request(evidencePacketId)
  → RuleEngine
  → JudgeResult
```

Top-level fields:

- `schema_version`
- `run_id`
- `url`
- `final_url`
- `scenario`
- `environment`
- `checkpoints`
- `aggregate_signals`
- `artifacts`
- `collection_notes`

## 5. Checkpoint

Checkpoint는 의미 있는 상태 전이 이후 생성된다.

각 checkpoint는 다음 값을 포함한다.

- `checkpoint_id`
- `step_id`
- `stage`
- `trigger`
- `settle`
- `state`
- `observations`
- `deltas`
- `artifact_refs`

## 6. Observation

Observation은 raw data에서 추출한 구조화된 fact다.

주요 observation type:

| Type | Description |
|---|---|
| `heading_structure` | heading sequence and text |
| `first_view_message` | first-view value proposition |
| `cta_candidate` | button/link/action candidate |
| `cta_cluster` | competing CTA group |
| `form_field` | input metadata |
| `form_error` | error text and field association |
| `trust_signal` | privacy/security/refund/review/logo |
| `visual_emphasis` | dominant visual element |
| `contrast_issue` | contrast threshold breach |
| `target_size_issue` | pointer target too small |
| `network_failure` | request failure or 4xx/5xx |
| `console_error` | JS error |
| `performance_metric` | LCP/INP/CLS/long task |
| `scroll_delta` | newly loaded or changed content |

## 7. RuleRegistry

RuleRegistry는 Judge criterion을 code-executable rule metadata로 표현한다.

각 rule은 다음 값을 포함한다.

- criterion id
- axis
- stages
- evidence level
- required observations
- measurement sources
- signal rule
- severity rules
- exceptions
- confidence rule
- output template
- source references

## 8. JudgeResult

JudgeResult is the canonical analyzer output. Analyzer completed callback must include this payload, and Spring stores it on `analysis_job.output_jsonb` plus user-facing projections (`analysis_finding`, `nudge`, `report`).

포함 항목:

- summary
- stage scores
- issues
- decision map
- nudges
- LLM notes

모든 issue는 다음 값을 포함해야 한다.

- `criterion_id`
- `stage`
- `axis`
- `severity`
- `confidence`
- `priority_score`
- `evidence_refs`
- `summary`
- `recommendations`

## 9. Evidence Reference Format

권장 형식:

```text
cp_001.obs_002
cp_003.artifact.screenshot_001
aggregate.primary_cta_count_by_stage.CTA
```

규칙:

- Any user-facing issue must include at least one evidence reference.
- LLM output must not introduce unsupported claims.
- If evidence is weak, confidence must be low.

## 10. Versioning

Domain contracts use explicit schema versions.

규칙:

- additive optional fields: no major break
- required field changes: schema version bump
- JudgeResult stores evidence schema version and rule registry id
