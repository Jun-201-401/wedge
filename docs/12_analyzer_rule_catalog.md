# Analyzer Rule Catalog

이 문서는 Analyzer Rule을 추가하거나 수정할 때 기준점으로 쓰는 Rule 카탈로그다. 앞으로 Rule을 만들면 이 문서에 먼저 목적, 입력 증거, 판정 기준, 출력 영향을 정리한다.

## 운영 원칙

- Rule은 observation과 명시적 condition을 기반으로 판단한다.
- GMS/LLM은 Rule 결과를 대체하지 않고, 애매한 의미 분류나 설명 문장, 보조 점수 판단에 사용한다.
- 사용자-facing issue는 evidence_refs로 추적 가능한 증거가 있을 때만 만든다.
- `fix_leverage`는 `priority_score`에 들어가는 개선 효과 가중치이며, Rule별 evidence에서 개선 효과가 얼마나 강하게 드러나는지에 따라 산출한다.
- 깨진 문구, 인코딩 오류, OCR 오류처럼 읽기 자체가 어려운 문제는 `COPY-FLOW-QUALITY-001`에서 다루지 않고 별도 Rule로 분리한다.

## fix_leverage 5단계

| fix_leverage | 의미 | 기준 |
| --- | --- | --- |
| 0.8 | 낮음 | 문제는 있으나 보조 영역에 있고 목표 흐름 영향이 작다. |
| 0.95 | 약간 낮음 | 문제는 의심되지만 위치, 역할, 수정 대상 근거가 약하다. |
| 1.0 | 기본 | 일반적인 개선 효과다. 특별히 높이거나 낮출 근거가 없다. |
| 1.15 | 높음 | 실제 사용 경로, 주요 버튼, 입력 영역 근처라 고치면 흐름이 좋아질 가능성이 크다. |
| 1.3 | 매우 높음 | 핵심 행동, 입력, 완료 단계에서 작은 수정으로 큰 마찰을 줄일 수 있다. |

## 현재 Rule 목록

| criterion_id | Axis | Stage | 목적 |
| --- | --- | --- | --- |
| PATH-CTA-001 | Path | FIRST_VIEW, CTA | 목표와 관련된 주요 행동 진입점이 보이는지 판단한다. |
| PATH-CTA-002 | Path | CTA | 같은 결정 순간에 주요 버튼처럼 보이는 선택지가 과도하게 경쟁하는지 판단한다. |
| PATH-CHOICE-OVERLOAD-001 | Path | FIRST_VIEW, VALUE, CTA | 한 viewport 안에 동시에 보이는 interactive 선택지가 과도하게 많은지 판단한다. |
| FRICTION-FORM-001 | Friction | INPUT | 입력 필드에 목적을 알 수 있는 라벨이나 설명이 있는지 판단한다. |
| RELIABILITY-TECH-001 | Reliability | CTA, INPUT, COMMIT | 사용자 행동 직후 네트워크 실패나 콘솔 오류가 있는지 판단한다. |
| RELIABILITY-LOADING-STUCK-001 | Reliability | CTA, INPUT, COMMIT | 일반 페이지 전환 이후 다음 화면이 사용 가능한 상태로 렌더링되기까지 오래 걸리는지 판단한다. |
| JOURNEY-GOAL-CTA-MISMATCH-001 | Path | VALUE, CTA, COMMIT | 실제 선택된 버튼이 시나리오 목표와 의미적으로 맞는지 판단한다. |
| COPY-FLOW-QUALITY-001 | Clarity | FIRST_VIEW, VALUE, CTA, INPUT, COMMIT | 라벨이 요소의 역할과 주변 맥락을 제대로 설명하는지 판단한다. |
| COPY-LABEL-INTEGRITY-001 | Clarity | FIRST_VIEW, VALUE, CTA, INPUT, COMMIT | 라벨이나 짧은 문구가 깨지거나 잘리거나 겹치지 않고 읽히는지 판단한다. |

## Spring/Runner Evidence 필수 데이터

Analyzer는 URL을 직접 방문해 화면을 수집하지 않는다. Spring이 저장한 evidence packet 또는 Runner가 생성한 observation을 받아 Rule을 평가한다. 따라서 아래 데이터가 없으면 Rule은 `NOT_EVALUABLE`이 되거나 낮은 confidence로 fallback된다.

### 공통 packet 필드

| 위치 | 필수/권장 | 용도 |
| --- | --- | --- |
| `schema_version` | 필수 | Evidence packet 버전 식별. 현재 기본값은 `0.5`다. |
| `run_id` | 필수 | 분석 run 추적 및 Spring callback payload에 사용한다. |
| `scenario.goal` | 권장 | CTA 의미 판단, GMS 설명 문맥, 목표 적합성 판단에 사용한다. |
| `scenario.target_url` 또는 checkpoint `state.page.url` | 권장 | 어떤 URL을 분석했는지 리포트와 디버깅에서 추적한다. |
| `checkpoints[]` | 필수 | Rule은 checkpoint 단위 observation을 stage context로 묶어 평가한다. |
| `checkpoints[].checkpoint_id` | 필수 | `evidence_refs`를 `checkpoint_id.observation_id`로 만들기 위해 필요하다. |
| `checkpoints[].primaryStage` | 권장 | checkpoint state/network/console/settle 증거를 어느 stage에 귀속할지 결정한다. |
| `checkpoints[].trigger.type` | 권장 | `click`, `input`, `goto` 같은 행동 구분. 클릭 이후 reliability, CTA mismatch 등 행동 관련 Rule에서 stage attribution에 사용한다. |
| `checkpoints[].settle.status`, `checkpoints[].settle.duration_ms` | 권장 | loading stuck 판단의 보조 근거다. |
| `checkpoints[].state.page.title`, `state.page.url`, `state.page.ready_state` | 권장 | 리포트 문맥과 디버깅에 사용한다. |
| `checkpoints[].state.viewport.width`, `state.viewport.height` | 필수에 가까움 | viewport 기반 Rule과 problem component projection에 필요하다. 없으면 일부 Rule confidence가 낮아진다. |
| `checkpoints[].state.layout_summary.first_view.width`, `height` | 권장 | `state.viewport`가 없을 때 viewport fallback으로 사용한다. |
| `checkpoints[].artifact_refs[]` | 권장 | screenshot artifact와 observation을 연결한다. |
| `artifacts[]` | 권장 | screenshot, DOM snapshot 등 evidence artifact 목록이다. |
| screenshot artifact의 `signed_url`, `presignedUrl`, `url` | GMS 이미지 판단 시 필수 | GMS label-role/label-integrity 이미지 보조 판단에 필요하다. HTTP 접근 가능한 URL이어야 한다. |

### observation 공통 필드

| 위치 | 필수/권장 | 용도 |
| --- | --- | --- |
| `observation_id` | 필수 | `evidence_refs`와 문제 위치 추적에 사용한다. |
| `type` | 필수 | 어떤 Rule handler가 observation을 볼지 결정한다. |
| `stage` | 권장 | observation을 `FIRST_VIEW`, `VALUE`, `CTA`, `INPUT`, `COMMIT` 중 어디에 귀속할지 결정한다. 없으면 type별 기본 stage 또는 checkpoint stage를 사용한다. |
| `source[]` | 권장 | `dom`, `ax`, `layout`, `screenshot`, `network`, `console`, `scenario_log` 등 근거 품질 판단에 사용한다. |
| `confidence` | 권장 | Rule confidence 산출에 사용한다. |
| `data.bounds` 또는 `data.components[].bounds` | 위치 기반 Rule과 screenshot projection 시 필수 | `{x, y, width, height}` css pixel 기준. `problem_components` 생성과 GMS 후보 구성에 필요하다. |
| `data.text`, `visible_text`, `accessible_name`, `label_text`, `placeholder` | copy/CTA/form Rule에 권장 | 화면에 보이는 문구와 접근성 이름 판단에 사용한다. |
| `data.clicked_in_scenario`, `typed_in_scenario`, `filled_in_scenario` | 행동 관련 Rule에 권장 | 실제 사용자 경로와 관련된 요소인지 판단한다. |
| `data.visual_prominence` | copy/CTA Rule에 권장 | `low`, `medium`, `high`. severity와 `fix_leverage` 산출에 사용한다. |

### Rule별 최소 데이터

| criterion_id | 필요한 observation/type | 필수 data 필드 | 권장 data 필드 | 없을 때 영향 |
| --- | --- | --- | --- | --- |
| `PATH-CTA-001` | `cta_cluster` 또는 `interactive_components`, 보조로 `cta_candidate` | `cta_cluster.data.primary_like_cta_count` 또는 `interactive_components.data.primary_like_component_count` | `components[].is_primary_like`, `cta_candidate.data.visible_text`, `scenario.goal` | CTA 존재/부재를 안정적으로 판단하지 못해 issue가 안 나올 수 있다. |
| `PATH-CTA-002` | `cta_cluster` 또는 `interactive_components` | `primary_like_cta_count >= 3` 또는 `primary_like_component_count >= 3` | `components[].bounds`, `components[].is_primary_like`, `source=["dom","layout","screenshot"]` | primary급 CTA 경쟁을 놓친다. |
| `PATH-CHOICE-OVERLOAD-001` | `interactive_components` | `data.components[]` | `components[].clickable`, `role`, `visible`, `hidden`, `disabled`, `aria-hidden`, `aria-disabled`, `bounds`, checkpoint viewport | viewport 안 선택지 수를 세지 못하거나 DOM 전체 개수로 오탐/누락이 생긴다. |
| `FRICTION-FORM-001` | `form_field` 또는 `missing_label` | `data.label_association`와 `source`에 `dom` 또는 `ax` 포함 | `label_text`, `accessible_name`, `placeholder`, `visible`, `bounds` | label association 근거가 없으면 의도적으로 `NOT_EVALUABLE` 처리한다. |
| `RELIABILITY-TECH-001` | `network_failure`, `console_error` 또는 checkpoint state summary | `state.network_summary.failed_request_count` 또는 `state.console_summary.error_count` | observation 직접 제공 시 `type=network_failure/console_error`, `stage`, `source=["network"|"console"]` | run-level aggregate만 있으면 stage issue로 내지 않는다. checkpoint stage attribution이 필요하다. |
| `RELIABILITY-LOADING-STUCK-001` | `page_ready_timing`, 보조로 `loading_state`/`settle_response` | 일반 전환 식별 필드와 `duration_ms` | `action_kind`, `url_changed`, `route_changed`, `main_content_changed`, `target_page_signals` | 일반 전환과 권한 요청/스트리밍/지도/결제/인증/WebGL 같은 예외 흐름을 구분하지 못한다. |
| `JOURNEY-GOAL-CTA-MISMATCH-001` | `cta_candidate` | click checkpoint 안의 clicked CTA observation | `visible_text`, `accessible_name`, `target`, `clicked_in_scenario`, `scenario.goal`, semantic classification result | clicked CTA와 목표 불일치를 판단할 근거가 부족하다. |
| `COPY-FLOW-QUALITY-001` | `cta_candidate`, `interactive_components`, `form_field`, `form_error`, `required_field`, `missing_label`, `error_recovery`, `final_submit_candidate`, `other` | 명시 신호 `label_role_alignment.status="mismatch"` 또는 `issue_type`/`label_issue_type` | `expected_meaning`, `visual_prominence`, `clicked_in_scenario`, `is_primary_like`, `bounds`, screenshot URL for GMS | 라벨-역할 불일치 issue를 만들지 못한다. GMS 이미지 보조도 screenshot URL 없이는 동작하지 않는다. |
| `COPY-LABEL-INTEGRITY-001` | `first_view_message`, `value_proposition`, `feature_summary`, `cta_candidate`, `interactive_components`, `form_field`, `form_error`, `required_field`, `missing_label`, `final_submit_candidate` | 명시 신호 `label_integrity.status="issue"` 또는 `issue_type`/`integrity_issue_type` | `text`/`visible_text`, `visual_prominence`, `clicked_in_scenario`, `is_primary_like`, `bounds`, screenshot URL for GMS | 깨짐/잘림/겹침/가독성 issue를 만들지 못한다. 단, replacement character 등 일부는 deterministic resolver가 보강할 수 있다. |

### 최소 evidence packet 예시

아래 예시는 모든 Rule을 만족하는 완전한 packet이 아니라, Spring/Runner가 Analyzer로 넘겨야 하는 필드 구조의 최소 골격이다.

```json
{
  "schema_version": "0.5",
  "run_id": "run_001",
  "scenario": {
    "goal": "회원가입 시작 흐름 점검",
    "target_url": "https://example.com"
  },
  "aggregate_signals": {},
  "artifacts": [
    {
      "artifact_id": "screenshot_cp_001",
      "type": "screenshot",
      "url": "https://cdn.example.com/screenshot_cp_001.png"
    }
  ],
  "checkpoints": [
    {
      "checkpoint_id": "cp_001",
      "primaryStage": "CTA",
      "trigger": {
        "type": "click",
        "target": "a.start"
      },
      "settle": {
        "status": "timeout",
        "duration_ms": 9000
      },
      "artifact_refs": ["artifact:screenshot_cp_001"],
      "state": {
        "page": {
          "title": "Example",
          "url": "https://example.com",
          "ready_state": "complete"
        },
        "viewport": {
          "width": 1440,
          "height": 900
        },
        "network_summary": {
          "failed_request_count": 0
        },
        "console_summary": {
          "error_count": 0
        }
      },
      "observations": [
        {
          "observation_id": "obs_interactive_components",
          "type": "interactive_components",
          "stage": "CTA",
          "source": ["dom", "layout", "screenshot"],
          "confidence": 0.86,
          "data": {
            "primary_like_component_count": 3,
            "components": [
              {
                "text": "무료로 시작하기",
                "role": "link",
                "clickable": true,
                "visible": true,
                "is_primary_like": true,
                "clicked_in_scenario": true,
                "bounds": {
                  "x": 520,
                  "y": 360,
                  "width": 220,
                  "height": 56
                }
              }
            ]
          }
        }
      ]
    }
  ]
}
```

## PATH-CHOICE-OVERLOAD-001

### 목적

`PATH-CHOICE-OVERLOAD-001`은 한 viewport 안에 동시에 노출된 interactive 선택지가 과도하게 많아 사용자가 다음 이동이나 행동을 고르기 어려운지 판단한다.

이 Rule은 `PATH-CTA-002`와 다르다. `PATH-CTA-002`는 주요 버튼처럼 보이는 CTA들이 서로 경쟁하는지를 본다. `PATH-CHOICE-OVERLOAD-001`은 primary CTA 여부와 무관하게, 네이버 서비스 바로가기처럼 같은 화면에 클릭 가능한 선택지가 너무 많이 보이는 상황을 다룬다.

### 문제로 보는 경우

- 같은 viewport 안에 클릭 가능한 버튼, 링크, 탭, 메뉴 항목이 과도하게 많이 동시에 보인다.
- 선택지들이 비슷한 크기와 시각적 위계로 나열되어 우선순위를 알기 어렵다.
- 서비스 바로가기, 기능 바로가기, 주요 메뉴 묶음처럼 사용자가 하나를 골라 이동해야 하는 선택지가 너무 많다.
- FIRST_VIEW, VALUE, CTA 단계에서 다음 행동을 고르기 전에 비교해야 할 대상이 지나치게 많다.

### 문제로 보지 않는 경우

- viewport 밖에 있는 요소까지 전체 DOM 기준으로 많이 잡힌 경우다.
- 숨김, 비활성, `aria-hidden` 요소처럼 사용자가 실제 선택할 수 없는 대상이다.
- footer 링크, 법무/정책 링크, 사이트맵처럼 목표 행동 선택 부담과 관련이 약한 영역이다.
- 검색 결과, 상품 목록, 게시글 목록처럼 많은 반복 항목을 보여주는 것이 화면의 본래 목적이다.
- 선택지가 많더라도 그룹 제목, 카테고리, 시각적 위계가 명확해 사용자가 선택 구조를 쉽게 이해할 수 있다.

### 입력 신호

1차 입력은 `interactive_components` observation이다.

```json
{
  "type": "interactive_components",
  "stage": "FIRST_VIEW",
  "source": ["dom", "layout", "screenshot"],
  "data": {
    "components": [
      {
        "text": "메일",
        "role": "link",
        "clickable": true,
        "visible": true,
        "bounds": {
          "x": 176,
          "y": 16,
          "width": 64,
          "height": 96
        }
      }
    ]
  }
}
```

Analyzer는 `components.length`를 그대로 쓰지 않고, 다음 조건을 통과한 component만 카운트한다.

- `visible`이 `false`가 아니다.
- `hidden`, `disabled`, `aria-hidden`, `aria-disabled`가 아니다.
- `bounds`와 viewport가 있으면 현재 viewport와 교차한다.
- `clickable`이 `false`인 경우에는 button/link/menuitem/tab 같은 명시적 interactive role이 있어야 한다.

### 판정

| severity | 조건 |
| --- | --- |
| 0 | viewport 안의 visible interactive component가 `10개 이하`다. |
| 1 | viewport 안의 visible interactive component가 `11-14개`다. |
| 2 | viewport 안의 visible interactive component가 `15개 이상`이다. |
| 3 | CTA, INPUT, COMMIT 같은 핵심 행동 단계에서 `20개 이상`이 동시에 노출된다. |

### 이미지 보조 판단

이 Rule의 1차 후보는 deterministic count로 만든다. 다만 선택지 과다는 단순 개수뿐 아니라 밀도, 그룹핑, 시각적 위계에 영향을 받으므로 screenshot artifact가 있으면 GMS로 보조 판단할 수 있다.

GMS는 다음을 확인한다.

1. 선택지가 실제 같은 viewport 안에 동시에 보이는가?
2. 선택지들이 같은 바로가기/행동 그룹처럼 보이는가?
3. 그룹 제목, 카테고리, 시각적 위계가 선택 부담을 줄이는가?
4. nav/footer/반복 목록처럼 목표 행동 선택지로 보기 어려운 영역인가?

GMS 결과는 Rule을 단독으로 발생시키지 않고, severity 조정이나 false positive 억제에만 사용한다.

### 출력 영향

- `evidence_refs`는 문제가 된 `interactive_components` observation을 가리킨다.
- screenshot artifact가 있으면 count 대상 component의 `bounds`를 `problem_components`로 projection할 수 있다.
- summary는 “선택지가 많다”보다 “다음 이동이나 행동을 고르기 어렵다”는 사용자 영향으로 설명한다.

## RELIABILITY-LOADING-STUCK-001

### 목적

`RELIABILITY-LOADING-STUCK-001`은 사용자 행동 이후 일반 페이지 전환이나 라우트 전환이 발생했지만 다음 페이지 또는 결과 화면이 사용 가능한 상태로 렌더링되기까지 오래 걸리는지 판단한다.

이 Rule은 `RELIABILITY-TECH-001`과 다르다. `RELIABILITY-TECH-001`은 네트워크 실패나 콘솔 오류처럼 명시적인 기술 오류를 다룬다. `RELIABILITY-LOADING-STUCK-001`은 기술 오류가 없더라도 일반적인 화면 전환이 느려 사용자가 멈춘 것처럼 느낄 수 있는 상황을 다룬다.

### 문제로 보는 경우

- 클릭 이후 내부 링크, 메뉴, 탭, route change 같은 일반 전환이 발생했다.
- 다음 화면의 main content 또는 route가 바뀌었지만 page ready 시간이 5초 이상이다.
- 시뮬레이션, AI 생성, 업로드, 결제, 인증, 외부 이동 같은 heavy/exception 신호가 없다.
- 명시적 네트워크 실패나 콘솔 오류가 없다.

### 문제로 보지 않는 경우

- 일반 전환이 아니라 submit, download, modal, 새 탭, 같은 페이지 anchor scroll이다.
- `target_page_signals`에서 권한 요청, 스트리밍, 지도, 결제, 인증 redirect, WebGL 신호가 확인된다.
- 같은 stage에 네트워크 실패나 콘솔 오류가 있어 `RELIABILITY-TECH-001`에서 다루는 상황이다.
- page ready 시간이 5초 미만이다.

### 입력 신호

우선 입력은 `page_ready_timing` observation이다.

```json
{
  "observation_id": "obs_page_ready_timing",
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
    "same_origin": true,
    "duration_ms": 6200,
    "target_page_signals": {
      "has_permission_prompt": false,
      "has_streaming_response": false,
      "has_map": false,
      "has_webgl": false,
      "has_payment_form": false,
      "has_auth_redirect": false
    }
  }
}
```

보조 입력으로 `loading_state`나 `settle_response`를 사용할 수 있다. 다만 이 경우에도 `action_kind`, `url_changed`/`route_changed`/`main_content_changed`, `target_page_signals` 같은 일반 전환 판별 필드가 있어야 한다.

### 일반 전환 판별

일반 전환으로 보려면 다음 조건을 만족해야 한다.

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
has_permission_prompt, has_streaming_response, has_map,
has_payment_form, has_auth_redirect, has_webgl
```

### 판정

| severity | 조건 |
| --- | --- |
| 0 | 일반 전환이 아니거나, 일반 전환이 5초 미만에 준비된다. |
| 2 | 일반 전환의 `duration_ms`가 `5000ms` 이상이다. |
| 3 | 일반 전환의 `duration_ms`가 `8000ms` 이상이거나 COMMIT stage 전환이 지연된다. |

### 출력 영향

- `evidence_refs`는 문제가 된 `page_ready_timing`, `loading_state`, 또는 `settle_response` observation을 가리킨다.
- signal에는 `page_ready_threshold_ms`, `duration_ms`, 일반 전환 판별 결과를 포함한다.
- summary는 “로딩이 길다”보다 “일반 전환 후 다음 화면이 사용 가능한 상태가 되기까지 오래 걸린다”는 사용자 영향으로 설명한다.

## COPY-FLOW-QUALITY-001

### 목적

`COPY-FLOW-QUALITY-001`은 문구가 예쁜지 평가하지 않는다. 이 Rule은 화면 요소의 역할 또는 주변 맥락상 기대되는 의미와 실제 라벨이 맞지 않아 사용자가 기능을 오해하거나 다음 행동을 망설일 수 있는지 판단한다.

### 문제로 보는 경우

- 설정, 검색, 닫기, 뒤로가기, 제출, 결제 등 명확한 기능 요소의 라벨이 역할과 다르다.
- 버튼이나 링크의 라벨이 실제 기대 행동과 다르다.
- 현재 단계의 목표와 상관없는 라벨이 중요한 행동처럼 보인다.
- 아이콘, 위치, 역할은 특정 기능을 암시하는데 텍스트가 전혀 다른 의미를 가진다.
- 라벨이 장난스럽거나 무관해서 기능을 예측하기 어렵다.

### 문제로 보지 않는 경우

- 더 좋은 카피로 바꿀 수는 있지만 현재 기능은 이해된다.
- 브랜드 톤이나 마케팅 표현으로 의도된 문구일 가능성이 높다.
- 단순히 짧거나 평범한 라벨이다.
- 깨짐, 인코딩 오류, OCR 오류처럼 읽기 자체가 어려운 문제다.
- observation이나 screenshot에서 확인되지 않는 추측이다.

### 입력 신호

우선 대상 observation은 사용자가 행동하거나 판단해야 하는 요소에 집중한다.

- `cta_candidate`
- `interactive_components`
- `form_field`
- `form_error`
- `required_field`
- `missing_label`
- `error_recovery`
- `final_submit_candidate`
- `other`

Analyzer는 checkpoint의 screenshot artifact에 `signed_url`, `presignedUrl`, `url` 같은 HTTP 이미지 URL이 있으면 observation 후보와 이미지를 GMS에 함께 보내 라벨-역할 불일치 신호를 만들 수 있다. Spring이 아직 이미지 URL을 넣지 않은 경우에는 Runner/Spring이 다음과 같은 명시 신호를 observation `data` 또는 `components[]`에 넣어도 같은 Rule이 동작한다.

```json
{
  "text": "삐까츄",
  "role": "button",
  "expected_meaning": "설정",
  "label_role_alignment": {
    "status": "mismatch",
    "issue_type": "label_role_mismatch"
  },
  "visual_prominence": "high",
  "clicked_in_scenario": true,
  "bounds": {
    "x": 24,
    "y": 1160,
    "width": 120,
    "height": 40
  }
}
```

### issue_type

| issue_type | 의미 |
| --- | --- |
| label_role_mismatch | 요소의 역할과 라벨이 맞지 않는다. |
| intent_mismatch | 현재 시나리오 목표 또는 화면 단계와 라벨 의도가 맞지 않는다. |
| irrelevant_label | 현재 요소나 화면 맥락과 무관한 라벨이다. |
| misleading_label | 누르면 일어날 행동을 잘못 예상하게 만드는 라벨이다. |
| misleading_copy | 라벨 또는 짧은 문구가 행동 의미를 오해하게 만든다. |
| unclear_label | 기능을 예측하기 어려운 라벨이다. |

### fix_leverage 산출

- `0.8`: 낮은 강조도의 보조 요소이고 실제 경로와 관련이 약하다.
- `0.95`: 라벨 문제 신호는 있으나 위치 정보가 없어 수정 대상을 명확히 잡기 어렵다.
- `1.0`: 일반적인 라벨-역할 불일치다.
- `1.15`: 실제 클릭 경로, 주요 버튼, CTA/COMMIT 단계에 걸려 있다.
- `1.3`: CTA/INPUT/COMMIT 단계의 실제 경로 또는 주요 요소에서 라벨이 역할과 강하게 어긋난다.

### LLM 활용 방향

GMS/LLM은 screenshot signed URL과 observation 후보를 함께 보고 다음 질문에 답한다.

1. 이 요소의 역할, 위치, 주변 맥락상 기대되는 의미는 무엇인가?
2. 실제 라벨이 그 기대 의미를 설명하는가?
3. 불일치한다면 사용자가 기능을 오해하거나 다음 행동을 망설일 수 있는가?
4. `fix_leverage` 5단계 중 어디에 해당하는가?

Analyzer는 LLM 응답을 그대로 신뢰하지 않고, candidate_id, issue_type, confidence, fix_leverage 허용값을 검증한 뒤 observation에 `label_role_alignment`를 붙이고 RuleHit으로 만든다.

## COPY-LABEL-INTEGRITY-001

### 목적

`COPY-LABEL-INTEGRITY-001`은 라벨의 의미가 적절한지 판단하지 않는다. 이 Rule은 버튼, 링크, 입력, 안내 문구가 깨지거나 잘리거나 겹쳐서 사용자가 텍스트를 정상적으로 읽기 어려운지 판단한다.

### 문제로 보는 경우

- 인코딩이 깨진 문자가 보인다.
- `�`, `□`, `???`처럼 의미 없는 대체 문자가 반복된다.
- 버튼, 링크, 입력 라벨이 말줄임이나 overflow로 잘린다.
- 라벨이 다른 요소와 겹친다.
- 렌더링 문제로 글자 일부가 가려지거나 읽기 어렵다.

### 문제로 보지 않는 경우

- 라벨이 특이하지만 읽을 수 있다.
- 라벨이 요소 역할과 어울리지 않는다. 이 경우는 `COPY-FLOW-QUALITY-001`에서 다룬다.
- 버튼 문구가 모호하다. 이 경우는 별도 구체성 Rule 후보로 둔다.
- 브랜드 톤이나 마케팅 문구가 마음에 들지 않는다.

### 처리 흐름

1. Analyzer가 observation 텍스트를 1차 deterministic으로 검사한다.
2. `�`, mojibake, `???`, 명시적 `text_clipped`, `text_overlap`, `text_truncated` 신호는 바로 `label_integrity`를 붙인다.
3. 1차에서 확정되지 않았고 bounds와 screenshot URL이 있는 후보만 GMS에 보낸다.
4. GMS는 이미지에서 잘림, 겹침, 렌더링 가독성 문제만 판단한다.
5. Analyzer는 `candidate_id`, `issue_type`, `confidence`, `fix_leverage`를 검증한 뒤 RuleHit으로 만든다.

### 입력 신호 예시

```json
{
  "text": "설...",
  "role": "button",
  "bounds": {
    "x": 520,
    "y": 360,
    "width": 80,
    "height": 36
  },
  "label_integrity": {
    "status": "issue",
    "issue_type": "text_truncated",
    "reason": "버튼 라벨이 말줄임으로 표시되어 전체 행동을 읽기 어렵다",
    "source": "deterministic",
    "fix_leverage": 1.15,
    "confidence": 0.9
  }
}
```

### issue_type

| issue_type | 의미 |
| --- | --- |
| encoding_broken | 인코딩이 깨진 문자열이다. |
| replacement_character | `�` 같은 대체 문자가 포함되어 있다. |
| placeholder_garbage | `???`, `□□□`처럼 의미 없는 대체 문구다. |
| text_truncated | 말줄임 또는 overflow로 전체 문구가 보이지 않는다. |
| text_clipped | 요소 영역 안에서 글자가 잘렸다. |
| text_overlap | 다른 텍스트나 UI와 겹친다. |
| low_readability_rendering | 렌더링 문제로 읽기 어렵다. |

### fix_leverage 산출

- `0.8`: 낮은 강조도의 보조 문구라 목표 흐름 영향이 작다.
- `0.95`: 문제는 의심되지만 위치나 시각 증거가 약하다.
- `1.0`: 일반적인 읽기 무결성 문제다.
- `1.15`: 주요 버튼, 입력, 실제 클릭 경로 주변 문구라 개선 효과가 크다.
- `1.3`: 핵심 행동, 입력, 완료 단계의 문구가 읽히지 않아 큰 마찰을 만들 수 있다.
