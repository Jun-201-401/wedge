# Runner Evidence 기준 룰 후보 도감

## 문서 목적

이 문서는 팀장 지시 업무 중 **2. Runner evidence 기준 필터링**에 해당하는 산출물이다.

1번 문서인 `docs/rule_candidate_separation_catalog.md`는 공신력 있는 레퍼런스만 기준으로 만들 수 있는 룰 후보 전체를 정리했다. 이 문서는 그 후보들 중에서 **현재 구현되어 있는 Runner가 실제 evidence를 제공할 수 있는지**만 판정한다.

이 문서는 아직 다음을 판단하지 않는다.

- Analyzer handler가 이미 있는지
- Analyzer에서 바로 RuleHit으로 만들 수 있는지
- 최종 구현 / 보류 / 제외 여부
- report wording이나 severity 최종값

즉, 이 문서는 개발자가 후속 작업에서 “Runner evidence가 이미 있으니 Analyzer 룰만 연결하면 되는 후보”와 “Runner 수집부터 더 해야 하는 후보”를 구분하기 위한 도감이다.

## 검토 기준

현재 Runner evidence 구조는 다음 파일 기준으로 확인했다.

| 구분 | 확인 파일 |
| --- | --- |
| checkpoint 생성 | `apps/runner/src/capture/index.ts` |
| Playwright snapshot 수집 | `apps/runner/src/browser/playwright/index.ts` |
| Runner contract type | `packages/contracts/types/runner.ts` |
| Evidence packet schema | `packages/contracts/schemas/evidence-packet.schema.json` |
| Runner callback schema | `packages/contracts/internal/runner-callback.schema.json` |
| 기존 observation 매핑 문서 | `docs/08_observation_mapping.md` |
| 기존 rule 필요 데이터 문서 | `docs/13_analyzer_rule_required_data.md` |
| 기존 extraction 후보 문서 | `docs/15_extraction_rule_candidates.md` |

## 판정 등급

| 등급 | 의미 |
| --- | --- |
| `Runner 사용 가능` | 현재 Runner가 룰 판단에 필요한 핵심 evidence를 구조화 observation으로 제공한다. Analyzer 연결은 별도 작업이다. |
| `Runner 부분 가능` | Runner가 일부 근거는 제공하지만, 정확한 룰로 만들려면 추가 observation, 추가 시나리오, GMS/시각 분석, 또는 보정 로직이 필요하다. |
| `Runner 추가 수집 필요` | 현재 Runner evidence만으로는 핵심 판단 근거가 부족하다. Runner collector/contract 추가가 먼저 필요하다. |
| `도메인 조건부` | Runner evidence는 있으나 checkout, modal, keyboard, performance capture 같은 특정 실행 조건에서만 의미가 있다. |

## 현재 Runner Evidence Inventory

현재 Runner는 checkpoint마다 다음 계열의 evidence를 남길 수 있다.

| Evidence | 대표 observation / state | 대표 필드 | 주요 사용 룰 |
| --- | --- | --- | --- |
| 화면 기본 정보 | `checkpoint.state` | `url`, `title`, `viewport`, `scrollY`, `visitedUrls`, `breadcrumb` | page title, breadcrumb, path context |
| 상호작용 요소 | `interactive_components` | `components[].text`, `role`, `tag`, `clickable`, `bounds`, `visibility`, `is_cta_candidate`, `is_primary_like`, `container_role`, `container_bounds`, `container_heading`, `nearby_text`, `nearest_target_spacing_px` | CTA, choice overload, target size, link purpose |
| 폼 필드 | `form_field` | `label_text`, `accessible_name`, `placeholder`, `required`, `input_type`, `describedby_text`, `help_text`, `input_format_hint`, `pattern`, `min`, `max`, `maxlength`, `visible_required_marker`, `visible_optional_marker`, `group_level_required_state`, `submit_required_error`, `bounds`, `visibility` | form label, instruction, required marker |
| visible text | `visible_text_blocks`, `text_block_metrics` | `blocks[]`, `line_count`, `font_size_px`, `nearby_cta_ref`, `mobile_line_break_segments` | heading, copy clarity, text overflow 후보 |
| 접근성 tree | `ax_tree` artifact / summary | `heading_count`, `landmark_count`, `button_count`, `link_count`, `focusable_count`, `role_counts` | heading, landmark, name-role-value 보조 |
| action 결과 | `journey_action_raw`, `goal_action_result`, `page_ready_timing` | `action_kind`, `expected_outcome_hint`, `url_before/after`, `dom_changed`, `network_result`, `settle_status`, `duration_ms`, `target_page_signals` | action result, loading, reliability |
| 로딩 상태 | `loading_state` | `has_spinner`, `has_progressbar`, `status_text`, `aria_busy`, `clicked_submit_disabled` | system status, checkout loading |
| 네트워크 / 콘솔 | `network_timeline`, `network_failure`, `console_error` | `failed_request_count`, `status_code_counts`, `events[]`, error messages | technical reliability |
| 성능 | `performance_metric` | `first_contentful_paint_ms`, `largest_contentful_paint_ms`, `cumulative_layout_shift`, `interaction_to_next_paint_ms`, `render_blocking_resource_count`, `long_task_count`, transfer size | Web Vitals, render blocking |
| 키보드 포커스 | `keyboard_focus_state` | `sampled`, `tab_stop_count`, `modal_open`, `keyboard_trap_candidate`, `focus_order[].visible_focus`, `inside_modal`, `bounds` | keyboard, focus, modal |
| 경로/단계 | `path_navigation` | `step_indicator`, `back_link_candidate`, `visited_url_count`, `browser_history_back_available`, `flow_step_count` | back link, multi-step flow |
| 아코디언 | `accordion_state` | `expanded`, `trigger`, `panel`, `hidden_panel_has_cta`, `hidden_panel_has_required_info`, `panel_relationship` | accordion discoverability, component state |
| 체크아웃 | `checkout_context` | `is_checkout_flow`, `flow_subtype`, `has_order_summary`, `has_editable_summary`, `has_final_submit`, `order_summary_text`, `final_submit_relation` | checkout review/loading |

## 1. Runner 사용 가능 후보

아래 후보는 현재 Runner evidence만으로도 rule 후보를 안정적으로 만들 수 있다. 단, 실제 사용자-facing issue가 되려면 Analyzer에서 handler와 severity/report wording을 구현해야 한다.

| 후보 ID | 필요한 Runner evidence | 사용 가능한 판단 범위 | 주의 |
| --- | --- | --- | --- |
| `PATH-CTA-001` | `interactive_components`, `goal_action_candidate`, `is_cta_candidate`, `is_primary_like`, `bounds`, `visible_text_blocks` | 목표 관련 핵심 CTA가 화면에 있는지 판단 가능 | goal relevance는 Analyzer/GMS semantic 보조가 있으면 더 정확함 |
| `PATH-CTA-002` | `interactive_components.primary_like_component_count`, `components[].is_primary_like`, `bounds` | primary-like CTA가 과도하게 경쟁하는지 판단 가능 | 시각 위계 해석은 현재 heuristic 기반 |
| `PATH-CHOICE-OVERLOAD-001` | `interactive_components.components[]`, `bounds`, `visibility`, `container_bounds`, `container_role` | viewport 또는 decision area의 선택지 과다 판단 가능 | 기존 운영 룰과 직접 연결됨 |
| `FRICTION-FORM-001` | `form_field.label_text`, `accessible_name`, `placeholder`, `required`, `bounds`, `visibility` | label/accessibility name 부재, placeholder-only 후보 판단 가능 | accessible name은 DOM/ARIA 기반 근사값임 |
| `FORM-INSTRUCTIONS-001` | `form_field.describedby_text`, `help_text`, `input_format_hint`, `pattern`, `min`, `max`, `maxlength` | 입력 조건이 있는데 설명이 없는지 판단 가능 | 필드별 예외 문구 calibration 필요 |
| `FORM-PLACEHOLDER-ONLY-001` | `form_field.label_text`, `accessible_name`, `placeholder` | label 없이 placeholder만 있는 입력 후보 판단 가능 | placeholder가 보조 안내인 경우는 제외해야 함 |
| `FORM-REQUIRED-OPTIONAL-001` | `required`, `visible_required_marker`, `visible_optional_marker`, `group_level_required_state`, `submit_required_error` | required attr과 화면 표시 불일치 후보 판단 가능 | marker 설명 문구까지 보는 것은 Analyzer 작업 |
| `A11Y-LINK-PURPOSE-001` | `interactive_components.text`, `role`, `nearby_text`, `container_heading`, `repeated_generic_link_grouping` | 반복 generic link가 문맥 없이 쓰였는지 후보화 가능 | 최종 목적 판단은 주변 문맥 threshold 필요 |
| `A11Y-TARGET-SIZE-001` | `interactive_components.bounds`, `visibility`, `clickable` | target width/height 기준 미달 판단 가능 | WCAG 예외 조건은 Analyzer에서 보정 필요 |
| `A11Y-TARGET-SPACING-001` | `interactive_components.nearest_target_spacing_px`, `bounds` | 작은 target 간 간격 부족 후보 판단 가능 | 수집된 visible target 집합 기준임 |
| `A11Y-LABEL-IN-NAME-001` | `visible_text`, `label_text`, `accessible_name`, `role` | visible label이 accessible name에 포함되는지 후보화 가능 | exact computed accessible name은 AX capture와 함께 쓰면 더 안전함 |
| `A11Y-FOCUS-VISIBLE-001` | `keyboard_focus_state.focus_order[].visible_focus`, `bounds` | Tab 이동 중 focus indicator가 보이는지 후보화 가능 | keyboard focus sampling이 실행된 경우에만 가능 |
| `A11Y-KEYBOARD-TRAP-001` | `keyboard_focus_state.keyboard_trap_candidate`, `modal_open`, `focus_order` | focus trap 후보 감지 가능 | 의도된 modal trap과 탈출 불가 trap은 Analyzer가 구분해야 함 |
| `PATH-BACK-LINK-001` | `path_navigation.step_indicator`, `back_link_candidate`, `flow_step_count`, `browser_history_back_available` | 다단계 흐름에서 back/edit affordance 부재 후보화 가능 | multi-step flow일 때만 적용해야 함 |
| `COMPONENT-ACCORDION-DISCOVERABILITY-001` | `accordion_state.expanded`, `hidden_panel_has_cta`, `hidden_panel_has_required_info`, `panel_relationship` | 접힌 패널 안에 핵심 정보/CTA가 숨어 있는지 판단 가능 | “핵심” 여부는 stage/goal과 함께 봐야 함 |
| `FEEDBACK-SYSTEM-STATUS-001` | `loading_state`, `journey_action_raw.action_kind`, `expected_outcome_hint`, `settle.durationMs` | 클릭/제출 후 처리 상태 안내 부재 후보화 가능 | 느림 자체와 상태 안내 부재를 분리해야 함 |
| `PATH-ACTION-RESULT-001` | `journey_action_raw`, `goal_action_result`, `url_before/after`, `dom_changed`, `toast_text`, `network_result`, `settle_status` | 사용자 행동 후 결과 변화가 있는지 판단 가능 | 모든 클릭에 적용하지 말고 목표 행동 중심으로 제한해야 함 |
| `RELIABILITY-TECH-001` | `network_failure`, `console_error`, `network_timeline`, `browser_health` | action 이후 네트워크 실패/콘솔 오류 후보화 가능 | user-impact 없는 로그성 오류는 필터링 필요 |
| `RELIABILITY-LOADING-STUCK-001` | `page_ready_timing`, `loading_state`, `settle_response`, `duration_ms`, `target_page_signals` | 일반 navigation/submit 후 usable state 지연 판단 가능 | streaming/map/webgl/auth/payment 예외 신호를 적용해야 함 |
| `PERF-LCP-SLOW-001` | `performance_metric.summary.largest_contentful_paint_ms` | LCP metric 기준 후보화 가능 | `capture_performance=true`일 때만 수집됨 |
| `PERF-INP-SLOW-001` | `performance_metric.summary.interaction_to_next_paint_ms`, action latency | interaction latency 후보화 가능 | 실제 INP 대표값과는 수집 window 차이가 있을 수 있음 |
| `PERF-CLS-SHIFT-001` | `performance_metric.summary.cumulative_layout_shift` | CLS metric 기준 후보화 가능 | 어떤 요소가 밀렸는지는 추가 분석 필요 |
| `PERF-RENDER-BLOCKING-001` | `performance_metric.summary.render_blocking_resource_count`, `long_task_count` | render-blocking 후보화 가능 | 원인 리소스 상세는 HAR와 함께 봐야 함 |
| `TECH-RESOURCE-FAILURE-001` | `network_timeline.failed_request_count`, `status_code_counts`, `events[]` | failed resource, 4xx/5xx 후보화 가능 | third-party 실패와 핵심 리소스 실패 구분 필요 |
| `CHECKOUT-ORDER-REVIEW-001` | `checkout_context.has_order_summary`, `has_editable_summary`, `has_final_submit`, `final_submit_relation` | 최종 제출 전 review/edit 기회 부재 후보화 가능 | checkout/application/booking 흐름일 때만 적용 |
| `CHECKOUT-LOAD-INDICATOR-001` | `checkout_context.flow_subtype`, `loading_state`, `clicked_submit_disabled`, `action_kind` | 결제/예약/주문 제출 후 loading indicator 부재 판단 가능 | 실제 결제 commit은 정책상 차단되어야 함 |

## 2. Runner 부분 가능 후보

아래 후보는 Runner가 관련 evidence를 일부 제공한다. 하지만 지금 바로 deterministic rule로 만들면 오탐 가능성이 있어, Analyzer 보정이나 Runner 추가 수집을 함께 고려해야 한다.

| 후보 ID | 현재 Runner 근거 | 부족한 점 | 권장 방향 |
| --- | --- | --- | --- |
| `COPY-FLOW-QUALITY-001` | `interactive_components.text/role`, `form_field`, `visible_text_blocks`, optional `ax_tree` | label-role alignment는 의미 판단이 필요함 | GMS semantic 결과와 결합 |
| `COPY-LABEL-INTEGRITY-001` | `screenshot`, `visible_text_blocks`, `text_block_metrics`, `layout_summary` | OCR/시각적 잘림/겹침 판정은 별도 분석 필요 | visual parser 또는 GMS 이미지 판단과 결합 |
| `JOURNEY-GOAL-CTA-MISMATCH-001` | `scenario goal`, `goal_action_candidate`, `journey_action_raw.clicked_text`, `interactive_components` | goal과 CTA 의미 일치 판단은 semantic 필요 | Runner evidence + GMS semantic으로 처리 |
| `A11Y-PAGE-TITLE-001` | `checkpoint.state.title`, `url` | “화면 목적과 title 일치”는 semantic/context 필요 | 비어 있음/중복 title은 deterministic, 목적 불일치는 semantic |
| `A11Y-BYPASS-BLOCKS-001` | optional `ax_tree` summary, `keyboard_focus_state`, `interactive_components` | skip link/main landmark 상세 구조가 충분하지 않음 | AX tree 상세 materialization 필요 |
| `A11Y-HEADING-LABEL-001` | `visible_text_blocks`, `form_field.label_text`, optional `ax_tree.heading_count` | heading hierarchy와 purpose 판단이 부족함 | heading structure observation 추가 권장 |
| `A11Y-LANDMARK-STRUCTURE-001` | optional `ax_tree.landmark_count`, `root_role`, `role_counts` | landmark 상세 목록과 중복/이름 판단 부족 | AX landmark detail을 observation화 |
| `A11Y-IMAGE-ALT-001` | `productImages.alt`, optional `ax_tree`, screenshot | 전체 이미지 목록과 decorative/meaningful 구분 부족 | image_elements observation 추가 권장 |
| `A11Y-DECORATIVE-IMAGE-001` | optional `ax_tree`, screenshot | 장식 이미지 판별 근거 부족 | image classification 필요 |
| `A11Y-REFLOW-001` | viewport 설정, `layout_summary`, `visible_text_blocks`, screenshot | 320px equivalent 비교 실행이 기본 보장되지 않음 | 별도 mobile/narrow viewport scenario로 검증 |
| `A11Y-HOVER-FOCUS-CONTENT-001` | scenario action `hover`, screenshot, focus sampling | hover/focus content의 dismissible/persistent/hoverable 판정 부족 | hover/focus 전후 delta 수집 필요 |
| `A11Y-KEYBOARD-ACCESS-001` | `keyboard_focus_state.focus_order`, `interactive_components` | Enter/Space activation 결과가 없음 | keyboard activation simulation 추가 |
| `A11Y-FOCUS-ORDER-001` | `keyboard_focus_state.focus_order`, component bounds | 시각적 순서와 논리 순서 비교 로직 필요 | Analyzer에서 layout order 비교 |
| `A11Y-FOCUS-NOT-OBSCURED-001` | focus bounds, screenshot, layout | sticky/header/modal occlusion 판정 없음 | occlusion 계산 추가 |
| `A11Y-NAME-ROLE-VALUE-001` | `interactive_components.role/name/value 일부`, optional `ax_tree`, `accordion_state` | custom control state/value 전체 판단 부족 | component_state detail 보강 |
| `A11Y-STATUS-MESSAGE-001` | `toastTexts`, `loading_state.status_text`, `visible_text_blocks`, optional `ax_tree` | `aria-live`, `role=status/alert` 연결 상세가 부족 | live_region observation 추가 |
| `FORM-GROUPING-001` | `form_field.group_level_required_state`, labels, optional `ax_tree` | fieldset/legend 또는 group name 상세가 부족 | form_group observation 추가 |
| `FORM-ERROR-IDENTIFICATION-001` | `submit_required_error`, `form_field`, `loading_state`, scenario submit | invalid field와 error 연결 상세 부족 | invalid/error relation observation 추가 |
| `FORM-ERROR-SUGGESTION-001` | `submit_required_error`, visible text | 오류 수정 방법의 의미 판단 필요 | error text classification 필요 |
| `FORM-ERROR-PROXIMITY-001` | `form_field.bounds`, visible text | error message bounds/field relation이 명시적이지 않음 | error_message bounds 추가 |
| `FORM-INPUT-PRESERVE-001` | checkpoint 전후 `fields`, action log | 오류 submit 전후 비교 scenario가 있어야 함 | submit-error scenario에서 적용 |
| `COMPONENT-MODAL-FOCUS-001` | `keyboard_focus_state.modal_open`, `focus_order.inside_modal` | modal open 직후 initial focus인지 명확하지 않음 | modal open action 전후 focus 비교 |
| `COMPONENT-MODAL-TRAP-001` | `keyboard_focus_state.modal_open`, `focus_order.inside_modal`, `keyboard_trap_candidate` | 정상 modal trap과 탈출 불가 trap 구분 필요 | Escape/close result와 결합 |
| `COMPONENT-MODAL-CLOSE-001` | focus order text, interactive components | close/cancel/Escape 결과가 명시적이지 않음 | close_candidate, escape_result 추가 |
| `COMPONENT-BUTTON-KEYBOARD-001` | `interactive_components.role`, `keyboard_focus_state` | Enter/Space 실행 결과 없음 | keyboard activation simulation 추가 |
| `COMPONENT-STATE-ARIA-001` | `accordion_state`, optional `ax_tree`, DOM role/name 일부 | tab/toggle/dropdown 상태까지 일반화 부족 | component_state observation 보강 |
| `PATH-PRIMARY-ACTION-CLARITY-001` | `interactive_components`, `is_primary_like`, `visual_prominence` | “핵심 행동”의 의미 판단은 goal과 결합 필요 | 기존 `PATH-CTA-001/002`에 흡수 권장 |
| `PATH-CTA-LABEL-SPECIFICITY-001` | `cta text`, `nearby_text`, `scenario goal` | generic label 의미 판단 필요 | 기존 journey/copy rule에 흡수 권장 |
| `PATH-BREADCRUMB-CONTEXT-001` | `breadcrumb`, `visitedUrls`, title, visible headings | 깊은 hierarchy 여부와 current location 의미 판단 필요 | page depth/navigation context 보강 |
| `PATH-CONSISTENT-NAVIGATION-001` | multi-checkpoint interactive labels, visited URLs | 반복 navigation 영역 identity가 명시적이지 않음 | navigation_snapshot 추가 |
| `FEEDBACK-STATUS-MESSAGE-001` | `toastTexts`, `loading_state.status_text`, visible status text | live region/AX 전달 여부 부족 | `A11Y-STATUS-MESSAGE-001`와 같이 live_region 보강 |
| `RECOVERY-UNDO-CANCEL-001` | back/cancel-like components, path navigation | danger action, undo result, confirmation relation 부족 | danger_action/undo/cancel observation 추가 |
| `FEEDBACK-PERMISSION-PROMPT-001` | `page_ready_timing.target_page_signals.has_permission_prompt`, screenshot | 브라우저 native permission prompt 직접 구조화 부족 | permission prompt collector 추가 |
| `TECH-HTTPS-SECURITY-001` | `url`, `network_timeline.events[]` | mixed content/security state 직접 수집 부족 | security_state/mixed_content observation 추가 |
| `TRUST-PAYMENT-SECURITY-CUE-001` | `checkout_context`, visible text, payment form signal | 보안 신뢰 단서 분류가 없음 | trust_signal observation 추가 |
| `TRUST-SENSITIVE-FIELD-EXPLAIN-001` | `form_field.help_text`, `checkout_context`, sensitive input hints | 민감 입력 목적 설명 분류 필요 | sensitive_field observation 추가 |
| `CHECKOUT-COST-CLARITY-001` | `visiblePrices`, `checkout_context.order_summary_text`, `has_order_summary` | 배송비/세금/총액 breakdown 구조화 부족 | cost_breakdown observation 추가 |
| `CHECKOUT-DATA-PERSISTENCE-001` | checkpoint 전후 `fields`, `form_field.value_length` | checkout error/reload 전후 비교 scenario 필요 | submit/reload recovery scenario에서 적용 |

## 3. Runner 추가 수집 필요 후보

아래 후보는 현재 Runner evidence만으로는 핵심 근거가 부족하다. Analyzer보다 Runner collector/contract 추가가 먼저다.

| 후보 ID | 왜 현재 Runner만으로 부족한가 | 필요한 Runner 추가 evidence |
| --- | --- | --- |
| `A11Y-IMAGE-TEXT-001` | 핵심 텍스트가 이미지 안에만 있는지 보려면 OCR 또는 image text 분석이 필요하다. | `ocr_text`, `image_text`, DOM 대체 텍스트 연결 |
| `A11Y-COLOR-ONLY-001` | 색상만으로 상태를 전달하는지 보려면 색상/상태/대체 단서 비교가 필요하다. | `visual_state`, computed color, icon/text redundancy |
| `A11Y-TEXT-CONTRAST-001` | 현재 Runner는 텍스트 foreground/background 대비 ratio를 계산하지 않는다. | `text_contrast` |
| `A11Y-LARGE-TEXT-CONTRAST-001` | 큰 텍스트 대비 ratio와 font size 기준 판정이 필요하다. | `text_contrast`, computed font size |
| `A11Y-NON-TEXT-CONTRAST-001` | 버튼 경계, input border, icon 대비를 직접 계산하지 않는다. | `component_contrast`, `icon_contrast` |
| `A11Y-RESIZE-TEXT-001` | 200% text resize 후 재캡처/비교가 필요하다. | `resize_text_result` |
| `A11Y-TEXT-SPACING-001` | WCAG text spacing 값을 주입한 뒤 레이아웃 손실을 비교해야 한다. | `text_spacing_result` |
| `A11Y-POINTER-CANCEL-001` | pointer down/up/cancel sequence를 시뮬레이션하지 않는다. | `pointer_event_behavior` |
| `FORM-ERROR-SUMMARY-001` | error summary와 field anchor 관계가 구조화되어 있지 않다. | `form_error_summary`, `field_error_links` |
| `FORM-AUTOCOMPLETE-001` | 현재 form field payload에 `autocomplete` attr이 없다. | `autocomplete_attr`, `input_purpose` |
| `FORM-PASTE-BLOCKED-001` | paste simulation을 수행하지 않는다. | `paste_simulation` |
| `COMPONENT-MODAL-RETURN-FOCUS-001` | modal close 후 focus return을 비교하지 않는다. | `modal_close_result`, `focus_return_target` |
| `PATH-PAGINATION-CLARITY-001` | pagination component/current/next/prev 상태가 별도 구조화되어 있지 않다. | `pagination_state` |
| `CHECKOUT-GUEST-OPTION-001` | guest checkout option 여부를 직접 수집하지 않는다. | `guest_checkout_option`, auth requirement signal |

## 4. 전체 후보 매핑

아래 표는 1번 후보 전체를 Runner evidence 기준으로 다시 매핑한 것이다.

| 후보 ID | Runner 판정 | 핵심 근거 또는 부족한 점 |
| --- | --- | --- |
| `PATH-CTA-001` | Runner 사용 가능 | `interactive_components`, `goal_action_candidate` |
| `PATH-CTA-002` | Runner 사용 가능 | `primary_like_component_count`, `is_primary_like` |
| `PATH-CHOICE-OVERLOAD-001` | Runner 사용 가능 | `interactive_components.components[]`, `container_bounds` |
| `FRICTION-FORM-001` | Runner 사용 가능 | `form_field.label_text`, `accessible_name`, `placeholder` |
| `COPY-FLOW-QUALITY-001` | Runner 부분 가능 | label-role semantic 판단 필요 |
| `COPY-LABEL-INTEGRITY-001` | Runner 부분 가능 | OCR/시각 분석 필요 |
| `RELIABILITY-TECH-001` | Runner 사용 가능 | `network_failure`, `console_error`, `network_timeline` |
| `RELIABILITY-LOADING-STUCK-001` | Runner 사용 가능 | `page_ready_timing`, `loading_state`, `settle` |
| `JOURNEY-GOAL-CTA-MISMATCH-001` | Runner 부분 가능 | scenario/action evidence는 있으나 semantic 필요 |
| `A11Y-PAGE-TITLE-001` | Runner 부분 가능 | title은 있으나 목적 일치 판단 필요 |
| `A11Y-BYPASS-BLOCKS-001` | Runner 부분 가능 | AX summary/keyboard 일부, skip link 구조 부족 |
| `A11Y-HEADING-LABEL-001` | Runner 부분 가능 | heading/label 일부, hierarchy 판단 부족 |
| `A11Y-LINK-PURPOSE-001` | Runner 사용 가능 | `nearby_text`, `container_heading`, generic link grouping |
| `A11Y-LANDMARK-STRUCTURE-001` | Runner 부분 가능 | AX summary는 있으나 landmark detail 부족 |
| `A11Y-IMAGE-ALT-001` | Runner 부분 가능 | product image/AX 일부, 전체 image list 부족 |
| `A11Y-DECORATIVE-IMAGE-001` | Runner 부분 가능 | decorative classification 부족 |
| `A11Y-IMAGE-TEXT-001` | Runner 추가 수집 필요 | OCR/image text 필요 |
| `A11Y-COLOR-ONLY-001` | Runner 추가 수집 필요 | color/state redundancy 필요 |
| `A11Y-TEXT-CONTRAST-001` | Runner 추가 수집 필요 | contrast ratio 필요 |
| `A11Y-LARGE-TEXT-CONTRAST-001` | Runner 추가 수집 필요 | large text contrast ratio 필요 |
| `A11Y-NON-TEXT-CONTRAST-001` | Runner 추가 수집 필요 | component/icon contrast 필요 |
| `A11Y-RESIZE-TEXT-001` | Runner 추가 수집 필요 | 200% resize 재수집 필요 |
| `A11Y-REFLOW-001` | Runner 부분 가능 | viewport evidence는 있으나 narrow comparison 필요 |
| `A11Y-TEXT-SPACING-001` | Runner 추가 수집 필요 | text spacing mutation 비교 필요 |
| `A11Y-HOVER-FOCUS-CONTENT-001` | Runner 부분 가능 | hover/focus delta와 dismissible 판정 부족 |
| `A11Y-KEYBOARD-ACCESS-001` | Runner 부분 가능 | focus traversal은 있으나 activation 결과 부족 |
| `A11Y-KEYBOARD-TRAP-001` | Runner 사용 가능 | `keyboard_trap_candidate`, `focus_order` |
| `A11Y-FOCUS-ORDER-001` | Runner 부분 가능 | focus order는 있으나 visual order 비교 필요 |
| `A11Y-FOCUS-VISIBLE-001` | Runner 사용 가능 | `focus_order[].visible_focus` |
| `A11Y-FOCUS-NOT-OBSCURED-001` | Runner 부분 가능 | focus bounds는 있으나 occlusion 판단 부족 |
| `A11Y-TARGET-SIZE-001` | Runner 사용 가능 | `components[].bounds` |
| `A11Y-TARGET-SPACING-001` | Runner 사용 가능 | `nearest_target_spacing_px` |
| `A11Y-POINTER-CANCEL-001` | Runner 추가 수집 필요 | pointer event sequence 필요 |
| `A11Y-LABEL-IN-NAME-001` | Runner 사용 가능 | `visible_text`, `accessible_name` |
| `A11Y-NAME-ROLE-VALUE-001` | Runner 부분 가능 | name/role 일부, state/value 일반화 부족 |
| `A11Y-STATUS-MESSAGE-001` | Runner 부분 가능 | status text는 있으나 live region 부족 |
| `FORM-INSTRUCTIONS-001` | Runner 사용 가능 | `help_text`, `describedby_text`, constraints |
| `FORM-PLACEHOLDER-ONLY-001` | Runner 사용 가능 | `label_text`, `accessible_name`, `placeholder` |
| `FORM-REQUIRED-OPTIONAL-001` | Runner 사용 가능 | `required`, visible required/optional markers |
| `FORM-GROUPING-001` | Runner 부분 가능 | group required 일부, group label 부족 |
| `FORM-ERROR-IDENTIFICATION-001` | Runner 부분 가능 | submit error 일부, invalid relation 부족 |
| `FORM-ERROR-SUGGESTION-001` | Runner 부분 가능 | error text semantic 필요 |
| `FORM-ERROR-PROXIMITY-001` | Runner 부분 가능 | field bounds는 있으나 error bounds 부족 |
| `FORM-ERROR-SUMMARY-001` | Runner 추가 수집 필요 | error summary/link 구조 필요 |
| `FORM-INPUT-PRESERVE-001` | Runner 부분 가능 | 전후 fields 비교 scenario 필요 |
| `FORM-AUTOCOMPLETE-001` | Runner 추가 수집 필요 | `autocomplete` attr 미수집 |
| `FORM-PASTE-BLOCKED-001` | Runner 추가 수집 필요 | paste simulation 미수행 |
| `COMPONENT-MODAL-FOCUS-001` | Runner 부분 가능 | modal focus 일부, initial focus 비교 부족 |
| `COMPONENT-MODAL-TRAP-001` | Runner 부분 가능 | trap/background 접근 일부 판단 가능 |
| `COMPONENT-MODAL-CLOSE-001` | Runner 부분 가능 | close candidate/escape result 부족 |
| `COMPONENT-MODAL-RETURN-FOCUS-001` | Runner 추가 수집 필요 | close 후 focus return 미수집 |
| `COMPONENT-BUTTON-KEYBOARD-001` | Runner 부분 가능 | keyboard activation 결과 부족 |
| `COMPONENT-STATE-ARIA-001` | Runner 부분 가능 | accordion state 일부, 일반 component state 부족 |
| `COMPONENT-ACCORDION-DISCOVERABILITY-001` | Runner 사용 가능 | `accordion_state.hidden_panel_has_*` |
| `PATH-PRIMARY-ACTION-CLARITY-001` | Runner 부분 가능 | existing CTA rule 흡수 권장 |
| `PATH-CTA-LABEL-SPECIFICITY-001` | Runner 부분 가능 | semantic 판단 필요 |
| `PATH-BACK-LINK-001` | Runner 사용 가능 | `path_navigation` |
| `PATH-BREADCRUMB-CONTEXT-001` | Runner 부분 가능 | breadcrumb는 있으나 hierarchy/context 판단 필요 |
| `PATH-PAGINATION-CLARITY-001` | Runner 추가 수집 필요 | pagination state 필요 |
| `PATH-CONSISTENT-NAVIGATION-001` | Runner 부분 가능 | multi-checkpoint 비교 가능하나 nav identity 부족 |
| `PATH-ACTION-RESULT-001` | Runner 사용 가능 | `journey_action_raw`, `goal_action_result` |
| `FEEDBACK-SYSTEM-STATUS-001` | Runner 사용 가능 | `loading_state` |
| `FEEDBACK-STATUS-MESSAGE-001` | Runner 부분 가능 | visible status는 있으나 live region 부족 |
| `RECOVERY-UNDO-CANCEL-001` | Runner 부분 가능 | cancel/back 일부, danger/undo relation 부족 |
| `FEEDBACK-PERMISSION-PROMPT-001` | Runner 부분 가능 | text signal은 있으나 native permission prompt 부족 |
| `PERF-LCP-SLOW-001` | Runner 사용 가능 | `performance_metric.largest_contentful_paint_ms` |
| `PERF-INP-SLOW-001` | Runner 사용 가능 | `interaction_to_next_paint_ms`, action latency |
| `PERF-CLS-SHIFT-001` | Runner 사용 가능 | `cumulative_layout_shift` |
| `PERF-RENDER-BLOCKING-001` | Runner 사용 가능 | `render_blocking_resource_count`, `long_task_count` |
| `TECH-RESOURCE-FAILURE-001` | Runner 사용 가능 | `network_timeline`, `network_failure` |
| `TECH-HTTPS-SECURITY-001` | Runner 부분 가능 | URL/network 일부, security state 부족 |
| `TRUST-PAYMENT-SECURITY-CUE-001` | Runner 부분 가능 | checkout/payment signal 일부, trust cue 분류 부족 |
| `TRUST-SENSITIVE-FIELD-EXPLAIN-001` | Runner 부분 가능 | sensitive field/help text 일부, 목적 설명 분류 필요 |
| `CHECKOUT-ORDER-REVIEW-001` | Runner 사용 가능 | `checkout_context` |
| `CHECKOUT-GUEST-OPTION-001` | Runner 추가 수집 필요 | guest checkout option 미수집 |
| `CHECKOUT-LOAD-INDICATOR-001` | Runner 사용 가능 | `checkout_context`, `loading_state` |
| `CHECKOUT-COST-CLARITY-001` | Runner 부분 가능 | order summary/price 일부, cost breakdown 부족 |
| `CHECKOUT-DATA-PERSISTENCE-001` | Runner 부분 가능 | fields 전후 비교 scenario 필요 |

## 5. 후속 작업 기준

다음 단계인 **3. Analyzer 분석 가능 여부 확인**에서는 이 문서를 그대로 이어받아 다음을 판단하면 된다.

1. `Runner 사용 가능` 후보 중 현재 Analyzer handler로 바로 연결 가능한 룰
2. `Runner 사용 가능`이지만 신규 Analyzer handler가 필요한 룰
3. `Runner 부분 가능` 후보 중 GMS/시각 분석/추가 observation 없이도 MVP로 낮은 confidence issue를 만들 수 있는 룰
4. `Runner 추가 수집 필요` 후보 중 Runner collector backlog로 올릴 항목

현 시점에서 Analyzer 후보 도출의 1차 우선순위는 다음이 가장 안전하다.

| 우선순위 | 후보 |
| --- | --- |
| 1 | `PATH-ACTION-RESULT-001`, `FEEDBACK-SYSTEM-STATUS-001` |
| 2 | `FORM-INSTRUCTIONS-001`, `FORM-REQUIRED-OPTIONAL-001`, `A11Y-LINK-PURPOSE-001` |
| 3 | `PATH-BACK-LINK-001`, `COMPONENT-ACCORDION-DISCOVERABILITY-001` |
| 4 | `CHECKOUT-ORDER-REVIEW-001`, `CHECKOUT-LOAD-INDICATOR-001` |
| 5 | `PERF-*`, `TECH-RESOURCE-FAILURE-001` |
