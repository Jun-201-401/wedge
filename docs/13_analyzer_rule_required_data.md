# 13. Analyzer Rule Required Data

## 목적

이 문서는 Analyzer Rule Engine에 들어가는 룰별로, 현재 Runner/Spring Evidence 흐름에서 이미 받을 수 있는 데이터와 추가로 보존해야 하는 데이터를 정리한다.

판단 기준은 다음 문서를 따른다.

- `docs/08_observation_mapping.md`
- `docs/10_rule_journey_observation_strategy.md`
- `docs/12_analyzer_rule_catalog.md`

Runner/Discovery는 최종 UX 판단값이 아니라 DOM, layout, click, URL, network, screenshot 같은 raw signal을 남긴다. Analyzer는 이 raw signal을 기반으로 Rule 판단을 수행한다.

## 요약

| Rule ID | Axis | Stages | 판단 대상 | 추가로 필요한 핵심 데이터 |
| --- | --- | --- | --- | --- |
| PATH-CHOICE-OVERLOAD-001 | Path | FIRST_VIEW, VALUE, CTA | 한 viewport 안에 동시에 보이는 interactive 선택지가 과도하게 많은지 판단한다. | `components[].decision_area_id`, `components[].decision_area_role`, `components[].container_bounds` |
| FRICTION-FORM-001 | Friction | INPUT | 입력 필드에 목적을 알 수 있는 라벨이나 설명이 있는지 판단한다. | `form_field.data.label_association`, `label_text`, `accessible_name`, `placeholder`, `visible`, `bounds` |
| RELIABILITY-LOADING-STUCK-001 | Reliability | CTA, INPUT, COMMIT | 일반 페이지 전환 이후 다음 화면이 사용 가능한 상태로 렌더링되기까지 오래 걸리는지 판단한다. | `page_ready_timing.data.duration_ms`, `action_kind`, `url_changed/route_changed/main_content_changed`, `target_page_signals` |

## PATH-CHOICE-OVERLOAD-001

### 룰 정의

| Rule ID | Axis | Stages | 설명 |
| --- | --- | --- | --- |
| PATH-CHOICE-OVERLOAD-001 | Path | FIRST_VIEW, VALUE, CTA | 한 viewport 안, 또는 같은 decision area 안에 동시에 보이는 interactive 선택지가 과도하게 많은지 판단한다. |

### 판단하려는 문제

이 룰은 사용자가 현재 화면에서 너무 많은 선택지를 동시에 보고 있어 다음 행동을 고르기 어려운 상황을 찾는다.

예시는 다음과 같다.

- 첫 viewport 안에 서비스 바로가기, 메뉴, 탭, 카드, 링크가 과도하게 많다.
- 같은 DOM 구역 안에 클릭 가능한 선택지가 지나치게 많이 몰려 있다.
- primary CTA 경쟁은 아니지만, 선택 가능한 항목 수 자체가 많아 의사결정 부담이 커진다.

### 현재 이미 받을 수 있는 데이터

`docs/08_observation_mapping.md` 기준으로 Runner는 DOM에서 실제 클릭 가능한 요소와 layout bounds를 수집해 `interactive_components` observation을 만들 수 있다.

현재 받을 수 있는 주요 값은 다음과 같다.

| 필드 | 설명 |
| --- | --- |
| `interactive_components.components[]` | 클릭 가능한 DOM 요소 목록 |
| `components[].text` | 요소의 표시 텍스트 |
| `components[].selector` | 요소 selector |
| `components[].role` | 접근성/DOM role |
| `components[].tag` | DOM tag |
| `components[].clickable` | 클릭 가능한 요소인지 여부 |
| `components[].clicked_in_scenario` | 실제 시나리오에서 클릭된 요소인지 여부 |
| `components[].is_cta_candidate` | CTA 후보인지 여부 |
| `components[].is_primary_like` | primary CTA처럼 보이는지 여부 |
| `components[].bounds` | 요소의 viewport 기준 위치와 크기 |
| `checkpoint.state.viewport` 또는 `checkpoint.state.layout_summary.first_view` | viewport 크기 |

현재 Runner 수집은 대체로 `visible && clickable && bounds.width > 0 && bounds.height > 0`인 요소를 남긴다. 따라서 Analyzer는 이미 클릭 가능한 요소의 viewport 교차 여부를 계산할 수 있다.

### 현재 데이터만으로 가능한 판단

현재 데이터만으로 가능한 것은 다음이다.

- viewport 안에 보이는 clickable component 수 계산
- `bounds`가 viewport와 교차하는 component만 카운트
- `role`, `clickable` 기반으로 countable choice 필터링
- `components.length`가 아니라 visible/clickable/bounds 기준으로 필터링한 수를 사용

다만 현재 데이터만으로는 같은 decision area 안에 몰린 선택지인지 안정적으로 알기 어렵다.

### 추가로 필요한 데이터

이 룰을 "한 viewport 안"뿐 아니라 "같은 decision area 안"까지 판단하려면, 각 클릭 요소가 어떤 DOM 구역에 속하는지 보존해야 한다.

추가 필드는 다음 3개를 우선 권장한다.

| 추가 필드 | 위치 | 설명 | 필요 이유 |
| --- | --- | --- | --- |
| `decision_area_id` | `components[]` | 같은 선택 구역을 공유하는 component를 묶는 ID | 같은 구역 안 선택지 개수를 세기 위해 필요 |
| `decision_area_role` | `components[]` | 선택 구역의 유형 | 구역 성격별 threshold/severity 조정을 위해 필요 |
| `container_bounds` | `components[]` | 선택 구역 DOM container의 viewport 기준 bounds | 구역이 현재 viewport 안에 보이는지, 선택지가 한 영역에 밀집됐는지 판단하기 위해 필요 |

### 필드 설명

#### `components[].decision_area_id`

같은 선택 구역에 속한 interactive component를 묶는 안정 ID다.

예를 들어 네이버 바로가기 영역의 `메일`, `카페`, `블로그`, `뉴스`, `지도`가 같은 DOM container에 속한다면 모두 같은 `decision_area_id`를 가져야 한다.

```json
{
  "text": "메일",
  "decision_area_id": "area_shortcut_nav"
}
```

Analyzer는 이 값을 기준으로 다음처럼 계산할 수 있다.

```text
area_shortcut_nav 안의 countable interactive choice count = 11
```

생성 기준은 DOM 기반이어야 한다. 예를 들어 가장 가까운 의미 있는 ancestor selector, role, DOM path hash를 조합해 만들 수 있다.

#### `components[].decision_area_role`

decision area의 성격을 나타낸다.

권장 값 예시는 다음과 같다.

| 값 | 의미 |
| --- | --- |
| `shortcut_grid` | 서비스 바로가기, 아이콘 바로가기 묶음 |
| `nav_menu` | 상단/사이드 navigation 메뉴 |
| `tab_bar` | 탭 선택 영역 |
| `filter_group` | 필터 chip 또는 조건 선택 영역 |
| `card_grid` | 카드형 항목 그리드 |
| `pricing_options` | 가격제/플랜 선택 영역 |
| `form_options` | 폼 안의 radio/checkbox/select option 묶음 |
| `category_menu` | 카테고리 메뉴 |
| `unknown` | 구역 유형을 안정적으로 분류하지 못함 |

이 값이 필요한 이유는 같은 개수라도 구역 유형에 따라 해석이 다를 수 있기 때문이다.

예를 들어 `shortcut_grid`나 `nav_menu`에서 15개 선택지는 선택 부담으로 볼 가능성이 크지만, `card_grid`에서는 정상 탐색 목록일 수도 있다.

#### `components[].container_bounds`

decision area를 감싸는 DOM container의 viewport 기준 위치와 크기다.

```json
{
  "container_bounds": {
    "x": 140,
    "y": 16,
    "width": 1200,
    "height": 124,
    "unit": "css_px"
  }
}
```

이 값으로 Analyzer는 다음을 판단할 수 있다.

- decision area가 현재 viewport와 교차하는가?
- 선택지가 좁은 영역 안에 밀집되어 있는가?
- viewport 밖 container를 현재 화면 선택지 과다로 오탐하지 않는가?

좌표계는 `components[].bounds`와 동일하게 CSS pixel 기준의 viewport 좌표계를 권장한다.

### 권장 Evidence Shape

```json
{
  "observation_id": "cp_001.obs_interactive_components",
  "type": "interactive_components",
  "stage": "FIRST_VIEW",
  "source": ["dom", "layout", "ax"],
  "confidence": 0.86,
  "data": {
    "components": [
      {
        "text": "메일",
        "selector": "a.service-mail",
        "role": "link",
        "tag": "a",
        "clickable": true,
        "clicked_in_scenario": false,
        "is_cta_candidate": false,
        "is_primary_like": false,
        "bounds": {
          "x": 176,
          "y": 28,
          "width": 64,
          "height": 88,
          "unit": "css_px"
        },
        "decision_area_id": "area_shortcut_nav",
        "decision_area_role": "shortcut_grid",
        "container_bounds": {
          "x": 140,
          "y": 16,
          "width": 1200,
          "height": 124,
          "unit": "css_px"
        }
      }
    ]
  }
}
```

### DOM 기반 수집 기준

이 룰은 이미지 기반 판단이 아니라 DOM 기반 수집을 기본으로 한다.

Runner는 각 clickable element에 대해 다음을 수행한다.

1. DOM에서 clickable 후보를 수집한다.
2. `getBoundingClientRect()`로 component `bounds`를 계산한다.
3. 가장 가까운 의미 있는 ancestor를 찾는다.
4. ancestor의 selector/role/label/bounds를 기반으로 decision area를 만든다.
5. 같은 ancestor를 공유하는 component에 같은 `decision_area_id`를 부여한다.

의미 있는 ancestor 후보는 다음과 같다.

- `nav`
- `menu`
- `section`
- `form`
- `ul`, `ol`
- `header`, `footer`
- `[role=navigation]`
- `[role=menu]`
- `[role=tablist]`
- `[role=listbox]`
- `[aria-label]`
- stable `id`, `class`, `data-*`가 있는 container

### Analyzer 판단 방식

Analyzer는 다음 두 축을 함께 볼 수 있어야 한다.

| 판단 축 | 설명 |
| --- | --- |
| viewport count | 현재 viewport 안에 보이는 countable interactive component 수 |
| decision area count | 같은 `decision_area_id` 안에 있는 countable interactive component 수 |

권장 판단 예시는 다음과 같다.

```text
viewport_count >= 15
또는
same_decision_area_count >= 11
이면 issue 후보
```

최종 threshold는 fixture와 calibration을 통해 조정한다.

### 현재 부족한 점

현재 Runner/Spring 흐름은 clickable component 목록과 bounds는 받을 수 있지만, decision area grouping 정보는 명시적으로 보존되지 않는다.

따라서 현재 데이터만 쓰면 다음 한계가 있다.

- viewport 전체 선택지 과다는 볼 수 있다.
- 특정 DOM 구역 안에 선택지가 몰린 상황은 안정적으로 구분하기 어렵다.
- `components[]`가 상위 N개로 제한되면 실제 전체 선택지 수를 과소평가할 수 있다.

### Spring/Runner에 요청할 추가 데이터

우선순위는 다음과 같다.

| 우선순위 | 요청 데이터 | 이유 |
| --- | --- | --- |
| P0 | `components[].decision_area_id` | 같은 구역 선택지 count를 계산하기 위한 최소 grouping key |
| P0 | `components[].container_bounds` | 해당 구역이 viewport 안에 보이는지 확인하기 위한 위치 정보 |
| P1 | `components[].decision_area_role` | 구역 유형별 threshold/severity 조정을 위한 보조 정보 |
| P1 | `interactive_components.data.total_count` | Runner가 상위 N개만 보낼 때 실제 viewport 내 전체 count 보존 |
| P2 | `decision_areas[]` | area 단위 label, role, bounds, count를 별도 구조로 보존 |

## FRICTION-FORM-001

### 룰 정의

| Rule ID | Axis | Stages | 설명 |
| --- | --- | --- | --- |
| FRICTION-FORM-001 | Friction | INPUT | 입력 필드에 목적을 알 수 있는 라벨이나 설명이 있는지 판단한다. |

### 판단하려는 문제

이 룰은 사용자가 입력 필드에 무엇을 입력해야 하는지 즉시 이해할 수 있는지 확인한다.

예시는 다음과 같다.

- visible input은 있지만 연결된 label이 없다.
- accessible name이 비어 있다.
- placeholder만 있고, placeholder가 사라지면 필드 목적을 알기 어렵다.
- DOM/AX 기준으로 label association이 확인되지 않는다.

### 현재 Analyzer 로직

Analyzer는 `form_field` 또는 `missing_label` observation을 본다.

다만 아무 `form_field`나 판단하지 않고, 반드시 label association 근거가 있어야 한다.

현재 판단 전제는 다음과 같다.

```text
data.label_association 존재
그리고
source에 dom 또는 ax 포함
```

이 조건이 없으면 룰은 의도적으로 `NOT_EVALUABLE`로 처리한다.

현재 판단 흐름은 다음과 같다.

| 조건 | 결과 |
| --- | --- |
| `missing_label` observation이 있고 label association 근거가 있음 | issue, severity 2 |
| `form_field`가 visible이 아니거나 label/accessibile name이 있음 | issue 없음 |
| `form_field`에 label/accessibile name이 없고 placeholder만 있음 | issue, severity 1 |
| `form_field`에 label/accessibile name도 placeholder도 없음 | issue, severity 2 |
| `label_association` 근거가 없음 | NOT_EVALUABLE |
| `source=["screenshot"]`만 있음 | NOT_EVALUABLE |

### 현재 이미 받을 수 있는 데이터

현재 Runner/Spring 흐름에서 `form_field` observation은 받을 수 있다.

현재 예시는 다음 수준이다.

```json
{
  "type": "form_field",
  "stage": "INPUT",
  "source": ["dom", "scenario_log"],
  "data": {
    "field_key": "Email",
    "value_length": 22
  }
}
```

현재 받을 수 있는 주요 값은 다음과 같다.

| 필드 | 설명 |
| --- | --- |
| `form_field` observation | 입력 필드가 있었다는 사실 |
| `field_key` | Runner가 입력 대상으로 사용한 필드 식별자 |
| `value_length` | 입력된 값 길이 |
| `source=["dom"]` | DOM 기반 관찰이라는 최소 근거 |

### 현재 부족한 점

현재 `form_field`에는 Analyzer가 실제 판단에 필요한 label/accessibility 정보가 기본으로 보존되지 않는다.

부족한 값은 다음과 같다.

| 부족한 필드 | 이유 |
| --- | --- |
| `data.label_association` | label이 input과 연결되어 있는지 판단하는 핵심 근거 |
| `data.label_text` | visible label 존재 여부 확인 |
| `data.accessible_name` | AX name 또는 aria-label 기반 목적 확인 |
| `data.placeholder` | placeholder-only인지 판단 |
| `data.visible` | 보이지 않는 필드는 issue에서 제외 |
| `data.bounds` | 화면 위치와 report highlight/projection에 필요 |
| `source=["ax"]` | 접근성 기반 label/name 근거 신뢰도 향상 |

### 추가로 필요한 데이터

`FRICTION-FORM-001`을 안정적으로 판단하려면 `form_field.data`에 다음 값을 추가로 보존해야 한다.

| 추가 필드 | 타입 | 필수도 | 설명 |
| --- | --- | --- | --- |
| `label_association` | boolean | P0 | label 또는 aria-labelledby가 input과 명시적으로 연결되어 있는지 |
| `label_text` | string | P0 | 연결되었거나 근처에서 식별된 visible label 텍스트 |
| `accessible_name` | string | P0 | AX name, aria-label, aria-labelledby 결과 |
| `placeholder` | string | P0 | input placeholder 텍스트 |
| `visible` | boolean | P0 | 현재 viewport/layout 기준 visible 여부 |
| `bounds` | object | P1 | input의 viewport 기준 bounds |
| `input_type` | string | P1 | `email`, `text`, `search`, `password`, `tel` 등 |
| `required` | boolean | P2 | 필수 입력 여부 |
| `selector` | string | P1 | input selector |
| `label_source` | string | P2 | `for`, `aria-label`, `aria-labelledby`, `ancestor_label`, `nearby_text`, `none` 등 |

### 권장 Evidence Shape

```json
{
  "observation_id": "cp_002.obs_form_email",
  "type": "form_field",
  "stage": "INPUT",
  "source": ["dom", "ax", "layout"],
  "confidence": 0.82,
  "data": {
    "field_key": "Email",
    "selector": "input#email",
    "input_type": "email",
    "value_length": 22,
    "visible": true,
    "label_association": false,
    "label_text": "",
    "accessible_name": "",
    "placeholder": "Email",
    "label_source": "none",
    "bounds": {
      "x": 420,
      "y": 360,
      "width": 320,
      "height": 44,
      "unit": "css_px"
    }
  }
}
```

위 예시는 label/accessibile name이 없고 placeholder만 있으므로 `FRICTION-FORM-001`에서 severity 1 후보가 된다.

완전히 누락된 경우는 다음과 같다.

```json
{
  "type": "form_field",
  "stage": "INPUT",
  "source": ["dom", "ax", "layout"],
  "data": {
    "selector": "input#company",
    "visible": true,
    "label_association": false,
    "label_text": "",
    "accessible_name": "",
    "placeholder": "",
    "bounds": {
      "x": 420,
      "y": 420,
      "width": 320,
      "height": 44,
      "unit": "css_px"
    }
  }
}
```

이 경우는 severity 2 후보가 된다.

### DOM/AX 기반 수집 기준

Runner는 input/select/textarea 같은 form control에 대해 다음 값을 수집해야 한다.

1. DOM selector와 tag/type을 수집한다.
2. `getBoundingClientRect()`로 `bounds`를 계산한다.
3. `display`, `visibility`, size, viewport 교차 여부로 `visible`을 계산한다.
4. 연결 label을 찾는다.
   - `<label for="input_id">`
   - input을 감싸는 `<label>`
   - `aria-label`
   - `aria-labelledby`
   - 접근성 tree의 name
5. 연결 결과를 `label_association`으로 보존한다.
6. label 텍스트와 accessible name을 각각 `label_text`, `accessible_name`으로 보존한다.
7. placeholder를 별도로 보존한다.

### Analyzer 판단 방식

Analyzer는 다음처럼 판단한다.

```text
label_association 근거 없음
=> NOT_EVALUABLE

visible=false
=> issue 없음

label_text 또는 accessible_name 있음
=> issue 없음

label_text/accessibile_name 없음 + placeholder 있음
=> placeholder_only issue, severity 1

label_text/accessibile_name 없음 + placeholder 없음
=> missing_label issue, severity 2
```

### Spring/Runner에 요청할 추가 데이터

우선순위는 다음과 같다.

| 우선순위 | 요청 데이터 | 이유 |
| --- | --- | --- |
| P0 | `form_field.data.label_association` | 현재 Analyzer가 이 값 없이는 판단하지 않음 |
| P0 | `form_field.data.label_text` | visible label 존재 여부 판단 |
| P0 | `form_field.data.accessible_name` | AX/ARIA 기반 목적 판단 |
| P0 | `form_field.data.placeholder` | placeholder-only severity 분기 |
| P0 | `form_field.data.visible` | 숨겨진 필드 제외 |
| P1 | `form_field.data.bounds` | evidence projection과 위치 확인 |
| P1 | `form_field.data.selector` | DOM에서 해당 input을 식별하기 위한 raw selector |

### 결론

현재 `form_field` observation 자체는 존재하지만, `label_association`과 label/accessibility 관련 필드는 기본으로 보존되지 않는다.

따라서 `FRICTION-FORM-001`은 기존 observation type을 그대로 쓰되, `form_field.data`에 label association 관련 raw signal을 추가해야 실제 판단 가능하다.

## RELIABILITY-LOADING-STUCK-001

### 룰 정의

| Rule ID | Axis | Stages | 설명 |
| --- | --- | --- | --- |
| RELIABILITY-LOADING-STUCK-001 | Reliability | CTA, INPUT, COMMIT | 일반 페이지 전환 이후 다음 화면이 사용 가능한 상태로 렌더링되기까지 오래 걸리는지 판단한다. |

### 현재 구현 상태

이 룰은 현재 Rule Engine registry와 handler map에 연결되어 있다.

판단의 우선 근거는 `page_ready_timing` observation이다. `loading_state`나 `settle_response`도 fallback으로 사용할 수 있지만, 이 경우에도 일반 페이지 전환인지 판단할 수 있는 action/result/exception 필드가 같이 있어야 한다.

명시적인 network failure 또는 console error가 있으면 이 룰은 issue를 만들지 않고 `RELIABILITY-TECH-001`이 우선 설명한다.

### 판단하려는 문제

이 룰은 일반적인 링크, 메뉴, 탭, route change 이후 다음 페이지나 결과 화면이 사용 가능한 상태로 렌더링되기까지 오래 걸리는 상황을 찾는다.

예시는 다음과 같다.

- 내부 링크 클릭 후 다음 화면의 main content가 5초 이상 늦게 준비된다.
- 메뉴 이동이나 SPA route change 이후 새 화면이 8초 이상 사용 가능하지 않다.
- 일반 탭 전환인데 새 tab panel이 오래 빈 상태로 남아 있다.

반대로 다음은 예외로 제외한다.

- 시뮬레이션, AI 생성, long-running job처럼 본질적으로 오래 걸릴 수 있는 흐름
- 파일 업로드/다운로드
- 결제, 인증, SSO, 외부 redirect
- 권한 요청, streaming, 지도, 결제, 인증 redirect, WebGL
- streaming response
- canvas/WebGL/map처럼 무거운 초기화가 필요한 화면

### 추가로 필요한 observation

권장 observation은 `page_ready_timing`이다.

```json
{
  "observation_id": "cp_003.obs_page_ready_timing",
  "type": "page_ready_timing",
  "stage": "CTA",
  "source": ["performance", "dom", "layout", "scenario_log"],
  "confidence": 0.86,
  "data": {
    "trigger_type": "click",
    "action_kind": "link_click",
    "url_changed": true,
    "route_changed": true,
    "main_content_changed": true,
    "tab_panel_changed": false,
    "history_changed": true,
    "same_origin": true,
    "http_method": "GET",
    "duration_ms": 6200,
    "target_page_signals": {
      "has_permission_prompt": false,
      "has_streaming_response": false,
      "has_map": false,
      "has_payment_form": false,
      "has_auth_redirect": false,
      "has_webgl": false
    }
  }
}
```

`loading_state` 또는 `settle_response`로 fallback할 때도 같은 일반 전환 판별 필드를 `data`에 포함해야 한다.

### 필요한 필드

| 필드 | 타입 | 필수도 | 설명 |
| --- | --- | --- | --- |
| `data.duration_ms` | number | P0 | 사용자 action 이후 다음 화면이 ready 되기까지 걸린 시간 |
| `data.trigger_type` | string | P0 | 보통 `click`이어야 일반 전환 후보로 본다. |
| `data.action_kind` | string | P0 | `navigation`, `route_change`, `link_click`, `menu_click`, `tab_change` 중 하나면 일반 전환 후보 |
| `data.url_changed` | boolean | P0 | URL 변경 여부 |
| `data.route_changed` | boolean | P0 | SPA route 변경 여부 |
| `data.main_content_changed` | boolean | P0 | main content 변경 여부 |
| `data.tab_panel_changed` | boolean | P1 | tab panel 변경 여부 |
| `data.history_changed` | boolean | P1 | browser history push/replace 여부 |
| `data.same_origin` | boolean | P1 | false이면 외부 이동으로 제외 |
| `data.http_method` | string | P1 | `POST` 등 GET이 아니면 일반 전환에서 제외 |
| `data.form_submit` | boolean | P1 | true이면 일반 전환에서 제외 |
| `data.download_triggered` | boolean | P1 | true이면 일반 전환에서 제외 |
| `data.external_redirect` | boolean | P1 | true이면 일반 전환에서 제외 |
| `data.modal_opened` | boolean | P1 | true이면 페이지 전환이 아니라 모달 흐름으로 제외 |
| `data.target_blank` | boolean | P1 | 새 탭/새 창 이동이면 제외 |
| `data.anchor_scroll` | boolean | P2 | 같은 페이지 anchor scroll만 있으면 제외 |
| `data.target_page_signals` | object | P0 | 일반 페이지 이동 속도 판단에서 제외할 target page raw signals |

### 일반 페이지 전환 판별

Analyzer는 다음 조건을 모두 만족할 때만 일반 전환으로 본다.

```text
trigger_type == "click"
action_kind in ["navigation", "route_change", "link_click", "menu_click", "tab_change"]
url_changed 또는 route_changed 또는 main_content_changed 또는 tab_panel_changed 또는 history_changed
same_origin != false
http_method 없음 또는 GET
form_submit/download_triggered/external_redirect/modal_opened/target_blank가 아님
target_page_signals의 예외 신호가 모두 false
```

예외 신호는 다음 6개만 사용한다.

```text
has_permission_prompt
has_streaming_response
has_map
has_payment_form
has_auth_redirect
has_webgl
```

### Analyzer 판단 방식

```text
technical failure 있음
=> RELIABILITY-TECH-001 우선, 이 룰은 suppress

일반 페이지 전환 아님
=> issue 없음

target_page_signals 중 하나라도 true
=> issue 없음

일반 페이지 전환이고 duration_ms >= 8000
=> severity 3

일반 페이지 전환이고 duration_ms >= 5000
=> severity 2

그 외
=> issue 없음
```

### Spring/Runner에 요청할 추가 데이터

| 우선순위 | 요청 데이터 | 이유 |
| --- | --- | --- |
| P0 | `page_ready_timing.data.duration_ms` | 렌더링/ready 지연 판단의 핵심 |
| P0 | `trigger_type`, `action_kind` | 일반 페이지 전환 후보 판별 |
| P0 | `url_changed`, `route_changed`, `main_content_changed` | 실제 전환 결과 확인 |
| P0 | `target_page_signals` | 권한 요청/스트리밍/지도/결제/인증/WebGL 예외 제외 |
| P1 | `same_origin`, `http_method`, `form_submit`, `download_triggered`, `external_redirect` | 일반 전환 오탐 방지 |
| P1 | `tab_panel_changed`, `history_changed` | URL 없는 SPA/tab 전환 보강 |
| P2 | `anchor_scroll`, `modal_opened`, `target_blank` | 페이지 전환이 아닌 인터랙션 제외 |

### 결론

이 룰은 더 이상 단순히 spinner가 오래 보이는지만 판단하지 않는다.

일반적인 페이지/라우트/메뉴/탭 전환이 맞는지 먼저 판별하고, 시뮬레이션이나 AI 생성처럼 무거운 흐름은 예외로 제외한 뒤, 다음 화면이 사용 가능한 상태로 준비되기까지 걸린 시간을 기준으로 issue를 만든다.
