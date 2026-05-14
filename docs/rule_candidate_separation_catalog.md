# Wedge RuleRegistry형 룰 후보 도감

## 문서 목적

이 문서는 팀장 지시 업무 중 **1. 룰 후보 분리**에 해당하는 산출물이다.

목표는 공신력 있는 레퍼런스에서 만들 수 있는 룰 후보를 정리하되, 현재 Wedge의 룰 사용 구조에 맞춰 후속 구현자가 바로 검토할 수 있는 형태로 만드는 것이다.

이 문서는 아직 다음을 판단하지 않는다.

- 현재 Runner가 evidence를 제공하는지
- 현재 Analyzer handler가 이미 있는지
- 지금 바로 구현 가능한지
- 최종 구현 / 보류 / 제외 여부

다만 Wedge 룰 구조와 맞추기 위해 각 후보는 `RuleRegistry 0.5`에 가까운 필드로 정리한다.

## 현재 Wedge 룰 사용 구조 요약

현재 Analyzer Rule Engine은 다음 흐름으로 동작한다.

```text
RuleRegistry JSON
→ RuleEngine
→ criterion_id별 handler
→ RuleHit
→ JudgeResult issues[]
→ Spring projection(rule_hit, analysis_finding, nudge)
→ Report
```

중요한 제약은 다음과 같다.

| 항목 | 현재 구조 |
| --- | --- |
| Registry schema | `schema_version: 0.5` |
| 룰 식별자 | `criterion_id` |
| 실행 단위 | `applicableStages`의 각 `StageContext` |
| Stage enum | `FIRST_VIEW`, `VALUE`, `CTA`, `INPUT`, `COMMIT` |
| Axis enum | `Clarity`, `Path`, `Friction`, `Trust`, `Reliability`, `Visual Integrity` |
| Evidence level enum | `Standard`, `Research-backed`, `Expert Guide`, `Operational`, `Technical` |
| Measurement source enum | `dom`, `layout`, `screenshot`, `ax`, `network`, `console`, `performance`, `scenario_log` |
| Issue 필수 조건 | `evidence_refs`가 있는 `RuleHit`만 사용자-facing issue가 됨 |
| LLM/GMS 역할 | Rule 결과 대체가 아니라 의미 분류, label-role, label-integrity, 설명 보조 |
| 외부 근거 | `references[]` 구조로 issue에 복사 가능 |

현재 registry rule 필드는 다음 형태를 따른다.

```json
{
  "criterion_id": "FRICTION-FORM-001",
  "axis": "Friction",
  "applicableStages": ["INPUT"],
  "evidence_level": "Standard",
  "definition": "...",
  "required_observations": ["form_field"],
  "measurement_sources": ["dom", "ax", "layout"],
  "signal_rule": "...",
  "severity_rules": [
    { "severity": 0, "condition": "..." },
    { "severity": 2, "condition": "..." }
  ],
  "confidence_rule": "...",
  "output_template": "...",
  "references": [
    {
      "label": "WCAG 3.3.2",
      "publisher": "W3C",
      "title": "Labels or Instructions",
      "basisSummary": "...",
      "url": "https://www.w3.org/WAI/WCAG22/Understanding/labels-or-instructions.html"
    }
  ]
}
```

따라서 이 도감도 단순 아이디어명이 아니라 **registry 후보 초안**으로 읽을 수 있게 정리한다.

## 도감 필드

| 필드 | 의미 |
| --- | --- |
| 후보 ID | registry에 들어갈 수 있는 `criterion_id` 후보 |
| Axis | Wedge axis enum 후보 |
| Stages | 적용 가능한 DecisionStage 후보 |
| Evidence level | 외부 기준 성격에 맞춘 evidence level 후보 |
| Definition | registry `definition` 후보 |
| Required observations | 필요한 observation type 후보. 현재 존재 여부는 다음 문서에서 판단 |
| Measurement sources | 필요한 measurement source 후보 |
| Signal rule | issue를 만들 수 있는 핵심 신호 |
| Severity sketch | severity 0~3 초안 |
| Reference | report badge에 붙일 수 있는 외부 근거 |

## Reference ID

반복을 줄이기 위해 후보 표에서는 reference ID를 사용한다.

| Ref ID | Label | Publisher | Title | URL |
| --- | --- | --- | --- | --- |
| `WCAG-1.1.1` | WCAG 1.1.1 | W3C | Non-text Content | https://www.w3.org/WAI/WCAG22/Understanding/non-text-content.html |
| `WCAG-1.3.5` | WCAG 1.3.5 | W3C | Identify Input Purpose | https://www.w3.org/WAI/WCAG22/Understanding/identify-input-purpose.html |
| `WCAG-1.4.1` | WCAG 1.4.1 | W3C | Use of Color | https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html |
| `WCAG-1.4.3` | WCAG 1.4.3 | W3C | Contrast Minimum | https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html |
| `WCAG-1.4.4` | WCAG 1.4.4 | W3C | Resize Text | https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html |
| `WCAG-1.4.5` | WCAG 1.4.5 | W3C | Images of Text | https://www.w3.org/WAI/WCAG22/Understanding/images-of-text.html |
| `WCAG-1.4.10` | WCAG 1.4.10 | W3C | Reflow | https://www.w3.org/WAI/WCAG22/Understanding/reflow.html |
| `WCAG-1.4.11` | WCAG 1.4.11 | W3C | Non-text Contrast | https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html |
| `WCAG-1.4.12` | WCAG 1.4.12 | W3C | Text Spacing | https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html |
| `WCAG-1.4.13` | WCAG 1.4.13 | W3C | Content on Hover or Focus | https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus.html |
| `WCAG-2.1.1` | WCAG 2.1.1 | W3C | Keyboard | https://www.w3.org/WAI/WCAG22/Understanding/keyboard.html |
| `WCAG-2.1.2` | WCAG 2.1.2 | W3C | No Keyboard Trap | https://www.w3.org/WAI/WCAG22/Understanding/no-keyboard-trap.html |
| `WCAG-2.4.1` | WCAG 2.4.1 | W3C | Bypass Blocks | https://www.w3.org/WAI/WCAG22/Understanding/bypass-blocks.html |
| `WCAG-2.4.2` | WCAG 2.4.2 | W3C | Page Titled | https://www.w3.org/WAI/WCAG22/Understanding/page-titled.html |
| `WCAG-2.4.3` | WCAG 2.4.3 | W3C | Focus Order | https://www.w3.org/WAI/WCAG22/Understanding/focus-order.html |
| `WCAG-2.4.4` | WCAG 2.4.4 | W3C | Link Purpose | https://www.w3.org/WAI/WCAG22/Understanding/link-purpose-in-context.html |
| `WCAG-2.4.6` | WCAG 2.4.6 | W3C | Headings and Labels | https://www.w3.org/WAI/WCAG22/Understanding/headings-and-labels.html |
| `WCAG-2.4.7` | WCAG 2.4.7 | W3C | Focus Visible | https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html |
| `WCAG-2.4.8` | WCAG 2.4.8 | W3C | Location | https://www.w3.org/WAI/WCAG22/Understanding/location.html |
| `WCAG-2.4.11` | WCAG 2.4.11 | W3C | Focus Not Obscured | https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html |
| `WCAG-2.5.2` | WCAG 2.5.2 | W3C | Pointer Cancellation | https://www.w3.org/WAI/WCAG22/Understanding/pointer-cancellation.html |
| `WCAG-2.5.3` | WCAG 2.5.3 | W3C | Label in Name | https://www.w3.org/WAI/WCAG22/Understanding/label-in-name.html |
| `WCAG-2.5.8` | WCAG 2.5.8 | W3C | Target Size Minimum | https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html |
| `WCAG-3.2.3` | WCAG 3.2.3 | W3C | Consistent Navigation | https://www.w3.org/WAI/WCAG22/Understanding/consistent-navigation.html |
| `WCAG-3.3.1` | WCAG 3.3.1 | W3C | Error Identification | https://www.w3.org/WAI/WCAG22/Understanding/error-identification.html |
| `WCAG-3.3.2` | WCAG 3.3.2 | W3C | Labels or Instructions | https://www.w3.org/WAI/WCAG22/Understanding/labels-or-instructions.html |
| `WCAG-3.3.3` | WCAG 3.3.3 | W3C | Error Suggestion | https://www.w3.org/WAI/WCAG22/Understanding/error-suggestion.html |
| `WCAG-3.3.4` | WCAG 3.3.4 | W3C | Error Prevention | https://www.w3.org/WAI/WCAG22/Understanding/error-prevention-legal-financial-data.html |
| `WCAG-4.1.2` | WCAG 4.1.2 | W3C | Name Role Value | https://www.w3.org/WAI/WCAG22/Understanding/name-role-value.html |
| `WCAG-4.1.3` | WCAG 4.1.3 | W3C | Status Messages | https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html |
| `WAI-FORMS` | WAI Forms | W3C WAI | Forms Tutorial | https://www.w3.org/WAI/tutorials/forms/ |
| `WAI-DIALOG` | WAI-ARIA Dialog | W3C WAI | Dialog Modal Pattern | https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/ |
| `GOVUK-ERROR` | GOV.UK Error Message | GOV.UK | Error message component | https://design-system.service.gov.uk/components/error-message/ |
| `GOVUK-TEXT-INPUT` | GOV.UK Text Input | GOV.UK | Text input component | https://design-system.service.gov.uk/components/text-input/ |
| `GOVUK-BUTTON` | GOV.UK Button | GOV.UK | Button component | https://design-system.service.gov.uk/components/button/ |
| `USWDS-FORM` | USWDS Form | USWDS | Form components | https://designsystem.digital.gov/components/form/ |
| `USWDS-VALIDATION` | USWDS Validation | USWDS | Validation component | https://designsystem.digital.gov/components/validation/ |
| `LIGHTHOUSE-A11Y` | Lighthouse Accessibility | Chrome | Accessibility audits | https://developer.chrome.com/docs/lighthouse/accessibility/ |
| `LIGHTHOUSE-TAP` | Lighthouse Tap Targets | Chrome | Tap targets are not sized appropriately | https://developer.chrome.com/docs/lighthouse/seo/tap-targets |
| `LIGHTHOUSE-BP` | Lighthouse Best Practices | Chrome | Best practices audits | https://developer.chrome.com/docs/lighthouse/best-practices/ |
| `WEB-VITALS` | Core Web Vitals | web.dev | Web Vitals | https://web.dev/articles/vitals |
| `NNG-HEURISTICS` | NN/g Heuristics | NN/g | 10 Usability Heuristics | https://www.nngroup.com/articles/ten-usability-heuristics/ |
| `BAYMARD-CHECKOUT` | Baymard Checkout | Baymard | Checkout usability research | https://baymard.com/research/checkout-usability |
| `BAYMARD-SECURITY` | Baymard Security | Baymard | Perceived security of payment forms | https://baymard.com/blog/perceived-security-of-payment-form |

## 1. 현재 운영 룰과 직접 연결되는 후보

이 섹션은 현재 registry에 이미 있거나, 기존 rule을 확장/분리하는 후보이다. 후속 구현 시 신규 criterion으로 만들지 기존 rule에 흡수할지 먼저 판단해야 한다.

| 후보 ID | Axis | Stages | Evidence level | Definition | Required observations | Measurement sources | Signal rule | Severity sketch | Reference |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `PATH-CTA-001` | Path | FIRST_VIEW, CTA | Operational | 목표 관련 핵심 행동 진입점이 보이는지 판단한다. | `cta_candidate`, `cta_cluster`, `interactive_components`, `scenario_goal` | dom, layout, screenshot, ax | goal-relevant primary-like CTA가 없다. | 0: CTA 있음 / 1: 약한 CTA만 있음 / 2: CTA stage에 핵심 CTA 없음 / 3: 진입점 차단 | NNG-HEURISTICS, GOVUK-BUTTON |
| `PATH-CTA-002` | Path | CTA | Operational | 같은 결정 순간에서 primary-like CTA가 과도하게 경쟁하는지 판단한다. | `cta_cluster`, `interactive_components`, `visual_emphasis` | dom, layout, screenshot | `primary_like_cta_count >= 3` | 0: 0~2개 / 2: 3개 이상 | GOVUK-BUTTON, NNG-HEURISTICS |
| `PATH-CHOICE-OVERLOAD-001` | Path | FIRST_VIEW, VALUE, CTA | Operational | 한 viewport 또는 decision area에 선택지가 과도하게 많은지 판단한다. | `interactive_components`, `decision_area` | dom, layout | countable visible interactive components가 threshold 이상이다. | 0: 10 이하 / 1: 11 이상 / 2: 15 이상 / 3: 핵심 stage에서 20 이상 | NNG-HEURISTICS |
| `FRICTION-FORM-001` | Friction | INPUT | Standard | visible input field가 label, accessible name, instruction을 제공하는지 판단한다. | `form_field`, `missing_label`, `instruction_text` | dom, ax, screenshot | label/accessibility name이 없거나 placeholder-only다. | 0: 명확함 / 1: placeholder-only / 2: label 없음 | WCAG-3.3.2, WAI-FORMS |
| `COPY-FLOW-QUALITY-001` | Clarity | FIRST_VIEW, VALUE, CTA, INPUT, COMMIT | Standard | visible label이 요소 역할, 기능, 주변 맥락과 맞는지 판단한다. | `label_role_alignment`, `cta_candidate`, `interactive_components`, `form_field` | screenshot, dom, layout, ax | GMS label-role alignment가 mismatch다. | 0: aligned / 1: low-impact mismatch / 2: 주요 요소 mismatch / 3: commit-stage high-leverage mismatch | WCAG-2.4.6, NNG-HEURISTICS |
| `COPY-LABEL-INTEGRITY-001` | Clarity | FIRST_VIEW, VALUE, CTA, INPUT, COMMIT | Standard | 짧은 라벨과 문구가 깨짐, 잘림, 겹침 없이 읽히는지 판단한다. | `label_integrity`, `screenshot`, `text_rendering` | screenshot, dom, layout, ax | integrity issue type이 허용 목록에 포함된다. | 0: 문제 없음 / 1: 낮은 영향 / 2: 깨짐·잘림·겹침 / 3: commit-stage high-leverage | WCAG-1.4.4, WCAG-1.4.10 |
| `RELIABILITY-TECH-001` | Reliability | CTA, INPUT, COMMIT | Technical | 사용자 행동 직후 네트워크 실패나 콘솔 오류가 있는지 판단한다. | `network_failure`, `console_error`, `checkpoint_state` | network, console, scenario_log | action-attributed failed request 또는 console error가 있다. | 0: 없음 / 2: 오류 1건 이상 | LIGHTHOUSE-BP |
| `RELIABILITY-LOADING-STUCK-001` | Reliability | CTA, INPUT, COMMIT | Operational | 일반 navigation 후 다음 화면이 usable state가 되기까지 오래 걸리는지 판단한다. | `page_ready_timing`, `loading_state`, `settle_response` | performance, dom, layout, scenario_log | 일반 navigation duration이 5000ms 이상이고 예외 신호가 없다. | 0: 5초 미만 / 2: 5초 이상 / 3: 8초 이상 또는 commit delay | WEB-VITALS, NNG-HEURISTICS |
| `JOURNEY-GOAL-CTA-MISMATCH-001` | Path | VALUE, CTA, COMMIT | Operational | 선택된 CTA가 scenario goal과 의미적으로 맞는지 판단한다. | `cta_candidate`, `scenario_goal`, `semantic_label` | dom, ax, scenario_log | clicked CTA가 low scenario relevance label을 가진다. | 0: 직접 관련 / 1: 약한 관련 / 2: 무관 | NNG-HEURISTICS |

## 2. Standard 기반 접근성 룰 후보

WCAG/WAI 기준은 측정 가능하면 `Hard` 성격의 RuleHit으로 만들 수 있다. Wedge registry에서는 `evidence_level=Standard`가 우선이다.

| 후보 ID | Axis | Stages | Evidence level | Definition | Required observations | Measurement sources | Signal rule | Severity sketch | Reference |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `A11Y-PAGE-TITLE-001` | Clarity | FIRST_VIEW, VALUE | Standard | page title이 현재 화면 목적을 설명하는지 판단한다. | `page_metadata`, `page_title` | dom, ax | title이 비어 있거나 모든 화면에서 동일하거나 화면 목적과 불일치한다. | 0: 목적 설명 / 1: 일반적 title / 2: 비어 있음 또는 오해 유발 | WCAG-2.4.2 |
| `A11Y-BYPASS-BLOCKS-001` | Friction | FIRST_VIEW, VALUE | Standard | 반복되는 header/nav를 건너뛸 수 있는 수단이 있는지 판단한다. | `landmark_structure`, `skip_link`, `keyboard_navigation` | dom, ax, layout | skip link, main landmark, navigation bypass 수단이 없다. | 0: 우회 가능 / 1: landmark만 있음 / 2: 우회 수단 없음 | WCAG-2.4.1 |
| `A11Y-HEADING-LABEL-001` | Clarity | FIRST_VIEW, VALUE, INPUT | Standard | heading과 label이 topic/purpose를 설명하는지 판단한다. | `heading_structure`, `form_field`, `label_role_alignment` | dom, ax, screenshot | heading/label이 비어 있거나 목적 설명이 부족하다. | 0: 명확 / 1: 모호 / 2: 주요 영역 purpose 불명확 | WCAG-2.4.6 |
| `A11Y-LINK-PURPOSE-001` | Clarity | FIRST_VIEW, VALUE, CTA | Standard | 링크 텍스트가 문맥상 목적을 설명하는지 판단한다. | `interactive_components`, `nearby_text`, `container_heading`, `link_target` | dom, ax, layout | 반복 generic link가 주변 문맥 없이 목적을 설명하지 못한다. | 0: 목적 명확 / 1: 문맥 필요 / 2: 목적 불명확한 링크 반복 | WCAG-2.4.4 |
| `A11Y-LANDMARK-STRUCTURE-001` | Clarity | FIRST_VIEW, VALUE | Standard | main/nav/header/footer 등 landmark가 페이지 구조를 설명하는지 판단한다. | `landmark_structure`, `dom_regions` | dom, ax | main landmark가 없거나 navigation landmark가 혼란스럽다. | 0: 구조 명확 / 1: 일부 부족 / 2: 주요 landmark 누락 | WAI-FORMS, LIGHTHOUSE-A11Y |
| `A11Y-IMAGE-ALT-001` | Clarity | FIRST_VIEW, VALUE, CTA | Standard | 의미 있는 이미지, 아이콘, 이미지 버튼에 대체 텍스트가 있는지 판단한다. | `image_elements`, `interactive_components`, `ax_snapshot` | dom, ax, screenshot | meaningful image/control에 alt 또는 accessible name이 없다. | 0: 적절 / 1: 모호 / 2: 의미 이미지 alt 없음 / 3: 이미지 버튼 name 없음 | WCAG-1.1.1, LIGHTHOUSE-A11Y |
| `A11Y-DECORATIVE-IMAGE-001` | Clarity | FIRST_VIEW, VALUE | Standard | 장식 이미지가 보조기술에서 불필요하게 읽히지 않는지 판단한다. | `image_elements`, `ax_snapshot` | dom, ax | decorative image에 파일명/무의미 alt가 노출된다. | 0: 숨김 적절 / 1: 의미 약한 alt / 2: 파일명 노출 | WCAG-1.1.1 |
| `A11Y-IMAGE-TEXT-001` | Clarity | FIRST_VIEW, VALUE, CTA | Standard | 핵심 텍스트가 이미지에만 포함되지 않는지 판단한다. | `image_text`, `visible_text_blocks`, `ocr_text` | screenshot, dom | CTA/가격/핵심 설명이 이미지에만 있고 DOM 텍스트 대체가 없다. | 0: 텍스트 대체 있음 / 1: 보조 이미지 텍스트 / 2: 핵심 정보 이미지 전용 | WCAG-1.4.5 |
| `A11Y-COLOR-ONLY-001` | Clarity | FIRST_VIEW, VALUE, INPUT, COMMIT | Standard | 색상만으로 상태나 의미를 전달하지 않는지 판단한다. | `visual_state`, `form_error`, `status_message`, `required_field` | dom, layout, screenshot, ax | 오류/성공/필수/선택 상태가 색상만으로 표현된다. | 0: 다중 단서 / 1: 색상 중심 / 2: 색상만 사용 | WCAG-1.4.1 |
| `A11Y-TEXT-CONTRAST-001` | Visual Integrity | FIRST_VIEW, VALUE, CTA, INPUT, COMMIT | Standard | 일반 텍스트 대비가 기준 이상인지 판단한다. | `text_contrast`, `visible_text_blocks` | screenshot, layout, dom | 일반 텍스트 대비가 4.5:1 미만이다. | 0: 통과 / 1: 경계값 / 2: 기준 미달 / 3: 핵심 CTA/입력 문구 기준 미달 | WCAG-1.4.3 |
| `A11Y-LARGE-TEXT-CONTRAST-001` | Visual Integrity | FIRST_VIEW, VALUE, CTA | Standard | 큰 텍스트 대비가 기준 이상인지 판단한다. | `text_contrast`, `heading_structure` | screenshot, layout, dom | 큰 텍스트 대비가 3:1 미만이다. | 0: 통과 / 1: 경계값 / 2: 기준 미달 | WCAG-1.4.3 |
| `A11Y-NON-TEXT-CONTRAST-001` | Visual Integrity | FIRST_VIEW, VALUE, CTA, INPUT, COMMIT | Standard | UI 컴포넌트와 의미 있는 그래픽 대비가 충분한지 판단한다. | `component_contrast`, `interactive_components`, `icon_button` | screenshot, layout, dom | 버튼 경계, input border, icon, selected state 대비가 3:1 미만이다. | 0: 통과 / 1: 보조 요소 부족 / 2: 주요 컨트롤 부족 | WCAG-1.4.11 |
| `A11Y-RESIZE-TEXT-001` | Visual Integrity | FIRST_VIEW, VALUE, CTA, INPUT | Standard | 텍스트 확대 시 정보와 기능이 손실되지 않는지 판단한다. | `resize_text_result`, `label_integrity` | screenshot, layout, dom | 200% 확대 후 텍스트가 잘리거나 겹친다. | 0: 손실 없음 / 1: 보조 문구 손실 / 2: 주요 기능 문구 손실 | WCAG-1.4.4 |
| `A11Y-REFLOW-001` | Visual Integrity | FIRST_VIEW, VALUE, CTA, INPUT | Standard | 작은 viewport나 확대 환경에서 가로 스크롤 없이 사용할 수 있는지 판단한다. | `responsive_layout`, `viewport_overflow` | layout, screenshot, dom | 320px equivalent 폭에서 주요 콘텐츠가 viewport 밖으로 밀린다. | 0: reflow 가능 / 1: 일부 overflow / 2: 주요 기능 overflow | WCAG-1.4.10 |
| `A11Y-TEXT-SPACING-001` | Visual Integrity | FIRST_VIEW, VALUE, CTA, INPUT | Standard | 텍스트 간격 조정 시 내용이 손실되지 않는지 판단한다. | `text_spacing_result`, `label_integrity` | screenshot, layout, dom | spacing 변경 후 라벨/버튼/카드 텍스트가 잘리거나 겹친다. | 0: 손실 없음 / 1: 보조 문구 손실 / 2: 주요 문구 손실 | WCAG-1.4.12 |
| `A11Y-HOVER-FOCUS-CONTENT-001` | Friction | VALUE, CTA, INPUT | Standard | hover/focus로 나타나는 콘텐츠를 닫고 유지하고 접근할 수 있는지 판단한다. | `hover_content`, `focus_content`, `keyboard_navigation` | dom, layout, screenshot, ax | tooltip/popover가 닫기 어렵거나 hover 이동 중 사라지거나 다른 콘텐츠를 가린다. | 0: dismissible/hoverable/persistent / 1: 일부 미흡 / 2: 핵심 정보 접근 불가 | WCAG-1.4.13 |
| `A11Y-KEYBOARD-ACCESS-001` | Friction | CTA, INPUT, COMMIT | Standard | 주요 기능을 키보드로 사용할 수 있는지 판단한다. | `keyboard_traversal`, `interactive_components` | dom, ax, scenario_log | clickable control이 Tab 접근 또는 Enter/Space activation을 지원하지 않는다. | 0: 가능 / 1: 일부 보조 기능 불가 / 2: 주요 기능 불가 | WCAG-2.1.1 |
| `A11Y-KEYBOARD-TRAP-001` | Reliability | CTA, INPUT, COMMIT | Standard | 키보드 포커스가 특정 컴포넌트에 갇히지 않는지 판단한다. | `keyboard_traversal`, `modal_state`, `focus_escape_result` | dom, ax, scenario_log | Tab/Escape로 빠져나올 수 없는 focus trap이 있다. | 0: 탈출 가능 / 2: trap 발생 / 3: commit/input flow 차단 | WCAG-2.1.2 |
| `A11Y-FOCUS-ORDER-001` | Friction | FIRST_VIEW, VALUE, CTA, INPUT, COMMIT | Standard | 포커스 순서가 시각적/논리적 흐름과 맞는지 판단한다. | `focus_order`, `interactive_components` | dom, ax, layout | Tab 순서가 화면 흐름과 크게 어긋난다. | 0: 논리적 / 1: 약한 어긋남 / 2: 주요 흐름 어긋남 | WCAG-2.4.3 |
| `A11Y-FOCUS-VISIBLE-001` | Friction | CTA, INPUT, COMMIT | Standard | 키보드 포커스가 시각적으로 보이는지 판단한다. | `focus_indicator`, `keyboard_traversal` | screenshot, layout, dom | active element의 focus indicator가 없거나 보이지 않는다. | 0: 명확 / 1: 약함 / 2: 주요 컨트롤 focus invisible | WCAG-2.4.7 |
| `A11Y-FOCUS-NOT-OBSCURED-001` | Friction | CTA, INPUT, COMMIT | Standard | 포커스된 요소가 sticky header/modal 등으로 가려지지 않는지 판단한다. | `focus_indicator`, `viewport_occlusion` | screenshot, layout, dom | focused element가 다른 레이어에 의해 가려진다. | 0: 가려지지 않음 / 1: 일부 가림 / 2: 주요 요소 가림 | WCAG-2.4.11 |
| `A11Y-TARGET-SIZE-001` | Friction | FIRST_VIEW, VALUE, CTA, INPUT | Standard | 클릭/터치 타깃 크기가 충분한지 판단한다. | `interactive_components`, `target_spacing` | layout, dom | target bounds가 24x24 CSS px 미만이고 예외에 해당하지 않는다. | 0: 충분 / 1: 보조 target 작음 / 2: 주요 target 작음 | WCAG-2.5.8, LIGHTHOUSE-TAP |
| `A11Y-TARGET-SPACING-001` | Friction | FIRST_VIEW, VALUE, CTA, INPUT | Standard | 작은 타깃 간 간격이 충분한지 판단한다. | `interactive_components`, `nearest_target_spacing` | layout, dom | 작은 target끼리 너무 가까워 오탭 가능성이 높다. | 0: 충분 / 1: 일부 근접 / 2: 주요 target 근접 | WCAG-2.5.8, LIGHTHOUSE-TAP |
| `A11Y-POINTER-CANCEL-001` | Reliability | CTA, INPUT, COMMIT | Standard | pointer down 즉시 위험 동작이 실행되지 않는지 판단한다. | `pointer_event_behavior`, `danger_action` | dom, scenario_log | pointer down/touch start만으로 제출/삭제/결제 등 위험 동작이 실행된다. | 0: up/cancel 가능 / 2: 위험 동작 즉시 실행 | WCAG-2.5.2 |
| `A11Y-LABEL-IN-NAME-001` | Clarity | CTA, INPUT, COMMIT | Standard | visible label이 accessible name에 포함되는지 판단한다. | `interactive_components`, `ax_snapshot` | dom, ax | visible label과 accessible name이 불일치해 음성 입력 사용자가 호출하기 어렵다. | 0: 포함 / 1: 일부 불일치 / 2: 주요 컨트롤 불일치 | WCAG-2.5.3 |
| `A11Y-NAME-ROLE-VALUE-001` | Reliability | CTA, INPUT, COMMIT | Standard | custom control의 name, role, value/state가 프로그램적으로 제공되는지 판단한다. | `ax_snapshot`, `interactive_components`, `component_state` | dom, ax | custom control이 role/name/state를 제공하지 않는다. | 0: 제공 / 1: 일부 state 누락 / 2: 주요 control name/role/value 누락 | WCAG-4.1.2 |
| `A11Y-STATUS-MESSAGE-001` | Clarity | INPUT, COMMIT | Standard | 상태 메시지가 focus 이동 없이 보조기술에 전달되는지 판단한다. | `status_message`, `live_region`, `toast_message` | dom, ax, screenshot | 성공/오류/진행 메시지가 aria-live/status 없이 시각적으로만 표시된다. | 0: 전달 가능 / 1: 시각 메시지만 있음 / 2: 핵심 상태 전달 누락 | WCAG-4.1.3 |

## 3. Form / Error / Recovery 룰 후보

폼 관련 후보는 Wedge의 `INPUT` stage와 가장 잘 맞는다. 현재 `FRICTION-FORM-001`이 label 중심이므로 instruction, error, recovery는 별도 후보로 분리하는 편이 안전하다.

| 후보 ID | Axis | Stages | Evidence level | Definition | Required observations | Measurement sources | Signal rule | Severity sketch | Reference |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `FORM-INSTRUCTIONS-001` | Clarity | INPUT | Standard | 입력 조건, 형식, 제한이 입력 전에 설명되는지 판단한다. | `form_field`, `instruction_text`, `input_constraints` | dom, ax, layout | pattern/min/max/maxlength/required가 있으나 visible/help/description 문구가 없다. | 0: 설명 있음 / 1: 일부 부족 / 2: 오류 유발 가능 조건 설명 없음 | WCAG-3.3.2, WAI-FORMS, GOVUK-TEXT-INPUT |
| `FORM-PLACEHOLDER-ONLY-001` | Friction | INPUT | Expert Guide | placeholder를 label 대체로만 사용하지 않는지 판단한다. | `form_field`, `label_association` | dom, ax, screenshot | visible label/accessibility name 없이 placeholder만 있다. | 0: label 있음 / 1: placeholder-only / 2: 중요 필드 placeholder-only | WAI-FORMS, GOVUK-TEXT-INPUT |
| `FORM-REQUIRED-OPTIONAL-001` | Clarity | INPUT | Expert Guide | 필수/선택 여부가 명확하고 일관적으로 표시되는지 판단한다. | `form_field`, `required_field`, `visible_required_marker`, `visible_optional_marker` | dom, ax, screenshot | required attr과 visible marker가 불일치하거나 marker 설명이 없다. | 0: 명확 / 1: 일부 불일치 / 2: 제출 오류 유발 가능 | GOVUK-TEXT-INPUT, USWDS-FORM |
| `FORM-GROUPING-001` | Clarity | INPUT | Standard | radio/checkbox 관련 입력 묶음에 group label이 있는지 판단한다. | `form_group`, `fieldset_legend`, `choice_controls` | dom, ax, layout | related controls에 fieldset/legend 또는 equivalent group name이 없다. | 0: 그룹 설명 있음 / 1: 약한 그룹 설명 / 2: 그룹 목적 없음 | WAI-FORMS, USWDS-FORM |
| `FORM-ERROR-IDENTIFICATION-001` | Friction | INPUT, COMMIT | Standard | 오류 발생 시 어떤 필드가 왜 문제인지 식별 가능한지 판단한다. | `form_error`, `submit_attempt`, `invalid_field` | dom, ax, screenshot, scenario_log | submit 후 invalid field와 error text가 연결되지 않는다. | 0: 식별 가능 / 1: 상단 메시지만 있음 / 2: 필드/원인 식별 불가 | WCAG-3.3.1, GOVUK-ERROR |
| `FORM-ERROR-SUGGESTION-001` | Friction | INPUT, COMMIT | Standard | 오류 메시지가 수정 방법을 제시하는지 판단한다. | `form_error`, `error_recovery` | dom, ax, screenshot | 오류 메시지가 원인 또는 수정 방법 없이 일반 오류만 말한다. | 0: 수정 방법 있음 / 1: 원인만 있음 / 2: 수정 방법 없음 | WCAG-3.3.3, GOVUK-ERROR |
| `FORM-ERROR-PROXIMITY-001` | Friction | INPUT | Expert Guide | 오류 메시지가 해당 필드 근처에 표시되는지 판단한다. | `form_error`, `invalid_field`, `field_bounds` | dom, layout, screenshot | error가 toast/상단에만 있고 field-level message가 없다. | 0: 근처 표시 / 1: summary만 있음 / 2: 위치 찾기 어려움 | GOVUK-ERROR, USWDS-VALIDATION |
| `FORM-ERROR-SUMMARY-001` | Friction | INPUT, COMMIT | Expert Guide | 여러 오류가 있을 때 error summary와 field anchor가 있는지 판단한다. | `form_error_summary`, `form_error`, `submit_attempt` | dom, ax, layout | 다중 오류인데 error summary 또는 field link가 없다. | 0: summary 있음 / 1: field error만 있음 / 2: 다중 오류 탐색 어려움 | GOVUK-ERROR, USWDS-VALIDATION |
| `FORM-INPUT-PRESERVE-001` | Reliability | INPUT, COMMIT | Expert Guide | 오류 후 사용자가 입력한 값이 보존되는지 판단한다. | `form_value_before_after`, `submit_attempt`, `form_error` | dom, scenario_log | submit error 후 입력값이 사라진다. | 0: 보존 / 2: 일부 손실 / 3: 민감하지 않은 주요 입력 전체 손실 | GOVUK-ERROR, BAYMARD-CHECKOUT |
| `FORM-AUTOCOMPLETE-001` | Friction | INPUT | Standard | 반복 입력 목적 필드에 적절한 autocomplete가 있는지 판단한다. | `form_field`, `input_purpose`, `autocomplete_attr` | dom, ax | 이름/이메일/주소/결제 등 목적 필드에 autocomplete가 없거나 부적절하다. | 0: 적절 / 1: 일부 누락 / 2: 반복 입력 핵심 필드 누락 | WCAG-1.3.5, BAYMARD-CHECKOUT |
| `FORM-PASTE-BLOCKED-001` | Friction | INPUT | Technical | 입력 필드에서 붙여넣기가 부당하게 차단되는지 판단한다. | `paste_simulation`, `form_field` | dom, scenario_log | paste event가 prevent되고 대체 입력 이유가 없다. | 0: 가능 / 2: 차단 / 3: 이메일·비밀번호·결제 확인 필드 차단 | LIGHTHOUSE-BP, BAYMARD-CHECKOUT |

## 4. Component Pattern 룰 후보

컴포넌트 후보는 WAI-ARIA APG와 WCAG Name/Role/Value 기준을 따른다. Wedge에서는 `component_state`, `keyboard_traversal`, `modal_state` 같은 observation 후보가 필요하다.

| 후보 ID | Axis | Stages | Evidence level | Definition | Required observations | Measurement sources | Signal rule | Severity sketch | Reference |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `COMPONENT-MODAL-FOCUS-001` | Friction | CTA, INPUT, COMMIT | Standard | 모달이 열릴 때 focus가 모달 내부로 이동하는지 판단한다. | `modal_state`, `focus_order` | dom, ax, scenario_log | modal open 후 active element가 modal 밖에 있다. | 0: 내부 이동 / 2: 배경 focus / 3: 입력/결제 modal에서 배경 focus | WAI-DIALOG |
| `COMPONENT-MODAL-TRAP-001` | Reliability | CTA, INPUT, COMMIT | Standard | 모달 열린 동안 Tab focus가 모달 내부에 유지되는지 판단한다. | `modal_state`, `keyboard_traversal` | dom, ax, scenario_log | Tab으로 background control에 접근된다. | 0: 내부 유지 / 2: background 접근 / 3: commit modal에서 background 접근 | WAI-DIALOG |
| `COMPONENT-MODAL-CLOSE-001` | Friction | CTA, INPUT, COMMIT | Standard | 모달을 명확하게 닫을 수 있는 수단이 있는지 판단한다. | `modal_state`, `close_candidate`, `escape_result` | dom, ax, layout, scenario_log | close/cancel/Escape 중 어느 것도 안정적으로 제공되지 않는다. | 0: 명확 / 1: close label 약함 / 2: 닫기 수단 불명확 | WAI-DIALOG |
| `COMPONENT-MODAL-RETURN-FOCUS-001` | Friction | CTA, INPUT, COMMIT | Standard | 모달 닫힘 후 focus가 적절한 위치로 돌아가는지 판단한다. | `modal_state`, `focus_order` | dom, ax, scenario_log | modal close 후 focus가 body 또는 예측 불가능한 요소로 이동한다. | 0: trigger/next logical / 1: 약한 복귀 / 2: focus lost | WAI-DIALOG |
| `COMPONENT-BUTTON-KEYBOARD-001` | Friction | CTA, INPUT, COMMIT | Standard | 버튼 역할 요소가 Enter/Space로 실행되는지 판단한다. | `interactive_components`, `keyboard_activation` | dom, ax, scenario_log | role/button-like element가 keyboard activation을 지원하지 않는다. | 0: 지원 / 2: 주요 버튼 미지원 | WCAG-2.1.1, WCAG-4.1.2 |
| `COMPONENT-STATE-ARIA-001` | Reliability | VALUE, CTA, INPUT | Standard | 확장/선택/비활성 상태가 보조기술에 전달되는지 판단한다. | `component_state`, `ax_snapshot` | dom, ax | accordion/tab/toggle/dropdown state가 aria-expanded/selected/checked 등으로 표현되지 않는다. | 0: 제공 / 1: 일부 state 누락 / 2: 주요 state 누락 | WCAG-4.1.2 |
| `COMPONENT-ACCORDION-DISCOVERABILITY-001` | Clarity | VALUE, CTA | Expert Guide | 중요한 정보나 CTA가 접힌 영역 안에 숨어 사용자가 놓치지 않는지 판단한다. | `accordion_state`, `hidden_panel_content`, `cta_candidate` | dom, layout, screenshot | collapsed panel 안에 필수 정보/CTA가 있고 외부에서 알 수 없다. | 0: 발견 가능 / 1: 보조 정보 숨김 / 2: 핵심 정보 또는 CTA 숨김 | USWDS-FORM, NNG-HEURISTICS |

## 5. Path / CTA / Choice 룰 후보

Path 계열은 Wedge의 핵심 축이다. 다만 Standard 기반 hard rule보다는 `Operational` 또는 `Expert Guide` 성격이 많으므로 evidence와 예외 조건을 명확히 둬야 한다.

| 후보 ID | Axis | Stages | Evidence level | Definition | Required observations | Measurement sources | Signal rule | Severity sketch | Reference |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `PATH-PRIMARY-ACTION-CLARITY-001` | Path | FIRST_VIEW, CTA | Expert Guide | 핵심 행동이 보조 행동과 구분되어 드러나는지 판단한다. | `interactive_components`, `cta_cluster`, `visual_emphasis` | dom, layout, screenshot | primary candidate가 없거나 secondary와 시각 위계가 구분되지 않는다. | 0: 명확 / 1: 약함 / 2: 핵심 행동 불명확 | NNG-HEURISTICS, GOVUK-BUTTON |
| `PATH-CTA-LABEL-SPECIFICITY-001` | Clarity | CTA, COMMIT | Standard | CTA 라벨이 실행 결과를 구체적으로 설명하는지 판단한다. | `cta_candidate`, `label_role_alignment`, `scenario_goal` | dom, ax, screenshot, scenario_log | generic CTA label이 결과를 설명하지 못하고 주변 문맥도 약하다. | 0: 구체적 / 1: 문맥 필요 / 2: 결과 예측 어려움 | WCAG-2.4.6, NNG-HEURISTICS |
| `PATH-BACK-LINK-001` | Path | VALUE, CTA, INPUT, COMMIT | Expert Guide | 다단계 흐름에서 이전 단계로 돌아가는 방법이 명확한지 판단한다. | `step_indicator`, `back_link_candidate`, `flow_step_count` | dom, layout, scenario_log | multi-step flow인데 back/cancel/edit affordance가 없다. | 0: 명확 / 1: browser back만 가능 / 2: 복귀 수단 불명확 | NNG-HEURISTICS, GOVUK-BUTTON |
| `PATH-BREADCRUMB-CONTEXT-001` | Clarity | VALUE, CTA | Expert Guide | 깊은 페이지에서 현재 위치를 이해할 수 있는 navigation 단서가 있는지 판단한다. | `breadcrumb`, `page_metadata`, `navigation_context` | dom, ax, layout | 깊은 hierarchy인데 breadcrumb/current nav/page heading 단서가 없다. | 0: 명확 / 1: 일부 단서 / 2: 위치 파악 어려움 | WCAG-2.4.8, GOVUK-BUTTON |
| `PATH-PAGINATION-CLARITY-001` | Clarity | VALUE | Expert Guide | pagination/list navigation에서 현재 위치와 이전/다음 이동이 명확한지 판단한다. | `pagination_state`, `interactive_components` | dom, ax, layout | current page, next/prev label, disabled state가 불명확하다. | 0: 명확 / 1: 일부 약함 / 2: 현재 위치 또는 이동 목적 불명확 | USWDS-FORM, WCAG-2.4.4 |
| `PATH-CONSISTENT-NAVIGATION-001` | Clarity | FIRST_VIEW, VALUE, CTA | Standard | 반복 navigation과 컴포넌트 명칭이 페이지 간 일관적인지 판단한다. | `navigation_snapshot`, `multi_checkpoint_labels` | dom, ax, layout | 반복 navigation의 순서/라벨/위치가 이유 없이 바뀐다. | 0: 일관 / 1: 일부 변화 / 2: 주요 navigation 불일치 | WCAG-3.2.3, NNG-HEURISTICS |
| `PATH-ACTION-RESULT-001` | Reliability | CTA, INPUT, COMMIT | Operational | 사용자 행동 후 결과 변화가 확인되는지 판단한다. | `journey_action_raw`, `settle_response`, `toast_message`, `url_change` | dom, network, console, scenario_log | clicked action 후 URL/DOM/toast/count/status 변화가 없다. | 0: 결과 확인 / 1: 약한 결과 / 2: 결과 불명확 / 3: commit action 결과 없음 | NNG-HEURISTICS |

## 6. Feedback / Recovery 룰 후보

Feedback 계열은 사용자 행동 이후 시스템 상태가 보이는지를 본다. `RELIABILITY-LOADING-STUCK-001`과 겹치지 않도록 “느림”이 아니라 “상태 안내 부재”에 집중한다.

| 후보 ID | Axis | Stages | Evidence level | Definition | Required observations | Measurement sources | Signal rule | Severity sketch | Reference |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `FEEDBACK-SYSTEM-STATUS-001` | Reliability | CTA, INPUT, COMMIT | Expert Guide | 클릭/제출/로드 중 처리 상태가 사용자에게 보이는지 판단한다. | `loading_state`, `status_message`, `action_context` | dom, layout, screenshot, scenario_log | action 후 일정 시간 이상 변화가 없는데 spinner/progress/status text가 없다. | 0: 상태 안내 있음 / 1: 약함 / 2: 처리 중인지 알 수 없음 | NNG-HEURISTICS |
| `FEEDBACK-STATUS-MESSAGE-001` | Clarity | INPUT, COMMIT | Standard | 성공/오류/진행 메시지가 화면과 보조기술 모두에 전달되는지 판단한다. | `status_message`, `live_region`, `toast_message` | dom, ax, screenshot | status message가 시각적으로만 존재하거나 보조기술에 전달되지 않는다. | 0: 전달 / 1: 시각만 / 2: 핵심 상태 누락 | WCAG-4.1.3 |
| `RECOVERY-UNDO-CANCEL-001` | Reliability | CTA, INPUT, COMMIT | Expert Guide | 사용자가 실수를 되돌리거나 취소할 수 있는지 판단한다. | `danger_action`, `undo_candidate`, `cancel_candidate`, `confirmation_step` | dom, scenario_log, layout | 위험 행동에 undo/cancel/confirmation/review 수단이 없다. | 0: 복구 가능 / 1: 확인만 있음 / 2: 복구 수단 없음 / 3: irreversible commit | NNG-HEURISTICS, WCAG-3.3.4 |
| `FEEDBACK-PERMISSION-PROMPT-001` | Friction | FIRST_VIEW, CTA | Technical | 페이지 진입 직후 권한 요청이 주요 흐름을 방해하는지 판단한다. | `permission_prompt`, `first_view_state` | scenario_log, screenshot | 사용자 맥락 전 설명 없이 notification/location prompt가 즉시 뜬다. | 0: 맥락 후 요청 / 1: 보조 prompt / 2: first-view blocking prompt | LIGHTHOUSE-BP, NNG-HEURISTICS |

## 7. Performance / Technical 룰 후보

성능 후보는 Core Web Vitals와 Lighthouse 기준을 따른다. Wedge registry에서는 `evidence_level=Technical` 또는 `Operational`이 적합하다.

| 후보 ID | Axis | Stages | Evidence level | Definition | Required observations | Measurement sources | Signal rule | Severity sketch | Reference |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `PERF-LCP-SLOW-001` | Reliability | FIRST_VIEW, VALUE | Technical | 주요 콘텐츠가 사용자 경험 기준보다 늦게 렌더링되는지 판단한다. | `web_vitals`, `lcp_element` | performance, layout, screenshot | LCP가 기준을 초과하고 핵심 콘텐츠가 늦게 보인다. | 0: good / 1: needs improvement / 2: poor | WEB-VITALS |
| `PERF-INP-SLOW-001` | Reliability | CTA, INPUT, COMMIT | Technical | 사용자 상호작용 응답이 느린지 판단한다. | `web_vitals`, `interaction_latency` | performance, scenario_log | INP 또는 action latency가 기준을 초과한다. | 0: good / 1: needs improvement / 2: poor | WEB-VITALS |
| `PERF-CLS-SHIFT-001` | Reliability | FIRST_VIEW, VALUE, CTA | Technical | 예기치 않은 layout shift가 읽기/클릭 흐름을 방해하는지 판단한다. | `web_vitals`, `layout_shift_events`, `shifted_elements` | performance, layout, screenshot | CLS가 기준을 초과하거나 주요 CTA/input이 이동한다. | 0: good / 1: moderate shift / 2: major shift / 3: 클릭 대상 이동 | WEB-VITALS |
| `PERF-RENDER-BLOCKING-001` | Reliability | FIRST_VIEW | Technical | 렌더링 차단 리소스가 첫 화면 사용 가능 시점을 늦추는지 판단한다. | `lighthouse_audit`, `resource_timing` | performance, network | render-blocking CSS/JS가 first view delay에 기여한다. | 0: 낮음 / 1: 보조 리소스 / 2: 주요 지연 | LIGHTHOUSE-BP |
| `TECH-RESOURCE-FAILURE-001` | Reliability | FIRST_VIEW, VALUE, CTA, INPUT, COMMIT | Technical | 이미지, CSS, JS, font 등 주요 리소스 실패가 없는지 판단한다. | `resource_failure`, `network_summary` | network, console | 주요 resource request가 실패한다. | 0: 없음 / 1: 보조 리소스 / 2: 주요 리소스 / 3: 기능 JS 실패 | LIGHTHOUSE-BP |
| `TECH-HTTPS-SECURITY-001` | Reliability | FIRST_VIEW, COMMIT | Technical | HTTPS, mixed content, security warning이 사용자 신뢰를 해치지 않는지 판단한다. | `security_state`, `mixed_content`, `page_metadata` | network, console, scenario_log | insecure origin, mixed content, certificate/security warning이 있다. | 0: secure / 1: mixed passive / 2: mixed active 또는 insecure form / 3: commit stage security risk | LIGHTHOUSE-BP |

## 8. Trust / Checkout 룰 후보

Trust/Checkout 후보는 Baymard 근거가 많으므로 `Research-backed`가 적합하다. 범용 사이트 전체에 적용하면 오탐이 많아 `checkout_context` 같은 도메인 판별 observation이 필요하다.

| 후보 ID | Axis | Stages | Evidence level | Definition | Required observations | Measurement sources | Signal rule | Severity sketch | Reference |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `TRUST-PAYMENT-SECURITY-CUE-001` | Trust | INPUT, COMMIT | Research-backed | 결제 정보 입력 구역에 신뢰 단서가 있는지 판단한다. | `checkout_context`, `payment_fields`, `trust_signal` | dom, layout, screenshot | payment fields 주변에 보안/신뢰 microcopy 또는 시각적 단서가 없다. | 0: 단서 있음 / 1: 약함 / 2: 민감 결제 구역 단서 없음 | BAYMARD-SECURITY |
| `TRUST-SENSITIVE-FIELD-EXPLAIN-001` | Trust | INPUT | Research-backed | 개인정보/민감 정보 입력 전 사용 목적이 설명되는지 판단한다. | `form_field`, `sensitive_field`, `instruction_text` | dom, ax, screenshot | 전화번호, 이메일, 카드정보 등 민감 필드에 사용 목적 설명이 없다. | 0: 설명 있음 / 1: 약함 / 2: 민감 필드 설명 없음 | BAYMARD-SECURITY, GOVUK-TEXT-INPUT |
| `CHECKOUT-ORDER-REVIEW-001` | Clarity | COMMIT | Research-backed | 최종 제출 전에 주문/예약/결제 정보를 검토하고 수정할 수 있는지 판단한다. | `checkout_context`, `order_summary`, `final_submit_candidate` | dom, layout, screenshot, scenario_log | final submit 전 review summary 또는 edit affordance가 없다. | 0: 검토/수정 가능 / 1: 검토만 가능 / 2: 검토 부족 / 3: 금전 commit 검토 없음 | BAYMARD-CHECKOUT, WCAG-3.3.4 |
| `CHECKOUT-GUEST-OPTION-001` | Path | CTA, COMMIT | Research-backed | 구매/예약 전 계정 생성 강요로 흐름이 막히지 않는지 판단한다. | `checkout_context`, `login_gate`, `guest_checkout_candidate` | dom, layout, screenshot, scenario_log | checkout flow에서 guest option 없이 account creation만 요구한다. | 0: guest 가능 / 1: 우회 가능 / 2: 계정 생성 강요 | BAYMARD-CHECKOUT |
| `CHECKOUT-LOAD-INDICATOR-001` | Reliability | COMMIT | Research-backed | 결제/예약 제출 후 처리 중 안내와 중복 제출 방지가 있는지 판단한다. | `checkout_context`, `loading_state`, `final_submit_candidate` | dom, layout, scenario_log | checkout submit 후 indicator 또는 submit disabled가 없다. | 0: 안내/방지 있음 / 1: 안내만 있음 / 2: 안내 없음 / 3: 중복 제출 가능 | BAYMARD-CHECKOUT, NNG-HEURISTICS |
| `CHECKOUT-COST-CLARITY-001` | Trust | COMMIT | Research-backed | 최종 제출 직전 비용, 수수료, 배송비, 조건이 명확한지 판단한다. | `checkout_context`, `order_summary`, `cost_breakdown` | dom, screenshot, layout | final commit 주변에 총액/추가비용/조건 설명이 없다. | 0: 명확 / 1: 일부 조건 약함 / 2: 비용 불명확 / 3: 결제 직전 총액 불명확 | BAYMARD-CHECKOUT |
| `CHECKOUT-DATA-PERSISTENCE-001` | Reliability | INPUT, COMMIT | Research-backed | checkout 오류 후 입력 데이터가 보존되는지 판단한다. | `checkout_context`, `form_value_before_after`, `form_error` | dom, scenario_log | submit error 후 비민감 입력값이 사라진다. | 0: 보존 / 2: 일부 손실 / 3: checkout 핵심 정보 손실 | BAYMARD-CHECKOUT |

## 9. 후보군 요약

| 구분 | 후보 수 | 우선 evidence level |
| --- | ---: | --- |
| 현재 운영 룰 직접 연결 | 9 | Operational / Standard / Technical |
| Standard 기반 접근성 | 28 | Standard |
| Form / Error / Recovery | 11 | Standard / Expert Guide |
| Component Pattern | 7 | Standard / Expert Guide |
| Path / CTA / Choice | 7 | Operational / Expert Guide |
| Feedback / Recovery | 4 | Standard / Expert Guide / Technical |
| Performance / Technical | 6 | Technical |
| Trust / Checkout | 7 | Research-backed |

총 후보 수: 79개

## 10. 후속 필터링 기준

다음 문서인 Runner evidence 기준 필터링에서는 각 후보를 아래 질문으로 다시 봐야 한다.

| 질문 | 의미 |
| --- | --- |
| required_observations가 현재 EvidencePacket에 존재하는가? | 현재 Runner/Spring으로 가능한지 |
| measurement_sources가 현재 수집되는가? | DOM/layout/screenshot/AX/network/console/performance 중 무엇이 부족한지 |
| evidence_refs를 안정적으로 만들 수 있는가? | Report에서 문제 위치를 추적할 수 있는지 |
| StageContext에 귀속 가능한가? | FIRST_VIEW/VALUE/CTA/INPUT/COMMIT 중 어디서 평가할 수 있는지 |
| false positive를 막을 exception이 필요한가? | 예외 조건 없이 rule로 만들면 위험한지 |
| deterministic handler로 가능한가, GMS 보조가 필요한가? | Analyzer 구현 방식 |
| 기존 rule에 흡수할지 신규 criterion_id로 둘지 | rule catalog 정리 방식 |

## 11. 작성 원칙

이 도감의 후보는 최종 구현 목록이 아니다.  
후보가 많아 보이는 것은 정상이다. 이 단계의 목적은 좋은 후보를 넓게 확보하고, 다음 단계에서 Runner evidence와 Analyzer 가능성으로 줄이는 것이다.

단, Wedge RuleRegistry 구조와 맞지 않는 순수 UX 아이디어는 넣지 않았다. 모든 후보는 최소한 다음 형태로 바꿀 수 있어야 한다.

```text
criterion_id
axis
applicableStages
evidence_level
required_observations
measurement_sources
signal_rule
severity_rules
confidence_rule
output_template
references
```
