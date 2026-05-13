# 15. Extraction Rule Candidates

이 문서는 외부 UX, 접근성, 성능, 디자인 시스템 근거에서 수집한 Analyzer Rule 후보를 **사용자가 실제로 체감하는 UX 문제** 기준으로 재정리한 문서다.

이번 버전의 핵심 기준은 다음이다.

1. 기존 Runner -> MQ -> Analyzer observation만으로 지금 바로 판단할 수 있는가.
2. 추가 수집 값이 있어야 오탐 없이 판단 가능한가.
3. 기존 `docs/12_analyzer_rule_catalog.md`의 운영 Rule과 중복되는가.
4. 신규 Rule로 독립시킬지, 기존 Rule의 signal/severity 고도화로 흡수할지 구분한다.

## 1. Source Index

| Source ID | Source | 성격 | URL |
| --- | --- | --- | --- |
| `W3C-WAI-TUTORIALS` | W3C WAI Tutorials | 접근성 구현 튜토리얼 | https://www.w3.org/WAI/tutorials/ |
| `WCAG22-QUICKREF` | WCAG 2.2 Quick Reference | 접근성 표준 성공 기준 | https://www.w3.org/WAI/WCAG22/quickref/ |
| `GOVUK-COMPONENTS` | GOV.UK Design System Components | 공공 서비스 UI 컴포넌트 기준 | https://design-system.service.gov.uk/components/ |
| `USWDS-COMPONENTS` | U.S. Web Design System Components | 공공 서비스 UI 컴포넌트 기준 | https://designsystem.digital.gov/components/overview/ |
| `LIGHTHOUSE` | Chrome Lighthouse | 자동화 가능한 품질 감사 기준 | https://developer.chrome.com/docs/lighthouse/overview?hl=ko |
| `WEB-VITALS` | web.dev Web Vitals | 사용자 경험 성능 지표 | https://web.dev/articles/vitals?hl=ko |
| `NNG-HEURISTICS` | Nielsen Norman Group 10 Heuristics | 일반 UX 휴리스틱 | https://www.nngroup.com/articles/ten-usability-heuristics/ |
| `BAYMARD-CHECKOUT` | Baymard Checkout Usability | 체크아웃/폼/커머스 UX 연구 | https://baymard.com/research/checkout-usability |

## 2. 분류 기준

### 2.1 바로 구현 가능

아래 조건을 모두 만족하면 `바로 구현 가능`으로 분류한다.

- 현재 Analyzer로 들어오는 observation만 사용한다.
- Runner/MQ contract에 새 필드를 추가하지 않는다.
- deterministic rule 또는 기존 GMS provider로 판단 가능하다.
- 추가 값은 있으면 좋지만, 없어도 MVP 수준의 RuleHit을 만들 수 있다.

### 2.2 기존 Rule 흡수 권장

새 criterion_id를 만들기보다 `docs/12_analyzer_rule_catalog.md`의 운영 Rule에 signal, severity, output wording을 추가하는 편이 더 자연스러운 경우다.

예를 들어 primary action clarity는 독립 Rule이라기보다 `PATH-CTA-001`, `PATH-CTA-002`의 사용자-facing 표현에 가깝다.

### 2.3 추가 수집 필요

아래 중 하나라도 해당하면 `추가 수집 필요`로 분류한다.

- 현재 observation에 없는 구조 정보가 필요하다.
- 주변 문맥, container, hidden panel, loading state처럼 Runner가 별도 계산해야 하는 값이 필요하다.
- 현재 값만으로 만들면 오탐 위험이 높다.
- 특정 도메인 흐름(checkout, booking, payment 등)을 먼저 판별해야 한다.

## 3. 전체 후보 분류

| Candidate ID | Axis | Stage | 사용자 문제 | 리포트 문장 예시 | 근거 | 분류 | 판단 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `PATH-CHOICE-OVERLOAD-001` | Path | FIRST_VIEW, VALUE, CTA | 한 화면이나 같은 결정 영역에 선택지가 너무 많아 다음 행동을 고르기 어렵다. | 한 화면에 고를 것이 너무 많아 다음 행동을 정하기 어렵습니다. | `NNG-HEURISTICS`, choice overload research | 운영 구현됨 | 12번 운영 Rule에 이미 구현되어 있다. |
| `PATH-PRIMARY-ACTION-CLARITY-001` | Path | FIRST_VIEW, CTA | 가장 먼저 눌러야 할 핵심 행동이 보이지 않거나 보조 행동과 경쟁한다. | 가장 먼저 해야 할 행동이 뚜렷하게 드러나지 않습니다. | `NNG-HEURISTICS`, `GOVUK-COMPONENTS`, `USWDS-COMPONENTS` | 기존 Rule 흡수 권장 | `PATH-CTA-001`, `PATH-CTA-002` 고도화로 처리하는 것이 적절하다. |
| `PATH-CTA-LABEL-SPECIFICITY-001` | Clarity | CTA, COMMIT | 버튼 라벨만 보고 누른 뒤 무슨 일이 일어나는지 예측하기 어렵다. | 버튼을 누르면 무엇이 일어나는지 알기 어렵습니다. | `NNG-HEURISTICS`, `WCAG22-QUICKREF` | 기존 Rule 흡수 권장 | `JOURNEY-GOAL-CTA-MISMATCH-001`, `COPY-FLOW-QUALITY-001`와 겹친다. |
| `A11Y-LINK-PURPOSE-001` | Clarity | FIRST_VIEW, VALUE, CTA | 반복되는 `자세히 보기`, `여기`, `더보기` 링크가 어디로 가는지 알기 어렵다. | 링크만 보고는 어디로 이동하는지 알기 어렵습니다. | `WCAG22-QUICKREF`, `LIGHTHOUSE` | 추가 수집 필요 | link 주변 문맥이나 container heading 없이는 정확한 목적 판단이 어렵다. |
| `PATH-BACK-LINK-001` | Path | VALUE, CTA, INPUT | 다단계 흐름에서 이전 단계로 돌아가는 방법이 명확하지 않아 불안하다. | 이전 단계로 돌아가는 방법이 명확하지 않습니다. | `GOVUK-COMPONENTS`, `NNG-HEURISTICS` | 추가 수집 필요 | step flow 여부와 back affordance를 별도로 판별해야 한다. |
| `PATH-ACCORDION-DISCOVERABILITY-001` | Clarity | VALUE, CTA | 필수 정보나 주요 행동이 접힌 영역 안에 숨어 있어 놓치기 쉽다. | 중요한 정보나 행동이 접힌 영역 안에 숨어 있습니다. | `GOVUK-COMPONENTS`, `USWDS-COMPONENTS`, `NNG-HEURISTICS` | 추가 수집 필요 | hidden panel과 trigger 관계가 필요하다. |
| `FORM-INSTRUCTIONS-001` | Clarity | INPUT | 입력 조건, 형식, 제한을 입력 전에 알 수 없어 오류가 발생하기 쉽다. | 입력하기 전에 필요한 형식이나 조건을 알기 어렵습니다. | `W3C-WAI-TUTORIALS`, `WCAG22-QUICKREF`, `GOVUK-COMPONENTS` | 추가 수집 필요 | 현재 form label 중심 evidence만으로는 instruction 부재를 안정적으로 분리하기 어렵다. |
| `FORM-REQUIRED-OPTIONAL-001` | Clarity | INPUT | 필수/선택 여부가 불명확해 불필요한 입력 부담이나 제출 오류가 생긴다. | 꼭 입력해야 하는 항목인지 알기 어렵습니다. | `BAYMARD-CHECKOUT`, `GOVUK-COMPONENTS` | 추가 수집 필요 | required attr과 화면상 필수/선택 표시를 함께 봐야 한다. |
| `FEEDBACK-SYSTEM-STATUS-001` | Reliability | CTA, INPUT, COMMIT | 클릭, 저장, 제출 후 처리 중인지 알 수 없어 반복 클릭하거나 기다림을 불안해한다. | 요청이 처리 중인지 알 수 없습니다. | `NNG-HEURISTICS`, `BAYMARD-CHECKOUT` | 추가 수집 필요 | loading/status/busy/disabled-after-click 관측이 필요하다. |
| `FEEDBACK-ACTION-RESULT-001` | Reliability | CTA, INPUT, COMMIT | 행동 후 결과 변화가 보이지 않아 성공/실패 여부를 알기 어렵다. | 방금 한 행동이 반영됐는지 알기 어렵습니다. | `NNG-HEURISTICS`, `BAYMARD-CHECKOUT` | 바로 구현 가능 | `goal_action_result`, `journey_action_raw`, `settle_status`, URL/DOM/toast 변화로 MVP 구현 가능하다. |
| `TECH-TARGET-SIZE-001` | Friction | FIRST_VIEW, VALUE, CTA, INPUT | 버튼이나 링크가 너무 작거나 가까워 실제로 누르기 어렵다. | 누르기 어려운 작은 클릭 대상이 있습니다. | `WCAG22-QUICKREF`, `LIGHTHOUSE` | 부분 구현 가능 | 크기 판단은 bounds로 가능하지만, 가까운 간격 판단은 spacing 추가 수집이 필요하다. |
| `CHECKOUT-ORDER-REVIEW-001` | Clarity | COMMIT | 결제, 예약, 제출 전에 내용을 확인하거나 수정할 기회가 없어 불안하다. | 최종 제출 전에 내용을 확인하거나 수정하기 어렵습니다. | `BAYMARD-CHECKOUT` | 추가 수집 필요 | checkout context와 order summary 관계가 필요하다. |
| `CHECKOUT-LOAD-INDICATOR-001` | Reliability | COMMIT | 결제/예약 제출 후 처리 중인지 알 수 없어 중복 제출 위험이 있다. | 제출 후 처리 중인지 알기 어렵습니다. | `BAYMARD-CHECKOUT`, `NNG-HEURISTICS` | 추가 수집 필요 | checkout submit 분류와 loading/disabled-after-click 관측이 필요하다. |

## 4. 기존 observation만으로 바로 구현 가능한 후보

이 섹션의 Rule은 Runner/MQ 계약을 늘리지 않고 Analyzer에서 바로 시작할 수 있다. 다만 `PATH-CHOICE-OVERLOAD-001`은 이미 12번 운영 Rule에 구현되어 있으므로 신규 구현 대상은 아니다.

| Candidate ID | 현재 쓸 수 있는 observation/value | 가능한 구현 범위 | 주의점 |
| --- | --- | --- | --- |
| `PATH-CHOICE-OVERLOAD-001` | `interactive_components.components[]`, `bounds`, `visibility`, `role`, `clickable`, `is_primary_like`, viewport | 이미 운영 구현됨. viewport/main 영역의 interactive 선택지 수를 기반으로 판단한다. | 신규 후보가 아니라 기존 운영 Rule이다. |
| `FEEDBACK-ACTION-RESULT-001` | `goal_action_result`, `journey_action_raw.dom_changed`, `url_before`, `url_after`, `toast_text`, `network_result`, `settle_status`, cart/count delta | 클릭 후 URL 변화, DOM 변화, toast, count 변화, 실패/timeout 여부를 근거로 "행동 결과가 확인되는지" 판단한다. | 모든 클릭에 적용하면 오탐이 생긴다. 목표 행동 후보나 clicked_in_scenario에 우선 적용한다. |
| `TECH-TARGET-SIZE-001` | `interactive_components.components[].bounds`, viewport, `clickable`, `visibility` | 클릭 대상의 width/height가 기준보다 작은지 판단하는 MVP는 가능하다. | "대상 간 간격이 너무 가까움"까지 보려면 `nearest_target_spacing_px`가 필요하다. |

> Runner 구현 메모 (2026-05-13): P0 component-level 값인 `visible_text`, `accessible_name`, `container_role`, `container_bounds`, `container_heading`, `nearby_text`, `nearest_target_spacing_px`는 `interactive_components.components[]`와 AgentTrace candidate summary에 추가됐다. `accessible_name`은 CDP AX tree의 exact computed name이 아니라 DOM/ARIA 기반 근사값이며, `nearest_target_spacing_px`는 현재 수집된 visible interactive target 집합 기준이다.
>
> Runner 구현 메모 (2026-05-13): P1 중 `form_fields[].describedby_text/help_text/pattern/min/max/maxlength`, `loading_state` observation, `journey_action_raw.action_kind`, `journey_action_raw.expected_outcome_hint`는 Runner 계약과 Playwright collector/capture pipeline에 추가됐다. `step_indicator` / `back_link_candidate`와 P2 `accordion_state`, `checkout_context`는 아직 별도 collector 구현이 필요하다.

## 5. 기존 Rule에 흡수하는 것이 좋은 후보

아래 후보는 독립 criterion_id로 만들면 12번 운영 Rule과 중복될 가능성이 높다. 새 Rule보다는 기존 Rule의 signal, severity, GMS prompt, report wording을 고도화하는 방향이 낫다.

| Candidate ID | 흡수 대상 Rule | 현재 쓸 수 있는 값 | 정리 방향 |
| --- | --- | --- | --- |
| `PATH-PRIMARY-ACTION-CLARITY-001` | `PATH-CTA-001`, `PATH-CTA-002` | `primary_like_component_count`, `is_cta_candidate`, `is_primary_like`, `bounds`, `text`, `role`, stage | primary CTA 부재는 `PATH-CTA-001`, primary급 CTA 경쟁은 `PATH-CTA-002`로 처리한다. |
| `PATH-CTA-LABEL-SPECIFICITY-001` | `JOURNEY-GOAL-CTA-MISMATCH-001`, `COPY-FLOW-QUALITY-001` | `cta_candidate`, `interactive_components.text`, `journey_action_raw.clicked_text`, `scenario.goal`, GMS semantic result | 목표와 CTA 의미 불일치는 journey rule, 라벨-역할 불일치는 copy rule로 처리한다. |

## 6. 추가 수집이 필요한 후보

아래 후보들은 지금 observation만으로도 일부 신호를 추정할 수는 있지만, 정식 Rule로 만들면 오탐 위험이 크다. 따라서 Runner가 추가 값을 내려준 뒤 구현하는 편이 안전하다.

| Candidate ID | 현재 있는 값 | 부족한 값 | 왜 바로 만들기 어려운가 |
| --- | --- | --- | --- |
| `A11Y-LINK-PURPOSE-001` | `interactive_components.role`, `text`, `href`, `visible_text_blocks` | `components[].nearby_text`, `container_heading`, repeated generic link grouping | `더보기` 자체만 보고는 무엇을 더 보는지 알 수 없다. 주변 카드/섹션 제목이 필요하다. |
| `PATH-BACK-LINK-001` | `interactive_components.text/href`, `breadcrumb`, `visitedUrls`, `journey_action_raw.url_before/after`, `step_order` | `step_indicator`, `back_link_candidate`, `history_back_available`, flow step count | 현재 화면이 다단계 흐름인지 먼저 알아야 한다. 단순 페이지에서 back 버튼이 없다고 issue를 내면 오탐이다. |
| `PATH-ACCORDION-DISCOVERABILITY-001` | `interactive_components`, DOM snapshot artifact | `accordion_state`, `aria-expanded`, `hidden_panel_has_cta`, `hidden_panel_has_required_info`, `panel_relationship` | 현재 visible component 중심 evidence로는 접힌 패널 안에 숨은 CTA/정보를 안정적으로 알기 어렵다. |
| `FORM-INSTRUCTIONS-001` | form control의 `label_text`, `placeholder`, `name`, `required`, `input_type`, `visible_text_blocks` | `describedby_text`, `help_text`, `pattern`, `min`, `max`, `maxlength`, input format hint | label 부재와 instruction 부재를 분리해야 한다. 현재 값만 쓰면 `FRICTION-FORM-001`과 겹친다. |
| `FORM-REQUIRED-OPTIONAL-001` | `required`, `label_text`, `placeholder`, form control component | visible required/optional marker, group-level required state, submit attempt 후 required error | DOM required와 화면상 표시가 일치하는지 봐야 한다. 표시 문구가 없으면 사용자 문제로 설명하기 어렵다. |
| `FEEDBACK-SYSTEM-STATUS-001` | `settle_status`, `settle.durationMs`, `toast_text`, clicked component | `loading_state.has_spinner`, `has_progressbar`, `status_text`, `aria_busy`, `clicked_submit_disabled` | 오래 걸렸다는 사실과 처리 중 안내가 없었다는 사실은 다르다. 화면 상태 신호가 필요하다. |
| `CHECKOUT-ORDER-REVIEW-001` | `final_submit_candidate`, `payment_or_sensitive_action`이 있으면 보조 가능 | `checkout_context.is_checkout_flow`, `has_order_summary`, `has_editable_summary`, `has_final_submit`, `final_submit_relation` | checkout/booking/payment 흐름인지 확정하지 않으면 일반 제출 페이지에서 오탐이 많다. |
| `CHECKOUT-LOAD-INDICATOR-001` | `COMMIT` stage, `settle_status`, `settle.durationMs`, `toast_text`, `network_result` | payment/booking submit classification, loading/progress indicator, submit disabled-after-click | 결제/예약 제출인지, 중복 제출 방지가 있는지 별도 확인이 필요하다. |

## 7. 추가 수집 값 설명

### 7.1 주변 문맥 / 링크 목적

| 값 | 의미 | 필요한 Rule |
| --- | --- | --- |
| `components[].nearby_text` | 버튼/링크 주변의 설명 텍스트다. 예: 카드 제목 근처의 `자세히 보기`. | `A11Y-LINK-PURPOSE-001`, `PATH-CTA-LABEL-SPECIFICITY-001` |
| `components[].container_heading` | 요소가 속한 section/card/form의 제목이다. 예: `객실 안내` 섹션 안의 `더보기`. | `A11Y-LINK-PURPOSE-001`, `FORM-INSTRUCTIONS-001` |
| `repeated_generic_link_grouping` | `더보기`, `자세히 보기`, `여기` 같은 반복 링크를 주변 제목별로 묶은 정보다. | `A11Y-LINK-PURPOSE-001` |

### 7.2 Step / Back flow

| 값 | 의미 | 필요한 Rule |
| --- | --- | --- |
| `step_indicator` | 현재 단계와 전체 단계를 보여주는 UI다. 예: `1. 정보 입력 > 2. 결제 > 3. 완료`. | `PATH-BACK-LINK-001` |
| `back_link_candidate` | 이전 단계로 돌아갈 수 있는 버튼/링크 후보이다. 예: `이전`, `뒤로`, `수정하기`, `Back`. | `PATH-BACK-LINK-001` |
| `history_back_available` | 브라우저 history back으로 이전 단계 복귀가 가능한지 여부다. | `PATH-BACK-LINK-001` |
| `flow_step_count` | 전체 흐름이 몇 단계인지 나타내는 값이다. | `PATH-BACK-LINK-001`, checkout 계열 |

### 7.3 Accordion state

| 값 | 의미 | 필요한 Rule |
| --- | --- | --- |
| `accordion_state.trigger_text` | 접힘/펼침을 제어하는 버튼이나 summary 텍스트다. | `PATH-ACCORDION-DISCOVERABILITY-001` |
| `accordion_state.expanded` | 현재 패널이 펼쳐져 있는지 여부다. | `PATH-ACCORDION-DISCOVERABILITY-001` |
| `aria-expanded` | 웹에서 접힘/펼침 상태를 표현하는 속성이다. | `PATH-ACCORDION-DISCOVERABILITY-001` |
| `hidden_panel_has_cta` | 접힌 패널 안에 주요 버튼/링크가 숨어 있는지 여부다. | `PATH-ACCORDION-DISCOVERABILITY-001` |
| `hidden_panel_has_required_info` | 접힌 패널 안에 필수 정보가 숨어 있는지 여부다. | `PATH-ACCORDION-DISCOVERABILITY-001` |
| `panel_relationship` | 어떤 trigger가 어떤 panel을 열고 닫는지 연결한 관계다. | `PATH-ACCORDION-DISCOVERABILITY-001` |

### 7.4 Form instruction / required marker

| 값 | 의미 | 필요한 Rule |
| --- | --- | --- |
| `form_fields[].describedby_text` | `aria-describedby`로 연결된 설명 문구다. | `FORM-INSTRUCTIONS-001` |
| `form_fields[].help_text` | 입력 필드 주변의 도움말/안내 문구다. | `FORM-INSTRUCTIONS-001` |
| `form_fields[].pattern` | input에 걸린 형식 조건이다. | `FORM-INSTRUCTIONS-001` |
| `form_fields[].min`, `max` | 숫자/날짜 입력의 최소/최대 조건이다. | `FORM-INSTRUCTIONS-001` |
| `form_fields[].maxlength` | 입력 가능한 최대 글자 수다. | `FORM-INSTRUCTIONS-001` |
| `visible_required_marker` | 화면에 보이는 필수 표시다. 예: `*`, `필수`. | `FORM-REQUIRED-OPTIONAL-001` |
| `visible_optional_marker` | 화면에 보이는 선택 표시다. 예: `선택`, `optional`. | `FORM-REQUIRED-OPTIONAL-001` |
| `group_level_required_state` | radio/checkbox 그룹 전체가 필수인지 나타내는 값이다. | `FORM-REQUIRED-OPTIONAL-001` |

### 7.5 Loading / action feedback

| 값 | 의미 | 필요한 Rule |
| --- | --- | --- |
| `loading_state.has_spinner` | 클릭/제출 후 spinner가 보이는지 여부다. | `FEEDBACK-SYSTEM-STATUS-001`, `CHECKOUT-LOAD-INDICATOR-001` |
| `loading_state.has_progressbar` | 진행률 표시가 있는지 여부다. | `FEEDBACK-SYSTEM-STATUS-001` |
| `loading_state.status_text` | 처리 중임을 설명하는 화면 문구다. | `FEEDBACK-SYSTEM-STATUS-001`, `CHECKOUT-LOAD-INDICATOR-001` |
| `loading_state.clicked_submit_disabled` | 제출 버튼 클릭 후 같은 버튼이 비활성화됐는지 여부다. | `CHECKOUT-LOAD-INDICATOR-001` |
| `loading_state.aria_busy` | 처리 중 상태가 `aria-busy` 등으로 표현되는지 여부다. | `FEEDBACK-SYSTEM-STATUS-001` |

### 7.6 Checkout context

| 값 | 의미 | 필요한 Rule |
| --- | --- | --- |
| `checkout_context.is_checkout_flow` | 현재 흐름이 결제/예약/주문/신청 최종 흐름인지 여부다. | `CHECKOUT-ORDER-REVIEW-001`, `CHECKOUT-LOAD-INDICATOR-001` |
| `checkout_context.has_order_summary` | 최종 제출 전 요약 정보가 보이는지 여부다. | `CHECKOUT-ORDER-REVIEW-001` |
| `checkout_context.has_editable_summary` | 요약 정보를 수정할 수 있는 버튼/링크가 있는지 여부다. | `CHECKOUT-ORDER-REVIEW-001` |
| `checkout_context.has_final_submit` | 최종 제출/결제/예약 확정 버튼이 있는지 여부다. | `CHECKOUT-ORDER-REVIEW-001`, `CHECKOUT-LOAD-INDICATOR-001` |
| `final_submit_relation` | 최종 제출 버튼과 요약 정보가 같은 흐름 안에 연결되어 있는지 여부다. | `CHECKOUT-ORDER-REVIEW-001` |

## 8. 구현 우선순위

| 우선순위 | Rule | 이유 |
| --- | --- | --- |
| 1 | `FEEDBACK-ACTION-RESULT-001` | 현재 observation만으로 신규 Rule MVP 구현이 가능하고 사용자 체감도 명확하다. |
| 2 | `PATH-PRIMARY-ACTION-CLARITY-001` | 신규 Rule보다 `PATH-CTA-001`, `PATH-CTA-002` report wording/severity 고도화로 흡수한다. |
| 3 | `PATH-CTA-LABEL-SPECIFICITY-001` | 신규 Rule보다 `JOURNEY-GOAL-CTA-MISMATCH-001`, `COPY-FLOW-QUALITY-001`의 GMS 판단을 고도화한다. |
| 4 | `A11Y-LINK-PURPOSE-001` | `nearby_text`, `container_heading` 수집 후 독립 Rule로 검토한다. |
| 5 | `PATH-BACK-LINK-001`, `PATH-ACCORDION-DISCOVERABILITY-001` | 독립성은 높지만 구조 observation 추가가 먼저 필요하다. |
| 6 | `CHECKOUT-ORDER-REVIEW-001`, `CHECKOUT-LOAD-INDICATOR-001` | checkout context 수집 후 도메인 한정 Rule로 구현한다. |

## 9. 요약

| 구분 | Rule |
| --- | --- |
| 운영 구현됨 | `PATH-CHOICE-OVERLOAD-001` |
| 기존 observation만으로 바로 신규 구현 가능 | `FEEDBACK-ACTION-RESULT-001` |
| 기존 observation만으로 부분 구현 가능 | `TECH-TARGET-SIZE-001` |
| 기존 운영 Rule에 흡수 권장 | `PATH-PRIMARY-ACTION-CLARITY-001`, `PATH-CTA-LABEL-SPECIFICITY-001` |
| 추가 수집 후 구현 권장 | `A11Y-LINK-PURPOSE-001`, `PATH-BACK-LINK-001`, `PATH-ACCORDION-DISCOVERABILITY-001`, `FORM-INSTRUCTIONS-001`, `FORM-REQUIRED-OPTIONAL-001`, `FEEDBACK-SYSTEM-STATUS-001`, `CHECKOUT-ORDER-REVIEW-001`, `CHECKOUT-LOAD-INDICATOR-001` |
