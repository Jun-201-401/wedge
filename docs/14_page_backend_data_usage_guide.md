# 페이지별 백엔드 데이터 활용 가이드

이 문서는 페이지별로 백엔드에서 받을 수 있는 값과 화면에서 활용할 수 있는 문구를 정리한다.
목적은 단순 필드 목록이 아니라, 각 화면에서 어떤 데이터를 어떤 사용자 문구로 바꿔 보여줄 수 있는지 공유하는 것이다.

예시는 현재 확인한 로컬 데이터 기준이다.

- URL: `https://www.naver.com/`
- 진단명: `구매 / 결제 흐름 점검`
- 추천 대상: `장바구니알림`
- 주요 문제: `선택지 과도한 노출로 인한 선택 혼란`

## 전체 구조

| 페이지 | 화면 용도 | 가장 먼저 보여줄 값 |
| --- | --- | --- |
| 사전분석 화면 | 사이트에서 어떤 흐름 후보가 보이는지 알려준다. | 감지된 흐름, CTA 후보 수, 체크아웃 후보 수 |
| 진단 흐름 추천 | 어떤 시나리오로 진단할지, 어떤 대상을 볼지 알려준다. | 추천 목표, 추천 대상, 실행 예정 단계, 안전 중단 여부 |
| runs 수집 화면 | 실제로 몇 단계를 실행했고 어떤 URL/화면을 수집했는지 보여준다. | 실행 step 수, 체크포인트 수, 스크린샷 수, URL 기준 방문 페이지 수 |
| 완료된 리포트 화면 | 무엇이 문제였고 무엇을 고치면 되는지 보여준다. | 전체 요약, 문제 제목, 문제 설명, 개선안, 기대 효과 |

## 1. 사전분석 화면

### 화면 용도

사용자가 입력한 사이트를 먼저 훑고, 어떤 진단 흐름 후보가 감지됐는지 보여주는 화면이다.
여기서는 기술 상세보다 "이 사이트에서 어떤 진단을 할 수 있는가"를 빠르게 이해시키는 것이 중요하다.

### 현재 활용 가능한 백엔드 값

| 백엔드 값 | 화면에 넣을 수 있는 내용 | 실제 예시 문구 |
| --- | --- | --- |
| `site_discovery.input_url` | 사용자가 입력한 URL | `입력 URL: https://www.naver.com/` |
| `site_discovery.final_url` | 리다이렉트 후 최종 확인 URL | `최종 확인 URL: https://www.naver.com/` |
| `site_discovery.status` | 사전분석 진행 상태 | `사전분석이 완료됐습니다.` |
| `site_discovery.summary_jsonb.detectedFlowTypes` | 감지된 진단 가능 흐름 | `랜딩 CTA와 구매/결제 흐름 후보가 감지됐습니다.` |
| `site_discovery.summary_jsonb.missingFlowTypes` | 이번에 감지하지 못한 흐름 | `가입 폼, 문의, 가격/요금제 흐름은 확인되지 않았습니다.` |
| `site_discovery.summary_jsonb.primaryCtaCount` | CTA 후보 수 | `CTA 후보 4개를 찾았습니다.` |
| `site_discovery.summary_jsonb.checkoutEntrypointCount` | 체크아웃/장바구니 진입점 수 | `체크아웃 진입점 1개가 감지됐습니다.` |

### 화면 문구 예시

```text
이 사이트에서는 랜딩 CTA와 구매/결제 흐름 후보가 감지됐습니다.
CTA 후보 4개, 체크아웃 진입점 1개를 찾았습니다.
가입 폼, 문의, 가격/요금제 흐름은 이번 사전분석에서 확인되지 않았습니다.
```

### 이미 받고 있지만 덜 쓰는 값

| 백엔드 값 | 화면에 넣을 수 있는 내용 | 실제 예시 문구 |
| --- | --- | --- |
| `summary_jsonb.detectedFlowTypes` | 가능한 진단 흐름 요약 | `진단 가능 흐름: 랜딩 CTA, 구매/결제` |
| `summary_jsonb.missingFlowTypes` | 미감지 흐름 안내 | `이번 사전분석에서는 가입 폼과 가격/요금제 흐름을 찾지 못했습니다.` |
| `summary_jsonb.primaryCtaCount` | CTA 후보 개수 | `첫 화면에서 CTA 후보 4개를 확인했습니다.` |
| `summary_jsonb.checkoutEntrypointCount` | 구매/결제 진입점 개수 | `구매 또는 장바구니로 이어질 수 있는 진입점 1개를 찾았습니다.` |
| `final_url` | 실제 확인한 최종 URL | `입력한 주소에서 최종적으로 https://www.naver.com/ 화면을 확인했습니다.` |
| `failure_code`, `failure_message` | 실패 시 원인 | `사이트 응답 시간이 초과되어 사전분석을 완료하지 못했습니다.` |

### 추가 API를 붙이면 좋은 것

| 추가 API/데이터 | 화면에 넣을 수 있는 내용 | 실제 예시 문구 |
| --- | --- | --- |
| `GET /api/discoveries/{id}/screenshots` | 사전분석 당시 첫 화면 이미지 | `사전분석에서 확인한 첫 화면입니다.` |
| `GET /api/discoveries/{id}/evidence-summary` | 흐름 감지 근거 요약 | `장바구니/구매 관련 링크 문구가 발견되어 구매 흐름 후보로 분류했습니다.` |
| `GET /api/discoveries/{id}/visited-pages` | 사전분석 중 확인한 URL 목록 | `사전분석 중 URL 기준 1개 페이지를 확인했습니다.` |

### 냉정한 판단

사전분석 화면은 자세한 근거를 길게 보여줄수록 복잡해진다.
우선은 감지된 흐름, 미감지 흐름, 후보 수만 요약 카드로 보여주는 편이 적합하다.

## 2. 진단 흐름 추천

### 화면 용도

사전분석 결과를 바탕으로 어떤 진단 흐름을 실행할지 추천하는 화면이다.
사용자는 여기서 "왜 이 흐름을 추천하는지", "어디를 볼 것인지", "위험한 행동은 하지 않는지"를 확인해야 한다.

### 현재 활용 가능한 백엔드 값

| 백엔드 값 | 화면에 넣을 수 있는 내용 | 실제 예시 문구 |
| --- | --- | --- |
| `scenario_authoring_job.input_jsonb.requested_goal` | 추천 진단 목표 | `구매 / 결제 흐름 점검 · 첫 화면만 보기` |
| `scenario_authoring_job.status` | 추천 생성 상태 | `진단 흐름 추천이 완료됐습니다.` |
| `jsonb_array_length(candidates_jsonb)` | 추천 후보 개수 | `추천 후보 1개를 생성했습니다.` |
| `confirmed_candidate_id` | 확정된 후보 ID | `확정 후보: rule_based_purchase_checkout_001` |
| `candidates_jsonb[0].scenario_plan.steps[2].action.target.text` | 러너가 확인할 추천 대상 | `진단 대상: 장바구니알림` |
| `candidates_jsonb[0].scenario_plan.steps[2].action.target.selector` | 대상 selector | `선택자: a[href="https://shopping.naver.com/cart"]` |
| `candidates_jsonb[0].scenario_plan.steps[].description` | 실행 예정 단계 | `추천 URL 진입 -> 첫 화면 기록 -> 장바구니 진입점 기록 -> 결제 전 중단` |

### 화면 문구 예시

```text
추천 진단 흐름: 구매 / 결제 흐름 점검

장바구니로 이어지는 진입점을 확인하되,
실제 결제나 구매 확정 전에는 중단하도록 설계됐습니다.
```

```text
1. 추천 URL에 진입
2. 첫 화면 문맥 수집
3. 장바구니 진입점 근거 기록
4. 실제 결제/구매 commit 전 중단
```

### 이미 받고 있지만 덜 쓰는 값

| 백엔드 값 | 화면에 넣을 수 있는 내용 | 실제 예시 문구 |
| --- | --- | --- |
| `ScenarioRecommendation.reason` | 추천 이유 | `구매/장바구니로 이어질 수 있는 진입점이 발견되어 이 흐름을 추천합니다.` |
| `evidenceSummary.matched_signals[].value` | 추천 근거 문구 | `감지된 문구: 장바구니알림` |
| `evidenceSummary.matched_signals[].source` | 어떤 속성에서 감지됐는지 | `링크 텍스트에서 구매 흐름 신호를 찾았습니다.` |
| `evidenceSummary.limitations` | 추천의 한계 | `로그인 이후 화면이나 이미지 속 텍스트는 확인하지 못했습니다.` |
| `suggestedTarget.text` | 사람이 이해하기 쉬운 진단 대상 | `진단 대상: 장바구니알림` |
| `suggestedTarget.selector` | 디버그용 대상 selector | `a[href="https://shopping.naver.com/cart"]` |
| `validation.safety_valid` | 안전 조건 통과 여부 | `실제 결제/구매 확정 전 중단 조건이 적용됐습니다.` |
| `scenario_plan.steps[].description` | 실행 계획 미리보기 | `추천 URL 진입 후 첫 화면을 기록하고, 결제 전 단계에서 중단합니다.` |

### 추가 API를 붙이면 좋은 것

| 추가 API/데이터 | 화면에 넣을 수 있는 내용 | 실제 예시 문구 |
| --- | --- | --- |
| `GET /api/scenario-authoring-jobs/{id}/preview` | 사람이 읽기 쉬운 실행 계획 | `이 진단은 4단계로 진행되며 마지막 단계에서 결제 전 중단됩니다.` |
| `GET /api/scenario-authoring-jobs/{id}/safety-summary` | 위험 행동 여부 요약 | `결제, 삭제, 외부 이동 같은 민감 행동은 자동 실행하지 않습니다.` |
| `GET /api/scenario-authoring-jobs/{id}/evidence-detail` | 추천 근거 상세 | `장바구니알림 링크가 구매 흐름 후보로 사용됐습니다.` |

### 냉정한 판단

`providerTrace`, `providerPolicy` 같은 내부 디버그 값은 기본 화면에 노출하지 않는 편이 낫다.
이 화면의 핵심은 추천 이유, 추천 대상, 안전 중단 조건이다.

## 3. runs 수집 화면

### 화면 용도

러너가 실제로 사이트를 돌면서 어떤 단계, URL, 화면, 자료를 수집했는지 보여주는 화면이다.
"진행 중인지"뿐 아니라 "무엇을 실제로 봤는지"가 드러나야 한다.

### 현재 활용 가능한 백엔드 값

| 백엔드 값 | 화면에 넣을 수 있는 내용 | 실제 예시 문구 |
| --- | --- | --- |
| `test_run.name` | 실행 이름 | `구매 / 결제 흐름 점검` |
| `test_run.start_url` | 시작 URL | `https://www.naver.com/` |
| `test_run.status` | 실행 상태 | `실행 상태: COMPLETED` |
| `test_run.analysis_status` | 분석 상태 | `분석 상태: COMPLETED` |
| `test_run.current_step_order` | 실행 단계 수 | `총 4단계를 실행했습니다.` |
| `test_run_step.step_name` | 단계별 설명 | `첫 화면의 핵심 문맥과 진입점을 기록한다.` |
| `test_run_event.payload_jsonb.actionType` | 실제 액션 종류 | `실행 액션: goto, checkpoint, stop_when` |
| `test_run_event.payload_jsonb.target` | 러너가 확인한 대상 | `대상: 장바구니알림 링크` |
| `test_run_event.payload_jsonb.details.finalUrl` | 액션 후 도착 URL | `액션 후에도 https://www.naver.com/에 머물렀습니다.` |
| `checkpoint.stage` | 체크포인트 단계 | `수집 단계: FIRST_VIEW, COMMIT` |
| `checkpoint.state_jsonb.url` | 체크포인트 URL | `수집 URL: https://www.naver.com/` |
| `checkpoint.state_jsonb.title` | 페이지 제목 | `확인한 화면: NAVER` |
| `artifact.artifact_type` | 수집 자료 종류 | `수집 자료: SCREENSHOT, DOM_SNAPSHOT` |
| `artifact.width`, `artifact.height` | 스크린샷 크기 | `스크린샷 크기: 1440 x 2819` |

### 화면 문구 예시

```text
총 4단계를 실행했습니다.
3개의 체크포인트에서 화면을 수집했고, 스크린샷 3장이 저장됐습니다.
URL 기준으로는 1개 페이지에서 진단이 진행됐습니다.
```

```text
이번 진단은 같은 URL 안에서 3번의 화면 상태를 수집했습니다.
실제 URL 이동은 없었지만, 첫 화면과 결제 진입점 근거를 각각 기록했습니다.
```

### 페이지 이동 관련 지표

| 지표 | 계산 기준 | 현재 예시 | 해석 |
| --- | --- | --- | --- |
| 실행 step 수 | `test_run.current_step_order` | `4개` | 러너가 수행한 시나리오 단계 수 |
| 체크포인트 수 | `checkpoint` row 수 | `3개` | 화면/상태를 수집한 지점 수 |
| 스크린샷 수 | `artifact.artifact_type = SCREENSHOT` row 수 | `3장` | 실제 저장된 화면 이미지 수 |
| URL 기준 방문 페이지 수 | `checkpoint.state_jsonb.url` distinct count | `1개` | URL 변화 기준으로 본 방문 페이지 수 |

### 이미 받고 있지만 덜 쓰는 값

| 백엔드 값 | 화면에 넣을 수 있는 내용 | 실제 예시 문구 |
| --- | --- | --- |
| `live.latestCheckpoint.stage` | 마지막 수집 단계 | `마지막 수집 단계: COMMIT` |
| `live.latestCheckpoint.url` | 마지막으로 본 URL | `마지막 확인 URL: https://www.naver.com/` |
| `checkpoint.state_jsonb.title` | 확인한 페이지 제목 | `확인한 화면: NAVER` |
| `checkpoint.duration_ms` | 체크포인트 수집 소요 시간 | `이 체크포인트 수집에는 275ms가 걸렸습니다.` |
| `artifact.artifact_type` | 수집 자료 종류 | `SCREENSHOT과 DOM Snapshot을 함께 저장했습니다.` |
| `artifact.width`, `artifact.height` | 스크린샷 해상도 | `스크린샷 크기: 1440 x 2819` |
| `artifact.size_bytes` | 파일 크기 | `스크린샷 용량: 약 1.8MB` |
| `artifact.captured_at` | 수집 시각 | `2026-05-15 10:15:55에 캡처됨` |
| `test_run_event.payload_jsonb.details.finalUrl` | 액션 이후 URL 변화 | `액션 후에도 같은 URL에 머물렀습니다.` |
| `test_run_event.payload_jsonb.target` | 러너가 바라본 대상 | `대상: 장바구니알림 링크` |

### 추가 API를 붙이면 좋은 것

| 추가 API/데이터 | 화면에 넣을 수 있는 내용 | 실제 예시 문구 |
| --- | --- | --- |
| `GET /api/runs/{id}/visited-pages` | URL 기준 방문 페이지 목록/개수 | `URL 기준 1개 페이지를 방문했습니다.` |
| `GET /api/runs/{id}/navigation-timeline` | URL 이동 경로 | `시작 URL -> 장바구니 진입점 확인 -> 결제 전 중단` |
| `GET /api/runs/{id}/screenshots` | 스크린샷 갤러리 | `수집된 화면 3장을 시간순으로 확인할 수 있습니다.` |
| `GET /api/runs/{id}/checkpoint-summary` | 체크포인트별 URL, 이미지, 소요 시간 | `FIRST_VIEW 단계에서 첫 화면을 수집했고, COMMIT 단계에서 결제 전 상태를 기록했습니다.` |

### 냉정한 판단

runs 화면에서 "몇 페이지를 이동했는지"를 보여주는 것은 좋다.
다만 현재 구조에서는 정확한 `page_move_count` 컬럼이 없으므로, 체크포인트 수를 페이지 수처럼 보여주면 안 된다.
반드시 `URL 기준 방문 페이지 수`, `체크포인트 수`, `스크린샷 수`, `실행 step 수`를 분리해서 보여줘야 한다.

## 4. 완료된 리포트 화면

### 화면 용도

수집 결과를 바탕으로 문제, 원인, 개선안을 보여주는 화면이다.
사용자에게 가장 가치가 큰 화면이므로, 숫자보다 문제와 개선 방향을 먼저 이해시켜야 한다.

### 현재 활용 가능한 백엔드 값

| 백엔드 값 | 화면에 넣을 수 있는 내용 | 실제 예시 문구 |
| --- | --- | --- |
| `report.status` | 리포트 상태 | `리포트 상태: READY` |
| `report.summary_jsonb.overall_risk` | 전체 위험도 | `전체 위험도: medium` |
| `report.summary_jsonb.task_success` | 진단 성공 여부 | `진단이 완료됐습니다.` |
| `report.summary_jsonb.friction_score` | 마찰 점수 | `마찰 점수: 54.67` |
| `report.summary_jsonb.top_issues_count` | 주요 이슈 수 | `주요 이슈 1건이 발견됐습니다.` |
| `report.summary_jsonb.llm_overall_summary` | 전체 요약 | `한 페이지에 여러 선택지가 함께 보여져 사용자의 선택이 어려워질 수 있습니다.` |
| `report.decision_map_jsonb[].status` | 단계별 판단 상태 | `CTA 단계: WARNING` |
| `report.decision_map_jsonb[].summary` | 단계별 판단 이유 | `CTA 단계에서 선택지가 과도하게 많아 다음 행동을 고르기 어려울 수 있습니다.` |
| `analysis_finding.title` | 문제 제목 | `선택지 과도한 노출로 인한 선택 혼란` |
| `analysis_finding.summary` | 문제 설명 | `한 화면에 여러 버튼과 링크가 함께 보여져 사용자가 다음 행동을 결정하는 데 어려움을 겪을 수 있습니다.` |
| `analysis_finding.stage` | 문제가 발생한 단계 | `관련 단계: CTA` |
| `analysis_finding.axis` | 문제 축 | `문제 축: Path` |
| `analysis_finding.severity` | 심각도 | `심각도: 2` |
| `analysis_finding.confidence` | 신뢰도 | `신뢰도: 82%` |
| `analysis_finding.priority_score` | 우선순위 점수 | `우선순위 점수: 2.130` |
| `analysis_finding.impact_hypothesis` | 왜 문제인지 | `많은 클릭 대상이 한 화면에 노출되면 사용자가 주요 목표 행동을 빠르게 선택하기 어렵습니다.` |
| `nudge.title` | 개선안 제목 | `선택지 간 시각적 구분 강화` |
| `nudge.recommendation` | 개선 제안 | `중요한 버튼을 더 크거나 눈에 띄게 디자인하고, 관련 선택지는 그룹화하는 방안을 고려해보세요.` |
| `nudge.expected_effect` | 기대 효과 | `사용자가 중요한 행동을 더 빠르게 파악하고 선택할 것 같아요.` |
| `nudge.validation_question` | 개선 후 검증 질문 | `사용자는 새로운 화면에서 가장 중요한 선택지를 빠르게 인식하고 선택할 수 있나요?` |

### 화면 문구 예시

```text
전체 요약
한 페이지에 여러 선택지가 함께 보여 사용자의 선택이 어려워질 수 있습니다.

주요 문제
선택지 과도한 노출로 인한 선택 혼란

왜 문제인가요?
많은 클릭 대상이 한 화면에 노출되면 사용자가 주요 목표 행동을 빠르게 선택하기 어렵습니다.

개선 제안
중요한 버튼을 더 크거나 눈에 띄게 디자인하고, 관련 선택지는 그룹화하는 방안을 고려해보세요.

개선 후 확인 질문
사용자는 새로운 화면에서 가장 중요한 선택지를 빠르게 인식하고 선택할 수 있나요?
```

### 이미 받고 있지만 덜 쓰는 값

| 백엔드 값 | 화면에 넣을 수 있는 내용 | 실제 예시 문구 |
| --- | --- | --- |
| `decision_map_jsonb[].summary` | 단계별 판단 이유 | `CTA 단계에서 선택지가 과도하게 많아 다음 행동을 고르기 어려울 수 있습니다.` |
| `decision_map_jsonb[].evidenceRefs` | 단계별 근거 연결 수 | `CTA 단계 판단에는 1개의 주요 근거가 연결돼 있습니다.` |
| `analysis_finding.impact_hypothesis` | 문제가 사용자에게 주는 영향 | `많은 클릭 대상이 한 화면에 노출되면 사용자가 주요 행동을 빠르게 선택하기 어렵습니다.` |
| `analysis_finding.evidence_refs_jsonb.problemComponent.text` | 실제 문제가 된 요소 | `문제가 된 요소: 장바구니알림` |
| `analysis_finding.evidence_refs_jsonb.problemComponent.selector` | 문제 요소 selector | `a[href="https://shopping.naver.com/cart"]` |
| `analysis_finding.references_jsonb` | 판단 기준 또는 참고 근거 | `이 판단은 사용성 기준 문서에 근거합니다.` |
| `nudge.validation_question` | 개선 후 검증 질문 | `사용자는 새로운 화면에서 가장 중요한 선택지를 빠르게 인식하고 선택할 수 있나요?` |
| `finding.highlight` | 스크린샷 위 문제 위치 | `문제가 된 버튼 위치를 화면에서 표시합니다.` |
| `report.updated_at` | 리포트 갱신 시각 | `마지막 분석 업데이트: 2026-05-15 10:16` |

### 추가 API를 붙이면 좋은 것

| 추가 API/데이터 | 화면에 넣을 수 있는 내용 | 실제 예시 문구 |
| --- | --- | --- |
| `GET /api/reports/{id}/evidence-map` | 문제, 체크포인트, 스크린샷 연결 | `이 문제는 COMMIT 단계의 스크린샷에서 확인된 요소입니다.` |
| `GET /api/reports/{id}/screenshots` | 리포트용 스크린샷 목록 | `문제와 연결된 화면 캡처 1장을 확인할 수 있습니다.` |
| `GET /api/reports/{id}/reference-summary` | 외부 기준 요약 | `이 개선안은 버튼 우선순위와 선택지 명확성 기준에 근거합니다.` |
| `GET /api/reports/{id}/navigation-summary` | 리포트 기준 이동 경로 | `진단은 시작 URL에서 결제 진입점 확인 후 중단됐습니다.` |
| `GET /api/reports/{id}/issue-evidence/{findingId}` | 특정 문제의 상세 근거 | `이 문제와 연결된 버튼, selector, 스크린샷 좌표를 확인합니다.` |

### 냉정한 판단

완료 리포트 화면에서는 `priority_score` 같은 숫자를 크게 앞세우는 것보다 아래 순서로 보여주는 편이 낫다.

| 우선순위 | 백엔드 값 | 이유 |
| --- | --- | --- |
| 1 | `summary_jsonb.llm_overall_summary` | 전체 진단 결과를 가장 빠르게 이해시킨다. |
| 2 | `analysis_finding.title` | 문제가 무엇인지 명확히 보여준다. |
| 3 | `analysis_finding.summary` | 문제 상황을 설명한다. |
| 4 | `analysis_finding.impact_hypothesis` | 왜 문제인지 설득한다. |
| 5 | `nudge.recommendation` | 무엇을 고치면 되는지 안내한다. |
| 6 | `nudge.expected_effect` | 고치면 무엇이 좋아지는지 알려준다. |
| 7 | `nudge.validation_question` | 개선 후 다시 확인할 기준을 제공한다. |

사용자는 점수보다 아래 질문에 대한 답을 더 중요하게 본다.

```text
무슨 문제가 있었나?
왜 문제인가?
무엇을 고치면 되나?
고치면 뭐가 좋아지나?
```

## 참고사항 / 작성자 의견

### 1. runs 화면의 페이지 이동 수 표기는 분리해야 한다

`runs` 화면에서 "몇 페이지를 이동했는지"를 보여주는 것은 좋은 지표다.
하지만 현재 DB에는 정확한 `page_move_count` 컬럼이 없다.

따라서 화면에는 아래 4개를 분리해서 보여주는 것이 맞다.

| 지표 | 현재 예시 | 권장 문구 |
| --- | --- | --- |
| URL 기준 방문 페이지 수 | `1개` | `URL 기준 1개 페이지에서 진단이 진행됐습니다.` |
| 체크포인트 수 | `3개` | `3개의 체크포인트에서 화면 상태를 수집했습니다.` |
| 스크린샷 수 | `3장` | `스크린샷 3장이 저장됐습니다.` |
| 실행 step 수 | `4개` | `총 4단계를 실행했습니다.` |

현재 예시에서는 "3페이지를 이동했다"가 아니라 "같은 URL에서 3번 수집했다"가 정확하다.
이 표현을 잘못 쓰면 리포트 신뢰도가 떨어질 수 있다.

### 2. 우선순위는 완료 리포트 화면이 가장 높다

화면별 개선 우선순위는 아래 순서가 적합하다.

| 우선순위 | 페이지 | 이유 |
| --- | --- | --- |
| 1 | 완료된 리포트 화면 | 사용자가 최종적으로 가치를 판단하는 화면이다. |
| 2 | runs 수집 화면 | 실제로 무엇을 봤는지 보여줘야 진단을 신뢰할 수 있다. |
| 3 | 진단 흐름 추천 | 추천 이유와 안전 조건만 명확하면 된다. |
| 4 | 사전분석 화면 | 흐름 후보와 후보 수 중심의 간단한 요약이면 충분하다. |

### 3. 추가 API보다 먼저 기존 값을 잘 보여주는 것이 맞다

추가 API를 붙이기 전에 이미 받고 있는 값을 먼저 살리는 것이 효율적이다.

| 먼저 살릴 값 | 적용 화면 | 화면에서 만들 수 있는 내용 |
| --- | --- | --- |
| `impactHypothesis` | 완료 리포트 | 문제가 사용자에게 주는 영향 설명 |
| `validationQuestion` | 완료 리포트 | 개선 후 확인 질문 |
| `evidenceRefs` | 완료 리포트 | 문제와 근거 연결 |
| `decisionMap.summary` | 완료 리포트 | 단계별 판단 이유 |
| `checkpoint.state_jsonb.url` | runs 수집 | 실제 수집 URL |
| `artifact.width`, `artifact.height`, `artifact.size_bytes` | runs 수집 | 스크린샷 메타 정보 |

작성자 의견으로는, 바로 다음 작업은 아래 순서가 적합하다.

```text
1. 이미 받고 있는 값으로 UI 문구 보강
2. runs 화면에 visited-pages / navigation summary 추가
3. report 화면에 evidence-map 추가
```

## 최종 요약

| 페이지 | 이미 받지만 덜 쓰는 값으로 넣을 수 있는 것 | 추가 API로 넣으면 좋은 것 |
| --- | --- | --- |
| 사전분석 | 감지/미감지 흐름, 후보 수, 최종 URL로 사전분석 요약 카드 | 사전분석 스크린샷, 근거 요약 |
| 진단 흐름 추천 | 추천 이유, 추천 근거 문구, 안전 검증으로 추천 설득력 강화 | 실행 계획 preview, safety summary |
| runs 수집 | 체크포인트 URL, 스크린샷 메타, 액션 후 URL로 수집 요약 강화 | visited-pages, navigation timeline, screenshot gallery |
| 완료 리포트 | `impactHypothesis`, `evidenceRefs`, `references`, `validationQuestion`으로 리포트 신뢰도 강화 | evidence-map, issue evidence, reference summary |
