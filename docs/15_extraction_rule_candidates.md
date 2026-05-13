# 15. Extraction Rule Candidates

이 문서는 외부 UX, 접근성, 성능, 디자인 시스템 근거에서 수집한 Analyzer Rule 후보를 **사용자가 실제로 체감하는 UX 문제** 기준으로 재정리한 문서다.

이전 후보 목록은 WCAG, Lighthouse, Web Vitals, DOM/AX evidence처럼 개발자와 자동화 시스템이 판단하기 쉬운 기준이 강했다. 이 문서는 그 후보를 다음 기준으로 다시 거른다.

1. 사용자가 실제로 막힘, 헷갈림, 불안함, 귀찮음, 실수를 느끼는가.
2. 리포트 문장이 개발 용어 없이 사용자 문제로 설명 가능한가.
3. 현재 Runner/Analyzer evidence로 판단하거나 낮은 risk로 추가 수집 가능한가.
4. 기존 `docs/12_analyzer_rule_catalog.md`의 Rule과 중복되지 않거나, 기존 Rule을 사용자 관점으로 확장하는가.
5. 접근성/기술 품질 Rule은 사용자 현상으로 번역될 때만 일반 UX Rule로 승격한다.

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

## 2. 선별 기준

### 2.1 살리는 Rule

아래 조건 중 하나 이상을 만족하면 사용자-facing UX Rule 후보로 살린다.

- 사용자가 다음 행동을 고르기 어렵다.
- 사용자가 버튼, 링크, 입력 필드의 목적을 이해하기 어렵다.
- 사용자가 입력 전에 조건을 알 수 없거나, 오류 후 무엇을 고쳐야 하는지 알 수 없다.
- 사용자가 클릭/제출 후 처리 상태나 결과를 확인하기 어렵다.
- 사용자가 최종 제출, 결제, 예약 같은 되돌리기 어려운 행동 전에 불안함을 느낀다.
- 작은 클릭 대상, 늦은 반응, 화면 밀림처럼 실제 조작 실패나 기다림으로 이어진다.

### 2.2 보류하거나 보조 Rule로 내리는 Rule

아래 조건에 가까우면 일반 UX Rule보다 접근성/기술 품질 보조 Rule로 둔다.

- 문제 설명이 `aria`, `role`, `landmark`, `console`, `network`, `render-blocking` 같은 구현 용어에 의존한다.
- 일반 사용자가 겪는 현상보다 개발자가 고칠 원인에 가깝다.
- 사용자 체감 문제와 연결하려면 별도 시뮬레이션이나 맥락 판단이 많이 필요하다.
- 이미 기존 Rule이 같은 사용자 문제를 더 자연스럽게 설명한다.

## 3. 바로 살릴 만한 사용자 체감 UX Rule

| Candidate ID | Axis | Stage | 사용자 문제 | 리포트 문장 예시 | 근거 | 현재 판단 가능성 | 비고 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `PATH-CHOICE-OVERLOAD-001` | Path | FIRST_VIEW, VALUE, CTA | 한 화면이나 같은 결정 영역에 선택지가 너무 많아 다음 행동을 고르기 어렵다. | 한 화면에 고를 것이 너무 많아 다음 행동을 정하기 어렵습니다. | `NNG-HEURISTICS`, choice overload research | 구현 중 | 기존 `PATH-CTA-002`와 분리 유지. primary CTA 경쟁이 아니라 전체 선택 부담을 본다. |
| `PATH-PRIMARY-ACTION-CLARITY-001` | Path | FIRST_VIEW, CTA | 가장 먼저 눌러야 할 핵심 행동이 보이지 않거나 보조 행동과 경쟁한다. | 가장 먼저 해야 할 행동이 뚜렷하게 드러나지 않습니다. | `NNG-HEURISTICS`, `GOVUK-COMPONENTS`, `USWDS-COMPONENTS` | 부분 가능 | 새 Rule로 분리하기보다 `PATH-CTA-001`, `PATH-CTA-002` 고도화 후보. |
| `PATH-CTA-LABEL-SPECIFICITY-001` | Clarity | CTA, COMMIT | 버튼 라벨만 보고 누른 뒤 무슨 일이 일어나는지 예측하기 어렵다. | 버튼을 누르면 무엇이 일어나는지 알기 어렵습니다. | `NNG-HEURISTICS`, `WCAG22-QUICKREF` | 이미 유사 Rule 있음 | `JOURNEY-GOAL-CTA-MISMATCH-001`, `COPY-FLOW-QUALITY-001`와 연결. |
| `A11Y-LINK-PURPOSE-001` | Clarity | FIRST_VIEW, VALUE, CTA | 반복되는 `자세히 보기`, `여기`, `더보기` 링크가 어디로 가는지 알기 어렵다. | 링크만 보고는 어디로 이동하는지 알기 어렵습니다. | `WCAG22-QUICKREF`, `LIGHTHOUSE` | 부분 가능 | 접근성 이름 자체보다 사용자에게 보이는 목적성 문제로 다룬다. |
| `PATH-BACK-LINK-001` | Path | VALUE, CTA, INPUT | 다단계 흐름에서 이전 단계로 돌아가는 방법이 명확하지 않아 불안하다. | 이전 단계로 돌아가는 방법이 명확하지 않습니다. | `GOVUK-COMPONENTS`, `NNG-HEURISTICS` | 부분 가능 | step indicator, back button, browser history action evidence 필요. |
| `PATH-ACCORDION-DISCOVERABILITY-001` | Clarity | VALUE, CTA | 필수 정보나 주요 행동이 접힌 영역 안에 숨어 있어 놓치기 쉽다. | 중요한 정보나 행동이 접힌 영역 안에 숨어 있습니다. | `GOVUK-COMPONENTS`, `USWDS-COMPONENTS`, `NNG-HEURISTICS` | 추가 필요 | collapsed state와 hidden CTA/info evidence 필요. |
| `FORM-INSTRUCTIONS-001` | Clarity | INPUT | 입력 조건, 형식, 제한을 입력 전에 알 수 없어 오류가 발생하기 쉽다. | 입력하기 전에 필요한 형식이나 조건을 알기 어렵습니다. | `W3C-WAI-TUTORIALS`, `WCAG22-QUICKREF`, `GOVUK-COMPONENTS` | 부분 가능 | `FRICTION-FORM-001`에서 label과 instruction을 분리할지 검토. |
| `FORM-REQUIRED-OPTIONAL-001` | Clarity | INPUT | 필수/선택 여부가 불명확해 불필요한 입력 부담이나 제출 오류가 생긴다. | 꼭 입력해야 하는 항목인지 알기 어렵습니다. | `BAYMARD-CHECKOUT`, `GOVUK-COMPONENTS` | 부분 가능 | required attr, label text, optional marker 일관성 필요. |
| `FEEDBACK-SYSTEM-STATUS-001` | Reliability | CTA, INPUT, COMMIT | 클릭, 저장, 제출 후 처리 중인지 알 수 없어 반복 클릭하거나 기다림을 불안해한다. | 요청이 처리 중인지 알 수 없습니다. | `NNG-HEURISTICS`, `BAYMARD-CHECKOUT` | 부분 가능 | loading indicator, disabled state, settle response evidence 필요. |
| `FEEDBACK-ACTION-RESULT-001` | Reliability | CTA, INPUT, COMMIT | 행동 후 결과 변화가 보이지 않아 성공/실패 여부를 알기 어렵다. | 방금 한 행동이 반영됐는지 알기 어렵습니다. | `NNG-HEURISTICS`, `BAYMARD-CHECKOUT` | 부분 가능 | URL/DOM/toast/count 변화로 판단. 오탐 방지를 위해 action kind 구분 필요. |
| `TECH-TARGET-SIZE-001` | Friction | FIRST_VIEW, VALUE, CTA, INPUT | 버튼이나 링크가 너무 작거나 가까워 실제로 누르기 어렵다. | 누르기 어려운 작은 클릭 대상이 있습니다. | `WCAG22-QUICKREF`, `LIGHTHOUSE` | 부분 가능 | 기술 이름은 `TECH`지만 사용자 체감이 직접적이므로 UX Rule로 살릴 수 있음. |
| `CHECKOUT-ORDER-REVIEW-001` | Clarity | COMMIT | 결제, 예약, 제출 전에 내용을 확인하거나 수정할 기회가 없어 불안하다. | 최종 제출 전에 내용을 확인하거나 수정하기 어렵습니다. | `BAYMARD-CHECKOUT` | 추가 필요 | checkout/booking/domain flow에서만 적용. |
| `CHECKOUT-LOAD-INDICATOR-001` | Reliability | COMMIT | 결제/예약 제출 후 처리 중인지 알 수 없어 중복 제출 위험이 있다. | 제출 후 처리 중인지 알기 어렵습니다. | `BAYMARD-CHECKOUT`, `NNG-HEURISTICS` | 부분 가능 | `FEEDBACK-SYSTEM-STATUS-001`의 COMMIT 특화 Rule로 볼 수 있음. |

## 4. Rule별 구현 가능성 및 추가 필요 값

| Candidate ID | 현재 evidence만으로 구현 가능? | 현재 바로 쓸 수 있는 값 | 더 필요한 값 | 판단 |
| --- | --- | --- | --- | --- |
| `PATH-CHOICE-OVERLOAD-001` | 가능 | `interactive_components.components[]`, `bounds`, `visibility`, `role`, `clickable`, `is_primary_like`, viewport | `container_role`, `container_bounds`, `decision_area_id`가 있으면 header/footer/main 분리 정확도 상승 | 이미 구현 가능. 현재는 bounds/텍스트 기반 추정으로 충분히 시작 가능 |
| `PATH-PRIMARY-ACTION-CLARITY-001` | 가능 | `primary_like_component_count`, `is_cta_candidate`, `is_primary_like`, `bounds`, `text`, `role`, stage | `visual_prominence`, `style_weight`, `container_role` | 기존 `PATH-CTA-001`, `PATH-CTA-002`를 확장하거나 새 Rule로 분리 가능 |
| `PATH-CTA-LABEL-SPECIFICITY-001` | 가능 | `cta_candidate`, `interactive_components.text`, `journey_action_raw.clicked_text`, `scenario.goal`, GMS semantic provider | `visible_text`와 `accessible_name` 분리, 주변 context text | 기존 `JOURNEY-GOAL-CTA-MISMATCH-001`, `COPY-FLOW-QUALITY-001`와 책임 경계 정리 필요 |
| `A11Y-LINK-PURPOSE-001` | 부분 가능 | `interactive_components`의 `role=link`, `text`, `href`, `visible_text_blocks` | link별 nearby text, parent/container heading, repeated generic link grouping | `자세히 보기/더보기/여기` 같은 generic link는 현재도 잡을 수 있으나, 정확한 목적 판단은 주변 문맥 필요 |
| `PATH-BACK-LINK-001` | 부분 가능 | `interactive_components.text/href`, `breadcrumb`, `visitedUrls`, `journey_action_raw.url_before/after`, `step_order`, stage | `step_indicator`, `back_link_candidate`, browser history back 가능 여부, flow step count | 다단계 흐름으로 확정되는 경우만 제한적으로 구현 가능 |
| `PATH-ACCORDION-DISCOVERABILITY-001` | 추가 필요 | `interactive_components`, DOM snapshot artifact | `expanded/collapsed state`, `aria-expanded`, hidden panel 안 CTA/info, panel relationship | 현재 visible component 중심이라 접힌 영역 안에 숨은 정보를 안정적으로 판단하기 어려움 |
| `FORM-INSTRUCTIONS-001` | 부분 가능 | `interactive_components`의 form control `label_text`, `placeholder`, `name`, `required`, `input_type`, `visible_text_blocks` | `aria-describedby`, field help text, pattern/min/max/maxLength, input format hint | label 부재와 분리해서 "입력 조건 안내 부족"만 다루면 구현 가능 |
| `FORM-REQUIRED-OPTIONAL-001` | 부분 가능 | `required`, `label_text`, `placeholder`, form control component | visible required/optional marker, group-level required state, submit attempt 후 required error | required attr과 label marker 불일치 중심으로 시작 가능 |
| `FEEDBACK-SYSTEM-STATUS-001` | 부분 가능 | `settle_status`, `settle.durationMs`, `toast_text`, `visible_text_blocks`의 status/alert, clicked component | loading spinner/progress/status component, disabled-after-click, busy state, duplicate submit guard | "처리 중 표시 없음"은 추가 state가 있어야 안정적. timeout/long settle과 함께 제한적으로 시작 가능 |
| `FEEDBACK-ACTION-RESULT-001` | 가능 | `goal_action_result`, `journey_action_raw.dom_changed`, `url_before/after`, `toast_text`, `network_result`, `settle_status`, cart count delta | action expected outcome hint, page type/action kind classification | 현재 Runner가 이미 성공 근거를 많이 수집한다. 단순 click 전체가 아니라 목표 행동 후보에 한정해야 함 |
| `TECH-TARGET-SIZE-001` | 가능 | `interactive_components.components[].bounds`, viewport, `clickable`, `visibility` | nearest target spacing, device type 기준, pointer coarse/fine | 크기만 보면 바로 가능. "너무 가까움"까지 보려면 spacing 계산 추가 필요 |
| `CHECKOUT-ORDER-REVIEW-001` | 추가 필요 | `final_submit_candidate`, `payment_or_sensitive_action`이 있으면 보조 가능. 현재 후보 문서 기준 Runner 직접 signal은 부족 | checkout/booking page type, order summary, editable summary, final submit relation | 도메인 맥락과 checkout stage 확정 없이는 오탐 위험 큼 |
| `CHECKOUT-LOAD-INDICATOR-001` | 부분 가능 | `COMMIT` stage, `settle_status`, `settle.durationMs`, `toast_text`, `network_result` | payment/booking submit classification, loading/progress indicator, submit disabled-after-click | `FEEDBACK-SYSTEM-STATUS-001`의 COMMIT 특화로 묶어 먼저 구현하는 편이 안전 |

## 5. 종합 추가 수집 필요 값

아래 값들은 여러 후보 Rule에서 반복적으로 필요하다. Runner 추가 수집 우선순위는 P0부터 검토한다.

| 우선순위 | 추가 값 | 필요한 Rule | 설명 |
| --- | --- | --- | --- |
| P0 | `components[].visible_text`와 `components[].accessible_name` 분리 | `PATH-CTA-LABEL-SPECIFICITY-001`, `A11Y-LINK-PURPOSE-001`, `FORM-INSTRUCTIONS-001` | 현재 `text`는 textContent, aria-label, title, label, placeholder, name이 섞일 수 있다. 사용자에게 보이는 문구와 보조 이름을 분리해야 copy 판단이 안정적이다. |
| P0 | `components[].container_role`, `components[].container_bounds` | `PATH-CHOICE-OVERLOAD-001`, `PATH-PRIMARY-ACTION-CLARITY-001`, `A11Y-LINK-PURPOSE-001` | header/footer/main/form/nav/card/list 같은 영역 분리에 필요하다. bounds 비율 추정보다 안정적이다. |
| P0 | `components[].nearby_text` 또는 `container_heading` | `A11Y-LINK-PURPOSE-001`, `FORM-INSTRUCTIONS-001`, `PATH-CTA-LABEL-SPECIFICITY-001` | "더보기", "자세히 보기" 같은 링크/버튼의 목적을 주변 제목과 연결해 판단한다. |
| P0 | `components[].nearest_target_spacing_px` | `TECH-TARGET-SIZE-001` | 크기뿐 아니라 옆 대상과 너무 가까운 문제를 판단한다. |
| P1 | `form_fields[].describedby_text`, `help_text`, `pattern`, `min`, `max`, `maxlength` | `FORM-INSTRUCTIONS-001`, `FORM-REQUIRED-OPTIONAL-001` | 입력 조건과 형식 안내가 있는지 판단한다. |
| P1 | `loading_state` observation | `FEEDBACK-SYSTEM-STATUS-001`, `CHECKOUT-LOAD-INDICATOR-001` | spinner/progress/status/busy/disabled-after-click 여부를 action 직후 수집한다. |
| P1 | `action_kind`와 `expected_outcome_hint` | `FEEDBACK-ACTION-RESULT-001`, `FEEDBACK-SYSTEM-STATUS-001`, `CHECKOUT-LOAD-INDICATOR-001` | 모든 click에 결과 변화를 요구하지 않기 위해 navigation, submit, tab, menu, filter 등을 구분한다. |
| P1 | `step_indicator` / `back_link_candidate` | `PATH-BACK-LINK-001` | 다단계 흐름에서 이전 단계 이동 수단이 있는지 판단한다. |
| P2 | `accordion_state` observation | `PATH-ACCORDION-DISCOVERABILITY-001` | collapsed panel, trigger, hidden panel 안 CTA/info를 연결한다. |
| P2 | `checkout_context` observation | `CHECKOUT-ORDER-REVIEW-001`, `CHECKOUT-LOAD-INDICATOR-001` | checkout/booking/payment page 여부, order summary, final submit, editable summary를 구분한다. |

## 6. 추가 필요 값 설명

### 6.1 Component text 분리

| 값 | 의미 | 예시 | 필요한 Rule |
| --- | --- | --- | --- |
| `components[].visible_text` | 사용자 눈에 실제로 보이는 글자다. | 화면 버튼 텍스트가 `예약하기`이면 `visible_text="예약하기"` | `PATH-CTA-LABEL-SPECIFICITY-001`, `A11Y-LINK-PURPOSE-001`, `FORM-INSTRUCTIONS-001` |
| `components[].accessible_name` | 스크린리더나 접근성 트리에서 읽히는 이름이다. `aria-label`, `aria-labelledby`, label, alt, 버튼 텍스트 등으로 계산될 수 있다. | `<button aria-label="숙소 예약하기">예약</button>`이면 `visible_text="예약"`, `accessible_name="숙소 예약하기"` | `PATH-CTA-LABEL-SPECIFICITY-001`, `A11Y-LINK-PURPOSE-001`, `ICON/CONTROL` 계열 후보 |

현재 `components[].text`는 `textContent`, `aria-label`, `title`, label, placeholder, name 중 하나가 섞여 들어올 수 있다. 사용자에게 보이는 문구 문제인지, 접근성 이름 문제인지 분리하려면 위 두 값을 나누는 것이 좋다.

### 6.2 Container / 주변 문맥

| 값 | 의미 | 예시 | 필요한 Rule |
| --- | --- | --- | --- |
| `components[].container_role` | 요소가 속한 화면 영역의 역할이다. | `header`, `footer`, `main`, `nav`, `form`, `card`, `list`, `accordion`, `modal`, `checkout_summary` | `PATH-CHOICE-OVERLOAD-001`, `PATH-PRIMARY-ACTION-CLARITY-001`, `A11Y-LINK-PURPOSE-001` |
| `components[].container_bounds` | 요소가 속한 부모 영역의 화면 좌표다. | `{ "x": 0, "y": 80, "width": 1440, "height": 320 }` | `PATH-CHOICE-OVERLOAD-001`, `TECH-TARGET-SIZE-001` 보조 |
| `components[].nearby_text` | 해당 버튼/링크 주변의 설명 텍스트다. | 카드 제목 `A동 수상빌리지` 근처의 `자세히 보기` 링크 | `A11Y-LINK-PURPOSE-001`, `PATH-CTA-LABEL-SPECIFICITY-001` |
| `components[].container_heading` | 해당 요소가 속한 section/card/form의 제목이다. | section heading `객실 안내` + link `더보기` | `A11Y-LINK-PURPOSE-001`, `FORM-INSTRUCTIONS-001` |

예를 들어 링크 텍스트가 `더보기` 하나만 있으면 목적이 불명확하지만, `container_heading="객실 안내"`가 있으면 `객실 안내 더보기`로 해석할 수 있다.

### 6.3 Target size / spacing

| 값 | 의미 | 예시 | 필요한 Rule |
| --- | --- | --- | --- |
| `components[].nearest_target_spacing_px` | 가장 가까운 다른 클릭 대상과의 거리다. | 버튼 A와 버튼 B 사이 간격이 `4px` | `TECH-TARGET-SIZE-001` |
| `device_type` 또는 pointer 기준 | desktop/mobile/tablet 또는 coarse/fine pointer 기준이다. | mobile이면 더 큰 target size 기준 적용 | `TECH-TARGET-SIZE-001` |

`bounds.width/height`만 있으면 작은 버튼은 잡을 수 있다. 하지만 "버튼끼리 너무 가까워서 누르기 어렵다"를 판단하려면 가장 가까운 target과의 간격이 필요하다.

### 6.4 Form instruction

| 값 | 의미 | 예시 | 필요한 Rule |
| --- | --- | --- | --- |
| `form_fields[].describedby_text` | `aria-describedby`로 연결된 설명 문구다. | `<input aria-describedby="phone-help">`, `phone-help="숫자만 입력하세요"` | `FORM-INSTRUCTIONS-001` |
| `form_fields[].help_text` | 입력 필드 주변의 도움말/안내 문구다. | `비밀번호는 8자 이상이어야 합니다.` | `FORM-INSTRUCTIONS-001` |
| `form_fields[].pattern` | input에 걸린 형식 조건이다. | `pattern="[0-9]{10,11}"` | `FORM-INSTRUCTIONS-001` |
| `form_fields[].min`, `max` | 숫자/날짜 입력의 최소/최대 조건이다. | `min="1"`, `max="99"` | `FORM-INSTRUCTIONS-001` |
| `form_fields[].maxlength` | 입력 가능한 최대 글자 수다. | `maxlength="10"` | `FORM-INSTRUCTIONS-001` |

이 값들은 사용자가 입력 전에 형식이나 제한을 알 수 있는지 판단하는 데 필요하다.

### 6.5 Loading / action feedback

| 값 | 의미 | 예시 | 필요한 Rule |
| --- | --- | --- | --- |
| `loading_state.has_spinner` | 클릭/제출 후 spinner가 보이는지 여부다. | 로딩 원형 아이콘 표시 | `FEEDBACK-SYSTEM-STATUS-001`, `CHECKOUT-LOAD-INDICATOR-001` |
| `loading_state.has_progressbar` | 진행률 표시가 있는지 여부다. | progress bar, progress role | `FEEDBACK-SYSTEM-STATUS-001` |
| `loading_state.status_text` | 처리 중임을 설명하는 화면 문구다. | `처리 중입니다`, `예약을 확인하고 있습니다` | `FEEDBACK-SYSTEM-STATUS-001`, `CHECKOUT-LOAD-INDICATOR-001` |
| `loading_state.clicked_submit_disabled` | 제출 버튼 클릭 후 같은 버튼이 비활성화됐는지 여부다. | 중복 제출 방지 | `CHECKOUT-LOAD-INDICATOR-001` |
| `loading_state.aria_busy` | 처리 중 상태가 `aria-busy` 등으로 표현되는지 여부다. | `<main aria-busy="true">` | `FEEDBACK-SYSTEM-STATUS-001` |

`settle_status`와 `durationMs`만으로는 "느렸다"는 사실은 알 수 있지만, 사용자가 처리 중임을 안내받았는지는 알기 어렵다. 그래서 화면의 loading/status signal이 필요하다.

### 6.6 Action kind / expected outcome

| 값 | 의미 | 예시 | 필요한 Rule |
| --- | --- | --- | --- |
| `action_kind` | 사용자가 한 행동의 종류다. | `navigation`, `submit`, `form_input`, `tab_change`, `menu_open`, `filter_change`, `checkout_submit`, `payment_submit` | `FEEDBACK-ACTION-RESULT-001`, `FEEDBACK-SYSTEM-STATUS-001` |
| `expected_outcome_hint` | 행동 후 기대되는 결과 유형이다. | `url_change`, `modal_open`, `toast_show`, `form_submit`, `item_count_change`, `checkout_processing` | `FEEDBACK-ACTION-RESULT-001` |

모든 클릭에 URL 변화나 DOM 변화를 요구하면 오탐이 생긴다. 예를 들어 menu open, tab change, filter change, submit은 기대 결과가 다르다. 따라서 행동 종류와 기대 결과를 같이 넘기는 것이 좋다.

### 6.7 Back / step flow

| 값 | 의미 | 예시 | 필요한 Rule |
| --- | --- | --- | --- |
| `step_indicator` | 다단계 흐름에서 현재 단계와 전체 단계를 보여주는 UI다. | `1. 정보 입력 > 2. 결제 > 3. 완료` | `PATH-BACK-LINK-001`, checkout 계열 |
| `back_link_candidate` | 이전 단계로 돌아갈 수 있는 버튼/링크 후보이다. | `이전`, `뒤로`, `수정하기`, `Back`, `Return` | `PATH-BACK-LINK-001` |
| `history_back_available` | 브라우저 history back으로 이전 단계 복귀가 가능한지 여부다. | `true/false` | `PATH-BACK-LINK-001` 보조 |

`PATH-BACK-LINK-001`은 다단계 흐름에서 사용자가 되돌아갈 방법을 찾을 수 있는지 보는 Rule이다. 단순히 브라우저 뒤로가기가 가능하다는 것보다 화면 안의 명시적 back/edit affordance가 중요하다.

### 6.8 Accordion state

| 값 | 의미 | 예시 | 필요한 Rule |
| --- | --- | --- | --- |
| `accordion_state.trigger_text` | 접힘/펼침을 제어하는 버튼이나 summary 텍스트다. | `예약 안내`, `상세 조건 보기` | `PATH-ACCORDION-DISCOVERABILITY-001` |
| `accordion_state.expanded` | 현재 패널이 펼쳐져 있는지 여부다. | `true`면 펼쳐짐, `false`면 접힘 | `PATH-ACCORDION-DISCOVERABILITY-001` |
| `aria-expanded` | 웹에서 접힘/펼침 상태를 표현하는 속성이다. | `<button aria-expanded="false">예약 안내</button>` | `PATH-ACCORDION-DISCOVERABILITY-001` |
| `hidden_panel_has_cta` | 접힌 패널 안에 주요 버튼/링크가 숨어 있는지 여부다. | 접힌 영역 안의 `예약하기` 버튼 | `PATH-ACCORDION-DISCOVERABILITY-001` |
| `hidden_panel_has_required_info` | 접힌 패널 안에 필수 정보가 숨어 있는지 여부다. | 가격, 조건, 준비물, 취소 정책 | `PATH-ACCORDION-DISCOVERABILITY-001` |
| `panel_relationship` | 어떤 trigger가 어떤 panel을 열고 닫는지 연결 관계다. | `aria-controls="reservation-panel"` -> `id="reservation-panel"` | `PATH-ACCORDION-DISCOVERABILITY-001` |

예시:

```html
<button aria-controls="reservation-panel" aria-expanded="false">예약 안내</button>
<div id="reservation-panel" hidden>
  <a href="/reserve">예약하기</a>
</div>
```

이 경우 `예약 안내` 버튼과 `reservation-panel`이 연결되어 있고, 패널은 접혀 있으며, 패널 안에 `예약하기` CTA가 숨어 있다. 이 구조를 알아야 "중요한 행동이 접힌 영역 안에 숨어 있는지" 판단할 수 있다.

### 6.9 Checkout context

| 값 | 의미 | 예시 | 필요한 Rule |
| --- | --- | --- | --- |
| `checkout_context.is_checkout_flow` | 현재 흐름이 결제/예약/주문/신청 최종 흐름인지 여부다. | 예약 확정, 결제, 주문 단계 | `CHECKOUT-ORDER-REVIEW-001`, `CHECKOUT-LOAD-INDICATOR-001` |
| `checkout_context.has_order_summary` | 최종 제출 전 요약 정보가 보이는지 여부다. | 객실명, 날짜, 인원, 가격, 결제 금액 | `CHECKOUT-ORDER-REVIEW-001` |
| `checkout_context.has_editable_summary` | 요약 정보를 수정할 수 있는 버튼/링크가 있는지 여부다. | `수정하기`, `변경`, `Edit` | `CHECKOUT-ORDER-REVIEW-001` |
| `checkout_context.has_final_submit` | 최종 제출/결제/예약 확정 버튼이 있는지 여부다. | `결제하기`, `예약 확정`, `주문 완료` | `CHECKOUT-ORDER-REVIEW-001`, `CHECKOUT-LOAD-INDICATOR-001` |
| `final_submit_relation` | 최종 제출 버튼과 요약 정보가 같은 흐름 안에 연결되어 있는지 여부다. | 주문 요약 바로 아래 `결제하기` 버튼 | `CHECKOUT-ORDER-REVIEW-001` |

checkout 계열 Rule은 일반 페이지에 적용하면 오탐이 많다. 따라서 먼저 현재 페이지가 checkout/booking/payment 흐름인지 구분하는 `checkout_context`가 필요하다.

## 7. 구현 가능성 요약

| 구분 | Rule |
| --- | --- |
| 현재 evidence만으로 구현 가능 | `PATH-CHOICE-OVERLOAD-001`, `PATH-PRIMARY-ACTION-CLARITY-001`, `PATH-CTA-LABEL-SPECIFICITY-001`, `FEEDBACK-ACTION-RESULT-001`, `TECH-TARGET-SIZE-001` |
| 현재 evidence로 제한 구현 가능 | `A11Y-LINK-PURPOSE-001`, `PATH-BACK-LINK-001`, `FORM-INSTRUCTIONS-001`, `FORM-REQUIRED-OPTIONAL-001`, `FEEDBACK-SYSTEM-STATUS-001`, `CHECKOUT-LOAD-INDICATOR-001` |
| Runner 추가 수집 후 구현 권장 | `PATH-ACCORDION-DISCOVERABILITY-001`, `CHECKOUT-ORDER-REVIEW-001` |
