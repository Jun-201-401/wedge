# 05. Judge, Scoring, and Validation

## 1. Judge Principle

Wedge does not let the LLM directly judge UX quality.

Canonical pipeline:

```text
Raw Data
  → Observation
  → Signal
  → Judgment
  → Output
  → LLM Explanation
```

The LLM only explains and translates Rule Engine output into user-facing language.

## 2. Evaluation Unit

Wedge evaluates stages, not entire pages.

| Stage | Description |
|---|---|
| `FIRST_VIEW` | 계속 볼지 판단하는 순간 |
| `VALUE` | 서비스 가치와 관련성을 이해하는 순간 |
| `CTA` | 행동을 시작할지 결정하는 순간 |
| `INPUT` | 입력을 계속할지 포기할지 결정하는 순간 |
| `COMMIT` | 제출/결제/문의 직전 확정하는 순간 |

## 3. Axis

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

Recommended stage weights:

| Stage | Weight |
|---|---:|
| FIRST_VIEW | 1.2 |
| VALUE | 1.1 |
| CTA | 1.3 |
| INPUT | 1.2 |
| COMMIT | 1.4 |

`fix_leverage` starts in the 0.8–1.2 range.

## 7. Run Friction Score

The run-level score is a weighted aggregation of issue risk.

```text
issue_risk = (severity / 3) × confidence × 100

stage_score = weighted average(issue_risk in stage)

run_friction_score = weighted average(stage_score × stage_weight)
```

Interpretation:

| Score | Label |
|---:|---|
| 0–24 | low |
| 25–49 | caution |
| 50–74 | high |
| 75–100 | critical |

Score is a comparison aid, not an absolute truth.

## 8. P0 Criteria

V1 should implement 7–10 rules from this set.

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

Experimental:

- VISUAL-HERO-001 Hero Dominance
- advanced trust taxonomy
- full visual saliency

## 9. LLM Output Constraints

The LLM must:

- not invent criteria
- not make claims without evidence_refs
- use possibility language for Research/Operational rules
- avoid taste language such as “ugly” or “not stylish”
- always translate findings into behavior risk and fix direction

## 10. Benchmark Calibration

Minimum benchmark set:

| Group | Count |
|---|---:|
| Well-designed SaaS landing | 5 |
| Complex SaaS landing | 5 |
| Pricing pages | 5 |
| Signup/lead forms | 5 |
| Mobile-sensitive pages | 3–5 |
| Weak-trust pages | 3–5 |

Process:

1. Human baseline labeling by at least 2 people
2. Automatic run
3. Compare true positive / false positive / false negative / ambiguous
4. Adjust thresholds and exceptions
5. Record version in RuleRegistry

## 11. Judge Quality Metrics

| Metric | MVP Target |
|---|---|
| Evidence coverage | 90%+ issues have evidence_refs |
| Rule reproducibility | top issue similarity 70%+ on rerun |
| False positive rate on good benchmarks | initial <= 30%, target <= 15% |
| Human agreement | medium+ agreement on P0 criteria |
| Unsupported LLM claim rate | <= 5% |
