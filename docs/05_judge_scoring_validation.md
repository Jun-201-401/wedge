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

## 2. 평가 단위

Wedge는 전체 page가 아니라 stage 단위로 평가한다.

| Stage | Description |
|---|---|
| `FIRST_VIEW` | 계속 볼지 판단하는 순간 |
| `VALUE` | 서비스 가치와 관련성을 이해하는 순간 |
| `CTA` | 행동을 시작할지 결정하는 순간 |
| `INPUT` | 입력을 계속할지 포기할지 결정하는 순간 |
| `COMMIT` | 제출/결제/문의 직전 확정하는 순간 |

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
| Stage | Preflight, First View, CTA Decision |
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
