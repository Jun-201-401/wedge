# Analyzer 분석 가능 룰 도감

## 문서 목적

이 문서는 팀장 지시 업무 중 **3. Analyzer 분석 가능 여부 확인**에 해당하는 산출물이다.

입력 문서는 다음 두 개다.

- `docs/17_rule_candidate_separation_catalog.md`
- `docs/18_runner_evidence_rule_catalog.md`

17번 문서는 “공신력 있는 근거로 만들 수 있는 전체 룰 후보”를 정리했다. 18번 문서는 그 후보 중 “현재 Runner가 evidence를 제공할 수 있는 후보”를 분리했다. 이 19번 문서는 다시 그중에서 **현재 구현되어 있는 Analyzer가 실제 RuleHit/JudgeResult issue로 반영할 수 있는 룰**을 확인한다.

따라서 이 문서의 기준은 다음이다.

```text
1번: 레퍼런스 기준 룰 후보
→ 2번: 현재 Runner evidence 기준 사용 가능 후보
→ 3번: 현재 Analyzer 구현 기준 실제 반영 가능 후보
```

## 결론 요약

현재 Analyzer가 실제로 반영 가능한 룰은 **현재 RuleRegistry와 handler에 연결된 9개**다.

| 분류 | 룰 |
| --- | --- |
| 현재 deterministic Analyzer로 직접 반영 가능 | `PATH-CTA-001`, `PATH-CTA-002`, `PATH-CHOICE-OVERLOAD-001`, `RELIABILITY-TECH-001`, `RELIABILITY-LOADING-STUCK-001` |
| 현재 Analyzer에 연결되어 있으나 입력 evidence 조건부 | `FRICTION-FORM-001` |
| 현재 Analyzer에 연결되어 있으나 GMS/semantic enrichment 조건부 | `COPY-FLOW-QUALITY-001`, `COPY-LABEL-INTEGRITY-001`, `JOURNEY-GOAL-CTA-MISMATCH-001` |
| Runner evidence는 있지만 현재 Analyzer에 미반영 | 18번 도감의 나머지 `Runner 사용 가능` 후보 |

중요한 점은 **registry에 rule만 추가한다고 반영되는 구조가 아니라는 것**이다. 현재 `RuleEngine`은 registry rule의 `criterion_id`에 대응하는 handler가 없으면 `RuleHandlerMissing`으로 실패한다. 즉, 신규 룰은 반드시 다음 세 가지가 같이 필요하다.

1. `apps/analyzer/app/rule_engine/registries/p0_v0_1.json` rule 정의
2. `apps/analyzer/app/rule_engine/handlers/*.py` handler 구현
3. `apps/analyzer/app/rule_engine/handlers/__init__.py`의 `DEFAULT_RULE_HANDLERS` 매핑

## 현재 Analyzer Rule 구조

현재 Analyzer 흐름은 다음과 같다.

```text
EvidencePacket
→ StageContextBuilder
→ optional GMS/semantic enrichment
→ RuleEngine
→ criterion_id별 handler
→ RuleHit
→ JudgeResult issues[]
→ Spring completed callback
```

현재 기본 registry는 다음 파일이다.

```text
apps/analyzer/app/rule_engine/registries/p0_v0_1.json
```

현재 handler 매핑은 다음 파일이다.

```text
apps/analyzer/app/rule_engine/handlers/__init__.py
```

현재 매핑된 `criterion_id`는 다음 9개다.

| criterion_id | handler |
| --- | --- |
| `PATH-CTA-001` | `evaluate_path_cta_presence` |
| `PATH-CTA-002` | `evaluate_path_cta_competition` |
| `PATH-CHOICE-OVERLOAD-001` | `evaluate_path_choice_overload` |
| `FRICTION-FORM-001` | `evaluate_form_labels` |
| `COPY-FLOW-QUALITY-001` | `evaluate_copy_flow_quality` |
| `COPY-LABEL-INTEGRITY-001` | `evaluate_copy_label_integrity` |
| `RELIABILITY-TECH-001` | `evaluate_reliability` |
| `RELIABILITY-LOADING-STUCK-001` | `evaluate_loading_stuck` |
| `JOURNEY-GOAL-CTA-MISMATCH-001` | `evaluate_journey_goal_cta_mismatch` |

## 판정 등급

| 등급 | 의미 |
| --- | --- |
| `현재 반영 가능` | 현재 registry와 handler에 연결되어 있고, 필요한 evidence가 들어오면 JudgeResult issue로 나갈 수 있다. |
| `조건부 반영 가능` | 현재 registry와 handler는 있지만, GMS/semantic enrichment 또는 특정 evidence shape가 있어야 issue가 나간다. |
| `Analyzer 신규 구현 필요` | Runner evidence는 있지만 현재 registry/handler가 없어 지금은 JudgeResult issue로 나갈 수 없다. |
| `Runner/Analyzer 모두 추가 필요` | 18번 기준 Runner evidence부터 부족하므로 Analyzer 구현보다 수집 확장이 먼저다. |

## 1. 현재 반영 가능 룰

### `PATH-CTA-001`

| 항목 | 내용 |
| --- | --- |
| 현재 상태 | 현재 반영 가능 |
| Analyzer handler | `evaluate_path_cta_presence` |
| 필요한 evidence | `cta_cluster` 또는 `interactive_components` |
| 핵심 조건 | primary-like CTA count가 `0`이고, 실제 observation ref가 있을 때 issue 생성 |
| 출력 | 핵심 행동 버튼이 충분히 드러나지 않는 문제 |
| 주의 | FIRST_VIEW에서 CTA observation 자체가 없으면 단순 추측으로 issue를 만들지 않고 `NOT_EVALUABLE` 처리한다. |

### `PATH-CTA-002`

| 항목 | 내용 |
| --- | --- |
| 현재 상태 | 현재 반영 가능 |
| Analyzer handler | `evaluate_path_cta_competition` |
| 필요한 evidence | `cta_cluster` 또는 `interactive_components` |
| 핵심 조건 | primary-like CTA count가 `3` 이상 |
| 출력 | 같은 결정 순간에서 강조된 CTA가 여러 개 경쟁하는 문제 |
| 주의 | `primary_like_component_count` 또는 components 내부 `is_primary_like` 값이 필요하다. |

### `PATH-CHOICE-OVERLOAD-001`

| 항목 | 내용 |
| --- | --- |
| 현재 상태 | 현재 반영 가능 |
| Analyzer handler | `evaluate_path_choice_overload` |
| 필요한 evidence | `interactive_components.components[]`, viewport |
| 핵심 조건 | visible/clickable/countable component 수가 threshold 이상 |
| threshold | 11개 이상 severity 1, 15개 이상 severity 2, CTA/INPUT/COMMIT에서 20개 이상 severity 3 |
| 출력 | 한 화면에 선택지가 과도하게 많아 다음 행동을 고르기 어려운 문제 |
| 주의 | 현재 handler는 viewport count 중심이다. decision area grouping까지 고도화하려면 별도 개선 여지가 있다. |

### `RELIABILITY-TECH-001`

| 항목 | 내용 |
| --- | --- |
| 현재 상태 | 현재 반영 가능 |
| Analyzer handler | `evaluate_reliability` |
| 필요한 evidence | `network_failure`, `console_error`, checkpoint `state.network_summary`, `state.console_summary` |
| 핵심 조건 | stage-attributed failed request 또는 console error가 1건 이상 |
| 출력 | 사용자 행동 직후 기술 오류가 관찰된 문제 |
| 주의 | run-level aggregate counter만으로는 issue를 만들지 않는다. checkpoint/stage에 귀속된 근거가 필요하다. |

### `RELIABILITY-LOADING-STUCK-001`

| 항목 | 내용 |
| --- | --- |
| 현재 상태 | 현재 반영 가능 |
| Analyzer handler | `evaluate_loading_stuck` |
| 필요한 evidence | `page_ready_timing`, `loading_state`, `settle_response` |
| 핵심 조건 | 일반 navigation action의 `duration_ms >= 5000` |
| critical 조건 | COMMIT stage 또는 `duration_ms >= 8000`이면 severity 3 |
| 출력 | 다음 화면이나 결과 화면이 준비되는 시간이 긴 문제 |
| 주의 | network/console 오류가 있으면 `RELIABILITY-TECH-001`이 우선 설명하도록 suppress한다. auth redirect, map, payment form, permission prompt, streaming, webgl 같은 예외 신호도 suppress 대상이다. |

## 2. 조건부 반영 가능 룰

### `FRICTION-FORM-001`

| 항목 | 내용 |
| --- | --- |
| 현재 상태 | 조건부 반영 가능 |
| Analyzer handler | `evaluate_form_labels` |
| 필요한 evidence | `missing_label` 또는 `form_field` |
| 추가 조건 | observation data에 `label_association`이 있고 source에 `dom` 또는 `ax`가 포함되어야 한다. |
| 핵심 조건 | visible field에 `label_text` 또는 `accessible_name`이 없으면 issue 생성 |
| 출력 | 입력칸의 목적을 알려주는 label/instruction 부족 문제 |
| 주의 | 18번 Runner 도감의 일반 `form_field.label_text`, `accessible_name`, `placeholder`만으로는 현재 handler가 바로 issue를 만들지 않는다. 현재 handler는 label relation evidence가 없으면 오탐 방지를 위해 `NOT_EVALUABLE` 처리한다. |

### `COPY-FLOW-QUALITY-001`

| 항목 | 내용 |
| --- | --- |
| 현재 상태 | 조건부 반영 가능 |
| Analyzer handler | `evaluate_copy_flow_quality` |
| 필요한 evidence | `label_role_alignment`가 포함된 observation |
| enrichment | `LabelRoleResolver` + `GMSLabelRoleProvider` |
| 핵심 조건 | GMS label-role alignment 결과가 `status=mismatch`이고 confidence threshold를 통과해야 한다. |
| 출력 | 화면 요소의 라벨이 역할/기능/맥락과 맞지 않는 문제 |
| 주의 | Runner raw text만으로는 issue가 나오지 않는다. GMS가 비활성화되거나 screenshot URL이 없거나 provider가 결과를 만들지 못하면 반영되지 않는다. |

### `COPY-LABEL-INTEGRITY-001`

| 항목 | 내용 |
| --- | --- |
| 현재 상태 | 조건부 반영 가능 |
| Analyzer handler | `evaluate_copy_label_integrity` |
| 필요한 evidence | `label_integrity`, `integrity_issue_type`, 또는 deterministic text corruption signal |
| enrichment | `LabelIntegrityResolver` + optional `GMSLabelIntegrityProvider` |
| 현재 deterministic 가능 signal | `replacement_character`, mojibake, placeholder garbage, `text_overlap`, `text_clipped`, `text_truncated` |
| 출력 | 라벨이나 짧은 문구가 깨지거나 잘려 읽기 어려운 문제 |
| 주의 | 단순 screenshot 존재만으로는 issue가 나오지 않는다. observation data에 integrity signal이 있어야 한다. |

### `JOURNEY-GOAL-CTA-MISMATCH-001`

| 항목 | 내용 |
| --- | --- |
| 현재 상태 | 조건부 반영 가능 |
| Analyzer handler | `evaluate_journey_goal_cta_mismatch` |
| 필요한 evidence | click checkpoint의 `cta_candidate` |
| enrichment | `SemanticLabelResolver` + `GMSSemanticProvider` |
| 핵심 조건 | 클릭된 CTA의 semantic label이 `AUXILIARY_ACTION` 또는 `IRRELEVANT_ACTION`이고 confidence threshold를 통과해야 한다. |
| 출력 | 선택된 CTA가 scenario goal과 직접 연결되지 않는 문제 |
| 주의 | Runner가 클릭/CTA evidence를 줘도 semantic provider 결과가 없으면 issue가 나오지 않는다. |

## 3. 18번 도감 기준 전체 매핑

아래 표는 18번 Runner 도감의 후보를 현재 Analyzer 구현 기준으로 다시 매핑한 것이다.

| 후보 ID | 18번 Runner 판정 | 현재 Analyzer 판정 | 이유 |
| --- | --- | --- | --- |
| `PATH-CTA-001` | Runner 사용 가능 | 현재 반영 가능 | registry/handler 있음 |
| `PATH-CTA-002` | Runner 사용 가능 | 현재 반영 가능 | registry/handler 있음 |
| `PATH-CHOICE-OVERLOAD-001` | Runner 사용 가능 | 현재 반영 가능 | registry/handler 있음 |
| `FRICTION-FORM-001` | Runner 사용 가능 | 조건부 반영 가능 | handler는 `label_association` 근거를 요구 |
| `COPY-FLOW-QUALITY-001` | Runner 부분 가능 | 조건부 반영 가능 | GMS label-role enrichment 필요 |
| `COPY-LABEL-INTEGRITY-001` | Runner 부분 가능 | 조건부 반영 가능 | deterministic/GMS label_integrity signal 필요 |
| `RELIABILITY-TECH-001` | Runner 사용 가능 | 현재 반영 가능 | registry/handler 있음 |
| `RELIABILITY-LOADING-STUCK-001` | Runner 사용 가능 | 현재 반영 가능 | registry/handler 있음 |
| `JOURNEY-GOAL-CTA-MISMATCH-001` | Runner 부분 가능 | 조건부 반영 가능 | GMS semantic enrichment 필요 |
| `FORM-INSTRUCTIONS-001` | Runner 사용 가능 | Analyzer 신규 구현 필요 | registry/handler 없음 |
| `FORM-PLACEHOLDER-ONLY-001` | Runner 사용 가능 | Analyzer 신규 구현 필요 | 현재는 `FRICTION-FORM-001` 일부 조건과 겹치지만 독립 rule 없음 |
| `FORM-REQUIRED-OPTIONAL-001` | Runner 사용 가능 | Analyzer 신규 구현 필요 | registry/handler 없음 |
| `A11Y-LINK-PURPOSE-001` | Runner 사용 가능 | Analyzer 신규 구현 필요 | registry/handler 없음 |
| `A11Y-TARGET-SIZE-001` | Runner 사용 가능 | Analyzer 신규 구현 필요 | registry/handler 없음 |
| `A11Y-TARGET-SPACING-001` | Runner 사용 가능 | Analyzer 신규 구현 필요 | registry/handler 없음 |
| `A11Y-LABEL-IN-NAME-001` | Runner 사용 가능 | Analyzer 신규 구현 필요 | registry/handler 없음 |
| `A11Y-FOCUS-VISIBLE-001` | Runner 사용 가능 | Analyzer 신규 구현 필요 | registry/handler 없음 |
| `A11Y-KEYBOARD-TRAP-001` | Runner 사용 가능 | Analyzer 신규 구현 필요 | registry/handler 없음 |
| `PATH-BACK-LINK-001` | Runner 사용 가능 | Analyzer 신규 구현 필요 | registry/handler 없음 |
| `COMPONENT-ACCORDION-DISCOVERABILITY-001` | Runner 사용 가능 | Analyzer 신규 구현 필요 | registry/handler 없음 |
| `FEEDBACK-SYSTEM-STATUS-001` | Runner 사용 가능 | Analyzer 신규 구현 필요 | registry/handler 없음 |
| `PATH-ACTION-RESULT-001` | Runner 사용 가능 | Analyzer 신규 구현 필요 | registry/handler 없음 |
| `PERF-LCP-SLOW-001` | Runner 사용 가능 | Analyzer 신규 구현 필요 | registry/handler 없음 |
| `PERF-INP-SLOW-001` | Runner 사용 가능 | Analyzer 신규 구현 필요 | registry/handler 없음 |
| `PERF-CLS-SHIFT-001` | Runner 사용 가능 | Analyzer 신규 구현 필요 | registry/handler 없음 |
| `PERF-RENDER-BLOCKING-001` | Runner 사용 가능 | Analyzer 신규 구현 필요 | registry/handler 없음 |
| `TECH-RESOURCE-FAILURE-001` | Runner 사용 가능 | Analyzer 신규 구현 필요 | 현재 `RELIABILITY-TECH-001`과 일부 겹치지만 독립 rule 없음 |
| `CHECKOUT-ORDER-REVIEW-001` | Runner 사용 가능 | Analyzer 신규 구현 필요 | registry/handler 없음 |
| `CHECKOUT-LOAD-INDICATOR-001` | Runner 사용 가능 | Analyzer 신규 구현 필요 | registry/handler 없음 |

## 4. 현재 Analyzer에 바로 추가하면 안 되는 후보

아래 후보들은 18번에서 `Runner 부분 가능` 또는 `Runner 추가 수집 필요`로 분류된 후보이므로, 현재 Analyzer에 rule만 추가하면 오탐 위험이 크다.

| 분류 | 후보 |
| --- | --- |
| semantic/context 보정 필요 | `A11Y-PAGE-TITLE-001`, `A11Y-HEADING-LABEL-001`, `PATH-BREADCRUMB-CONTEXT-001`, `PATH-CONSISTENT-NAVIGATION-001`, `TRUST-PAYMENT-SECURITY-CUE-001`, `TRUST-SENSITIVE-FIELD-EXPLAIN-001` |
| AX/detail observation 보강 필요 | `A11Y-BYPASS-BLOCKS-001`, `A11Y-LANDMARK-STRUCTURE-001`, `A11Y-IMAGE-ALT-001`, `A11Y-DECORATIVE-IMAGE-001`, `A11Y-NAME-ROLE-VALUE-001`, `A11Y-STATUS-MESSAGE-001`, `FORM-GROUPING-001` |
| interaction simulation 필요 | `A11Y-KEYBOARD-ACCESS-001`, `A11Y-FOCUS-ORDER-001`, `A11Y-FOCUS-NOT-OBSCURED-001`, `A11Y-HOVER-FOCUS-CONTENT-001`, `COMPONENT-MODAL-*`, `COMPONENT-BUTTON-KEYBOARD-001`, `RECOVERY-UNDO-CANCEL-001` |
| visual/OCR/contrast 수집 필요 | `A11Y-IMAGE-TEXT-001`, `A11Y-COLOR-ONLY-001`, `A11Y-TEXT-CONTRAST-001`, `A11Y-LARGE-TEXT-CONTRAST-001`, `A11Y-NON-TEXT-CONTRAST-001`, `A11Y-RESIZE-TEXT-001`, `A11Y-REFLOW-001`, `A11Y-TEXT-SPACING-001` |
| form/error relation 보강 필요 | `FORM-ERROR-IDENTIFICATION-001`, `FORM-ERROR-SUGGESTION-001`, `FORM-ERROR-PROXIMITY-001`, `FORM-ERROR-SUMMARY-001`, `FORM-INPUT-PRESERVE-001`, `FORM-AUTOCOMPLETE-001`, `FORM-PASTE-BLOCKED-001` |
| checkout/cost/session relation 보강 필요 | `CHECKOUT-GUEST-OPTION-001`, `CHECKOUT-COST-CLARITY-001`, `CHECKOUT-DATA-PERSISTENCE-001` |
| browser/security state 보강 필요 | `TECH-HTTPS-SECURITY-001`, `FEEDBACK-PERMISSION-PROMPT-001`, `PATH-PAGINATION-CLARITY-001`, `A11Y-POINTER-CANCEL-001` |

## 5. 신규 Analyzer 구현 우선순위

현재 Runner evidence는 이미 있지만 Analyzer에 아직 없는 후보 중에서는 다음 순서가 가장 현실적이다.

| 우선순위 | 후보 | 이유 |
| --- | --- | --- |
| 1 | `PATH-ACTION-RESULT-001` | Runner의 `journey_action_raw`, `goal_action_result`가 이미 있어 deterministic handler로 시작하기 쉽다. |
| 2 | `FEEDBACK-SYSTEM-STATUS-001` | `loading_state`가 이미 있고, `RELIABILITY-LOADING-STUCK-001`과 분리해 “느림”이 아니라 “상태 안내 부재”를 다룰 수 있다. |
| 3 | `FORM-INSTRUCTIONS-001` | `help_text`, `describedby_text`, constraint 필드가 있어 `FRICTION-FORM-001`과 분리 가능하다. |
| 4 | `FORM-REQUIRED-OPTIONAL-001` | required marker 관련 Runner evidence가 있어 deterministic rule로 만들 수 있다. |
| 5 | `A11Y-LINK-PURPOSE-001` | `nearby_text`, `container_heading`, generic link grouping이 있어 구현 후보로 적합하다. |
| 6 | `PATH-BACK-LINK-001` | `path_navigation` 기반으로 다단계 흐름 한정 rule을 만들 수 있다. |
| 7 | `COMPONENT-ACCORDION-DISCOVERABILITY-001` | `accordion_state`가 이미 있어 독립 rule 후보로 적합하다. |
| 8 | `CHECKOUT-ORDER-REVIEW-001`, `CHECKOUT-LOAD-INDICATOR-001` | `checkout_context`와 `loading_state`가 있지만 도메인 한정 예외 처리가 중요하다. |

## 6. 최종 도감 요약

현재 Analyzer가 “이미 반영 가능한 룰”은 다음 9개다.

```text
PATH-CTA-001
PATH-CTA-002
PATH-CHOICE-OVERLOAD-001
FRICTION-FORM-001
COPY-FLOW-QUALITY-001
COPY-LABEL-INTEGRITY-001
RELIABILITY-TECH-001
RELIABILITY-LOADING-STUCK-001
JOURNEY-GOAL-CTA-MISMATCH-001
```

다만 실제 운영 의미로 더 엄밀히 나누면 다음과 같다.

| 구분 | 룰 |
| --- | --- |
| deterministic evidence만으로 issue 가능 | `PATH-CTA-001`, `PATH-CTA-002`, `PATH-CHOICE-OVERLOAD-001`, `RELIABILITY-TECH-001`, `RELIABILITY-LOADING-STUCK-001` |
| evidence shape 조건부 | `FRICTION-FORM-001` |
| GMS/semantic enrichment 조건부 | `COPY-FLOW-QUALITY-001`, `COPY-LABEL-INTEGRITY-001`, `JOURNEY-GOAL-CTA-MISMATCH-001` |

따라서 “현재 반영 가능한 룰 목록”을 Jira나 팀 공유용으로 짧게 말하면 다음이 정확하다.

```text
현재 Analyzer는 P0 registry 기준 9개 룰만 실제 JudgeResult issue로 반영 가능하다.
그중 5개는 deterministic evidence 중심이고, 1개는 label association evidence 조건부이며, 3개는 GMS/semantic enrichment 조건부다.
그 외 18번 Runner 도감의 Runner 사용 가능 후보들은 Runner evidence는 준비되어 있지만 Analyzer registry/handler가 아직 없어 신규 Analyzer 구현 대상이다.
```
