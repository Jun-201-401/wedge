# Final Analyzer Rules

이 문서는 Analyzer에 최종적으로 유지하거나 신규 추가할 Rule을 정리하는 문서다.

`docs/12_analyzer_rule_catalog.md`는 현재 운영 Rule 카탈로그이고, `docs/15_extraction_rule_candidates.md`는 후보 Rule 정리 문서다. 이 문서는 두 문서를 비교한 뒤 실제 제품에 남길 Rule만 선별해 관리한다.

## 정리 기준

- 이미 운영 구현이 되어 있고 사용자 문제 정의가 명확한 Rule은 유지한다.
- 기존 Rule과 의미가 겹치는 후보는 별도 Rule로 만들기보다 기존 Rule에 흡수한다.
- Runner/MQ/Analyzer에 들어오는 observation만으로 판단 가능한 Rule을 우선한다.
- 근거가 약하거나 오탐 가능성이 큰 Rule은 보류한다.
- 사용자가 실제로 이해, 선택, 입력, 제출, 대기 과정에서 겪는 문제를 우선한다.

## 구현 상태 정리

현재 Analyzer 기준으로 handler와 registry가 모두 연결된 Rule은 총 17개다.

구현 여부 기준은 다음 두 조건을 모두 만족하는 경우로 본다.

- `apps/analyzer/app/rule_engine/handlers/__init__.py`에 handler가 연결되어 있다.
- `apps/analyzer/app/rule_engine/registries/p0_v0_1.json`에 registry rule이 등록되어 있다.

### 구현 완료

| Rule | 20md 최종 표 포함 여부 | 상태 | 비고 |
| --- | --- | --- | --- |
| `PATH-CTA-001` | 포함 | 구현 완료 | 주요 CTA 존재 여부 판단 |
| `PATH-CTA-002` | 포함 | 구현 완료 | primary급 CTA 경쟁 판단 |
| `FRICTION-FORM-001` | 포함 | 구현 완료 | 입력 필드 라벨/목적 판단 |
| `RELIABILITY-TECH-001` | 포함 | 구현 완료 | 사용자 행동 결과를 막는 핵심 기술 실패 판단 |
| `RELIABILITY-LOADING-STUCK-001` | 포함 | 구현 완료 | 일반 페이지 전환 지연 판단 |
| `COPY-LABEL-INTEGRITY-001` | 포함 | 구현 완료 | 라벨 깨짐/잘림/겹침 판단 |
| `PATH-CHOICE-OVERLOAD-001` | 포함 | 구현 완료 | 같은 결정 영역의 선택지 과다 판단 |
| `PATH-BACK-LINK-001` | 포함 | 구현 완료 | 다단계 흐름의 이전/복귀 수단 판단 |
| `PATH-ACCORDION-DISCOVERABILITY-001` | 포함 | Analyzer 구현 완료 | handler/registry는 있음. |
| `FORM-REQUIRED-OPTIONAL-001` | 포함 | 구현 완료 | 필수/선택 표시 판단 |
| `FEEDBACK-SYSTEM-STATUS-001` | 포함 | 구현 완료 | 처리 중 상태 피드백 판단 |
| `FEEDBACK-ACTION-RESULT-001` | 포함 | 구현 완료 | 행동 후 결과 변화 판단 |
| `TECH-TARGET-SIZE-001` | 포함 | 구현 완료 | 목표 흐름에 중요한 작은/tight interactive target 판단 |
| `TECH-PRODUCT-IMAGE-LOAD-001` | 포함 | 구현 완료 | 상품 카드 이미지 로딩/표시 실패 판단 |
| `CHECKOUT-ORDER-REVIEW-001` | 포함 | 구현 완료 | 최종 제출 전 주문/예약/결제 요약 확인 여부 판단 |
| `COPY-FLOW-QUALITY-001` | 미포함 | 구현 완료 | 라벨/문구의 의미와 역할 불일치 판단 |
| `JOURNEY-GOAL-CTA-MISMATCH-001` | 미포함 | 구현 완료 | 선택된 CTA와 시나리오 목표 불일치 판단 |

### 미구현

| Rule | 상태 | 필요한 작업 |
| --- | --- | --- |
| `A11Y-LINK-PURPOSE-001` | 미구현 | 반복 generic link와 주변 맥락 evidence 기반 handler/registry 추가 필요 |
| `FORM-INSTRUCTIONS-001` | 미구현 | `form_field`의 `describedby_text`, `help_text`, `input_format_hint`, `pattern`, `min`, `max`, `maxlength` 기반 handler/registry 추가 필요 |
| `CHECKOUT-LOAD-INDICATOR-001` | 미구현 | checkout submit 이후 `loading_state`, `clicked_submit_disabled`, action kind 기반 handler/registry 추가 필요 |

## 최종 유지 Rule

| Rule | Axis | Stage | 상태 | 판단 |
| --- | --- | --- | --- | --- |
| `PATH-CTA-001` | Path | FIRST_VIEW, CTA | 유지 | 목표와 관련된 주요 행동 진입점이 보이는지 판단하는 핵심 Path Rule이다. |
| `PATH-CTA-002` | Path | CTA | 유지 | 같은 결정 순간에 primary급 CTA가 과도하게 경쟁하는지 판단하는 핵심 Path Rule이다. |
| `FRICTION-FORM-001` | Friction | INPUT | 유지 | 입력 필드의 목적을 알 수 있는 라벨이나 설명이 있는지 판단하는 핵심 Form Rule이다. |
| `RELIABILITY-TECH-001` | Reliability | CTA, INPUT, COMMIT | 유지 | 사용자 행동의 다음 결과가 핵심 네트워크/API 실패나 관련 스크립트 오류로 막혔는지 판단하는 Reliability Rule이다. |
| `RELIABILITY-LOADING-STUCK-001` | Reliability | CTA, INPUT, COMMIT | 유지 | 일반 페이지 전환 이후 다음 화면이 사용 가능한 상태로 렌더링되기까지 오래 걸리는지 판단한다. |
| `COPY-LABEL-INTEGRITY-001` | Clarity | FIRST_VIEW, VALUE, CTA, INPUT, COMMIT | 유지 | 라벨이나 짧은 문구가 깨지거나 잘리거나 겹치지 않고 읽히는지 판단하는 핵심 Copy Rule이다. |
| `PATH-CHOICE-OVERLOAD-001` | Path | FIRST_VIEW, VALUE, CTA | 유지/고도화 | 한 화면이나 같은 결정 영역에 선택지가 너무 많아 다음 행동을 고르기 어려운지 판단한다. |
| `A11Y-LINK-PURPOSE-001` | Clarity | FIRST_VIEW, VALUE, CTA | 신규 후보 | 반복되는 `자세히 보기`, `여기`, `더보기` 링크의 목적을 주변 맥락으로 이해할 수 있는지 판단한다. |
| `PATH-BACK-LINK-001` | Path | VALUE, CTA, INPUT | 신규 후보 | 다단계 흐름에서 이전 단계로 돌아가는 방법이 명확한지 판단한다. |
| `PATH-ACCORDION-DISCOVERABILITY-001` | Clarity | VALUE, CTA | 신규 후보 | 중요한 정보나 주요 행동이 접힌 영역 안에 숨어 있어 놓치기 쉬운지 판단한다. |
| `FORM-INSTRUCTIONS-001` | Clarity | INPUT | 신규 후보 | 입력 조건, 형식, 제한을 입력 전에 알 수 있는지 판단한다. |
| `FORM-REQUIRED-OPTIONAL-001` | Clarity | INPUT | 신규 후보 | 필수/선택 여부가 화면에서 명확하게 전달되는지 판단한다. |
| `FEEDBACK-SYSTEM-STATUS-001` | Reliability | CTA, INPUT, COMMIT | 신규 후보 | 클릭, 저장, 제출 후 처리 중 상태가 사용자에게 보이는지 판단한다. |
| `FEEDBACK-ACTION-RESULT-001` | Reliability | CTA, INPUT, COMMIT | 신규 후보 | 행동 후 결과 변화가 보여 사용자가 성공/실패 여부를 알 수 있는지 판단한다. |
| `TECH-TARGET-SIZE-001` | Friction | FIRST_VIEW, VALUE, CTA, INPUT | 신규 후보 | 목표 흐름에 중요한 버튼이나 링크가 너무 작거나 가까워 누르기 어려운지 판단한다. |
| `TECH-PRODUCT-IMAGE-LOAD-001` | Visual Integrity | VALUE | 유지 | 상품 카드에서 상품 이미지가 보이지 않고 같은 화면에서 이미지 리소스 실패가 관찰되는지 판단한다. |
| `CHECKOUT-ORDER-REVIEW-001` | Clarity | COMMIT | 신규 후보 | 결제, 예약, 제출 전에 내용을 확인하거나 수정할 기회가 있는지 판단한다. |
| `CHECKOUT-LOAD-INDICATOR-001` | Reliability | COMMIT | 신규 후보 | 결제/예약 제출 후 처리 중 상태가 보여 중복 제출 위험을 줄이는지 판단한다. |

## PATH-CTA-001

### 목적

사용자가 페이지에 들어왔을 때 목표와 관련된 주요 행동 진입점을 찾을 수 있는지 판단한다.

예를 들어 회원가입 시나리오라면 `회원가입`, `시작하기`, `무료로 시작`처럼 목표를 시작할 수 있는 CTA가 첫 화면이나 CTA 단계에서 보여야 한다.

### 유지 이유

- 사용자가 다음 행동을 찾지 못하면 여정이 바로 막힌다.
- FIRST_VIEW와 CTA 단계에서 가장 기본적인 Path 문제를 잡는다.
- 현재 Analyzer Rule Engine에 운영 구현되어 있다.

### 주요 판단 신호

- `cta_cluster.data.primary_like_cta_count`
- `interactive_components.data.primary_like_component_count`
- `cta_candidate`
- `components[].is_primary_like`
- `scenario.goal`
- CTA의 visible text, accessible name, bounds

### 현재 로직 요약

주어진 stage context 안에서 목표와 관련된 primary-like CTA 후보가 있는지 본다.

- primary-like CTA가 있으면 issue를 만들지 않는다.
- 약한 CTA 후보만 있으면 낮은 severity 후보가 될 수 있다.
- CTA 단계에서 목표 관련 주요 CTA가 없으면 issue가 된다.
- 진입점이 disabled, blocked, unreachable이면 더 강한 issue가 될 수 있다.

### 근거 매핑

- `USWDS-COMPONENTS`
- `GOVUK-COMPONENTS`
- `NNG-HEURISTICS`

## PATH-CTA-002

### 목적

같은 결정 순간에 주요 버튼처럼 보이는 선택지가 너무 많이 경쟁해서 사용자가 첫 행동을 고르기 어려운지 판단한다.

예를 들어 같은 영역에 `시작하기`, `문의하기`, `데모 보기`, `가격 보기`가 모두 같은 강도로 보이면 사용자는 무엇을 먼저 눌러야 하는지 헷갈릴 수 있다.

### 유지 이유

- CTA가 없는 것도 문제지만, 너무 많은 CTA가 같은 위계로 경쟁하는 것도 Path 문제다.
- `PATH-CTA-001`과 함께 CTA 존재 여부와 CTA 우선순위 문제를 나눠서 볼 수 있다.
- 현재 Analyzer Rule Engine에 운영 구현되어 있다.

### 주요 판단 신호

- `cta_cluster.data.primary_like_cta_count`
- `interactive_components.data.primary_like_component_count`
- `components[].is_primary_like`
- `components[].bounds`
- `visual_emphasis`
- 같은 decision context 안의 primary-like CTA 개수

### 현재 로직 요약

CTA decision context 안에서 primary-like CTA가 몇 개 경쟁하는지 본다.

- primary-like CTA가 0-2개면 일반적으로 issue를 만들지 않는다.
- primary-like CTA가 3개 이상이면 같은 결정 순간에서 행동 우선순위가 흐려진 것으로 판단한다.

### 근거 매핑

- `USWDS-COMPONENTS`
- `GOVUK-COMPONENTS`
- `NNG-HEURISTICS`

## FRICTION-FORM-001

### 목적

입력 필드에 사용자가 무엇을 입력해야 하는지 알 수 있는 라벨이나 설명이 있는지 판단한다.

예를 들어 이름, 이메일, 비밀번호, 검색어 입력 필드가 보이는데 label, accessible name, placeholder, 주변 설명이 모두 부족하면 사용자는 입력 목적을 알기 어렵다.

### 유지 이유

- 입력 필드 목적을 모르는 문제는 사용자 행동을 직접 막는 명확한 UX 결함이다.
- INPUT 단계에서 가장 기본적인 Friction 문제를 잡는다.
- WCAG/WAI Forms 계열 근거와 연결되어 hard rule에 가깝게 다룰 수 있다.
- 현재 Analyzer Rule Engine에 운영 구현되어 있다.

### 주요 판단 신호

- `form_field`
- `missing_label`
- `data.label_association`
- `label_text`
- `accessible_name`
- `placeholder`
- `visible`
- `bounds`

### 현재 로직 요약

입력 필드가 목적을 설명하는 label 또는 accessible name과 연결되어 있는지 본다.

- label association 근거가 있으면 issue를 만들지 않는다.
- label, accessible name, 설명 근거가 부족하면 issue가 된다.
- label association 근거 자체가 없으면 무리하게 판단하지 않고 `NOT_EVALUABLE`에 가깝게 처리한다.

### 근거 매핑

- `WCAG22-QUICKREF`
- `WAI-TUTORIALS`
- `GOVUK-COMPONENTS`
- `USWDS-COMPONENTS`
- `BAYMARD-CHECKOUT`

## RELIABILITY-TECH-001

### 목적

사용자 행동의 다음 결과가 기술 오류 때문에 막혔는지 판단한다.

예를 들어 로그인, 제출, 저장, 결제, 장바구니 담기 같은 행동 이후 핵심 API 요청이 실패하거나, 해당 행동에 필요한 JavaScript가 깨져 결과 화면이나 성공/실패 피드백이 나오지 않는 경우를 잡는다.

이 Rule은 단순히 콘솔에 빨간 줄이 있거나 네트워크 실패가 있다는 이유만으로 issue를 만들지 않는다. 사용자 행동과 결과 실패가 연결되는 기술 오류만 Reliability issue로 본다.

### 유지 이유

- 사용자 행동의 결과를 막는 기술 실패는 주관적 UX 판단이 아니라 객관적인 장애 신호다.
- CTA, INPUT, COMMIT 단계에서 행동 결과가 나오지 않는 문제를 안정적으로 잡을 수 있다.
- 광고, 트래킹, 폰트, 이미지, source map 실패처럼 사용자 행동 결과를 직접 막는다고 보기 어려운 오류를 제외해 과대탐지를 줄인다.
- 현재 Analyzer Rule Engine에 운영 구현되어 있다.

### 주요 판단 신호

- `network_failure`
- `console_error`
- `network_timeline`
- `state.network_summary.failed_request_count`
- `state.console_summary.error_count`
- `interactive_components.components[].clicked_in_scenario`
- `journey_action_raw`
- `goal_action_result`
- checkpoint stage attribution
- `source=["network"]`
- `source=["console"]`

### 현재 로직 요약

사용자 행동 이후 같은 stage 또는 checkpoint에서 핵심 네트워크/API 실패나 관련 console error가 행동 결과를 막았는지 본다.

- 실패 요청이나 console error가 없으면 issue를 만들지 않는다.
- 실패 요청이나 console error가 있어도 사용자 행동과 연결되지 않으면 issue를 만들지 않는다.
- 로그인, 인증, 제출, 저장, 검색, 장바구니, 주문, 결제 등 핵심 행동 이후 관련 요청이 실패하면 issue가 된다.
- 사용자가 관련 기능을 실행한 뒤 해당 기능 스크립트 오류가 발생하면 issue가 된다.
- main document 또는 핵심 API/resource 실패는 사용자 흐름을 막을 가능성이 높으므로 issue 후보로 본다.
- 단순 run-level aggregate만 있고 stage attribution이 없으면 사용자-facing issue로 만들지 않는다.

### 제외 기준

다음 오류는 이 Rule에서 제외한다.

- 광고/트래킹 요청 실패
- 상품 이미지, 일반 이미지 리소스 로딩 실패
- 폰트 로딩 실패
- favicon 실패
- `.map` source map 파일 실패
- 브라우저의 slow network/fallback font 경고
- 사용자가 관련 기능을 누른 정황이 없는 외부 SDK 오류

상품 카드에서 이미지가 보이지 않는 문제는 `TECH-PRODUCT-IMAGE-LOAD-001`이 담당한다. 폰트 실패 때문에 실제 문구가 깨지거나 잘리거나 겹친 경우는 `COPY-LABEL-INTEGRITY-001` 성격의 표시/문구 무결성 문제로 본다.

### 현재 잡는 범위

- 사용자가 버튼을 눌렀는데 핵심 요청이 실패함
- 사용자 행동 후 결과 변화가 보이지 않음
- 핵심 기능 스크립트가 깨짐
- 메인 페이지나 핵심 리소스가 실패함
- 제출, 저장, 결제, 주문 같은 중요 행동이 실패함
- 로그인, 권한, 인증 흐름이 실패함
- validation/error response 실패가 제출 흐름을 막음
- 핵심 데이터 API 실패로 결과가 표시되지 않음
- 필수 외부 서비스 실패가 관련 사용자 행동과 연결됨

서버 상태와 화면 상태 불일치처럼 서버 응답과 UI 반영을 비교해야 하는 문제는 현재 runner evidence만으로는 제한적으로만 판단한다.

### 근거 매핑

- `LIGHTHOUSE`
- `WEB-VITALS`
- `NNG-HEURISTICS`

## RELIABILITY-LOADING-STUCK-001

### 목적

사용자 행동 이후 일반 페이지 이동이나 화면 전환이 발생했지만, 다음 화면이 사용 가능한 상태로 렌더링되기까지 오래 걸리는지 판단한다.

이 Rule은 네트워크 실패나 콘솔 오류 자체를 찾는 Rule이 아니다. 오류가 없어도 사용자가 "눌렀는데 멈춘 건가?"라고 느낄 수 있는 느린 전환을 잡는다.

### 유지 이유

- 사용자가 행동한 뒤 화면이 오래 준비되지 않으면 이탈이나 반복 클릭으로 이어질 수 있다.
- `RELIABILITY-TECH-001`과 역할이 다르다. TECH는 실패/오류를 보고, LOADING-STUCK은 오류가 없어도 전환 시간이 긴 상황을 본다.
- 일반 페이지 전환과 결제/인증/AI/지도/WebGL 같은 무거운 예외 흐름을 분리해서 판단할 수 있다.
- 현재 Analyzer Rule Engine에 운영 구현되어 있다.

### 주요 판단 신호

- `page_ready_timing`
- `duration_ms`
- `action_kind`
- `url_changed`
- `route_changed`
- `main_content_changed`
- `target_page_signals.has_payment_form`
- `target_page_signals.has_auth_redirect`
- `target_page_signals.has_map`
- `target_page_signals.has_webgl`
- `target_page_signals.has_streaming_response`
- `target_page_signals.has_permission_prompt`
- 보조 신호: `loading_state`, `settle_response`

### 현재 로직 요약

일반 페이지 이동 또는 라우트 전환으로 볼 수 있는 행동 이후 다음 화면 준비 시간이 긴지 본다.

- 일반 페이지 전환이 아니면 issue를 만들지 않는다.
- 결제, 인증 redirect, 지도, WebGL, streaming, 권한 요청처럼 오래 걸릴 수 있는 heavy target signal이 있으면 issue를 만들지 않는다.
- 네트워크 실패나 콘솔 오류가 같은 stage에 있으면 `RELIABILITY-TECH-001`이 우선 설명하도록 suppress한다.
- 일반 전환에서 `duration_ms >= 5000`이면 문제 후보가 된다.
- 일반 전환에서 `duration_ms >= 8000`이면 더 강한 문제로 본다.

### 근거 매핑

- `WEB-VITALS`
- `LIGHTHOUSE`
- `NNG-HEURISTICS`
- `BAYMARD-CHECKOUT`

## COPY-LABEL-INTEGRITY-001

### 목적

라벨이나 짧은 문구가 깨지거나, 잘리거나, 겹치지 않고 사용자가 정상적으로 읽을 수 있는지 판단한다.

이 Rule은 라벨의 의미가 좋은지 나쁜지를 판단하지 않는다. 텍스트가 실제로 읽히는 상태인지, 즉 문구의 물리적/시각적 무결성을 판단한다.

### 유지 이유

- 텍스트가 깨지거나 잘리거나 겹치면 사용자는 의미 판단 이전에 읽기 자체가 어렵다.
- FIRST_VIEW부터 COMMIT까지 모든 stage에서 사용자 이해를 직접 방해할 수 있다.
- COPY-FLOW-QUALITY-001과 역할이 다르다. FLOW는 의미/맥락 불일치, INTEGRITY는 읽힘/표시 문제를 본다.
- 현재 Analyzer Rule Engine에 운영 구현되어 있다.

### 주요 판단 신호

- `label_integrity.status="issue"`
- `issue_type`
- `integrity_issue_type`
- `text`
- `visible_text`
- `bounds`
- `visual_prominence`
- `clicked_in_scenario`
- screenshot URL for GMS

### 현재 로직 요약

버튼, 링크, 입력, 안내 문구가 화면에서 정상적으로 읽히는지 본다.

- 깨짐, 잘림, 겹침, 말줄임, 인코딩 문제 신호가 없으면 issue를 만들지 않는다.
- 명시적인 integrity issue가 있으면 issue가 된다.
- replacement character 같은 일부 텍스트 깨짐은 deterministic resolver가 보강할 수 있다.
- 이미지 기반 판단이 필요한 경우 GMS가 screenshot과 요소 후보를 함께 보고 보조 판단한다.

### 근거 매핑

- `WCAG22-QUICKREF`
- `WAI-TUTORIALS`
- `NNG-HEURISTICS`
- `GOVUK-COMPONENTS`
- `USWDS-COMPONENTS`

## TECH-TARGET-SIZE-001

### 목적

목표 흐름에 중요한 클릭 대상이 너무 작거나 서로 가까워 사용자가 원하는 대상을 정확히 누르기 어려운지 판단한다.

이 Rule은 단순히 `clickable=true`인 모든 요소를 검사하지 않는다. 네이버의 `사운드 off`처럼 보조 광고 UI나 목표 흐름과 관련 없는 작은 버튼은 과대탐지될 수 있으므로, 먼저 "사용자 목표 흐름에 중요한 클릭 대상인지"를 필터링한 뒤 크기와 간격을 판단한다.

### 유지 이유

- 실제 시나리오에서 눌러야 하는 버튼이 작거나 밀집되어 있으면 클릭 실수로 이어질 수 있다.
- 모든 클릭 가능 요소를 검사하면 광고, 보조 메뉴, 장식성 컨트롤까지 잡혀 과대탐지가 커진다.
- 현재 Runner evidence만으로 목표 관련성 필터와 bounds 기반 크기 판단을 함께 수행할 수 있다.

### 주요 판단 신호

- `interactive_components.components[]`
- `components[].bounds`
- `components[].clickable`
- `components[].visibility`
- `components[].clicked_in_scenario`
- `components[].typed_in_scenario`
- `components[].filled_in_scenario`
- `components[].selected_in_scenario`
- `components[].interaction_order`
- `components[].is_cta_candidate`
- `components[].is_primary_like`
- `components[].is_form_control`
- `components[].required`
- `components[].role`
- `components[].tag`
- `components[].text`
- `components[].visible_text`
- `components[].accessible_name`
- `components[].selector`
- `components[].href`
- `components[].container_heading`
- `components[].nearby_text`

### 현재 로직 요약

먼저 visible/enabled/clickable interactive target인지 확인한 뒤, 목표 흐름 관련성 필터를 통과한 요소만 크기와 간격을 검사한다.

목표 흐름 관련성은 다음 중 하나라도 해당하면 통과한다.

- 실제 시나리오에서 사용된 요소다.
- 주요 CTA 후보다.
- 입력/폼/필수 요소다.
- 텍스트, selector, href, 주변 문맥에 핵심 행동 키워드가 있다.

관련성 필터를 통과한 뒤 다음 조건을 본다.

- 클릭 대상의 width 또는 height가 기준보다 작다.
- 클릭 대상끼리 너무 가까워 오클릭 가능성이 있다.
- footer 법적 링크처럼 낮은 우선순위 보조 링크는 제외한다.
- 목표 흐름과 관련 없는 작은 링크나 보조 버튼은 issue로 만들지 않는다.

### 핵심 행동 키워드 예시

- `검색`, `로그인`, `회원가입`, `제출`, `저장`
- `다음`, `계속`, `장바구니`, `담기`
- `구매`, `결제`, `주문`, `인증`, `주소`
- `search`, `login`, `signup`, `submit`, `save`
- `next`, `continue`, `cart`, `checkout`, `payment`, `order`, `buy`

### 예시

- `사운드 off` 광고 보조 버튼이 작아도 목표 흐름과 관련 없으면 제외한다.
- `자세히` 같은 일반 링크가 작아도 시나리오 사용, CTA, form, 핵심 키워드 중 어느 것에도 해당하지 않으면 제외한다.
- 사용자가 실제로 누른 작은 버튼은 목표 흐름에 사용된 요소이므로 검사한다.
- `검색`, `로그인`, `결제`처럼 핵심 행동 키워드가 있는 작은 버튼/링크는 검사한다.

### 근거 매핑

- `WCAG22-QUICKREF`
- `USWDS-COMPONENTS`
- `GOVUK-COMPONENTS`
- `NNG-HEURISTICS`

## TECH-PRODUCT-IMAGE-LOAD-001

### 목적

상품 카드에서 상품 이미지가 보이지 않는 상태를 판단한다.

이 Rule은 단순히 이미지가 없는 디자인을 문제로 잡지 않는다. 상품 카드에 상품명/가격 같은 상품 근거가 있고, 같은 checkpoint에서 이미지 리소스 요청 실패가 함께 관찰될 때 상품 이미지 로딩 또는 표시 실패로 판단한다.

예를 들어 쿠키 상품 카드 3개가 보이지만 각 카드의 이미지 요청이 `net::ERR_BLOCKED_BY_ORB`로 실패하고, 카드에는 가격과 장바구니 버튼만 남아 있으면 사용자는 상품을 시각적으로 확인하거나 비교하기 어렵다.

### 유지 이유

- 상품 이미지는 커머스 VALUE 단계에서 상품 이해와 비교에 직접 영향을 준다.
- `RELIABILITY-TECH-001`은 기술 실패 자체를 설명하지만, 이 Rule은 그 실패가 상품 카드의 시각적 결손으로 드러난 상황을 별도로 설명한다.
- 기존 Runner evidence만으로 MVP 판단이 가능하다.
- `product_card.cards[].bbox`를 `problem_components[].bounding_box`로 승격해 Spring/front의 기존 highlight 흐름을 사용할 수 있다.

### 주요 판단 신호

- `product_card`
- `product_card.cards[].visible_product_image=false`
- `product_card.cards[].visible_price`
- `product_card.cards[].element_text`
- `product_card.cards[].bbox`
- `product_card.cards[].screenshot_artifact_id`
- `network_timeline.events[].resourceType="image"`
- `network_timeline.events[].failed=true`
- 보조 신호: `network_failure` message 안의 image URL

### 현재 로직 요약

같은 VALUE checkpoint 안에서 상품 카드 evidence와 이미지 네트워크 실패 evidence를 함께 본다.

- 상품 카드가 없으면 issue를 만들지 않는다.
- `visible_product_image=false`인 카드가 없으면 issue를 만들지 않는다.
- 가격 또는 가격 패턴 같은 상품 근거가 없는 카드는 제외한다.
- 같은 checkpoint에서 image resource failure가 없으면 issue를 만들지 않는다.
- 문제가 있는 상품 카드의 `bbox`를 `problem_components[].bounding_box`로 전달한다.
- 문제가 있는 상품 카드가 1~3개이면 severity 2, 4개 이상이면 severity 3으로 본다.

### 좌표 전달

Analyzer는 문제 카드의 위치를 다음 구조로 Spring callback에 포함한다.

- `evidence_ref`: product card observation ref
- `role`: `product_card`
- `coordinate_space`: `viewport`
- `bounding_box`: `product_card.cards[].bbox`
- `screenshot_artifact_id`: `product_card.cards[].screenshot_artifact_id`

Front는 기존 report highlight 구조에서 이 `bounding_box`를 받아 상품 카드 영역을 표시할 수 있다.

### 근거 매핑

- `LIGHTHOUSE`
- `WEB-VITALS`
- `BAYMARD-CHECKOUT`
- `NNG-HEURISTICS`

## 기존 Rule 흡수 후보

아래 후보는 별도 Rule로 만들기보다 기존 운영 Rule에 흡수하는 방향을 우선 검토한다.

| Candidate | 흡수 대상 | 이유 |
| --- | --- | --- |
| `PATH-PRIMARY-ACTION-CLARITY-001` | `PATH-CTA-001`, `PATH-CTA-002` | primary action이 보이는지, 또는 primary급 CTA가 서로 경쟁하는지는 기존 두 CTA Rule로 설명 가능하다. |
| `PATH-CTA-LABEL-SPECIFICITY-001` | `COPY-FLOW-QUALITY-001`, `JOURNEY-GOAL-CTA-MISMATCH-001` | CTA 라벨이 구체적인지 여부는 라벨-역할 맥락 또는 시나리오 목표 적합성 판단과 겹친다. |

## 15번 후보에서 최종 반영할 Rule

아래 Rule은 `docs/15_extraction_rule_candidates.md`에서 가져와 최종 Rule 후보로 반영한다.

| Rule | 현재 구현 가능성 | 필요한 핵심 evidence | 정리 방향 |
| --- | --- | --- | --- |
| `PATH-CHOICE-OVERLOAD-001` | 운영 구현됨 | `interactive_components.components[]`, `bounds`, `visibility`, `role`, `clickable`, viewport | 최종 유지한다. 다만 단순 viewport count보다 같은 decision area/group 기준으로 고도화한다. |
| `FEEDBACK-ACTION-RESULT-001` | 바로 구현 가능 | `goal_action_result`, `journey_action_raw`, `settle_status`, URL/DOM/toast 변화 | 신규 구현 우선순위가 가장 높다. 클릭 후 결과가 확인되는지 판단한다. |
| `TECH-TARGET-SIZE-001` | 운영 구현됨 | `interactive_components.components[].bounds`, `clickable`, `visibility`, scenario-used signal, CTA/form signal, text/selector/href | 목표 흐름 관련성 필터를 먼저 적용한 뒤 작은/tight target을 판단한다. |
| `A11Y-LINK-PURPOSE-001` | 추가 수집 후 구현 | `components[].nearby_text`, `container_heading`, `repeated_generic_link_grouping` | 반복 generic link가 주변 맥락 없이 목적을 알기 어려운지 판단한다. |
| `PATH-BACK-LINK-001` | 추가 수집 후 구현 | `step_indicator`, `back_link_candidate`, `history_back_available`, `flow_step_count` | 다단계 흐름에서 이전 단계 복귀 수단이 있는지 판단한다. |
| `PATH-ACCORDION-DISCOVERABILITY-001` | 추가 수집 후 구현 | `accordion_state`, `aria-expanded`, `hidden_panel_has_cta`, `hidden_panel_has_required_info`, `panel_relationship` | 접힌 패널 안에 필수 정보나 주요 CTA가 숨어 있는지 판단한다. |
| `FORM-INSTRUCTIONS-001` | 추가 수집 후 구현 | `describedby_text`, `help_text`, `input_format_hint`, `pattern`, `min`, `max`, `maxlength` | label 존재 여부와 별도로 입력 조건/형식 안내가 있는지 판단한다. |
| `FORM-REQUIRED-OPTIONAL-001` | 추가 수집 후 구현 | `required`, `visible_required_marker`, `visible_optional_marker`, `group_level_required_state` | DOM required와 화면상 필수/선택 표시가 사용자에게 일치되게 전달되는지 판단한다. |
| `FEEDBACK-SYSTEM-STATUS-001` | 추가 수집 후 구현 | `loading_state.has_spinner`, `has_progressbar`, `status_text`, `aria_busy`, `clicked_submit_disabled` | 오래 걸리는 행동 이후 처리 중 상태 피드백이 있는지 판단한다. |
| `CHECKOUT-ORDER-REVIEW-001` | 추가 수집 후 구현 | `checkout_context.is_checkout_flow`, `has_order_summary`, `has_editable_summary`, `has_final_submit`, `final_submit_relation` | checkout/booking/payment 최종 제출 전 요약 확인/수정 기회가 있는지 판단한다. |
| `CHECKOUT-LOAD-INDICATOR-001` | 추가 수집 후 구현 | `checkout_context.flow_subtype`, `action_kind`, `loading_state.*`, `clicked_submit_disabled` | 결제/예약 제출 후 처리 중 피드백과 중복 제출 방지가 있는지 판단한다. |

## 15번 후보 구현 우선순위

| 우선순위 | Rule | 이유 |
| --- | --- | --- |
| 1 | `FEEDBACK-ACTION-RESULT-001` | 현재 observation만으로 MVP 구현 가능성이 높고 사용자 체감 문제가 명확하다. |
| 2 | `PATH-CHOICE-OVERLOAD-001` | 이미 운영 구현되어 있으므로 decision area/group 기준으로 오탐을 줄이는 고도화가 우선이다. |
| 3 | `TECH-TARGET-SIZE-001` | 운영 구현 완료. 단순 clickable 전체가 아니라 시나리오 사용, CTA, form, 핵심 행동 키워드 중 하나라도 맞는 목표 관련 요소만 판단한다. |
| 4 | `A11Y-LINK-PURPOSE-001` | 주변 맥락 evidence가 있으면 독립 Rule로 가치가 높다. |
| 5 | `FORM-INSTRUCTIONS-001`, `FORM-REQUIRED-OPTIONAL-001` | form label 문제와 분리하면 INPUT 단계 Clarity Rule로 살릴 수 있다. |
| 6 | `PATH-BACK-LINK-001`, `PATH-ACCORDION-DISCOVERABILITY-001` | 구조 observation이 필요하지만 독립성이 높다. |
| 7 | `FEEDBACK-SYSTEM-STATUS-001`, `CHECKOUT-ORDER-REVIEW-001`, `CHECKOUT-LOAD-INDICATOR-001` | checkout/status context 수집 이후 도메인 한정 Rule로 구현한다. |
