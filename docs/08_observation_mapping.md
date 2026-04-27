# Observation 후보 매핑

## 1. 목적

이 문서는 OmniParser 같은 screenshot parser 산출물을 Wedge `Observation` 후보로 변환하는 기준을 정리한다.

OmniParser 결과는 raw dump 그대로 `Observation`으로 넘기지 않는다. Producer는 `parsed_content_list`의 각 element를 범용 규칙으로 분류해 Wedge의 기존 observation type 후보로 변환한다.

## 2. OmniParser 결과 구조

예시 입력:

```json
{
  "input": "test_img\\test5.png",
  "image_size": [2880, 1796],
  "ocr_text": ["..."],
  "label_coordinates": {
    "58": [0.1453, 0.1566, 0.097, 0.0325]
  },
  "parsed_content_list": [
    {
      "type": "icon",
      "bbox": [0.1453, 0.1566, 0.2423, 0.1891],
      "interactivity": true,
      "content": "상품명 또는 브랜드 입력",
      "source": "box_yolo_content_ocr"
    }
  ]
}
```

필드 해석:

| Field | 의미 |
|---|---|
| `image_size` | screenshot artifact metadata와 viewport 기준값 |
| `ocr_text` | OCR 텍스트 pool. 이것만으로는 observation이 아님 |
| `label_coordinates` | labeled image 디버깅 좌표. 보통 normalized `[x, y, width, height]` |
| `parsed_content_list[].bbox` | element 좌표. 보통 normalized `[x1, y1, x2, y2]` |
| `parsed_content_list[].interactivity` | parser가 판단한 actionable 가능성 힌트 |
| `parsed_content_list[].content` | OCR 텍스트 또는 icon 설명. 후보 분류의 주요 근거 |
| `parsed_content_list[].source` | parser 내부 추출 출처. `data.omniparser.source`에 보존 |

## 3. 공통 Observation 작성 규칙

OmniParser 기반 observation 후보는 다음 값을 유지한다.

- `source`: DOM/AX/network/console/performance 근거가 따로 없으면 `["screenshot", "layout"]`.
- `data.source_ref`: 원본 element 포인터. 예: `omniparser.parsed_content_list[58]`.
- `data.bounds`: normalized viewport 기준의 canonical bounds.
- `data.omniparser`: 원본 `type`, `source`, label id 같은 parser-local metadata.
- `confidence`: visual-only 후보는 DOM/AX 기반 evidence보다 낮게 둔다.

Canonical bounds shape:

```json
{
  "x": 0.1453,
  "y": 0.1566,
  "width": 0.097,
  "height": 0.0325,
  "unit": "viewport_ratio"
}
```

## 4. Observation 후보 매핑

| Observation candidate | Stage | OmniParser-derived condition | Data payload guidance |
|---|---|---|---|
| `heading_structure` | `FIRST_VIEW` | 첫 화면 또는 상단 영역의 브랜드명, 페이지명, 섹션 제목성 text | `texts`, `bounds`, `source_refs` |
| `first_view_message` | `VALUE` | 첫 viewport에서 offer/value를 전달하는 비상호작용 text 또는 banner copy | `message`, `texts`, `bounds`, `source_refs` |
| `value_proposition` | `VALUE` | 할인, 무료, 배송, 추천, 만족도, 한정, 쿠폰, 체험 등 benefit signal 포함 | `claim_text`, `value_keywords`, `source_refs` |
| `trust_signal` | `VALUE` | 결제, 보안, 인증, 리뷰, 평점, 환불, 공식 브랜드, 파트너 로고, trust provider | `signal_text`, `signal_type`, `source_refs` |
| `cta_candidate` | `CTA` | `interactivity = true`이고 button, link, icon action, navigation item, card, actionable banner처럼 보임 | `text`, `role_hint`, `bounds`, `source_ref` |
| `cta_cluster` | `CTA` | 가까운 `cta_candidate`들이 header, navigation, menu, card row, carousel, content-action region을 공유 | `texts`, `primary_like_cta_count`, `cluster_role`, `source_refs`, `bounds` |
| `form_field` | `INPUT` | search/input/select처럼 보이거나 placeholder-like text를 가진 interactive element | `field_role_hint`, `placeholder`, `bounds`, `source_ref` |
| `required_field` | `INPUT` | form field 근처에 `*`, required text, 필수 시각 표시가 있음 | `field_ref`, `required_indicator`, `source_refs` |
| `visual_emphasis` | `VALUE` 또는 `CTA` | 첫 viewport에서 큰 면적을 차지하거나 중앙/상단에 있는 banner, hero, product card, primary content block | `dominant_elements`, `area_ratio`, `source_refs` |
| `target_size_issue` | `CTA` | interactive element bounds가 pointer target threshold보다 작음 | `target_ref`, `width`, `height`, `threshold` |
| `contrast_issue` | `FIRST_VIEW`, `VALUE`, 또는 `CTA` | 별도 contrast pass에서 text 대비 문제가 측정됨 | `text`, `contrast_ratio`, `source_ref` |
| `scroll_delta` | `VALUE` 또는 `CTA` | screenshot 비교 결과 새로 추가, 제거, 변경된 content가 있음 | `added_texts`, `removed_texts`, `source_refs` |

## 5. 후보 생성 파이프라인

1. screenshot에 browser chrome, OS UI, taskbar가 포함되어 있으면 page 외부 영역을 먼저 제거한다.
2. 각 element를 `bounds`, `area_ratio`, `center`, `text_length`, `interactive`, `source_ref`로 정규화한다.
3. 개별 후보인 `cta_candidate`, `form_field`, `first_view_message`, `value_proposition`, `trust_signal`, `visual_emphasis`를 생성한다.
4. 가까운 actionable 후보들을 region 기준으로 묶어 `cta_cluster`를 만든다.
5. 원본 parser 참조를 `data.source_ref` 또는 `data.source_refs`에 보존한다.
6. 확실하지 않은 visual-only 후보는 버리지 말고 낮은 `confidence`로 유지한다.

## 6. 예시

### cta_candidate

```json
{
  "observation_id": "obs_cta_candidate_001",
  "type": "cta_candidate",
  "stage": "CTA",
  "source": ["screenshot", "layout"],
  "data": {
    "text": "상품명 또는 브랜드 입력",
    "role_hint": "button_or_link",
    "interactive": true,
    "bounds": {
      "x": 0.1453,
      "y": 0.1566,
      "width": 0.097,
      "height": 0.0325,
      "unit": "viewport_ratio"
    },
    "source_ref": "omniparser.parsed_content_list[58]",
    "omniparser": {
      "type": "icon",
      "source": "box_yolo_content_ocr"
    }
  },
  "confidence": 0.7
}
```

### cta_cluster

```json
{
  "observation_id": "obs_cta_cluster_001",
  "type": "cta_cluster",
  "stage": "CTA",
  "source": ["screenshot", "layout"],
  "data": {
    "cluster_role": "header_or_navigation_or_content_actions",
    "primary_like_cta_count": 5,
    "texts": ["Search", "Login", "Cart"],
    "source_refs": [
      "omniparser.parsed_content_list[1]",
      "omniparser.parsed_content_list[2]"
    ],
    "bounds": {
      "x": 0.1,
      "y": 0.1,
      "width": 0.8,
      "height": 0.1,
      "unit": "viewport_ratio"
    }
  },
  "confidence": 0.65
}
```
