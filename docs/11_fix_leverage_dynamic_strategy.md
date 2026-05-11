# Dynamic Fix Leverage Strategy

## 1. 목적

`fix_leverage`는 Rule Engine이 발견한 issue를 고쳤을 때, 사용자의 불편이나 전환 마찰이 줄어들 가능성을 나타내는 개선 효과 기대값이다.

`fix_leverage`는 issue의 심각도나 근거 확실성을 대체하지 않는다.

```text
priority_score = severity * stage_weight * confidence * fix_leverage
```

- `severity`: 사용자의 목표 달성을 얼마나 방해하는지
- `stage_weight`: 문제가 발생한 DecisionStage의 중요도
- `confidence`: observation/evidence가 얼마나 확실한지
- `fix_leverage`: 이 issue를 고쳤을 때 사용자 불편이나 전환 마찰이 얼마나 줄어들지

따라서 `fix_leverage`는 "문제가 얼마나 심각한가"가 아니라 "고쳤을 때 얼마나 효과가 클 것인가"를 판단한다.

## 2. MVP 방향

MVP에서는 `fix_leverage`를 Rule Engine이 deterministic하게 계산하지 않는다.

Rule Engine은 observation과 deterministic condition을 기준으로 issue를 만든다. 이후 GMS/LLM이 해당 issue와 연결된 observation, evidence location, component 위치 정보를 보고 `fix_leverage`를 5개 값 중 하나로 부여한다.

```text
EvidencePacket / observations
→ Rule Engine issue 생성
→ LLM이 issue와 observation 근거 확인
→ fix_leverage 5단계 중 하나 선택
→ Analyzer가 허용값 검증
→ priority_score 재계산
```

이때 LLM은 issue 자체를 새로 판단하지 않는다. LLM은 이미 만들어진 issue에 대해 "고치면 사용자 불편이나 전환 마찰이 얼마나 줄어들지"만 판단한다.

## 3. 5단계 기준

MVP에서는 아래 5개 값만 사용한다.

| fix_leverage | criterion_id 기준 부합도 |
|---:|---|
| 0.8 | 해당 Rule의 개선 효과 조건에 거의 부합하지 않음. 문제는 있으나 고쳐도 목표 흐름 개선이 제한적 |
| 0.95 | 일부만 부합함. 문제는 맞지만 수정 대상 또는 개선 효과가 불확실 |
| 1.0 | 보통 수준으로 부합함. 해당 Rule의 일반적인 개선 효과 |
| 1.15 | 많이 부합함. 해당 Rule에서 기대하는 개선 효과가 실제 evidence에서 잘 드러남 |
| 1.3 | 매우 강하게 부합함. 해당 Rule의 핵심 고효과 패턴에 해당하고, 작은 수정으로 큰 흐름 개선이 예상됨 |

위 표에서 "부합도"는 Rule Engine의 판단이 맞는지 다시 검증한다는 뜻이 아니다.

```text
부합도 =
이 issue가 해당 criterion_id에서 기대하는 개선 효과 패턴에 얼마나 가까운가
```

예를 들어 `PATH-CTA-002` issue가 생성되었다면 LLM은 "버튼 경쟁 문제가 실제 observation에서 얼마나 사용자 선택 마찰로 이어질 가능성이 큰가"를 본다.

## 4. LLM 판단 입력

LLM은 최소한 다음 정보를 함께 받아야 한다.

| 입력 | 용도 |
|---|---|
| `issue_id` | 어떤 issue에 대한 판단인지 식별 |
| `criterion_id` | 어떤 Rule의 개선 효과 기준으로 볼지 확인 |
| `stage` | 문제가 목표 흐름의 어느 단계에 있는지 확인 |
| `severity` | Rule Engine이 판단한 방해 정도를 참고 |
| `confidence` | evidence 확실성을 참고 |
| `summary` / `impact_hypothesis` | Rule Engine이 만든 원인과 영향 설명 참고 |
| `evidence_refs` | issue와 연결된 observation 참조 |
| `evidence_locations` | 문제 위치, 컴포넌트, bounds 확인 |
| observation `data` | clicked 여부, component count, bounds, role, text 등 근거 확인 |
| screenshot artifact 정보 | 화면상 위치와 맥락 판단에 사용 |

LLM 판단은 observation 기반이어야 한다. 즉, LLM은 `evidence_refs`와 연결된 observation, component, bounds, clicked path, screenshot 맥락을 근거로 해야 한다.

## 5. Observation 기반 판단 축

LLM은 아래 축을 보고 `fix_leverage`를 선택한다.

| 판단 축 | 높게 보는 근거 | 낮게 보는 근거 |
|---|---|---|
| 목표 흐름 연결성 | 실제 시나리오 경로, 클릭 checkpoint, INPUT/COMMIT 단계와 직접 연결됨 | 목표 흐름과 간접적으로만 관련됨 |
| 실제 사용자 행동 여부 | `clicked_in_scenario=true`이거나 실제 action checkpoint와 연결됨 | 사용자가 지나가지 않은 주변 영역에서만 관찰됨 |
| 수정 대상 명확성 | problem_components, bounds, selector, text 등으로 위치가 특정됨 | 어떤 컴포넌트를 고쳐야 하는지 불명확함 |
| 수정 효과 명확성 | 문구, 강조, 배치, 라벨, 안내, 상태 표시처럼 작은 변경으로 완화 가능 | 구조, 정책, 인증, 결제, 백엔드 변경이 필요해 보임 |
| 화면상 영향도 | 문제 컴포넌트가 화면에서 잘 보이고 선택/입력 흐름에 영향을 줌 | 화면 하단, 보조 영역, 실제 경로 밖에 있음 |
| 중복 완화 가능성 | 하나의 수정이 여러 issue나 여러 컴포넌트 문제를 함께 줄임 | 단일 국소 문제이고 영향 범위가 작음 |

이 축은 점수 계산용 고정 공식이 아니라, LLM이 5단계를 안정적으로 고르기 위한 판단 기준이다.

## 6. 단계별 판단 예시

### 0.8

문제는 있지만 observation 기준으로 목표 흐름과 직접 연결이 약하다. 고쳐도 사용자 불편이나 전환 마찰이 크게 줄어들 가능성이 낮다.

예:

- 사용자가 실제로 지나간 경로 밖의 보조 영역 문제
- 문제 컴포넌트가 목표 행동과 멀리 떨어져 있음
- 수정해도 목표 완료 흐름에 주는 영향이 제한적

### 0.95

문제는 맞지만 수정 대상이나 개선 효과가 불확실하다. observation은 있으나 작은 수정으로 개선될지 확신하기 어렵다.

예:

- 오류는 있지만 원인 컴포넌트가 불명확함
- 화면 구조나 정책 변경이 필요해 보임
- observation이 집계성 근거에 가깝고 직접 위치 근거가 약함

### 1.0

해당 Rule의 일반적인 개선 효과 수준이다. 상향하거나 하향할 뚜렷한 observation 근거가 없다.

예:

- 문제와 수정 방향은 일반적으로 타당함
- 목표 흐름과 관련은 있으나 직접적인 큰 마찰로 보기는 어려움
- 위치나 클릭 경로 근거가 보통 수준

### 1.15

문제가 실제 사용 경로와 연결되어 있고, observation에서 수정 대상이 명확하다. 고치면 사용자 흐름이 좋아질 가능성이 높다.

예:

- 실제 클릭한 버튼, 입력 필드, 제출 흐름과 연결됨
- bounds나 text로 문제 컴포넌트가 특정됨
- 문구, 강조, 라벨, 안내 변경으로 개선 가능해 보임

### 1.3

해당 Rule의 핵심 고효과 패턴에 강하게 부합한다. 작은 수정으로 큰 여정 마찰을 줄이거나 여러 문제를 동시에 완화할 수 있다.

예:

- 목표 행동 직전이나 제출 직전에서 사용자가 막힘
- 실제 클릭 후 결과가 보이지 않아 흐름이 중단됨
- 첫 행동 선택지가 강하게 경쟁하고, 하나로 정리하면 마찰이 크게 줄어들 수 있음
- 하나의 컴포넌트나 영역이 여러 issue와 연결됨

## 7. LLM이 바꾸면 안 되는 값

LLM은 Rule Engine 결과를 대체하지 않는다.

LLM이 변경하면 안 되는 값:

- `issue_id`
- `criterion_id`
- `stage`
- `axis`
- `severity`
- `confidence`
- `priority_score`
- `evidence_refs`
- issue 존재 여부
- issue 순서
- issue 개수

LLM이 판단할 수 있는 값:

- `fix_leverage`
- `fix_leverage_rationale`

Analyzer는 LLM이 반환한 `fix_leverage`를 검증한 뒤 `priority_score`를 다시 계산한다.

## 8. LLM 응답 형태

LLM은 issue별로 아래 형태를 반환한다.

```json
{
  "issue_id": "issue_001",
  "fix_leverage": 1.15,
  "fix_leverage_rationale": "실제 사용 경로의 버튼 선택과 연결되어 있고, 버튼 문구와 강조를 정리하면 사용자가 다음 행동을 더 쉽게 고를 수 있어 개선 효과가 클 것으로 보입니다."
}
```

`fix_leverage`는 반드시 아래 값 중 하나여야 한다.

```text
0.8, 0.95, 1.0, 1.15, 1.3
```

## 9. Prompt 기준

```text
For each issue, assign fix_leverage using only one of:
0.8, 0.95, 1.0, 1.15, 1.3.

fix_leverage means the likelihood that fixing this issue will reduce user friction or conversion friction.
It is not issue severity.

The Rule Engine already decided that the issue exists.
Do not change issue existence, issue count, issue order, issue_id, criterion_id, stage, axis, severity, confidence, priority_score, or evidence_refs.

Judge fix_leverage only from the issue fields, evidence_refs, evidence_locations, observation data, component positions, clicked path information, and screenshot context when available.

Use:
- 0.8 when the issue barely matches the Rule's improvement-effect condition. The issue exists, but fixing it is unlikely to improve the goal flow much.
- 0.95 when the issue partially matches. The issue is valid, but the fix target or expected improvement effect is uncertain.
- 1.0 when the issue normally matches the Rule's expected improvement effect.
- 1.15 when the issue strongly matches. The observation evidence clearly shows the expected improvement effect for this Rule.
- 1.3 when the issue very strongly matches the Rule's high-impact pattern, and a small fix is likely to reduce major journey friction.

Do not invent unsupported facts.
Do not mention internal evidence ids in user-facing rationale.
Return valid JSON only.
```

한국어 번역:

```text
각 issue마다 fix_leverage를 아래 값 중 하나로만 부여한다.
0.8, 0.95, 1.0, 1.15, 1.3.

fix_leverage는 이 issue를 고쳤을 때 사용자 불편이나 전환 마찰이 줄어들 가능성을 의미한다.
fix_leverage는 issue의 심각도가 아니다.

Rule Engine은 이미 이 issue가 존재한다고 판단했다.
issue 존재 여부, issue 개수, issue 순서, issue_id, criterion_id, stage, axis, severity, confidence, priority_score, evidence_refs를 변경하지 않는다.

fix_leverage는 issue 필드, evidence_refs, evidence_locations, observation data, component 위치, clicked path 정보, 사용 가능한 screenshot 맥락만 근거로 판단한다.

기준:
- 0.8은 해당 issue가 Rule의 개선 효과 조건에 거의 부합하지 않을 때 사용한다. 문제는 있지만 고쳐도 목표 흐름 개선이 크지 않을 가능성이 높다.
- 0.95는 일부만 부합할 때 사용한다. 문제는 맞지만 수정 대상이나 기대되는 개선 효과가 불확실하다.
- 1.0은 해당 Rule의 일반적인 개선 효과에 보통 수준으로 부합할 때 사용한다.
- 1.15는 강하게 부합할 때 사용한다. observation 근거에서 해당 Rule의 기대 개선 효과가 명확하게 드러난다.
- 1.3은 해당 Rule의 고효과 패턴에 매우 강하게 부합하고, 작은 수정으로 큰 여정 마찰을 줄일 가능성이 높을 때 사용한다.

근거 없는 사실을 만들지 않는다.
사용자에게 보이는 rationale에는 내부 evidence id를 언급하지 않는다.
유효한 JSON만 반환한다.
```

## 10. Guardrail

Analyzer는 LLM 응답을 그대로 믿지 않고 검증한다.

| 상황 | 처리 |
|---|---|
| 허용값이 아닌 `fix_leverage` 반환 | 기존값 또는 1.0으로 fallback |
| 존재하지 않는 `issue_id` 반환 | 무시 |
| issue 순서, 개수, severity, confidence 변경 시도 | 무시 |
| `fix_leverage_rationale`이 evidence와 무관함 | rationale 폐기 또는 fallback |
| GMS/LLM 호출 실패 | 기존 deterministic 값 또는 1.0 사용 |

## 11. 향후 확장

MVP 이후에는 `criterion_id`별 leverage profile과 정량 score를 추가할 수 있다.

다만 현재 MVP에서는 criterion별 세부 점수표보다 observation 기반 LLM 판단을 우선한다.

```text
현재 MVP:
observation 기반 LLM 판단 → 5개 fix_leverage 중 하나 부여

향후:
criterion_id별 leverage profile → leverage_fit_score 계산 → LLM 보조 판단
```
