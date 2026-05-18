# 15. Report Reference Badge Strategy

## 1. 목적

이 문서는 리포트 finding에 외부 기준 근거 배지를 붙이기 위한 협의 기준을 정리한다.

현재 리포트의 판단은 Wedge Rule에 의해 만들어진다. 하지만 사용자 입장에서는 "Wedge가 정한 룰"만으로는 피드백의 신뢰를 판단하기 어렵다. 따라서 리포트에서 각 finding이 어떤 공개 표준, 공식 가이드, 실무 연구에 기대고 있는지 짧게 보여준다.

목표는 사용자를 외부 문서로 보내는 것이 아니다. 사용자가 리포트 안에서 "이 피드백은 어떤 기준의 어떤 내용을 바탕으로 하는지"를 바로 이해하게 하는 것이다.

## 2. 사용자 경험 기준

배지는 finding 제목 옆에 작게 표시한다.

예시:

```text
입력 필드의 목적을 알기 어렵습니다  [WCAG 3.3.2] [WAI Forms]
```

배지에 마우스를 올리거나 키보드 focus가 들어오면 짧은 설명을 보여준다.

```text
W3C WCAG 3.3.2 Labels or Instructions
입력을 요구하는 화면에서는 사용자가 무엇을 입력해야 하는지 알 수 있는 라벨 또는 안내가 제공되어야 합니다.
```

기본 동작은 외부 링크 이동이 아니다. WCAG, WAI-ARIA, Baymard, NN/g 문서는 영어와 긴 설명이 많아 사용자가 "무엇을 보라는 건지" 알기 어렵기 때문이다.

`url`은 원문 추적과 향후 확장을 위해 저장한다. MVP에서는 tooltip 안에 원문 링크를 바로 노출하지 않거나, 필요할 때만 보조 링크로 둔다.

## 3. Reference 데이터 형태

리포트에 노출할 최소 필드는 다음과 같다.

```json
{
  "label": "WCAG 3.3.2",
  "publisher": "W3C",
  "title": "Labels or Instructions",
  "basisSummary": "입력을 요구하는 화면에서는 사용자가 무엇을 입력해야 하는지 알 수 있는 라벨 또는 안내가 제공되어야 합니다.",
  "url": "https://www.w3.org/WAI/WCAG22/Understanding/labels-or-instructions.html"
}
```

필드 의미:

| 필드 | 의미 |
| --- | --- |
| `label` | 배지에 짧게 표시할 이름 |
| `publisher` | 기준 제공 주체. 예: W3C, WAI, GOV.UK, USWDS, NN/g, Baymard |
| `title` | 기준 또는 문서의 제목 |
| `basisSummary` | 리포트 안에서 보여줄 기준 요약 |
| `url` | 원문 추적용 URL |

`observedReason`은 MVP reference badge에는 넣지 않는다.

이유:

- "이 화면에서 왜 걸렸는가"는 finding summary, impact hypothesis, recommendation에서 이미 설명한다.
- 배지는 외부 기준의 핵심 문구와 출처만 담당한다.
- 외부 기관이 우리 화면을 직접 평가한 것처럼 보이는 표현을 피한다.

## 4. 우선 사용할 기준 출처

| 출처 | 용도 | 적용 후보 |
| --- | --- | --- |
| W3C WCAG 2.2 | 접근성 hard rule 근거 | contrast, target size, labels, errors |
| W3C WAI Tutorials | form, label, accessibility pattern 설명 | form label, input instruction |
| WAI-ARIA APG | modal, dialog, keyboard interaction 기준 | modal close, focus, keyboard path |
| GOV.UK Design System | 공공 서비스 UX 실무 기준 | error message, form, button wording |
| USWDS | 공공 디자인 시스템 기준 | form, validation, component usage |
| Chrome Lighthouse | 자동 감사 기준 | accessibility, best practices, technical quality |
| web.dev Core Web Vitals | 성능 UX 기준 | LCP, INP, CLS, loading reliability |
| NN/g | UX heuristic, usability guide | soft rule, diagnostic, clarity nudge |
| Baymard | ecommerce, checkout, form research | checkout, trust, pricing, form friction |

사용 원칙:

- WCAG, WAI-ARIA처럼 testable한 기준은 hard rule 근거로 사용할 수 있다.
- NN/g, Baymard, design system 기준은 문맥 예외가 많으므로 soft rule, diagnostic, nudge 근거로 우선 사용한다.
- 기준 문구를 과장하지 않는다. "W3C가 이 화면을 평가했다"처럼 보이는 표현은 금지한다.

## 5. 저장 및 전달 구조 제안

현재 상태:

- RuleRegistry에는 `source_refs` 문자열 배열이 있다.
- Analyzer JudgeResult issue에는 reference metadata가 없다.
- Spring projection 테이블 `analysis_finding`, `rule_hit`, `nudge`에는 reference 전용 컬럼이 없다.
- `analysis_job.output_jsonb`에는 Analyzer callback 원본이 저장되므로, Analyzer가 `issues[].references`를 보내면 원본 보존은 가능하다.

권장 구조:

1. RuleRegistry에서 rule별 reference metadata를 정의한다.
2. Analyzer가 rule hit를 JudgeResult issue로 변환할 때 `issues[].references[]`로 복사한다.
3. `packages/contracts/schemas/judge-result.schema.json`에 `issues[].references[]`를 추가한다.
4. Spring은 `issues[].references`를 `analysis_finding.references_jsonb`에 저장한다.
5. Report Detail API는 `findings[].references[]`를 내려준다.
6. Web은 finding 제목 옆에 reference badge를 렌더링하고 hover/focus tooltip을 제공한다.

DB migration 후보:

```sql
ALTER TABLE analysis_finding
ADD COLUMN references_jsonb JSONB NOT NULL DEFAULT '[]'::jsonb;
```

`rule_hit.references_jsonb`는 선택 사항이다. 내부 감사나 raw rule hit 추적까지 필요하면 후속으로 추가한다. 리포트 배지만 목표라면 `analysis_finding.references_jsonb`가 우선이다.

## 6. 파트별 확인 사항

### Analyzer / Rule 담당

- RuleRegistry의 `source_refs`를 유지할지, `references` 구조체 배열로 확장할지 결정한다.
- 각 Rule에 붙일 reference를 선별한다.
- Rule hit를 issue로 변환할 때 rule metadata의 references를 `issues[].references[]`로 복사한다.
- `basisSummary`는 외부 기준의 핵심 의미만 짧게 작성한다.
- Rule 판단 근거와 외부 기준 근거를 섞지 않는다. 화면에서 관찰된 내용은 기존 `summary`, `observations`, `signals`, `evidence_refs`가 담당한다.

### Contracts 담당

- `rule-registry.schema.json`에 구조화된 reference metadata를 추가할지 확인한다.
- `judge-result.schema.json`의 `issue` 정의에 `references[]`를 추가한다.
- sample JudgeResult와 Analyzer completed callback 예시에 reference badge 샘플을 반영한다.
- OpenAPI Report Detail schema에 `findings[].references[]`를 추가한다.

### Spring / API / DB 담당

- `analysis_finding.references_jsonb` 컬럼 추가 여부를 확정한다.
- Analyzer completed callback 저장 시 `issues[].references`를 finding projection에 저장한다.
- Report Detail 응답에 `findings[].references[]`를 포함한다.
- 기존 `analysis_job.output_jsonb` 원본 보존과 projection 저장의 역할을 분리한다.
- null 또는 빈 reference는 빈 배열로 내려준다.

### Web / FE 담당

- finding 제목 옆에 reference badge를 표시한다.
- badge hover와 keyboard focus에서 tooltip 또는 popover를 연다.
- tooltip에는 `publisher`, `title`, `basisSummary`를 보여준다.
- 기본 클릭 동작은 외부 이동으로 두지 않는다.
- 접근성을 위해 badge는 focus 가능해야 하고, tooltip 내용은 키보드 사용자도 확인할 수 있어야 한다.

### QA / Calibration 담당

- 배지가 실제 Rule 근거와 맞는지 확인한다.
- 같은 finding에 reference가 너무 많이 붙지 않도록 상한을 확인한다. MVP 권장 상한은 1~3개다.
- 영어 원문으로 사용자를 밀어내지 않고, 리포트 안에서 기준 요약이 이해되는지 확인한다.
- hard rule과 soft/diagnostic rule의 reference level이 섞여 오해를 만들지 않는지 확인한다.

## 7. MVP 범위 제안

MVP에서는 다음 범위로 시작한다.

- `references[]`는 finding 단위로만 제공한다.
- 배지는 finding title 옆에 표시한다.
- hover/focus tooltip에는 `publisher`, `title`, `basisSummary`만 보여준다.
- 외부 `url`은 데이터에 저장하지만 기본 UI에서는 직접 이동 링크로 쓰지 않는다.
- `observedReason`은 추가하지 않는다.
- 우선 적용 대상은 WCAG 기반 form label, contrast, target size, WAI-ARIA modal/focus, GOV.UK error message 정도로 제한한다.

후속 확장:

- tooltip 안에 "원문 보기" 보조 링크 추가
- reference level 표시. 예: Standard, Expert Guide, Practitioner Research
- docs/07_research_basis.md와 RuleRegistry reference metadata 동기화
- Report Markdown/PDF export에도 reference badge 또는 footnote 반영
