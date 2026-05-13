# 14. Evidence-based Rule Candidates

이 문서는 외부 UX, 접근성, 성능, 디자인 시스템 근거에서 Analyzer Rule 후보를 추출하기 위한 초안이다.

현재 단계의 목적은 구현이 아니라 후보 수집이다. 이후 작업 순서는 다음과 같다.

1. 근거 사이트 기반으로 후보 Rule을 추출한다.
2. `12_analyzer_rule_catalog.md`의 기존 Rule과 비교한다.
3. Runner가 현재 수집하는 값으로 판단 가능한지 확인한다.
4. 부족한 evidence를 `13_analyzer_rule_required_data.md`에 정리한다.
5. 각 Rule을 `FIRST_VIEW`, `VALUE`, `CTA`, `INPUT`, `COMMIT` stage에 매핑한다.

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

## 2. Candidate Rule Map

### 2.1 Accessibility and Structure

| Candidate ID | Axis | Stage | 후보 Rule | 근거 | 현재 데이터로 가능성 | 필요한 주요 evidence |
| --- | --- | --- | --- | --- | --- | --- |
| `A11Y-IMAGE-ALT-001` | Clarity | FIRST_VIEW, VALUE, CTA | 의미 있는 이미지/아이콘/이미지 버튼에 대체 텍스트나 접근성 이름이 있는지 판단한다. | `W3C-WAI-TUTORIALS`, `WCAG22-QUICKREF` | 부분 가능 | `interactive_components.components[]`, `img alt`, `aria-label`, `role`, `clickable`, `bounds` |
| `A11Y-CONTROL-NAME-001` | Clarity | CTA, INPUT, COMMIT | 버튼, 링크, 커스텀 컨트롤이 목적을 설명하는 accessible name을 갖는지 판단한다. | `WCAG22-QUICKREF`, `LIGHTHOUSE` | 부분 가능 | `role`, `accessible_name`, `aria-label`, `text`, `title`, `clickable` |
| `A11Y-NAME-ROLE-VALUE-001` | Reliability | CTA, INPUT, COMMIT | 커스텀 컨트롤의 role/name/state/value가 보조기술에 전달 가능한지 판단한다. | `WCAG22-QUICKREF`, `LIGHTHOUSE` | 추가 필요 | accessibility tree snapshot, `role`, `name`, `aria-expanded`, `aria-checked`, `aria-disabled` |
| `A11Y-FOCUS-VISIBLE-001` | Friction | CTA, INPUT, COMMIT | 키보드 포커스가 시각적으로 보이는지 판단한다. | `WCAG22-QUICKREF`, `LIGHTHOUSE` | 추가 필요 | focus traversal screenshot, active element bounds, focus ring style |
| `A11Y-FOCUS-ORDER-001` | Friction | CTA, INPUT, COMMIT | 탭 순서가 화면/DOM 흐름과 논리적으로 맞는지 판단한다. | `WCAG22-QUICKREF`, `LIGHTHOUSE` | 추가 필요 | tab traversal order, active element sequence, bounds, DOM order |
| `A11Y-KEYBOARD-TRAP-001` | Reliability | CTA, INPUT, COMMIT | 키보드 포커스가 모달, 메뉴, iframe, 커스텀 위젯 안에 갇히지 않는지 판단한다. | `WCAG22-QUICKREF`, `LIGHTHOUSE` | 추가 필요 | keyboard simulation result, focus escape result, modal/menu state |
| `A11Y-LINK-PURPOSE-001` | Clarity | FIRST_VIEW, VALUE, CTA | 링크 텍스트가 주변 맥락 없이도 목적을 설명하는지 판단한다. | `WCAG22-QUICKREF`, `LIGHTHOUSE` | 부분 가능 | `interactive_components.components[].text`, `href`, `aria-label`, surrounding text |
| `A11Y-HEADING-STRUCTURE-001` | Clarity | FIRST_VIEW, VALUE | heading 구조가 페이지 내용을 이해하는 데 충분하고 순서가 과도하게 깨지지 않는지 판단한다. | `W3C-WAI-TUTORIALS`, `WCAG22-QUICKREF` | 부분 가능 | `heading_structure`, heading levels, text, bounds |
| `A11Y-LANDMARK-STRUCTURE-001` | Clarity | FIRST_VIEW, VALUE | header, nav, main, footer 같은 landmark가 페이지 구조를 설명하는지 판단한다. | `W3C-WAI-TUTORIALS`, `LIGHTHOUSE` | 추가 필요 | semantic landmarks, role, DOM region info |

### 2.2 Forms and Input

| Candidate ID | Axis | Stage | 후보 Rule | 근거 | 현재 데이터로 가능성 | 필요한 주요 evidence |
| --- | --- | --- | --- | --- | --- | --- |
| `FORM-LABEL-ASSOCIATION-001` | Friction | INPUT | 입력 필드가 명시 label 또는 accessible name과 연결되어 있는지 판단한다. | `W3C-WAI-TUTORIALS`, `WCAG22-QUICKREF`, `GOVUK-COMPONENTS`, `USWDS-COMPONENTS` | 이미 유사 Rule 있음 | `form_field.label_association`, `label_text`, `accessible_name`, `placeholder` |
| `FORM-FIELDSET-GROUPING-001` | Clarity | INPUT | checkbox/radio 묶음이 group label 또는 fieldset/legend로 설명되는지 판단한다. | `W3C-WAI-TUTORIALS`, `GOVUK-COMPONENTS`, `USWDS-COMPONENTS` | 추가 필요 | fieldset/legend, group role, related controls, bounds |
| `FORM-INSTRUCTIONS-001` | Clarity | INPUT | 입력 조건, 형식, 제한이 사용자가 입력하기 전에 보이는지 판단한다. | `W3C-WAI-TUTORIALS`, `WCAG22-QUICKREF`, `GOVUK-COMPONENTS` | 부분 가능 | `form_field.help_text`, `description`, `required`, `pattern`, `maxLength` |
| `FORM-ERROR-IDENTIFICATION-001` | Friction | INPUT | 오류 발생 시 어떤 필드가 왜 문제인지 식별 가능한지 판단한다. | `WCAG22-QUICKREF`, `GOVUK-COMPONENTS`, `NNG-HEURISTICS`, `BAYMARD-CHECKOUT` | 부분 가능 | `form_error`, `field_id`, error text, field bounds, invalid state |
| `FORM-ERROR-SUMMARY-001` | Friction | INPUT, COMMIT | 여러 오류가 있을 때 상단 error summary나 필드별 연결이 제공되는지 판단한다. | `GOVUK-COMPONENTS`, `WCAG22-QUICKREF` | 추가 필요 | submit attempt, error summary component, anchor targets, field errors |
| `FORM-CHARACTER-COUNT-001` | Clarity | INPUT | 글자 수 제한이 있는 입력에 현재/최대 길이 안내가 있는지 판단한다. | `GOVUK-COMPONENTS`, `USWDS-COMPONENTS` | 추가 필요 | `maxLength`, visible character count, aria-describedby |
| `FORM-AUTOCOMPLETE-001` | Friction | INPUT | 이름, 주소, 이메일, 결제 등 반복 입력 필드에 적절한 autocomplete가 있는지 판단한다. | `WCAG22-QUICKREF`, `BAYMARD-CHECKOUT` | 추가 필요 | input `autocomplete`, input purpose, field type |
| `FORM-PASTE-BLOCKED-001` | Friction | INPUT | 사용자가 입력 필드에 붙여넣기를 하지 못하도록 막는지 판단한다. | `LIGHTHOUSE` | 추가 필요 | paste simulation result, prevented paste event |
| `FORM-REQUIRED-OPTIONAL-001` | Clarity | INPUT | required/optional 표시가 명확하고 일관적인지 판단한다. | `BAYMARD-CHECKOUT`, `GOVUK-COMPONENTS` | 부분 가능 | `required_field`, label text, optional marker, required attr |

### 2.3 Navigation, Choice, and Decision Flow

| Candidate ID | Axis | Stage | 후보 Rule | 근거 | 현재 데이터로 가능성 | 필요한 주요 evidence |
| --- | --- | --- | --- | --- | --- | --- |
| `PATH-CHOICE-OVERLOAD-001` | Path | FIRST_VIEW, VALUE, CTA | header/footer 보조 요소를 제외한 main decision 영역에 선택지가 과도하게 많은지 판단한다. | `NNG-HEURISTICS`, choice overload research | 구현 중 | `interactive_components.components[]`, bounds, role, text, viewport |
| `PATH-PRIMARY-ACTION-CLARITY-001` | Path | FIRST_VIEW, CTA | 주요 행동이 하나 이상 보이고, 보조 행동과 시각 위계가 구분되는지 판단한다. | `NNG-HEURISTICS`, `GOVUK-COMPONENTS`, `USWDS-COMPONENTS` | 부분 가능 | `primary_like_component_count`, `visual_prominence`, `bounds`, text |
| `PATH-BREADCRUMB-CONTEXT-001` | Clarity | VALUE, CTA | 깊은 페이지나 상세 페이지에서 현재 위치를 이해할 수 있는 breadcrumb/location signal이 있는지 판단한다. | `GOVUK-COMPONENTS`, `USWDS-COMPONENTS`, `WCAG22-QUICKREF` | 추가 필요 | breadcrumb text, URL depth, page title, nav context |
| `PATH-BACK-LINK-001` | Path | VALUE, CTA, INPUT | 다단계 흐름에서 이전 단계로 돌아가는 방법이 명확한지 판단한다. | `GOVUK-COMPONENTS`, `NNG-HEURISTICS` | 부분 가능 | back link/button, history action, step indicator |
| `PATH-PAGINATION-CLARITY-001` | Clarity | VALUE | 페이지네이션/목록 탐색에서 현재 위치와 다음/이전 이동이 명확한지 판단한다. | `GOVUK-COMPONENTS`, `USWDS-COMPONENTS` | 추가 필요 | pagination component, current page, next/prev labels |
| `PATH-ACCORDION-DISCOVERABILITY-001` | Clarity | VALUE, CTA | accordion/details 안에 주요 행동이나 필수 정보가 숨겨져 사용자가 발견하기 어려운지 판단한다. | `GOVUK-COMPONENTS`, `USWDS-COMPONENTS`, `NNG-HEURISTICS` | 추가 필요 | collapsed state, hidden CTA/info, expanded labels |
| `PATH-CTA-LABEL-SPECIFICITY-001` | Clarity | CTA, COMMIT | CTA 라벨이 사용자가 실행할 행동을 구체적으로 설명하는지 판단한다. | `NNG-HEURISTICS`, `WCAG22-QUICKREF` | 이미 유사 Rule 있음 | CTA text, scenario goal, role, GMS semantic result |
| `PATH-CONSISTENT-NAVIGATION-001` | Clarity | FIRST_VIEW, VALUE, CTA | 반복되는 navigation과 주요 컴포넌트 명칭이 페이지 간 일관적인지 판단한다. | `WCAG22-QUICKREF`, `NNG-HEURISTICS` | 추가 필요 | multi-checkpoint nav snapshot, labels, hrefs, positions |

### 2.4 Feedback, Errors, and State Change

| Candidate ID | Axis | Stage | 후보 Rule | 근거 | 현재 데이터로 가능성 | 필요한 주요 evidence |
| --- | --- | --- | --- | --- | --- | --- |
| `FEEDBACK-SYSTEM-STATUS-001` | Reliability | CTA, INPUT, COMMIT | 클릭/제출/로드 중 시스템 상태가 사용자에게 보이는지 판단한다. | `NNG-HEURISTICS`, `BAYMARD-CHECKOUT` | 부분 가능 | loading state, progress indicator, toast/status text, settle response |
| `FEEDBACK-STATUS-MESSAGE-001` | Clarity | INPUT, COMMIT | 성공/오류/진행 상태 메시지가 화면에 보이고 보조기술에도 전달 가능한지 판단한다. | `WCAG22-QUICKREF`, `GOVUK-COMPONENTS`, `USWDS-COMPONENTS` | 추가 필요 | status role/live region, toast text, alert/banner component |
| `FEEDBACK-ACTION-RESULT-001` | Reliability | CTA, INPUT, COMMIT | 사용자의 행동 후 URL, DOM, 카운트, toast 등 결과 변화가 확인되는지 판단한다. | `NNG-HEURISTICS`, `BAYMARD-CHECKOUT` | 부분 가능 | `settle_response`, `dom_changed`, `url_changed`, `toast_text`, count change |
| `FEEDBACK-PERMISSION-PROMPT-001` | Friction | FIRST_VIEW, CTA | 페이지 진입 즉시 알림/위치 등 권한 요청이 떠 사용 흐름을 방해하는지 판단한다. | `LIGHTHOUSE` | 추가 필요 | permission prompt event, prompt type, timing |
| `FEEDBACK-MODAL-FOCUS-001` | Friction | CTA, INPUT, COMMIT | 모달/팝업이 열릴 때 포커스 이동, 닫기, 배경 접근 차단이 적절한지 판단한다. | `WCAG22-QUICKREF`, `GOVUK-COMPONENTS`, `USWDS-COMPONENTS` | 추가 필요 | modal open state, focus target, close button, escape result |

### 2.5 Performance and Technical UX

| Candidate ID | Axis | Stage | 후보 Rule | 근거 | 현재 데이터로 가능성 | 필요한 주요 evidence |
| --- | --- | --- | --- | --- | --- | --- |
| `PERF-LCP-SLOW-001` | Reliability | FIRST_VIEW, VALUE | 주요 콘텐츠가 늦게 렌더링되는지 판단한다. | `WEB-VITALS`, `LIGHTHOUSE` | 추가 필요 | LCP value, LCP element, navigation timing |
| `PERF-CLS-SHIFT-001` | Reliability | FIRST_VIEW, VALUE, CTA | 로딩 중 레이아웃 이동이 발생해 클릭/읽기 흐름을 방해하는지 판단한다. | `WEB-VITALS`, `LIGHTHOUSE` | 추가 필요 | CLS value, layout shift events, shifted elements |
| `PERF-INP-SLOW-001` | Reliability | CTA, INPUT, COMMIT | 사용자 상호작용 응답이 느린지 판단한다. | `WEB-VITALS` | 추가 필요 | INP or interaction latency, event target, duration |
| `PERF-RENDER-BLOCKING-001` | Reliability | FIRST_VIEW | 렌더링 차단 요청이나 과도한 JS/CSS가 첫 화면 사용 가능 시점을 늦추는지 판단한다. | `LIGHTHOUSE` | 추가 필요 | Lighthouse audits, render blocking requests, main thread tasks |
| `TECH-CONSOLE-ERROR-001` | Reliability | CTA, INPUT, COMMIT | 사용자 행동 직후 console error가 발생하는지 판단한다. | `LIGHTHOUSE` | 이미 유사 Rule 있음 | `console_error`, checkpoint state console summary |
| `TECH-NETWORK-FAILURE-001` | Reliability | CTA, INPUT, COMMIT | 사용자 행동 직후 failed request가 발생하는지 판단한다. | `LIGHTHOUSE` | 이미 유사 Rule 있음 | `network_failure`, network summary |
| `TECH-HTTPS-SECURITY-001` | Reliability | FIRST_VIEW, COMMIT | HTTPS 미사용 또는 mixed content/security warning이 있는지 판단한다. | `LIGHTHOUSE` | 추가 필요 | page protocol, security state, mixed content events |
| `TECH-TARGET-SIZE-001` | Friction | FIRST_VIEW, VALUE, CTA, INPUT | 터치/클릭 대상 크기와 간격이 너무 작지 않은지 판단한다. | `WCAG22-QUICKREF`, `LIGHTHOUSE` | 부분 가능 | component bounds, viewport/device type, neighboring target spacing |

### 2.6 Checkout and Commerce Flow

| Candidate ID | Axis | Stage | 후보 Rule | 근거 | 현재 데이터로 가능성 | 필요한 주요 evidence |
| --- | --- | --- | --- | --- | --- | --- |
| `CHECKOUT-GUEST-OPTION-001` | Path | CTA, COMMIT | 구매/예약 전 계정 생성 강요로 목표 흐름이 막히지 않는지 판단한다. | `BAYMARD-CHECKOUT` | 추가 필요 | login/account choice screen, guest checkout CTA, scenario goal |
| `CHECKOUT-ORDER-REVIEW-001` | Clarity | COMMIT | 최종 제출 전에 주문/예약/결제 정보를 검토하고 수정할 수 있는지 판단한다. | `BAYMARD-CHECKOUT` | 추가 필요 | review step, editable summary, final submit candidate |
| `CHECKOUT-PAYMENT-FIELD-CLARITY-001` | Friction | INPUT, COMMIT | 카드번호, 만료일, CVC, 명의자 등 결제 필드가 명확히 분리되고 설명되는지 판단한다. | `BAYMARD-CHECKOUT`, `WCAG22-QUICKREF` | 추가 필요 | payment field types, labels, grouping, input masks |
| `CHECKOUT-CROSSSELL-DISTRACTION-001` | Path | COMMIT | checkout 중 cross-sell이나 외부 프로모션이 최종 완료 행동을 방해하는지 판단한다. | `BAYMARD-CHECKOUT`, `NNG-HEURISTICS` | 추가 필요 | checkout stage, promo/cross-sell components, final submit bounds |
| `CHECKOUT-LOAD-INDICATOR-001` | Reliability | COMMIT | 결제/예약 제출 후 처리 중임을 알리는 indicator와 중복 제출 방지가 있는지 판단한다. | `BAYMARD-CHECKOUT`, `NNG-HEURISTICS` | 부분 가능 | loading state, submit disabled after click, settle response |
| `CHECKOUT-DATA-PERSISTENCE-001` | Reliability | INPUT, COMMIT | 오류 후 사용자가 입력한 값이 보존되는지 판단한다. | `BAYMARD-CHECKOUT` | 추가 필요 | before/after field values, submit error, rerender state |

## 3. Existing Rule 비교 후보

| 기존 Rule | 연결 가능한 후보 | 판단 |
| --- | --- | --- |
| `PATH-CTA-001` | `PATH-PRIMARY-ACTION-CLARITY-001` | 기존 Rule 확장 후보. CTA 존재 여부에서 primary action clarity로 세분화 가능. |
| `PATH-CTA-002` | `PATH-PRIMARY-ACTION-CLARITY-001`, `PATH-CHOICE-OVERLOAD-001` | 주요 버튼 경쟁과 선택지 과다는 분리 유지. |
| `PATH-CHOICE-OVERLOAD-001` | `PATH-CHOICE-OVERLOAD-001` | 현재 구현 중. 근거는 NN/g minimalist design과 choice overload 연구가 적합. |
| `FRICTION-FORM-001` | `FORM-LABEL-ASSOCIATION-001`, `FORM-FIELDSET-GROUPING-001`, `FORM-INSTRUCTIONS-001` | 현재 Rule은 label association 중심. grouping/instruction은 후보로 분리. |
| `RELIABILITY-TECH-001` | `TECH-CONSOLE-ERROR-001`, `TECH-NETWORK-FAILURE-001` | 이미 구현된 기술 실패 Rule과 직접 연결. |
| `RELIABILITY-LOADING-STUCK-001` | `FEEDBACK-SYSTEM-STATUS-001`, `PERF-LCP-SLOW-001` | 페이지 전환 속도와 상태 피드백을 분리할 필요 있음. |
| `JOURNEY-GOAL-CTA-MISMATCH-001` | `PATH-CTA-LABEL-SPECIFICITY-001` | 목표-CTA 의미 불일치와 라벨 구체성은 GMS 기반으로 연결 가능. |
| `COPY-FLOW-QUALITY-001` | `A11Y-LINK-PURPOSE-001`, `PATH-CTA-LABEL-SPECIFICITY-001` | 라벨 의미 품질과 링크/CTA 목적성을 연결 가능. |
| `COPY-LABEL-INTEGRITY-001` | WCAG distinguishable/visual presentation 계열 | 깨짐/잘림/겹침은 GMS/이미지 기반 보조가 적합. |

## 4. Stage Mapping 초안

| Stage | 우선 검토할 후보 Rule |
| --- | --- |
| `FIRST_VIEW` | `A11Y-IMAGE-ALT-001`, `A11Y-HEADING-STRUCTURE-001`, `A11Y-LANDMARK-STRUCTURE-001`, `PATH-CHOICE-OVERLOAD-001`, `PERF-LCP-SLOW-001`, `PERF-CLS-SHIFT-001`, `FEEDBACK-PERMISSION-PROMPT-001` |
| `VALUE` | `PATH-BREADCRUMB-CONTEXT-001`, `PATH-ACCORDION-DISCOVERABILITY-001`, `A11Y-LINK-PURPOSE-001`, `PERF-CLS-SHIFT-001` |
| `CTA` | `PATH-PRIMARY-ACTION-CLARITY-001`, `PATH-CTA-LABEL-SPECIFICITY-001`, `A11Y-CONTROL-NAME-001`, `A11Y-FOCUS-VISIBLE-001`, `TECH-TARGET-SIZE-001`, `FEEDBACK-ACTION-RESULT-001` |
| `INPUT` | `FORM-LABEL-ASSOCIATION-001`, `FORM-FIELDSET-GROUPING-001`, `FORM-INSTRUCTIONS-001`, `FORM-ERROR-IDENTIFICATION-001`, `FORM-CHARACTER-COUNT-001`, `FORM-AUTOCOMPLETE-001`, `FORM-PASTE-BLOCKED-001` |
| `COMMIT` | `CHECKOUT-ORDER-REVIEW-001`, `CHECKOUT-PAYMENT-FIELD-CLARITY-001`, `CHECKOUT-CROSSSELL-DISTRACTION-001`, `CHECKOUT-LOAD-INDICATOR-001`, `CHECKOUT-DATA-PERSISTENCE-001`, `FEEDBACK-STATUS-MESSAGE-001` |

## 5. Runner Data Feasibility 초안

### 현재 데이터로 먼저 검토 가능한 후보

- `PATH-CHOICE-OVERLOAD-001`
- `PATH-PRIMARY-ACTION-CLARITY-001`
- `FORM-LABEL-ASSOCIATION-001`
- `FORM-ERROR-IDENTIFICATION-001`
- `TECH-CONSOLE-ERROR-001`
- `TECH-NETWORK-FAILURE-001`
- `FEEDBACK-ACTION-RESULT-001`
- `TECH-TARGET-SIZE-001` 단, target spacing은 추가 계산 필요
- `A11Y-CONTROL-NAME-001` 단, accessibility tree가 없으면 confidence 낮음
- `A11Y-LINK-PURPOSE-001` 단, 주변 문맥과 GMS가 필요할 수 있음

### Runner 추가 수집이 필요한 후보

- focus traversal: `A11Y-FOCUS-VISIBLE-001`, `A11Y-FOCUS-ORDER-001`, `A11Y-KEYBOARD-TRAP-001`
- accessibility tree snapshot: `A11Y-NAME-ROLE-VALUE-001`, `FEEDBACK-STATUS-MESSAGE-001`
- Lighthouse/Web Vitals JSON: `PERF-LCP-SLOW-001`, `PERF-CLS-SHIFT-001`, `PERF-INP-SLOW-001`, `PERF-RENDER-BLOCKING-001`
- form value persistence: `CHECKOUT-DATA-PERSISTENCE-001`
- modal simulation: `FEEDBACK-MODAL-FOCUS-001`
- paste/permission simulation: `FORM-PASTE-BLOCKED-001`, `FEEDBACK-PERMISSION-PROMPT-001`

## 6. 우선순위 추천

1. 기존 데이터로 가능한 후보부터 `12_analyzer_rule_catalog.md`와 비교한다.
2. WCAG/Lighthouse처럼 자동 근거가 명확한 Rule은 deterministic rule로 우선 검토한다.
3. NN/g/Baymard처럼 의미 판단이 필요한 Rule은 GMS 보조 또는 후보 낮은 confidence로 시작한다.
4. 성능 Rule은 Runner가 Lighthouse/Web Vitals JSON을 안정적으로 넘긴 뒤 추가한다.
5. Checkout Rule은 범용 journey보다 도메인 특화이므로 COMMIT stage 후보로 따로 관리한다.

