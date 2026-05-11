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
| RELIABILITY-LOADING-STUCK-001 | Reliability | CTA, INPUT, COMMIT | 사용자 행동 이후 로딩 상태가 오래 지속되고 결과가 확인되지 않는지 판단한다. | `loading_state.data.loading_visible`, `duration_ms`, `selector`, `text`, `bounds` |
| TARGET-SIZE-001 | Friction | FIRST_VIEW, VALUE, CTA, INPUT | Google 검색창 기준 대비 검색 입력 영역이 충분한지 판단한다. | `bounds.width`, `bounds.height`, `role/input_type`, `placeholder/label_text/accessible_name`, viewport width |

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
| RELIABILITY-LOADING-STUCK-001 | Reliability | CTA, INPUT, COMMIT | 사용자 행동 이후 로딩 상태가 오래 지속되고 결과가 확인되지 않는지 판단한다. |

### 현재 구현 상태

이 룰은 현재 Rule Engine registry와 handler map에 연결되어 있다.

우선 판단 근거는 `loading_state` observation이다. `loading_state`가 없을 때만 `settle_response.data.settle_status = timeout` 또는 `stuck` 같은 값을 약한 fallback 근거로 사용한다.

클릭 후 timeout 전용 룰은 별도로 두지 않고, loading UI가 오래 유지되는 문제는 이 룰에서만 다룬다.

### 판단하려는 문제

이 룰은 사용자가 클릭, 제출, 입력 완료 같은 행동을 한 뒤 다음 상태가 명확히 확인되지 않고, loading spinner, skeleton, progress UI가 오래 유지되는 상황을 찾는다.

예시는 다음과 같다.

- 버튼 클릭 후 spinner가 8초 이상 계속 보인다.
- form submit 후 skeleton UI만 유지되고 성공/실패 메시지가 없다.
- checkout/commit action 후 progress indicator가 사라지지 않는다.
- `settle_status`가 `timeout` 또는 `stuck`이고 화면 결과도 확인되지 않는다.

### 기존 데이터로 가능한 판단

현재 기존 데이터로 가능한 것은 timeout 기반의 약한 fallback 판단이다.

이미 받을 수 있는 값은 다음과 같다.

| 기존 데이터 | 설명 |
| --- | --- |
| `settle_response.data.settle_status` | action 이후 settle 결과. `timeout`, `failed`, `settled` 등 |
| `checkpoints[].settle.status` | checkpoint 단위 settle 상태 |
| `checkpoints[].settle.duration_ms` | settle 소요 시간 |
| `settle_item_count_change` | 기대한 상태 변화가 있었는지 확인하는 보조 근거 |

이 값으로는 "행동 이후 결과가 timeout 됐다"는 판단은 가능하다.

하지만 다음은 판단하기 어렵다.

- 실제 spinner/skeleton/progress가 화면에 보였는가?
- 로딩 UI가 얼마나 오래 유지됐는가?
- 어떤 로딩 요소가 문제였는가?
- 로딩 상태가 결과 피드백 없이 남아 있었는가?

따라서 정확한 룰 판단에는 `loading_state` observation이 필요하다.

### 추가로 필요한 observation

`loading_state` observation을 추가로 보존해야 한다.

권장 형태는 다음과 같다.

```json
{
  "observation_id": "cp_003.obs_loading_state",
  "type": "loading_state",
  "stage": "CTA",
  "source": ["dom", "layout"],
  "data": {
    "loading_visible": true,
    "duration_ms": 9000,
    "selector": ".loading-spinner",
    "text": "Loading...",
    "loading_role": "spinner",
    "bounds": {
      "x": 640,
      "y": 360,
      "width": 80,
      "height": 80,
      "unit": "css_px"
    }
  }
}
```

### 필요한 필드

| 필드 | 타입 | 필수도 | 설명 |
| --- | --- | --- | --- |
| `loading_visible` | boolean | P0 | 로딩 UI가 현재 화면에 보이는지 |
| `duration_ms` | number | P0 | 로딩 UI가 관찰된 지속 시간 |
| `selector` | string | P1 | 로딩 요소 DOM selector |
| `text` | string | P1 | 로딩 요소 또는 주변 안내 문구 |
| `loading_role` | string | P1 | `spinner`, `skeleton`, `progressbar`, `busy_region`, `unknown` 등 |
| `bounds` | object | P1 | 로딩 요소의 viewport 기준 위치와 크기 |
| `aria_busy` | boolean | P2 | `aria-busy=true` 여부 |
| `role` | string | P2 | DOM/ARIA role. 예: `progressbar`, `status` |

### 필드 설명

#### `loading_visible`

로딩 상태를 나타내는 UI가 현재 viewport에 보이는지 나타낸다.

DOM 기반으로 다음 후보를 찾을 수 있다.

- spinner class 또는 progress class
- `[role=progressbar]`
- `[aria-busy=true]`
- skeleton placeholder class
- loading text
- disabled submit button과 함께 나타나는 progress indicator

이 값은 최종 UX 판단이 아니라, DOM/layout에서 관찰 가능한 raw signal이다.

#### `duration_ms`

로딩 UI가 관찰된 지속 시간이다.

Runner는 action 직후부터 settle 종료 또는 timeout까지 loading indicator가 유지된 시간을 측정해 넣는다.

예:

```json
{
  "loading_visible": true,
  "duration_ms": 9000
}
```

Analyzer는 이 값을 threshold와 비교한다.

권장 초기 기준은 다음과 같다.

```text
duration_ms >= 8000 => issue 후보
duration_ms >= 15000 => 강한 issue 후보
```

#### `selector`

로딩 요소를 다시 식별하기 위한 DOM selector다.

예:

```json
{
  "selector": ".checkout-submit .spinner"
}
```

#### `text`

로딩 UI에 표시된 텍스트나 주변 안내 문구다.

예:

```text
Loading...
처리 중...
잠시만 기다려 주세요
```

이 값은 리포트 설명과 evidence 확인에 도움이 된다.

#### `loading_role`

로딩 UI의 유형이다.

권장 값은 다음과 같다.

| 값 | 의미 |
| --- | --- |
| `spinner` | 회전 로딩 아이콘 |
| `skeleton` | skeleton placeholder |
| `progressbar` | progress bar 또는 role=progressbar |
| `busy_region` | aria-busy 기반 busy 영역 |
| `button_pending` | 클릭한 버튼 내부 pending 상태 |
| `unknown` | 유형을 안정적으로 분류하지 못함 |

#### `bounds`

로딩 UI의 viewport 기준 위치와 크기다.

```json
{
  "bounds": {
    "x": 640,
    "y": 360,
    "width": 80,
    "height": 80,
    "unit": "css_px"
  }
}
```

이 값은 report highlight와 로딩 요소 위치 확인에 사용한다.

### DOM 기반 수집 기준

Runner는 사용자 action 이후 일정 시간 동안 다음을 관찰한다.

1. action 직후 DOM snapshot을 본다.
2. loading indicator 후보를 찾는다.
3. 후보가 viewport 안에 보이는지 확인한다.
4. 후보가 사라지는 시점 또는 settle timeout 시점까지 지속 시간을 측정한다.
5. loading indicator가 계속 보이면 `loading_state` observation을 남긴다.

후보 selector 기준은 다음과 같이 시작할 수 있다.

```text
[role=progressbar]
[role=status]
[aria-busy=true]
.spinner
.loading
.loader
.progress
.skeleton
[class*=spinner]
[class*=loading]
[class*=loader]
[class*=skeleton]
```

### Analyzer 판단 방식

권장 판단 흐름은 다음과 같다.

```text
loading_state.loading_visible=true
그리고 duration_ms >= 8000
=> severity 2 후보

loading_state.loading_visible=true
그리고 duration_ms >= 15000
=> severity 3 후보

COMMIT stage에서 timeout/stuck 또는 오래 지속된 loading
=> severity 3 후보
```

보조 fallback으로 다음도 볼 수 있다.

```text
loading_state 없음
그리고 settle_response.data.settle_status in ["timeout", "stuck"]
=> weak loading/result-stuck 후보
```

다음 결과 확인 신호가 있으면 loading stuck issue를 만들지 않는다.

```text
settle_response.data.settle_status in ["settled", "success", "succeeded", "complete", "completed"]
settle_item_count_change.data.current_count >= expected_count
명시적 success toast 또는 completion message observation
```

명시적인 network failure 또는 console error가 있으면 `RELIABILITY-TECH-001`을 우선한다.

### Spring/Runner에 요청할 추가 데이터

우선순위는 다음과 같다.

| 우선순위 | 요청 데이터 | 이유 |
| --- | --- | --- |
| P0 | `loading_state.data.loading_visible` | 실제 로딩 UI가 보였는지 판단 |
| P0 | `loading_state.data.duration_ms` | 오래 지속됐는지 threshold 비교 |
| P1 | `loading_state.data.selector` | DOM evidence 추적 |
| P1 | `loading_state.data.text` | 리포트 설명과 화면 문구 확인 |
| P1 | `loading_state.data.loading_role` | spinner/skeleton/progress 유형 구분 |
| P1 | `loading_state.data.bounds` | report highlight와 viewport 내 위치 확인 |
| P2 | `loading_state.data.aria_busy` | aria-busy 기반 loading 상태 확인 |
| P2 | `loading_state.data.role` | progress/status role 보조 확인 |

### 결론

기존 `settle_response`와 checkpoint settle 정보만으로 timeout 기반 약한 판단은 가능하다.

하지만 `RELIABILITY-LOADING-STUCK-001`의 핵심인 "로딩 UI가 오래 유지됨"을 정확히 판단하려면 `loading_state` observation을 추가로 받아야 한다.

## TARGET-SIZE-001

### 룰 정의

| Rule ID | Axis | Stages | 설명 |
| --- | --- | --- | --- |
| TARGET-SIZE-001 | Friction | FIRST_VIEW, VALUE, CTA, INPUT | Google 검색창 기준 대비 검색 입력 영역이 충분한지 판단한다. |

### 현재 구현 상태

현재 `apps/analyzer/app/rule_engine/handlers/target_size.py`에 handler 구현은 존재한다.

하지만 현재 Rule Engine registry와 handler map에는 연결되어 있지 않다. 따라서 지금 analyzer 기본 실행에서는 이 룰이 평가되지 않는다.

### 판단하려는 문제

이 룰은 검색 입력창의 실제 입력 영역이 지나치게 작아서 사용자가 검색창을 찾거나 클릭하거나 검색어를 입력하기 어려운 상황을 찾는다.

예시는 다음과 같다.

- 검색창이 있지만 높이가 너무 낮아 클릭하기 어렵다.
- 검색 입력 영역의 폭이 Google 검색창 기준 대비 지나치게 좁다.
- 모바일이나 좁은 viewport에서 검색창이 거의 아이콘 수준으로 줄어든다.
- 실제 검색 흐름에서 사용한 검색창의 hit area가 작다.

### 기존 데이터로 가능한 판단

현재 기존 데이터만으로는 안정적인 판단이 불가능하다.

이미 받을 수 있는 값은 일부 checkpoint, observation, form field 정보지만, 이 룰에 필요한 핵심 데이터가 보장되지 않는다.

| 기존 데이터 | 현재 한계 |
| --- | --- |
| `form_field` | `field_key`, `value_length` 중심이면 검색창 크기 판단 불가 |
| `interactive_components` | 클릭 요소 목록은 있어도 검색 입력창의 `bounds`와 search 식별 필드가 보장되지 않음 |
| checkpoint viewport fallback | 일부 packet에는 `layout_summary.first_view.width`가 있지만 검색창 기준 폭 계산에 필요한 viewport width가 항상 안정적이지 않음 |

따라서 기존 데이터만으로는 다음을 판단하기 어렵다.

- 어떤 요소가 검색 입력창인지
- 검색 입력창의 실제 `width`, `height`가 얼마인지
- 그 크기가 viewport 기준으로 충분한지
- 실제 사용자가 검색 흐름에서 사용한 입력창인지

### 추가로 필요한 observation

우선 기존 observation type을 재사용할 수 있다.

- `form_field`
- `interactive_components`
- `cta_candidate`
- `final_submit_candidate`

다만 위 observation의 `data` 또는 `components[]` 안에 검색 입력창 식별 필드와 크기 필드를 보존해야 한다.

권장 형태는 다음과 같다.

```json
{
  "observation_id": "cp_001.obs_search_field",
  "type": "form_field",
  "stage": "FIRST_VIEW",
  "source": ["dom", "layout"],
  "data": {
    "field_key": "search",
    "role": "searchbox",
    "input_type": "search",
    "placeholder": "검색어를 입력하세요",
    "label_text": "검색",
    "accessible_name": "검색",
    "selector": "input[type='search']",
    "bounds": {
      "x": 320,
      "y": 120,
      "width": 180,
      "height": 28,
      "unit": "css_px"
    },
    "clicked_in_scenario": true,
    "typed_in_scenario": true
  }
}
```

`interactive_components` 안에 들어오는 경우는 다음처럼 `components[]`에 같은 필드를 넣는다.

```json
{
  "observation_id": "cp_001.obs_interactive_components",
  "type": "interactive_components",
  "stage": "FIRST_VIEW",
  "source": ["dom", "layout"],
  "data": {
    "components": [
      {
        "text": "",
        "role": "searchbox",
        "input_type": "search",
        "placeholder": "Search",
        "selector": "header input.search",
        "bounds": {
          "x": 24,
          "y": 16,
          "width": 96,
          "height": 30,
          "unit": "css_px"
        },
        "typed_in_scenario": true
      }
    ]
  }
}
```

### 필요한 필드

| 필드 | 타입 | 필수도 | 설명 |
| --- | --- | --- | --- |
| `data.bounds.width` | number | P0 | 검색 입력 영역의 실제 폭 |
| `data.bounds.height` | number | P0 | 검색 입력 영역의 실제 높이 |
| `data.hit_area_bounds.width` | number | P1 | 실제 클릭 가능한 hit area 폭. 있으면 `bounds`보다 우선 사용 가능 |
| `data.hit_area_bounds.height` | number | P1 | 실제 클릭 가능한 hit area 높이 |
| `data.role` | string | P0 | `searchbox`이면 검색창 후보로 식별 |
| `data.input_type` 또는 `data.type` | string | P0 | `search`, `search_input`, `searchbox`이면 검색창 후보로 식별 |
| `data.placeholder` | string | P1 | 검색창 식별 보조 근거 |
| `data.label_text` | string | P1 | 검색창 식별 보조 근거 |
| `data.accessible_name` | string | P1 | 검색창 식별 보조 근거 |
| `data.selector` | string | P1 | DOM evidence 추적과 검색창 식별 보조 근거 |
| `data.id`, `data.class`, `data.name` | string | P2 | `search`, `검색` 키워드 기반 식별 보조 근거 |
| `data.clicked_in_scenario` | boolean | P2 | 실제 사용 흐름에서 클릭한 검색창인지 확인 |
| `data.typed_in_scenario` | boolean | P1 | 실제 검색어 입력 대상인지 확인 |
| `checkpoints[].state.viewport.width` | number | P0 | Google 기준 폭과 viewport 기반 reference width 계산 |
| `checkpoints[].state.layout_summary.first_view.width` | number | P1 | viewport width가 없을 때 fallback |

### 필드 설명

#### `bounds`

검색 입력창의 viewport 기준 위치와 크기다.

이 룰은 크기 판단 룰이기 때문에 `bounds.width`, `bounds.height`가 없으면 판단할 수 없다.

```json
{
  "bounds": {
    "x": 24,
    "y": 16,
    "width": 96,
    "height": 30,
    "unit": "css_px"
  }
}
```

#### `hit_area_bounds`

실제 클릭 가능한 영역이 시각적 bounds와 다를 때 사용한다.

있으면 Analyzer는 `hit_area_bounds`를 우선 사용할 수 있다.

```json
{
  "hit_area_bounds": {
    "x": 20,
    "y": 12,
    "width": 120,
    "height": 36,
    "unit": "css_px"
  }
}
```

#### search 식별 필드

검색창인지 판단하기 위한 DOM 기반 raw signal이다.

우선순위는 다음과 같다.

```text
role == "searchbox"
또는 input_type/type/component_type in ["search", "search_input", "searchbox"]
또는 placeholder/label_text/accessible_name/selector/id/class/name에 "search" 또는 "검색" 포함
```

#### viewport width

Google 기준 검색창 폭은 584px을 기준으로 삼되, viewport가 더 좁으면 viewport width에서 margin을 뺀 값을 기준 폭으로 사용한다.

따라서 checkpoint에 다음 중 하나가 필요하다.

```json
{
  "state": {
    "viewport": {
      "width": 1440,
      "height": 900
    }
  }
}
```

또는 fallback:

```json
{
  "state": {
    "layout_summary": {
      "first_view": {
        "width": 1440,
        "height": 900
      }
    }
  }
}
```

### DOM 기반 수집 기준

Runner는 DOM에서 다음 후보를 검색 입력창 후보로 수집할 수 있다.

```text
input[type=search]
[role=searchbox]
form[role=search] input
[aria-label*=search]
[aria-label*=검색]
[placeholder*=search]
[placeholder*=검색]
[name*=search]
[id*=search]
[class*=search]
```

후보마다 다음을 함께 저장한다.

1. DOM selector
2. role
3. input type
4. placeholder, label, accessible name
5. bounds 또는 hit area bounds
6. viewport 안에 보이는지 여부
7. 실제 scenario에서 클릭/입력했는지 여부

### Analyzer 판단 방식

권장 판단 흐름은 다음과 같다.

```text
검색창 후보 식별
그리고 bounds.width / bounds.height 존재
그리고 viewport width 존재 또는 fallback 가능
=> Google 기준 대비 크기 계산 가능
```

현재 handler 기준 threshold는 다음과 같다.

```text
height < 32
또는 width_ratio < 0.55
또는 width < 100
=> severity 2

height < 40
또는 width_ratio < 0.75
또는 width < 120
=> severity 1

실제 scenario에서 사용한 검색창이고
height < 32 또는 width_ratio < 0.45 또는 width < 100
=> severity 3
```

`width_ratio`는 다음처럼 계산한다.

```text
reference_width = min(584, viewport_width - 32)
width_ratio = search_width / reference_width
```

### Spring/Runner에 요청할 추가 데이터

우선순위는 다음과 같다.

| 우선순위 | 요청 데이터 | 이유 |
| --- | --- | --- |
| P0 | `form_field.data.bounds.width` / `height` | 검색 입력창 크기 판단의 핵심 |
| P0 | `interactive_components.data.components[].bounds.width` / `height` | 검색창이 components 안에 들어올 때 크기 판단 |
| P0 | `role` 또는 `input_type/type` | 검색창 후보 식별 |
| P0 | `checkpoints[].state.viewport.width` | Google 기준 대비 폭 계산 |
| P1 | `placeholder`, `label_text`, `accessible_name` | 검색창 후보 식별 보강 |
| P1 | `selector` | evidence 추적과 재현성 |
| P1 | `hit_area_bounds` | 실제 클릭 가능 영역이 시각적 bounds와 다를 때 정확도 향상 |
| P1 | `typed_in_scenario` | 실제 검색 흐름과 관련된 입력창인지 판단 |
| P2 | `id`, `class`, `name` | 검색 키워드 기반 식별 보조 |
| P2 | `clicked_in_scenario` | 사용 흐름 관련도 보조 판단 |

### 결론

현재 기존 데이터만으로는 `TARGET-SIZE-001`을 판단하기 어렵다.

검색창 후보 식별 필드와 `bounds.width`, `bounds.height`, viewport width가 추가로 들어와야 DOM 기반으로 안정적인 판단이 가능하다.
