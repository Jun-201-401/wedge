# 07. Research Basis

## 1. 목적

이 문서는 원본 리서치 자료를 무작정 보존하지 않고, Wedge Judge/Rule 설계에 필요한 핵심 근거만 압축한 canonical research basis다.

일반 구현 작업에는 이 문서를 매번 참조하지 않는다.  
다음 상황에서만 사용한다.

- Judge 기준 변경
- scoring/criterion 재검토
- false positive / false negative calibration
- benchmark 기준 정의
- 제품 가치/PRD 재검토

## 2. Evidence level

| Level | Meaning | Usage |
|---|---|---|
| Standard | 공식 표준 또는 명시적 기준 | hard rule / pass-fail |
| Research-backed | 논문, HCI, 메타분석 | heuristic의 이론 근거 |
| Expert Guide | NN/g, Baymard, design system | 운영 규칙의 실무 근거 |
| Operational | Wedge 초기값 | benchmark로 calibration 필요 |
| Technical | Playwright/CDP/Web Vitals 등 수집/성능 기준 | reliability/collection rule |

원칙:

- 표준이 있는 것은 표준으로 판정한다.
- 표준이 없는 것은 Research/Expert Guide/Operational로 낮은 확신도와 예외 조건을 둔다.
- Operational threshold는 정답이 아니라 초기값이며 benchmark로 보정한다.

## 3. Source map

| Source | Use in Wedge | Level |
|---|---|---|
| Google HEART | Goals → Signals → Metrics 상위 프레임 | Research-backed |
| WCAG 2.2 | 접근성 hard rule | Standard |
| W3C WAI Heading docs | heading hierarchy | Standard / Best Practice |
| WCAG Headings and Labels | descriptive headings/labels | Standard |
| WCAG Labels or Instructions | form label/instruction | Standard |
| WCAG Error Identification | form error text | Standard |
| WCAG Error Suggestion | error recovery | Standard |
| WCAG Target Size | pointer target minimum | Standard |
| WCAG Contrast Minimum | text contrast | Standard |
| WCAG Non-text Contrast | UI component contrast | Standard |
| Core Web Vitals | LCP/INP/CLS reliability metric | Standard Metric |
| NN/g Visual Hierarchy | visual hierarchy heuristic | Expert Guide |
| NN/g Button States | primary/secondary button behavior | Expert Guide |
| Carbon Button Usage | principal CTA usage | Design System |
| Baymard checkout/form research | checkout/friction/trust insight | Practitioner Research |
| Choice Overload research | choice complexity | Research-backed |
| Online Trust research | trust antecedents | Research-backed |
| Playwright docs | browser automation | Technical |
| Chrome DevTools Protocol | DOMSnapshot/Network/Performance collection | Technical |

## 4. Wedge 평가 축

| Axis | Judgment Question | Main Evidence |
|---|---|---|
| Clarity | 화면 목적과 가치 제안이 이해되는가 | heading, first-view copy, structure |
| Path | 다음 행동이 명확한가 | CTA, button hierarchy, first-view presence |
| Friction | 행동 부담이 큰가 | form, required fields, errors, step count |
| Trust | 행동 직전에 확신을 줄 정보가 충분한가 | pricing, privacy, security, refund, reviews |
| Reliability | 기술적으로 안정적인가 | Web Vitals, failed requests, console errors |
| Visual Integrity | 시각 위계가 목적에 맞는가 | contrast, hierarchy, hero dominance, affordance |

## 5. Stage model

| Stage | Description | Key Axis |
|---|---|---|
| FIRST_VIEW | 계속 볼지 판단 | Clarity, Path, Visual Integrity, Reliability |
| VALUE | 가치와 관련성 이해 | Clarity, Trust |
| CTA | 행동 시작 여부 결정 | Path, Trust, Visual Integrity |
| INPUT | 입력 지속 여부 결정 | Friction, Reliability |
| COMMIT | 제출/결제/문의 직전 확정 | Trust, Friction, Reliability |

## 6. P0 criterion 근거

### PATH-CTA-001 Primary CTA Presence

- 근거: CTA는 핵심 경로를 명확히 해야 함.
- Evidence: buttons, links, role=button, layout, first-view bounds.
- Caution: editorial, documentation, browse-first page는 예외 가능.

### PATH-CTA-002 Primary CTA Competition

- 근거: primary급 action이 같은 decision stage에서 경쟁하면 path risk.
- 초기 운영값: 1 primary 정상, 2 warning, 3+ strong warning 후보.
- Exception: pricing plan selection, audience split, dashboard action cluster.

### CLARITY-HEAD-001 Heading Hierarchy

- 근거: heading과 label은 topic/purpose를 설명해야 함.
- 여러 H1 자체는 오류라기보다 clarity warning으로 다룸.

### FRICTION-FORM-001 Label/Instruction

- 근거: WCAG labels/instructions.
- Missing accessible name on required field는 high-confidence issue.

### FRICTION-FORM-003 Error Identification/Suggestion

- 근거: WCAG error identification/suggestion.
- invalid submit을 실제 실행하고 error text가 없으면 confidence high.

### RELIABILITY-TECH-001 Failed Request and Console Error

- 근거: action 직후 failed request/uncaught error는 technical friction.
- analytics/ad script blocked는 예외 처리.

### VISUAL-CONTRAST-001 Contrast

- 근거: WCAG contrast threshold.
- primary CTA/critical label breach는 severity를 높임.

### PATH-TARGET-001 Target Size

- 근거: WCAG target size.
- critical CTA가 기준 미달이면 severity high.

### TRUST-RISK-001 Risk-reduction Signal Coverage

- 근거: online trust research, practitioner guide.
- payment/personal data/signup 근처에서 risk-reduction signal 부족 시 warning.

### VISUAL-HIER-001 Semantic–Visual Hierarchy Alignment

- 근거: visual hierarchy guides attention.
- core message/CTA보다 decorative element가 과도하게 강하면 warning.

## 7. 사용하지 않는 판단 표현

Wedge는 아래 표현을 사용하지 않는다.

| Avoid | Replacement |
|---|---|
| 촌스럽다 | 핵심 메시지와 CTA의 시각 우선순위가 약함 |
| 예쁘지 않다 | 전환에 필요한 정보/행동 우선순위가 낮음 |
| 감이 없다 | 컴포넌트 표현과 의미 구조가 어긋남 |
| 아이콘이 별로다 | icon-only action의 accessible name이 불명확함 |

## 8. Calibration 절차

1. Benchmark set 20–30개 구성
2. 2명 이상이 manual label
3. automatic run
4. true positive / false positive / false negative / ambiguous 분류
5. threshold와 exception 업데이트
6. RuleRegistry version 기록

## 9. 남은 research gap

| Gap | Handling |
|---|---|
| Hero dominance quantification | experimental, P0 제외 가능 |
| Trust signal taxonomy | domain-specific calibration 필요 |
| CTA threshold calibration | benchmark로 검증 |
| Visual hierarchy scoring | screenshot/layout proxy부터 시작 |
| 실제 conversion data 연동 | P2 이후 |

## 10. Scenario Fit and Preflight Rationale

Wedge는 사용자가 선택한 시나리오가 입력 URL에서 실행 가능하다는 가정을 두지 않는다. 일반 사용자나 1인 제작자는 자신의 URL에 어떤 분석 시나리오가 적합한지 모를 수 있다. 따라서 Wedge는 정식 Run 전에 lightweight Site Discovery를 수행해 CTA, form, pricing, checkout, contact 후보를 찾고, 그 근거를 바탕으로 시나리오를 추천한다.

이 섹션은 새로운 외부 research source를 추가하기보다, 기존 Stage-based evaluation과 Evidence-based judgment 원칙의 제품 UX 적용으로 설명한다.

원칙:

- Scenario mismatch는 UX defect가 아니다.
- Scenario mismatch는 URL과 시나리오의 fit 문제다.
- 사용자가 특정 flow 존재 여부를 평가 목표로 명시한 경우에만 Path issue로 해석할 수 있다.
