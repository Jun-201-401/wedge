# 10. Journey Rule과 Observation 설계 기준

## 1. 목적

이 문서는 Journey 기반 Rule을 만들기 위해 Runner, Discovery, Spring Evidence, Analyzer가 어떤 observation 기준을 맞춰야 하는지 정리한다.

Rule은 중요한 컴포넌트를 무조건 지적하는 구조가 아니다. 사용자가 목표 행동에 도달하는 과정에서 발생하는 마찰, 우회, 실패, 불명확성을 찾는 구조다.

장바구니 담기는 대표 예시일 뿐이다. 실제 기준은 다음과 같은 목표 행동 전반에 적용한다.

- 예약하기
- 문의하기
- 무료 체험 시작
- 결제 시작
- 가입 완료
- 장바구니 담기
- 다운로드
- 상담 신청

따라서 Rule은 "이 버튼이 중요해 보인다"를 판단하는 것이 아니라, "사용자가 목표 행동까지 올바르게 도달했고, 불필요한 우회 없이 실제 행동 결과가 성공했는가"를 판단해야 한다.

## 2. 현재 MVP 기준

현재 MVP에서 안정적으로 확인된 observation은 아래 항목 중심이다.

- `cta_candidate`
- `form_field`
- `console_error`
- `network_failure`
- `settle_response`
- `settle_item_count_change`

이 observation으로는 CTA, form, reliability Rule을 검증할 수 있다.

예를 들어 CTA 후보가 있는지, 입력 필드가 관찰되는지, 사용자 행동 직후 console error나 network failure가 발생했는지는 판단할 수 있다.

하지만 상품 탐색부터 목표 행동 완료까지의 Journey Rule을 만들기에는 아직 signal이 부족하다. 특히 다음 질문에 답하려면 추가 observation signal이 필요하다.

- 사용자가 어떤 목표 대상을 발견했는가?
- 발견한 대상의 상세 정보를 확인했는가?
- 목표 행동 버튼을 올바르게 찾았는가?
- 클릭이나 입력 이후 실제 상태가 성공적으로 바뀌었는가?
- 카테고리, 필터, 검색 이동이 정상 탐색인지 불필요한 우회인지 구분 가능한가?
- 목표 대상 발견 이후 목표 행동까지 몇 단계가 걸렸는가?

## 3. Raw Signal과 Derived Intent

Runner가 넘겨야 하는 것은 최종 판단값이 아니라 판단 가능한 근거다.

Runner와 Discovery는 브라우저에서 관찰 가능한 URL, DOM, click, result 기반 signal을 남긴다. Rule Engine과 GMS/LLM은 이 signal을 바탕으로 의미를 교차 판단한다.

### Raw Signal

Raw signal은 Runner/Discovery가 직접 수집할 수 있는 관찰값이다.

- `clicked_text`
- `clicked_selector`
- `element_role`
- `element_text`
- `aria_label`
- `url_before`
- `url_after`
- `title_before`
- `title_after`
- `breadcrumb_before`
- `breadcrumb_after`
- `cart_count_before`
- `cart_count_after`
- `toast_text`
- `visible_price`
- `visible_product_image`
- `add_to_cart_like_button`
- `dom_changed`
- `network_result`
- `settle_status`
- `screenshot_artifact_id`
- `bbox`

### Derived Intent

Derived intent는 raw signal을 바탕으로 Rule Engine과 GMS/LLM이 판단하는 의미다.

- `product_detail_view`
- `add_to_cart`
- `category_changed`
- `depth_from_discovery`
- 정상 탐색 여부
- 불필요한 우회 여부
- 목표 행동 성공 여부

`product_detail_view`, `add_to_cart`, `category_changed`는 Runner가 단독으로 확정해서 넘기는 최종 label이 아니다. Runner가 수집한 signal을 기준으로 Rule Engine이 먼저 결정 가능한 부분을 판정하고, 애매한 intent는 GMS/LLM으로 보조 검증한다.

## 4. Journey Observation 후보

### `product_card`

`product_card`는 사용자가 선택할 수 있는 목표 대상 후보를 의미한다.

상품 카드에만 한정하지 않는다. 서비스 유형에 따라 플랜, 강의, 숙소, 매물, 콘텐츠 카드, 다운로드 항목, 상담 상품 등으로 확장할 수 있다.

필요한 이유:

- 사용자가 목표 후보를 발견했는지 판단할 수 있다.
- 이후 상세 진입이나 목표 행동까지의 기준점을 잡을 수 있다.
- `depth_from_discovery` 계산의 시작점이 된다.

권장 raw signal:

- `element_text`
- `element_role`
- `clicked_selector`
- `visible_price`
- `visible_product_image`
- `screenshot_artifact_id`
- `bbox`

### `product_detail_view`

`product_detail_view`는 목표 후보를 선택한 뒤 상세 정보를 확인하는 단계다.

Runner가 직접 "상품 상세 페이지다"라고 확정하기보다, 상품 카드 클릭 후 URL, title, 가격, 이미지, 상세 CTA 변화가 함께 관찰될 때 Rule Engine과 GMS/LLM이 판단하는 derived intent로 둔다.

필요한 이유:

- 목표 행동 전에 사용자가 충분한 정보를 확인했는지 판단할 수 있다.
- 상세 확인 없이 바로 목표 행동으로 넘어가는 흐름과 정상 상세 탐색 흐름을 구분할 수 있다.
- 상세 페이지 진입 후 CTA가 사라지거나 약해지는 문제를 잡을 수 있다.

권장 raw signal:

- `url_before`
- `url_after`
- `title_after`
- `clicked_text`
- `visible_price`
- `visible_product_image`
- `add_to_cart_like_button`
- `breadcrumb_after`
- `dom_changed`

### `add_to_cart`

`add_to_cart`는 장바구니 담기에 한정하지 않고 목표 행동 실행 여부를 뜻한다.

서비스별로 다음 행동까지 포함할 수 있다.

- 신청하기
- 예약하기
- 문의하기
- 결제 시작
- 무료 체험 시작
- 다운로드
- 가입 완료

필요한 이유:

- 사용자의 목표 행동이 실제로 수행됐는지 확인할 수 있다.
- CTA가 보이는 것과 실제로 동작하는 것을 구분할 수 있다.
- 클릭 이후 성공 toast, URL 이동, count 변화, network result를 통해 행동 결과를 검증할 수 있다.

권장 raw signal:

- `clicked_text`
- `clicked_selector`
- `url_before`
- `url_after`
- `toast_text`
- `cart_count_before`
- `cart_count_after`
- `network_result`
- `settle_status`
- `dom_changed`

### `category_changed`

`category_changed`는 탐색 범위가 바뀐 signal이다.

카테고리 변경, 필터 변경, 검색어 변경은 사용자의 정상 탐색일 수 있다. 따라서 이 값은 곧바로 문제를 의미하지 않는다. 목표와 비교해 정상 탐색인지 불필요한 우회인지 판단하기 위한 근거로 사용한다.

필요한 이유:

- 단순 step 수만으로 depth를 과판정하지 않기 위해 필요하다.
- 사용자가 의도적으로 탐색 범위를 바꾼 것인지, 목표 행동으로 가는 길에서 이탈한 것인지 구분할 수 있다.
- category/filter/search 이동을 예외로 처리할 수 있다.

권장 raw signal:

- `clicked_text`
- `url_before`
- `url_after`
- `breadcrumb_before`
- `breadcrumb_after`
- `selected_filter_before`
- `selected_filter_after`
- `search_query_before`
- `search_query_after`

### `depth_from_discovery`

`depth_from_discovery`는 목표 후보를 처음 발견한 뒤 목표 행동까지 몇 step이 걸렸는지 나타낸다.

이 값은 전환 마찰과 경로 복잡도를 판단하는 핵심 지표다. 다만 depth가 길다고 무조건 문제로 보지 않는다. 정상 탐색, 필수 옵션 선택, 카테고리 전환, 필터 적용 같은 예외를 함께 고려해야 한다.

필요한 이유:

- 목표 행동까지 사용자가 얼마나 돌아가는지 판단할 수 있다.
- 전환 경로가 과도하게 복잡한지 확인할 수 있다.
- "발견은 쉬운데 실행은 어렵다" 같은 문제를 찾을 수 있다.

권장 raw signal:

- `step_order`
- `step_key`
- `action_type`
- `stage`
- `intent_candidate`
- `is_detour_candidate`
- `category_changed`
- `filter_changed`
- `search_submitted`
- `goal_action_result`

## 5. Rule 판단 방식

Journey Rule은 단순히 점수를 빼는 방식이 아니다.

`priority_score = severity × stage_weight × confidence × fix_leverage`는 문제의 크기, 발생 위치, 근거의 확실성, 수정 효과를 함께 반영하기 위한 구조다.

- `severity`: 사용자 목표 달성에 주는 방해 정도
- `stage_weight`: 문제가 발생한 의사결정 단계의 중요도
- `confidence`: observation/evidence가 얼마나 확실한지
- `fix_leverage`: 고쳤을 때 사용자 불편이나 전환 마찰이 줄어들 가능성

예를 들어 목표 행동 버튼이 보이지만 클릭 후 아무 변화가 없다면 severity가 높다. 같은 문제가 `COMMIT` 단계에서 발생하면 stage weight도 높다. 클릭 전후 URL, DOM, network, toast 변화가 모두 없으면 confidence가 높아진다. 작은 문구 수정으로 해결 가능한 문제가 아니라 핵심 경로를 단순화해야 하는 문제라면 fix leverage도 높게 볼 수 있다.

이 공식은 중요한 컴포넌트를 무조건 1순위로 올리기 위한 것이 아니다. 사용자 목표 달성에 실제로 큰 마찰을 주고, 근거가 확실하며, 고쳤을 때 개선 효과가 큰 finding을 우선 보여주기 위한 것이다.

## 6. GMS/LLM 활용 기준

GMS/LLM은 Rule 결과를 대체하지 않는다.

Rule Engine은 observation과 deterministic condition을 기준으로 stage, severity, confidence, evidence_refs를 만든다. GMS/LLM은 다음 영역을 보조한다.

- 애매한 intent 분류
- 정상 탐색과 불필요한 우회 구분
- `fix_leverage` 보조 판단
- 사용자-facing 설명 문장 보강
- 개선 효과 추정
- nudge 문장 품질 개선

LLM은 evidence_refs 없는 claim을 만들지 않아야 한다. Rule Engine이 확인하지 않은 문제를 새로 만들어내는 용도로 쓰지 않는다.

## 7. 예외 처리 원칙

Depth가 길다고 무조건 문제로 보지 않는다.

사용자의 정상 탐색일 수 있는 행동은 예외 후보로 둔다.

- 카테고리 변경
- 필터 변경
- 정렬 변경
- 검색어 변경
- 옵션 필수 선택
- 로그인이나 인증이 필요한 필수 단계
- 지역, 날짜, 수량 같은 조건 선택

Rule은 단순 step 수가 아니라 목표와의 관련성, 경로 이탈 여부, 행동 결과 성공 여부를 함께 본다.

예를 들어 카테고리 이동이 목표 상품을 찾기 위한 정상 탐색이면 depth penalty를 낮추거나 제외한다. 반대로 CTA를 눌렀는데 unrelated category로 이동하거나 목표 행동에서 멀어졌다면 우회 또는 이탈 signal로 본다.

## 8. Static UX / Copy Readability Observation 후보

Journey Rule은 사용자가 목표 행동까지 도달하는 흐름을 본다. 다만 목표 행동 주변의 정적 UI 품질도 전환 마찰의 원인이 될 수 있다.

예를 들어 CTA 자체는 존재하고 클릭도 가능하지만, 설명 문구가 너무 빽빽하거나 줄바꿈이 어색하거나 CTA와 설명이 시각적으로 묶이지 않으면 사용자는 다음 행동을 이해하기 어려울 수 있다.

따라서 Journey Rule과 별개로 다음 정적 UX 기준은 후속 Rule 또는 nudge 후보로 관리한다.

### Hard Rule 후보

표준에 가깝고 측정 가능한 기준은 충분한 evidence가 있을 때 user-facing issue와 scoring에 반영할 수 있다.

- CTA, close button, icon button의 target size
- 버튼, 아이콘, focus indicator의 non-text contrast
- modal/dialog에서 명확한 닫기 수단 제공 여부
- keyboard focus가 보이고 조작 가능한지 여부

이 기준은 WCAG, WAI-ARIA처럼 비교적 testable한 기준을 우선 사용한다.

### Heuristic / Nudge 후보

관습이나 UX research에 가깝고 예외가 많은 기준은 바로 감점하지 않는다. 충분한 evidence와 calibration 전까지는 diagnostic, nudge, fix leverage 보조 판단으로 둔다.

- 일반 웹 modal에서 close button이 관습적 위치에서 크게 벗어나는 경우
- primary CTA가 시각적으로 약하거나 주변 CTA와 경쟁하는 경우
- CTA 문구가 목표 행동과 약하게만 연결되는 경우
- 설명 문구가 의미 단위로 잘 나뉘지 않는 경우
- 긴 문단이 줄 단위로 chunking되지 않아 스캔하기 어려운 경우
- 설명 문구와 CTA가 거리, 정렬, grouping 측면에서 서로 분리되어 보이는 경우
- 모바일 viewport에서 줄바꿈 때문에 의미 단위가 깨지는 경우

특히 `X` close button 위치는 단독 감점 기준으로 쓰지 않는다. 웹 modal에서는 우상단이 강한 관습일 수 있지만, mobile/native sheet나 full-screen dialog에서는 다른 위치가 정상 패턴일 수 있다. 따라서 "닫기 수단이 명확한가"를 우선 보고, 위치는 낮은 confidence의 보조 signal로만 사용한다.

### Copy Readability에 필요한 raw signal

설명 글의 chunking과 정렬을 판단하려면 Runner/Discovery가 다음 값을 observation data로 제공할 수 있는지 검토해야 한다.

- `text`
- `bounds`
- `line_count`
- `line_width` 또는 `block_width`
- `font_size`
- `line_height`
- `text_align`
- `nearby_cta_ref`
- CTA와 text block 사이의 거리
- `viewport` 또는 `device_preset`
- 모바일 줄바꿈 이후의 text line 분리 결과

이 값은 Runner가 최종 UX 판단을 내려서 넘기는 값이 아니다. Runner는 측정 가능한 layout/text signal을 남기고, Analyzer Rule Engine이 evidence 기반으로 판단한다.

후속 Rule 이름 후보:

- `VISUAL-READABILITY-001`
- `CLARITY-COPY-CHUNKING-001`
- `PATH-CTA-GROUPING-001`

다만 이 후보들은 현재 Journey Rule v0 범위에 바로 포함하지 않는다. 먼저 observation 수집 가능 여부와 EvidencePacket 저장/전달 유실 여부를 확인한 뒤, 충분한 fixture와 calibration을 통해 issue/scoring 승격 여부를 결정한다.

## 9. 역할 경계

### 박성환

- Rule 기준 정의
- 필요한 observation signal 정의
- severity, confidence, fix_leverage 기준 정리
- Journey Rule의 예외 조건 정리
- Rule 결과가 Report/Evidence 흐름에서 설명 가능한지 검토
- Static UX / Copy Readability 기준을 hard rule과 heuristic/nudge 후보로 분리

### 차지훈

- Runner/Discovery에서 raw signal 수집 가능 여부 확인
- click 전후 URL, DOM, title, breadcrumb, toast, count 변화 수집 검토
- 목표 대상 후보와 목표 행동 후보를 observation으로 태깅할 수 있는지 확인
- screenshot artifact id와 bbox 제공 가능 여부 확인
- text block, line, bounds, CTA proximity 같은 readability raw signal 수집 가능 여부 확인

### 정관우

- 새 observation type과 data field가 Spring checkpoint 저장에서 유실되지 않는지 확인
- EvidencePacket 조립 시 observation shape가 유지되는지 확인
- Analyzer 전달 payload에서 raw signal이 보존되는지 확인
- 새 observation이 기존 Report/Evidence 조회 흐름을 깨지 않는지 확인
- readability 관련 observation field가 EvidencePacket과 Report/Evidence 조회 흐름에서 보존되는지 확인

Report UX는 Rule/Evidence 흐름이 안정된 뒤 후속으로 조정한다.

## 10. 결론

Journey Rule은 중요한 버튼을 찾는 것이 아니라, 사용자가 목표 행동에 도달하는 과정에서 올바른 요소를 선택했고, 불필요한 우회 없이 진행됐으며, 실제 행동 결과가 성공했는지를 판단하기 위한 Rule이다.

이를 위해 Runner/Discovery는 최종 판단값이 아니라 URL, DOM, click, result 기반 raw signal을 남긴다. Rule Engine은 이 signal로 deterministic 판단을 수행하고, GMS/LLM은 derived intent와 fix leverage를 보조 검증한다.

현재 MVP observation은 CTA/form/reliability Rule 검증에는 충분하지만, Journey Rule을 위해서는 목표 대상, 상세 확인, 목표 행동 실행, 탐색 전환, depth 계산을 위한 추가 signal이 필요하다.

추가로 target size, contrast, modal close affordance, copy readability 같은 정적 UX signal은 Journey Rule과 sibling 관계의 보조 Rule 후보로 관리한다. 표준 기반 hard rule은 충분한 evidence가 있을 때 scoring에 반영할 수 있지만, X 위치나 copy chunking처럼 예외가 많은 기준은 초기에는 nudge 또는 diagnostic signal로 두는 것이 안전하다.
