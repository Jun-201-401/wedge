# JudgeResult 필수 데이터 정리

## 1. 목적

이 문서는 Analyzer가 생성하는 `JudgeResult`의 필수 데이터를 정리한다.

목표는 Spring 쪽의 **Judge 저장 구조 초안 작성** 작업에서 어떤 데이터를 `analysis_job`, `rule_hit`, `analysis_finding`, `nudge`, `report`에 저장해야 하는지 판단할 수 있게 하는 것이다.

기준 계약:

- `packages/contracts/schemas/judge-result.schema.json`
- `docs/04_domain_payload_contracts.md`
- `apps/analyzer/app/rule_engine/judge_result_builder.py`
- `packages/contracts/examples/sample-judge-result.json`

## 2. JudgeResult 역할

`JudgeResult`는 Analyzer의 canonical output이다.

Runner가 수집한 checkpoint, observation, artifact를 Spring이 `EvidencePacket`으로 materialize하고, Analyzer는 이 `EvidencePacket`을 입력으로 받아 Rule Engine 평가 결과를 `JudgeResult`로 만든다.

흐름:

```text
EvidencePacket
  -> StageResolver
  -> StageContextBuilder
  -> RuleEngine
  -> JudgeResult
  -> Spring 저장
  -> Report / Finding / Nudge projection
```

`JudgeResult`는 사용자에게 그대로 보여주는 화면 모델이 아니라, 저장과 리포트 생성을 위한 분석 결과 원본이다.

## 3. Top-level 필수 필드

JSON Schema 기준 필수 필드는 다음과 같다.

| Field | Required | 설명 | 저장 후보 |
|---|---|---|---|
| `schema_version` | 필수 | JudgeResult 계약 버전. 현재 `0.5` | `analysis_job.output_jsonb`, `analysis_job.judge_schema_version` |
| `run_id` | 필수 | 분석 대상 run id | `analysis_job.run_id`, `output_jsonb` |
| `evidence_schema_version` | 필수 | 입력 EvidencePacket schema version | `analysis_job.output_jsonb` |
| `rule_registry_id` | 필수 | 평가에 사용한 RuleRegistry id | `analysis_job.rule_registry_id`, `output_jsonb` |
| `summary` | 필수 | 전체 분석 요약 | `analysis_job.output_jsonb`, `report.summary_jsonb` |
| `issues` | 필수 | Rule Engine이 생성한 issue 목록 | `rule_hit`, `analysis_finding`, `output_jsonb` |
| `decision_map` | 필수 | stage별 사용자 결정 흐름 요약 | `report.decision_map_jsonb`, `output_jsonb` |
| `stage_scores` | 선택 | stage별 score 진단값. 사용자 화면은 `decision_map` 우선 | `output_jsonb` |
| `scenario_mismatch_report` | 선택 | 선택 시나리오가 페이지와 맞지 않을 때 별도 보고 | `output_jsonb`, 필요 시 `report.summary_jsonb` |
| `nudges` | 선택 | issue 기반 개선 제안 | `nudge`, `output_jsonb` |
| `llm_notes` | 선택 | LLM/AI 사용 제약 또는 설명 메모 | `output_jsonb` |

주의:

- `decision_map`은 snake_case가 canonical field다.
- Public API projection에서는 `decisionMap` camelCase로 노출될 수 있다.
- `scenario_mismatch_report`는 UX issue가 아니라 시나리오 적합성 결과다.

## 4. summary 필수 데이터

`summary`는 JudgeResult 전체 요약이다.

| Field | Required | Type | 설명 |
|---|---|---|---|
| `overall_risk` | 필수 | enum | 전체 위험도. `low`, `medium`, `high`, `critical` |
| `friction_score` | 필수 | number | 사용자 마찰 점수. 0~100 |
| `top_issues_count` | 필수 | integer | 주요 issue 개수 |
| `task_success` | 필수 | enum | 과업 성공 상태. `success`, `partial`, `failed`, `blocked` |

저장 기준:

- `friction_score`는 조회/정렬 가능성이 있어 `analysis_job.friction_score`에 별도 저장 후보.
- 전체 `summary` object는 `analysis_job.output_jsonb`에 원본 보존.
- Report 생성을 위해 `report.summary_jsonb`에도 projection 저장 후보.

## 5. issues 필수 데이터

`issues[]`는 Rule Engine이 생성한 사용자-facing 문제 목록이다.

JSON Schema 기준 필수 필드는 다음과 같다.

| Field | Required | 설명 | 저장 후보 |
|---|---|---|---|
| `issue_id` | 필수 | JudgeResult 내부 issue 식별자 | `analysis_finding` 연결 키 또는 `output_jsonb` |
| `criterion_id` | 필수 | 어떤 rule/criterion에서 나온 issue인지 | `rule_hit.criterion_id` |
| `stage` | 필수 | issue가 속한 DecisionStage | `rule_hit.stage`, `analysis_finding.stage` |
| `axis` | 필수 | Path, Friction, Trust, Reliability 등 평가 축 | `rule_hit.axis`, `analysis_finding.axis` |
| `severity` | 필수 | 심각도. 0~3 | `rule_hit.severity`, `analysis_finding.severity` |
| `confidence` | 필수 | 신뢰도. 0~1 | `rule_hit.confidence`, `analysis_finding.confidence` |
| `priority_score` | 필수 | 정렬용 우선순위 점수 | `rule_hit.priority_score`, `analysis_finding.priority_score` |
| `evidence_refs` | 필수 | 근거 checkpoint/observation reference 목록 | `rule_hit.evidence_refs_jsonb`, `analysis_finding.evidence_refs_jsonb` |
| `summary` | 필수 | 사용자-facing 문제 요약 | `analysis_finding.summary` |
| `recommendations` | 필수 | 개선 제안 목록 | `nudge.recommendation` 또는 `output_jsonb` |

선택 필드:

| Field | 설명 | 저장 후보 |
|---|---|---|
| `evidence_level` | Operational, Standard, Technical 등 evidence 강도 | `rule_hit.evidence_level` |
| `observations` | issue 판단에 사용한 observation 요약 | `rule_hit.observations_jsonb` |
| `signals` | Rule Engine 내부 signal | `rule_hit.signals_jsonb` |
| `impact_hypothesis` | 사용자 영향 가설 | `analysis_finding.impact_hypothesis` |
| `validation_questions` | 검증 질문 | `nudge.validation_question` 또는 `output_jsonb` |
| `exceptions_applied` | 적용된 예외 규칙 | `rule_hit.exceptions_jsonb` |

중요:

- `docs/04_domain_payload_contracts.md`의 issue 필수 목록에는 `issue_id`가 빠져 있지만, JSON Schema 기준으로는 `issue_id`가 필수다.
- 저장 구조는 JSON Schema를 우선 기준으로 삼는다.

## 6. decision_map 필수 데이터

`decision_map[]`은 stage별 사용자 결정 흐름 요약이다.

| Field | Required | 설명 | 저장 후보 |
|---|---|---|---|
| `stage` | 필수 | 내부 DecisionStage enum | `report.decision_map_jsonb` |
| `displayName` | 필수 | 사용자-facing stage 이름 | `report.decision_map_jsonb` |
| `status` | 필수 | stage 상태 | `report.decision_map_jsonb` |
| `issueIds` | 필수 | 해당 stage에 연결된 issue id 목록 | `report.decision_map_jsonb` |
| `summary` | 필수 | stage 요약 문구. null 가능 | `report.decision_map_jsonb` |
| `evidenceRefs` | 필수 | 해당 stage 근거 reference 목록 | `report.decision_map_jsonb` |

DecisionStage enum:

```text
FIRST_VIEW
VALUE
CTA
INPUT
COMMIT
```

StageStatus enum:

```text
OBSERVED
PASS
WARNING
BLOCKED
NOT_OBSERVED
NOT_APPLICABLE
```

저장 기준:

- `decision_map`은 별도 row table보다 `report.decision_map_jsonb` 저장이 우선이다.
- 원본은 `analysis_job.output_jsonb.decision_map`에도 유지한다.
- UI는 내부 enum인 `FIRST_VIEW` 대신 `displayName`을 표시한다.

## 7. nudges 데이터

`nudges[]`는 issue 기반 개선 제안이다.

| Field | Required | 설명 | 저장 후보 |
|---|---|---|---|
| `nudge_id` | 필수 | nudge 식별자 | `output_jsonb` 또는 `nudge.id`와 별도 매핑 |
| `issue_id` | 필수 | 연결된 issue | `nudge.finding_id` 매핑 기준 |
| `title` | 필수 | 제안 제목 | `nudge.title` |
| `recommendation` | 필수 | 구체 개선 제안 | `nudge.recommendation` |
| `difficulty` | 필수 | 난이도. `LOW`, `MEDIUM`, `HIGH` | `nudge.difficulty` |
| `rationale` | 선택 | 왜 이 제안이 필요한지 | `nudge.rationale` |
| `expected_effect` | 선택 | 기대 효과 | `nudge.expected_effect` |
| `validation_question` | 선택 | 수정 후 검증 질문 | `nudge.validation_question` |

저장 기준:

- nudge는 사용자-facing 개선 제안이므로 `nudge` table projection 대상이다.
- `issue_id`는 `analysis_finding`과 연결되어야 한다.

## 8. scenario_mismatch_report 데이터

`scenario_mismatch_report`는 선택한 시나리오가 페이지와 맞지 않을 때만 생성한다.

필수 필드:

| Field | 설명 |
|---|---|
| `scenario_type` | 선택한 시나리오 타입 |
| `scenario_fit_status` | 시나리오 적합성 상태 |
| `block_reason` | 막힌 이유 |
| `evidence_refs` | mismatch 판단 근거 |
| `recommended_alternatives` | 대체 시나리오 후보 |
| `user_message` | 사용자-facing 메시지 |

주의:

- `scenario_mismatch_report`는 `issues[]`에 넣지 않는다.
- 시나리오 부적합은 UX 문제와 분리한다.
- 저장은 우선 `analysis_job.output_jsonb`에 원본 보존한다.

## 9. Spring 저장 구조 매핑 초안

Judge 저장 구조 담당자가 참고할 최소 매핑이다.

| 저장 대상 | JudgeResult source | 저장 목적 |
|---|---|---|
| `analysis_job.output_jsonb` | JudgeResult 전체 | 원본 보존, 재처리, 디버깅 |
| `analysis_job.judge_schema_version` | `schema_version` | 계약 버전 추적 |
| `analysis_job.rule_registry_id` | `rule_registry_id` | 사용한 RuleRegistry 추적 |
| `analysis_job.friction_score` | `summary.friction_score` | 목록/정렬/요약 조회 |
| `rule_hit` | `issues[]`의 rule 판단 원천 필드 | Rule Engine raw hit 저장 |
| `analysis_finding` | `issues[]`의 사용자-facing 필드 | Report와 API에 노출할 issue projection |
| `nudge` | `nudges[]` 또는 `issues[].recommendations` | 개선 제안 저장 |
| `report.summary_jsonb` | `summary` + 주요 issue 요약 | 리포트 요약 |
| `report.decision_map_jsonb` | `decision_map` | Decision Map 렌더링 |

## 10. LLM 제약

LLM 또는 MCP provider는 다음 값을 임의로 생성하거나 변경하지 않는다.

- `stage`
- `severity`
- `confidence`
- `priority_score`
- `criterion_id`
- `evidence_refs`

LLM이 할 수 있는 일:

- Rule Engine 결과를 사용자 언어로 설명한다.
- `summary`, `recommendation`, `rationale`, `validation_question` 초안을 보조한다.
- 단, `evidence_refs`가 없는 claim은 제거해야 한다.

## 11. 최소 JudgeResult 예시

```json
{
  "schema_version": "0.5",
  "run_id": "run_001",
  "evidence_schema_version": "0.5",
  "rule_registry_id": "registry_p0_v0_1",
  "summary": {
    "overall_risk": "medium",
    "friction_score": 42,
    "top_issues_count": 1,
    "task_success": "partial"
  },
  "issues": [
    {
      "issue_id": "issue_001",
      "criterion_id": "PATH-CTA-001",
      "stage": "CTA",
      "axis": "Path",
      "severity": 2,
      "confidence": 0.82,
      "priority_score": 72.5,
      "evidence_refs": ["cp_001.obs_002"],
      "summary": "핵심 CTA가 첫 화면에서 충분히 명확하지 않습니다.",
      "recommendations": [
        "첫 화면의 primary CTA를 하나로 명확히 정리합니다."
      ]
    }
  ],
  "decision_map": [
    {
      "stage": "FIRST_VIEW",
      "displayName": "첫 화면 이해",
      "status": "PASS",
      "issueIds": [],
      "summary": "첫 화면에서 판단에 필요한 evidence가 관찰되었습니다.",
      "evidenceRefs": ["cp_001.obs_001"]
    },
    {
      "stage": "CTA",
      "displayName": "행동 선택",
      "status": "WARNING",
      "issueIds": ["issue_001"],
      "summary": "핵심 CTA가 첫 화면에서 충분히 명확하지 않습니다.",
      "evidenceRefs": ["cp_001.obs_002"]
    }
  ],
  "scenario_mismatch_report": null,
  "nudges": [
    {
      "nudge_id": "nudge_001",
      "issue_id": "issue_001",
      "title": "Primary CTA 명확화",
      "rationale": "PATH-CTA-001 rule hit와 evidence_refs에 근거합니다.",
      "recommendation": "첫 화면의 primary CTA를 하나로 명확히 정리합니다.",
      "difficulty": "LOW",
      "expected_effect": "사용자가 다음 행동을 더 빠르게 선택할 수 있습니다.",
      "validation_question": "수정 후 같은 evidence 수집에서 CTA issue가 재현되지 않는가?"
    }
  ],
  "llm_notes": [
    "Rule Engine generated deterministic stage/severity/confidence/priority values."
  ]
}
```

## 12. 오늘 작업 완료 기준

- JudgeResult 필수 top-level 필드가 정리되어 있다.
- `summary`, `issues`, `decision_map`, `nudges` 필수 데이터가 정리되어 있다.
- Judge 저장 구조 담당자가 참고할 Spring 저장 후보가 정리되어 있다.
- LLM이 변경하면 안 되는 JudgeResult 필드가 명시되어 있다.
- 최소 JudgeResult 예시가 포함되어 있다.
