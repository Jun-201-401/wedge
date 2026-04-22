# 05. Judge, Scoring, Validation 기준

## 1. Judge 원칙

Wedge는 LLM이 UX quality를 직접 판단하게 하지 않는다.

Canonical pipeline:

```text
Raw Data
  → Observation
  → Signal
  → Judgment
  → Output
  → LLM Explanation
```

LLM은 Rule Engine output을 사용자-facing 언어로 설명하고 번역하는 역할만 맡는다.

## 2. 평가 단위: Stage as Operational Decision Context

Wedge는 page 전체에 하나의 점수를 매기지 않는다. 대신 실제 시나리오 실행 중 생성된 checkpoint와 observation을 사용자 결정 순간인 Stage에 배치하고, Rule Engine은 stage별 context에서 criterion을 평가한다. Stage는 UX 문제를 더 정확히 설명하고, 우선순위를 계산하고, 리포트의 Decision Map을 구성하기 위한 내부 운영 프레임이다.

Stage는 다음을 의미하지 않는다.

- 사용자의 실제 심리 상태를 완벽히 추론한 값
- LLM이 화면 텍스트를 보고 자유롭게 판단한 값
- 페이지 섹션 이름
- 모든 페이지에 반드시 존재해야 하는 고정 단계

Stage는 다음을 의미한다.

- ScenarioStep, Checkpoint, Observation, Rule, Issue, DecisionMap에 붙는 enum 값
- Rule 적용 범위와 우선순위 계산에 쓰는 operational label
- 리포트에서 “어디서 왜 막힐 수 있는지”를 설명하기 위한 Decision Map 단위

### 2.1 Stage 목록

| Internal Stage | User-facing Label | Meaning |
|---|---|---|
| `FIRST_VIEW` | 첫 화면 이해 | 사용자가 페이지를 계속 볼지 판단하는 첫 순간 |
| `VALUE` | 가치 이해 | 서비스 가치와 관련성을 이해하는 순간 |
| `CTA` | 행동 선택 | 사용자가 다음 행동을 시작할지 결정하는 순간 |
| `INPUT` | 입력 진행 | 사용자가 입력을 계속할지 포기할지 결정하는 순간 |
| `COMMIT` | 최종 확정 | 제출, 결제, 문의, 가입 완료 직전 확정하는 순간 |

### 2.2 Stage의 비즈니스 목적

Stage는 단순 분류가 아니다. Stage는 다음 목적을 가진다.

1. 사용자가 어느 결정 순간에서 막힐 수 있는지 설명한다.
2. issue list를 flat하게 나열하지 않고 사용자 여정 순서로 정리한다.
3. 같은 issue라도 발생 위치에 따라 우선순위를 다르게 계산한다.
4. Rule false positive를 줄인다.
5. Report에서 Decision Map을 구성한다.
6. “무엇부터 고칠지”를 추천하는 기준으로 사용한다.

예:

- CTA 문구가 모호한 문제는 보조 링크에서는 낮은 우선순위일 수 있다.
- 같은 문제가 CTA stage 또는 COMMIT stage에 있으면 더 높은 우선순위가 될 수 있다.

### 2.3 Stage 할당 방식

V1에서 Stage는 LLM이 자유롭게 판단하지 않는다. Stage는 아래 순서로 결정한다.

1. ScenarioPlan의 `step.stage`
2. Checkpoint의 trigger/action context와 `primaryStage`
3. Observation type 기반 StageResolver
4. 필요 시 Analyzer의 제한된 heuristic
5. LLM은 보조 설명만 가능하며 source of truth가 아니다.

StageResolver 우선순위:

- ScenarioStep.stage가 있으면 checkpoint.primaryStage의 기본값으로 사용한다.
- Observation.stage가 명시되어 있으면 우선 사용한다.
- Observation.type에 따라 stage를 추론한다.
- 그래도 불명확하면 checkpoint.primaryStage를 사용한다.
- LLM의 자유 판단으로 stage를 바꾸지 않는다.

### 2.4 Stage별 activation criteria

| Stage | Activation Criteria | Primary Observation Types | Candidate Rules |
|---|---|---|---|
| `FIRST_VIEW` | `goto` 직후 첫 안정 checkpoint, 첫 viewport, scroll 전 상태 | `heading_structure`, `first_view_message`, `visual_emphasis`, `performance_metric`, `cta_candidate` | CLARITY-HEAD-001, CLARITY-MSG-001, PATH-CTA-001, RELIABILITY-CWV-001, VISUAL-HIER-001 |
| `VALUE` | first-view 또는 value/feature/pricing intro 영역에서 가치 제안 관련 observation이 추출됨 | `first_view_message`, `value_proposition`, `feature_summary`, `audience_signal`, `trust_signal` | CLARITY-MSG-001, CLARITY-HEAD-001, TRUST-RISK-001 |
| `CTA` | CTA 후보, primary-like action, click 직전/직후 decision checkpoint | `cta_candidate`, `cta_cluster`, `cta_text_specificity`, `target_size_issue`, `visual_emphasis` | PATH-CTA-001, PATH-CTA-002, PATH-CTA-003, PATH-TARGET-001, TRUST-RISK-001 |
| `INPUT` | form/input 발견, fill action, invalid submit, required/error observation 발생 | `form_field`, `form_error`, `required_field`, `missing_label`, `error_recovery`, `submit_disabled` | FRICTION-FORM-001, FRICTION-FORM-002, FRICTION-FORM-003, RELIABILITY-TECH-001 |
| `COMMIT` | submit/payment/contact/signup final action 직전, sensitive action 직전 | `final_submit_candidate`, `pricing_condition`, `risk_reduction_signal`, `terms_privacy_signal`, `payment_or_sensitive_action` | TRUST-INFO-001, TRUST-RISK-001, FRICTION-FORM-003, RELIABILITY-TECH-001 |

### 2.5 Stage status

모든 Run이 모든 Stage를 가져야 하는 것은 아니다. Decision Map에는 stage별 상태를 둔다.

`StageStatus`:

- `OBSERVED`: 해당 stage의 checkpoint 또는 observation이 존재한다.
- `PASS`: 관찰되었고 유의미한 issue가 없다.
- `WARNING`: issue가 있다.
- `BLOCKED`: 이전 단계 또는 시나리오 부적합으로 진행하지 못했다.
- `NOT_OBSERVED`: 탐색했지만 해당 stage evidence가 발견되지 않았다.
- `NOT_APPLICABLE`: 이 시나리오에 해당 stage가 필요하지 않다.

예:

Landing CTA scenario:

- FIRST_VIEW: OBSERVED 또는 PASS
- VALUE: OBSERVED
- CTA: OBSERVED 또는 WARNING
- INPUT: NOT_APPLICABLE
- COMMIT: NOT_APPLICABLE

Signup scenario:

- FIRST_VIEW: OBSERVED
- CTA: OBSERVED
- INPUT: OBSERVED
- COMMIT: OBSERVED 또는 BLOCKED

### 2.6 StageContext

Rule Engine은 전체 evidence를 한 번에 평가하지 않는다. Rule Engine은 StageContext를 만든 뒤, 각 rule의 `applicableStages`에 맞는 context에서만 평가한다.

StageContext fields:

- `runId`
- `stage`
- `checkpoints`
- `observations`
- `aggregateSignals`
- `scenarioGoal`
- `scenarioFitStatus`

Pseudo code:

```ts
type DecisionStage =
  | "FIRST_VIEW"
  | "VALUE"
  | "CTA"
  | "INPUT"
  | "COMMIT";

type StageStatus =
  | "OBSERVED"
  | "PASS"
  | "WARNING"
  | "BLOCKED"
  | "NOT_OBSERVED"
  | "NOT_APPLICABLE";

type StageContext = {
  runId: string;
  stage: DecisionStage;
  checkpoints: Checkpoint[];
  observations: Observation[];
  aggregateSignals: Record<string, unknown>;
  scenarioGoal: string;
  scenarioFitStatus?: string;
};

function buildStageContexts(packet: EvidencePacket): StageContext[] {
  const stages: DecisionStage[] = ["FIRST_VIEW", "VALUE", "CTA", "INPUT", "COMMIT"];

  return stages.map(stage => ({
    runId: packet.run_id,
    stage,
    checkpoints: packet.checkpoints.filter(cp =>
      cp.primaryStage === stage ||
      cp.observations.some(obs => obs.stage === stage)
    ),
    observations: packet.checkpoints
      .flatMap(cp => cp.observations)
      .filter(obs => obs.stage === stage),
    aggregateSignals: packet.aggregate_signals,
    scenarioGoal: packet.scenario.goal,
    scenarioFitStatus: packet.scenario_fit?.scenario_fit_status
  }));
}
```

### 2.7 StageResolver

StageResolver는 step, checkpoint, observation을 보고 stage를 결정한다.

Pseudo code:

```ts
function resolveObservationStage(
  observation: Observation,
  checkpoint: Checkpoint,
  step?: ScenarioStep
): DecisionStage {
  if (observation.stage) return observation.stage;

  switch (observation.type) {
    case "heading_structure":
      return checkpoint.isFirstViewport ? "FIRST_VIEW" : "VALUE";

    case "first_view_message":
    case "value_proposition":
    case "feature_summary":
      return "VALUE";

    case "cta_candidate":
    case "cta_cluster":
    case "cta_text_specificity":
    case "target_size_issue":
      return "CTA";

    case "form_field":
    case "form_error":
    case "required_field":
    case "missing_label":
    case "error_recovery":
      return "INPUT";

    case "pricing_condition":
    case "risk_reduction_signal":
    case "terms_privacy_signal":
    case "payment_or_sensitive_action":
      return step?.stage === "COMMIT" ? "COMMIT" : "CTA";

    case "network_failure":
    case "console_error":
    case "performance_metric":
      return step?.stage ?? checkpoint.primaryStage;

    default:
      return step?.stage ?? checkpoint.primaryStage ?? "FIRST_VIEW";
  }
}
```

### 2.8 Rule Engine과 LLM의 역할 분리

Rule Engine:

- observation을 signal로 변환한다.
- rule별 severity, confidence, priority를 계산한다.
- exceptions를 적용한다.
- `evidence_refs`를 반드시 포함한다.

LLM:

- Rule Engine 결과를 사용자 언어로 설명한다.
- Nudge를 제안한다.
- validation question을 작성한다.
- Stage, severity, confidence를 임의로 변경하지 않는다.
- `evidence_refs`가 없는 claim을 생성하지 않는다.
- criterion에 없는 문제명을 새로 만들지 않는다.

LLM output은 JSON schema로 검증하고, unsupported claim은 제거한다.

### 2.9 Stage와 Scenario Mismatch의 분리

시나리오가 URL에 맞지 않는 경우는 Stage issue로 바로 처리하지 않는다.

예:

- 사용자가 PURCHASE_CHECKOUT 시나리오를 선택했다.
- Discovery 또는 Run에서 pricing/cart/checkout entrypoint가 없다.

이 경우:

- `scenarioFitStatus = NOT_APPLICABLE`
- `resultCompleteness = PARTIAL`
- `ScenarioMismatchReport` 생성
- Run failure가 아니라 mismatch outcome으로 표시

주의:
이것은 “사이트 UX가 나쁘다”가 아니다. “선택한 시나리오가 이 URL에서 진행 가능하지 않다”는 진단이다.

단, 사용자의 명시 목표가 “랜딩 페이지에 구매 진입점이 있는지 확인”이라면 PATH issue로 승격할 수 있다.

### 2.10 Report 표현

내부 enum을 사용자에게 그대로 노출하지 않는다.

표시명:

- FIRST_VIEW → 첫 화면 이해
- VALUE → 가치 이해
- CTA → 행동 선택
- INPUT → 입력 진행
- COMMIT → 최종 확정

Report는 stage별 점수표보다 Decision Map으로 보여준다.

나쁜 표현:

- FIRST_VIEW: 72점
- CTA: 84점

좋은 표현:

- 행동 선택 단계에서 primary급 CTA 3개가 경쟁합니다.
- 첫 클릭 결정이 분산될 수 있습니다.
- 먼저 primary CTA를 1개로 정리하세요.

### 2.11 Calibration

Stage 기반 Rule은 benchmark calibration으로 검증한다.

검증 항목:

- stage assignment가 사람이 보는 결정 순간과 맞는가
- `applicableStages`가 너무 넓거나 좁지 않은가
- false positive가 특정 stage에서 반복되는가
- `NOT_APPLICABLE` / `BLOCKED` 처리가 적절한가
- LLM unsupported claim rate가 5% 이하인가

기존 success metrics와 연결한다.

## 3. 평가 축

| Axis | Question |
|---|---|
| Clarity | 목적, 가치 제안, 정보 구조가 이해되는가 |
| Path | 다음 행동과 기본 경로가 명확한가 |
| Friction | 행동 수행 부담과 복구 비용이 큰가 |
| Trust | 행동 직전에 확신을 줄 정보가 충분한가 |
| Reliability | 기술적으로 안정적으로 동작하는가 |
| Visual Integrity | 시각 위계와 컴포넌트 표현이 목적에 맞는가 |

## 4. Severity

| Severity | Meaning |
|---:|---|
| 0 | no issue |
| 1 | weak signal / caution |
| 2 | clear issue |
| 3 | severe issue at critical stage |

## 5. Confidence

| Range | Meaning |
|---|---|
| 0.00–0.39 | weak evidence |
| 0.40–0.69 | partial evidence |
| 0.70–0.89 | multiple aligned evidence sources |
| 0.90–1.00 | standard rule or clear execution failure |

## 6. Priority

```text
priority_score = severity × stage_weight × confidence × fix_leverage
```

권장 stage weight:

| Stage | Weight |
|---|---:|
| FIRST_VIEW | 1.2 |
| VALUE | 1.1 |
| CTA | 1.3 |
| INPUT | 1.2 |
| COMMIT | 1.4 |

`fix_leverage`는 0.8–1.2 범위에서 시작한다.

## 7. Run Friction Score

Run-level score는 issue risk의 가중 집계값이다.

```text
issue_risk = (severity / 3) × confidence × 100

stage_score = weighted average(issue_risk in stage)

run_friction_score = weighted average(stage_score × stage_weight)
```

해석:

| Score | Label |
|---:|---|
| 0–24 | low |
| 25–49 | caution |
| 50–74 | high |
| 75–100 | critical |

Score는 비교를 돕는 값이며, 절대적 정답이 아니다.

## 7.5 Scenario Fit Evaluation

Scenario Fit Evaluation은 선택한 시나리오가 입력 URL에서 실행 가능한지 판단하는 단계다. 이는 UX 점수나 전환 마찰 점수와 다르다. 예를 들어 구매 시나리오를 선택했지만 해당 URL에 구매/결제 진입점이 없다면, 이는 “사이트가 나쁘다”가 아니라 “선택한 시나리오가 이 URL에 맞지 않다”로 처리한다.

### FIT-SCENARIO-001: Scenario Entrypoint Availability

| Field | Value |
|---|---|
| Stage | N/A — scenario fit diagnostic, not a Stage issue |
| Axis | Fit / Diagnostic |
| Evidence Level | Operational |
| Required Data | CTA candidates, nav links, form candidates, pricing links, checkout/cart links, URL text, link href, button text |

Signal Rule:

선택한 시나리오에 필요한 entrypoint가 first-view, nav, limited scroll 내에서 발견되지 않으면 scenario mismatch signal을 생성한다.

Severity:

일반 severity에 포함하지 않는다. 대신 `scenario_fit_status`로 표현한다.

Output Template:

```text
이 URL에서는 선택한 {scenario_type} 시나리오를 시작할 진입점을 찾지 못했습니다. 대신 {alternative_scenarios} 흐름이 더 적합해 보입니다.
```

Scenario mismatch는 Run Friction Score에 포함하지 않는다. 단, 사용자가 명시적으로 “랜딩 페이지에서 구매 진입점이 있는지 점검”을 목표로 설정했다면 Path issue로도 해석할 수 있다.

## 8. P0 Criteria

V1에서는 아래 후보 중 7–10개 rule을 구현한다.

| Criterion | Priority |
|---|---|
| PATH-CTA-001 Primary CTA Presence | P0 |
| PATH-CTA-002 Primary CTA Competition | P0 |
| CLARITY-HEAD-001 Heading Hierarchy | P0 |
| FRICTION-FORM-001 Label/Instruction | P0 |
| FRICTION-FORM-003 Error Identification/Suggestion | P0 |
| RELIABILITY-TECH-001 Failed Request/Console Error | P0 |
| VISUAL-CONTRAST-001 Contrast | P0 |
| PATH-TARGET-001 Target Size | P0 |
| TRUST-RISK-001 Risk-reduction Signal | P1/P0 if time |
| VISUAL-HIER-001 Semantic–Visual Alignment | P1/P0 if time |

실험 항목:

- VISUAL-HERO-001 Hero Dominance
- advanced trust taxonomy
- full visual saliency

## 9. LLM output 제약

LLM은 다음 규칙을 지킨다.

- criteria를 새로 만들어내지 않는다.
- `evidence_refs` 없는 claim을 만들지 않는다.
- Research/Operational rule에는 가능성 표현을 사용한다.
- "ugly", "not stylish" 같은 취향 표현을 피한다.
- finding을 항상 behavior risk와 fix direction으로 번역한다.

## 10. Benchmark calibration

최소 benchmark set:

| Group | Count |
|---|---:|
| Well-designed SaaS landing | 5 |
| Complex SaaS landing | 5 |
| Pricing pages | 5 |
| Signup/lead forms | 5 |
| Mobile-sensitive pages | 3–5 |
| Weak-trust pages | 3–5 |

절차:

1. 2명 이상이 human baseline labeling을 수행한다.
2. 자동 실행을 수행한다.
3. true positive / false positive / false negative / ambiguous를 비교한다.
4. threshold와 exception을 조정한다.
5. RuleRegistry에 version을 기록한다.

## 11. Judge Quality Metrics

| Metric | MVP Target |
|---|---|
| Evidence coverage | 90%+ issues have evidence_refs |
| Rule reproducibility | top issue similarity 70%+ on rerun |
| False positive rate on good benchmarks | initial <= 30%, target <= 15% |
| Human agreement | medium+ agreement on P0 criteria |
| Unsupported LLM claim rate | <= 5% |

### Scenario mismatch validation cases

Benchmark에는 scenario mismatch case를 포함한다.

- 구매 시나리오를 SaaS 랜딩 URL에 적용
- signup 시나리오를 블로그 글 URL에 적용
- pricing 시나리오를 제품 상세 URL에 적용
- contact form 시나리오를 form 없는 페이지에 적용

검증 목표:

- 시스템 오류로 보이지 않는지
- 대체 시나리오 추천이 적절한지
- LOW/NOT_AVAILABLE 추천이 과도하게 나오지 않는지
