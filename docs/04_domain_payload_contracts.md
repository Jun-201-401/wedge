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
| SiteDiscoveryResult | `packages/contracts/schemas/site-discovery-result.schema.json` |
| EvidencePacket | `packages/contracts/schemas/evidence-packet.schema.json` |
| RuleRegistry | `packages/contracts/schemas/rule-registry.schema.json` |
| JudgeResult | `packages/contracts/schemas/judge-result.schema.json` |

## 3. SiteDiscoveryResult

`SiteDiscoveryResult`는 Discovery / Preflight 결과를 domain payload로 고정한다.

필수 필드:

- `schema_version`
- `discovery_id`
- `input_url`
- `final_url`
- `environment`
- `checkpoints`
- `detected_flow_types`
- `missing_flow_types`
- `flow_candidates`
- `scenario_recommendations`
- `collection_notes`

`flow_candidate` 구조:

- `flow_type`: LANDING_CTA, SIGNUP_LEAD_FORM, PRICING, PURCHASE_CHECKOUT, CONTACT, CONTENT_ONLY
- `confidence`
- `evidence_refs`
- `entrypoint_candidates`
- `reason`

`scenario_recommendation` 구조:

- `scenario_type`
- `recommendation_level`: HIGH, MEDIUM, LOW, NOT_AVAILABLE
- `confidence`
- `reason`
- `evidence_refs`
- `suggested_start_url`
- `suggested_target`

## 4. ScenarioPlan

ScenarioPlan은 사용자의 시나리오 선택 또는 자연어 요청을 실행 가능한 step plan으로 변환한 결과다.

V1에서는 완전한 natural-language planner를 구현하지 않는다.
템플릿 기반 ScenarioPlan을 우선 사용한다.

Stage는 `ScenarioPlan`, `EvidencePacket`, `RuleRegistry`, `JudgeResult`를 연결하는 code-level enum이다.

`DecisionStage`:

- `FIRST_VIEW`
- `VALUE`
- `CTA`
- `INPUT`
- `COMMIT`

Stage는 LLM free-form output이 아니다. V1 template scenario에서는 모든 `ScenarioStep.stage`를 반드시 명시한다. Custom scenario도 ScenarioPlanner가 `stage`를 채운 `custom_compiled` ScenarioPlan으로 compile해야 한다.

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
추가 optional 필드:

- `source_discovery_id`
- `fit_requirements`

예:

```json
{
  "required_flow_type": "PURCHASE_CHECKOUT",
  "required_entrypoint_types": ["pricing", "checkout", "cart"],
  "fallback_allowed": true
}
```

### Step 식별자 경계

Domain payloads use `step_id` as a stable scenario key. Operational transport uses camelCase `stepKey` for the same value when Runner sends callbacks. Spring resolves `stepKey` to the DB UUID `test_run_step.id`; public REST paths such as `/api/runs/{runId}/steps/{stepId}` use the DB UUID.

## 5. EvidencePacket

EvidencePacket은 Spring이 Runner checkpoint/artifact callback을 기준으로 materialize하는 normalized evidence snapshot이다. Runner는 checkpoint와 artifact metadata를 전송하고, full EvidencePacket blob은 finished/failed callback에 싣지 않는다.

Pipeline:

```text
ScenarioPlan
  → ScenarioValidator
  → BrowserWorker action/settle
  → checkpoint + artifact callbacks
  → Spring evidence materializer
  → Spring stores EvidencePacket snapshot and outbox_message stores analysis.request(evidencePacketId)
  → RabbitMQ analysis.request
  → StageResolver
  → StageContextBuilder
  → RuleEngine
  → JudgeResult
  → Analyzer callback stores analysis projection
  → Spring report API/service generates report row from completed analysis
```

현재 MVP 점검 범위에서는 Analyzer MQ consumer 구현에 맞춰 Spring이 EvidencePacket snapshot을 저장하고 `analysis.request`에는 `evidencePacketId`를 포함한다. Analyzer는 service token으로 `/internal/analysis/evidence-packets/{evidencePacketId}`를 호출해 packet을 가져간다.

Top-level fields:

- `schema_version`
- `run_id`
- `url`
- `final_url`
- `scenario`
- `environment`
- `checkpoints`
- `aggregate_signals`
- `decisionStageSummary` optional
- `artifacts`
- `collection_notes`

`decisionStageSummary`는 pre-Judge coverage summary다. EvidencePacket은 Rule Engine 이전 산출물이므로 `PASS` 또는 `WARNING` 같은 issue-derived status를 포함하지 않는다. Issue 유무가 반영된 stage 상태는 JudgeResult의 Decision Map에서만 계산한다.

## 6. Checkpoint

Checkpoint는 의미 있는 상태 전이 이후 생성된다.

각 checkpoint는 다음 값을 포함한다.

- `checkpoint_id`
- `step_id`
- `primaryStage`
- `trigger`
- `settle`
- `state`
- `observations`
- `deltas`
- `artifact_refs`

`checkpoint.primaryStage`는 checkpoint의 기본 decision moment다. 일반적으로 `ScenarioStep.stage` 또는 trigger/action context에서 결정된다. 기존 `stage` 필드는 migration 기간 동안 deprecated alias로만 사용할 수 있으며, 신규 producer는 `primaryStage`를 사용한다.

Checkpoint 안의 모든 observation이 반드시 같은 stage일 필요는 없다. 예를 들어 `FIRST_VIEW` checkpoint 안에서 `heading_structure.stage = FIRST_VIEW`, `first_view_message.stage = VALUE`, `cta_cluster.stage = CTA`가 동시에 존재할 수 있다.

## 7. Observation

Observation은 raw data에서 추출한 구조화된 fact다.

`Observation.stage`는 해당 observation이 어떤 decision moment와 관련 있는지 나타낸다. 이 값은 `checkpoint.primaryStage`와 다를 수 있고, StageResolver가 observation type을 기준으로 보정할 수 있다.

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

## 8. RuleRegistry

RuleRegistry는 Judge criterion을 code-executable rule metadata로 표현한다.

각 rule은 다음 값을 포함한다.

- criterion id
- axis
- applicableStages
- evidence level
- required observations
- measurement sources
- signal rule
- severity rules
- exceptions
- confidence rule
- output template
- source references

`Rule.applicableStages`는 rule이 실행되는 `StageContext` 목록이다. Rule Engine은 전체 page를 임의로 평가하지 않고, `applicableStages`에 해당하는 context에서만 criterion을 실행한다. Rule output은 stage, axis, criterion, severity, confidence, priority, `evidence_refs`를 포함해야 한다.

## 9. JudgeResult

JudgeResult is the canonical analyzer output. Analyzer completed callback must include this payload, and Spring stores it on `analysis_job.output_jsonb` plus user-facing projections (`analysis_finding`, `nudge`). Report rows are generated later from the completed analysis projection by the Spring report API/service.

포함 항목:

- summary
- stage scores(optional diagnostic)
- issues
- decision map
- scenario mismatch report(optional, stage issue와 분리)
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

`JudgeIssue.stage`는 Rule Engine이 StageContext를 기준으로 할당한다. LLM은 stage를 새로 만들거나 issue stage를 바꾸지 않는다.

`DecisionMapItem`:

- `stage`
- `displayName`
- `status`
- `issueIds`
- `summary`
- `evidenceRefs`

Canonical `JudgeResult`는 top-level field를 기존 계약에 맞춰 `decision_map`으로 유지한다. `decision_map[]` item은 UI/API projection과 동일한 camelCase fields(`displayName`, `issueIds`, `evidenceRefs`)를 사용해 Decision Map 렌더링 계약을 공유한다. Public OpenAPI에서는 top-level projection을 `decisionMap`으로 노출한다.

`StageStatus`:

- `OBSERVED`
- `PASS`
- `WARNING`
- `BLOCKED`
- `NOT_OBSERVED`
- `NOT_APPLICABLE`

Decision Map은 stage별 점수표가 아니라 사용자 결정 순간별 요약이다. UI는 `FIRST_VIEW` 같은 내부 enum 대신 `첫 화면 이해`, `가치 이해`, `행동 선택`, `입력 진행`, `최종 확정`을 표시한다.

LLM 제약:

- Stage는 LLM free-form output이 아니다.
- LLM은 `stage`, `severity`, `confidence`를 임의 변경하지 않는다.
- LLM은 Rule Engine의 `rule_hit`, `issue`, `evidence_refs`를 설명하고 Nudge/validation question을 생성한다.
- `evidence_refs` 없는 claim이나 criterion에 없는 문제명은 제거한다.

## 10. Evidence Reference Format

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

## 11. ScenarioMismatchReport

`ScenarioMismatchReport`는 JudgeResult와 별개로 선택한 시나리오가 URL에 맞지 않을 때 반환하는 product outcome payload다.

필드:

- `scenario_type`
- `scenario_fit_status`
- `block_reason`
- `evidence_refs`
- `recommended_alternatives`
- `user_message`

원칙:

- ScenarioMismatchReport는 UX 문제 판단이 아니다.
- URL과 선택 시나리오의 적용 가능성 판단이다.
- 사용자가 “구매 흐름”을 명시했는데 해당 진입점이 없는 경우, 사이트의 UX 문제로 단정하지 않는다.
- 단, 사용자의 goal이 “랜딩에서 구매 진입점이 있어야 한다”라면 PATH issue로 승격될 수 있다.

## 12. Versioning

Domain contracts use explicit schema versions.

규칙:

- additive optional fields: no major break
- required field changes: schema version bump
- JudgeResult stores evidence schema version and rule registry id
