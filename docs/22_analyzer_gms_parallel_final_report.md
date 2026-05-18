# Analyzer GMS 병렬화 개선 최종 정리

> 작성일: 2026-05-18  
> 목적: Analyzer 리포트 생성 지연 개선 작업의 before / after / 최종 after 병렬 3 결과를 한 문서로 정리한다.  
> 관련 브랜치: `feature/analyzer-gms-parallel-checkpoints`

---

## 한 줄 결론

`label_integrity` / `label_role`의 checkpoint 이미지 GMS 호출을 병렬 처리하면서 Analyzer 처리 시간이 크게 줄었다.

- 1차 개선: phase 내부 checkpoint 호출을 병렬화해 **약 84초 → 약 63.5초**로 감소
- 2차 개선: compact prompt + 이미지 병렬 3 적용 후 최근 동일 계열 run에서 **약 60.0초 → 약 40.0초**로 감소
- 최종 현재 병목은 image label phase보다 `report_explainer`의 text GMS 호출 **약 15~16초** 쪽으로 이동

---

## 최종 현재 구조

```text
label_integrity phase
  - checkpoint 이미지 3개까지 병렬
  - maxConcurrency = 3

label_role phase
  - checkpoint 이미지 3개까지 병렬
  - maxConcurrency = 3

phase 순서
  label_integrity -> label_role -> stage_context_build -> semantic_cta -> rule_engine_eval -> report_explainer
```

중요:

- `label_integrity`와 `label_role` phase 자체는 여전히 **직렬**이다.
- 따라서 worker 10개 기준 analyzer image GMS 최악 동시 호출은 `10 × 3 = 30`이다.
- `integrity + role`을 phase 병렬로 동시에 돌리는 `10 × 3 × 2 = 60 image` 구조는 적용하지 않았다.

---

## 측정 세트 A — 최초 병렬화 효과: 병렬 off -> 병렬 2

이 세트는 기존 문서 `Gwan/analyzer_gms_parallel_before_after.md`의 내용을 요약한 것이다.

### 조건

| 구분 | Before | After |
|---|---|---|
| `parallelEnabled` | `false` | `true` |
| `maxConcurrency` | 2로 표시되지만 병렬 off | 2 |
| checkpoint 수 | 3 | 3 |
| issueCount | 3 | 3 |
| 주요 목적 | 완전 직렬 기준 | checkpoint 단위 병렬 2 |

### 평균 결과

| 항목 | Before 평균 | After 평균 | 변화 | 개선율 |
|---|---:|---:|---:|---:|
| `label_integrity` | 30.5s | 19.5s | -11.0s | 약 35.9% 감소 |
| `label_role` | 35.3s | 21.4s | -13.9s | 약 39.4% 감소 |
| label 두 phase 합계 | 65.8s | 40.9s | -24.9s | 약 37.8% 감소 |
| `analysis_core_total` | 83.9s | 63.4s | -20.5s | 약 24.4% 감소 |
| `process_message_total` | 84.0s | 63.5s | -20.5s | 약 24.4% 감소 |

### 해석

checkpoint 3개가 phase 안에서 직렬로 쌓이던 구조를 병렬 2로 바꾸면서, label 두 phase 합계가 약 25초 줄었다.

---

## 측정 세트 B — 현재 최종 효과: 병렬 2 + compact -> 병렬 3 + compact

최근 같은 계열 시나리오에서 측정한 현재 비교다.  
이 세트는 `issueCount=4`, compact prompt enabled, checkpoint 3개 기준이다.

### Before 기준: 병렬 2 + compact prompt

기존 병렬 2 after 측정 4회 평균:

| 항목 | 평균 |
|---|---:|
| `label_integrity` | 21.787s |
| `label_role` | 21.459s |
| `report_explainer` | 16.666s |
| `analysis_core_total` | 59.918s |
| `process_message_total` | 60.012s |
| `promptCharCount` | 11,513~11,575 |
| `fallbackUsed` | false |

### After 기준: 병렬 3 + compact prompt

최근 run 3회:

| runId | `label_integrity` | `label_role` | `report_explainer` | `analysis_core_total` | `process_message_total` |
|---|---:|---:|---:|---:|---:|
| `19613c37-c6cb-4392-9853-5dee97890043` | 12.68s | 12.93s | 15.97s | 41.59s | 41.76s |
| `f8c5f68c-be93-4aee-8f74-fa46935bfa01` | 6.55s | 12.29s | 15.53s | 34.37s | 34.44s |
| `e42ba544-c6e2-4163-9c34-5e4251c50ae7` | 10.72s | 17.48s | 15.39s | 43.59s | 43.65s |
| **평균** | **9.98s** | **14.23s** | **15.63s** | **39.85s** | **39.95s** |

로그 공통 확인값:

```text
parallelEnabled = true
maxConcurrency = 3
compactPromptEnabled = true
fallbackUsed = false
attemptCount = 1
issueCount = 4
```

### 병렬 2 + compact 대비 병렬 3 + compact 개선

| 항목 | 병렬 2 평균 | 병렬 3 평균 | 변화 | 개선율 |
|---|---:|---:|---:|---:|
| `label_integrity` | 21.79s | 9.98s | -11.81s | 약 54.2% 감소 |
| `label_role` | 21.46s | 14.23s | -7.23s | 약 33.7% 감소 |
| label 두 phase 합계 | 43.25s | 24.21s | -19.04s | 약 44.0% 감소 |
| `report_explainer` | 16.67s | 15.63s | -1.04s | 약 6.2% 감소 |
| `analysis_core_total` | 59.92s | 39.85s | -20.07s | 약 33.5% 감소 |
| `process_message_total` | 60.01s | 39.95s | -20.06s | 약 33.4% 감소 |

### 해석

병렬 3은 checkpoint 3개짜리 run에서 각 label phase를 한 번의 image GMS wave로 끝낼 수 있게 한다.

```text
병렬 2: checkpoint 2개 + checkpoint 1개 = 2 wave
병렬 3: checkpoint 3개 = 1 wave
```

그래서 `label_integrity + label_role` 합계가 약 43.25초에서 약 24.21초로 줄었다.

### 참고 비교 — 최초 직렬 처리 대비 최종 병렬 3

아래 비교는 “처음 직렬 처리”와 “현재 최종 병렬 3 + compact prompt”를 한눈에 보기 위한 참고 비교다.
다만 두 측정 세트는 issueCount와 prompt 조건이 완전히 같지 않기 때문에, 엄밀한 동일 조건 A/B라기보다 개선 흐름을 이해하기 위한 요약으로 본다.

| 항목 | 최초 직렬 평균 | 최종 병렬 3 + compact 평균 | 변화 | 참고 개선율 |
|---|---:|---:|---:|---:|
| `label_integrity` | 30.5s | 9.98s | -20.52s | 약 67.3% 감소 |
| `label_role` | 35.3s | 14.23s | -21.07s | 약 59.7% 감소 |
| label 두 phase 합계 | 65.8s | 24.21s | -41.59s | 약 63.2% 감소 |
| `process_message_total` | 84.0s | 39.95s | -44.05s | 약 52.4% 감소 |

요약하면, 최초 직렬 처리 기준으로는 Analyzer 처리 시간이 대략 아래처럼 줄었다.

```text
최초 직렬: 약 84.0초
최종 병렬 3 + compact: 약 40.0초
참고 개선: 약 44초 단축, 약 52% 감소
```

이 수치는 병렬화와 compact prompt가 함께 반영된 최종 상태의 체감 개선 폭을 설명하기 위한 값이다.

---

## Runner 종료부터 Report 생성까지

최근 병렬 3 run 3회 기준 DB 시각:

| runId | Runner 실행 | Analyzer 분석 | Runner 종료 -> Report row 생성 |
|---|---:|---:|---:|
| `19613c37...` | 19.30s | 41.71s | 48.22s |
| `f8c5f68c...` | 19.66s | 34.48s | 40.09s |
| `e42ba544...` | 19.99s | 43.69s | 50.14s |
| **평균** | **19.65s** | **39.96s** | **46.15s** |

주의:

- `Runner 종료 -> Report row 생성`에는 analysis job queue 진입 지연, analyzer 처리, callback, report row 생성 시점 차이가 함께 포함된다.
- 실제 analyzer worker 내부 처리 시간은 `process_message_total` 평균 약 39.95초다.

---

## Compact prompt 효과 요약

별도 측정에서 `report_explainer` compact prompt는 입력 크기를 크게 줄였다.

| 항목 | compact off | compact on |
|---|---:|---:|
| `promptCharCount` | 약 53,518 | 약 11,513~11,575 |
| 감소율 | - | 약 78% 감소 |
| `report_explainer` latency | 약 17.1s | 약 15.7~16.7s |

해석:

- prompt 크기 감소 효과는 명확하다.
- latency 개선은 제한적이다.
- 현재 병목은 compact prompt보다 image label phase 병렬화 효과가 더 컸다.

---

## GMS 동시 호출 smoke 결과와 병렬 3 선택 이유

운영 확장 가능성을 보기 위해 실제 GMS smoke도 진행했다.

### 동시 호출 계산 기준

현재 최종안은 `label_integrity`와 `label_role` phase를 동시에 돌리지 않는다.
따라서 analyzer 쪽 동시 image GMS 호출 수는 아래처럼 계산한다.

```text
analyzer image 동시 호출 = analyzer worker 수 × checkpoint image 병렬 수
```

예시:

| 가정 | analyzer image 동시 호출 | runner text 동시 호출 | 총 GMS 동시 호출 |
|---|---:|---:|---:|
| worker 1개, image 병렬 3 | 3 | 1 | 4 |
| worker 3개, image 병렬 3 | 9 | 3 | 12 |
| worker 10개, image 병렬 3 | 30 | 10 | 40 |

만약 `label_integrity`와 `label_role` phase까지 동시에 돌리면 worker 10개 기준 아래처럼 증가한다.

```text
10 workers × 3 images × 2 phases = 60 image calls
runner text 10개까지 겹치면 총 70 GMS calls
```

이 70 동시 호출 구조는 현재 단계에서 과한 burst로 보고 적용하지 않았다.

### Smoke 결과

| 부하 | 의미 | 결과 |
|---|---|---|
| `image=2, text=1` | 기존 worker 1개 병렬 2 수준 | 3/3 success |
| `image=3, text=1` | worker 1개 병렬 3 + runner 1개 겹침 | 간헐 실패 1회 후 재시도 성공 |
| `image=6, text=3` | worker 3개, 병렬 2 가정 | 9/9 success |
| `image=9, text=3` | worker 3개, 병렬 3 가정 | 12/12 success |
| `image=30, text=10` | worker 10개, 병렬 3 최악 순간 | 40/40 success, elapsed 14.05s |

### 해석

- 단기 smoke 기준으로 worker 10개 + image 병렬 3 최악 순간도 통과했다.
- 단, `image=3,text=1`에서 간헐 실패가 한 번 있었으므로, 운영 안정성 판단에는 반복/soak가 필요하다.
- 현재 설계는 analyzer image 동시 최대를 worker 10개 기준 30으로 제한한다.
- phase까지 병렬화하는 경우의 60 image / 총 70 GMS 동시 호출은 추후 확장성에는 부담이 크다.

따라서 병렬 3은 아래 두 요구 사이에서 선택한 타협값이다.

```text
리포트 생성 시간 단축: checkpoint 3개를 한 phase 안에서 한 번에 처리
추후 worker 확장성: worker 10개 기준 image 30 / 총 40 동시 호출 수준으로 제한
```

즉, `maxConcurrency=3`은 “현재 시나리오의 checkpoint 3개를 충분히 활용하되, worker가 늘어났을 때 GMS burst가 과도하게 커지지 않도록 타협한 병렬 처리 수”로 이해하면 된다.

---

## 왜 integrity / role phase 병렬화는 보류했는가

현재 `label_role`은 `label_integrity` 결과를 직접 읽지 않는다.  
따라서 이론상 phase 병렬화도 가능하다.

하지만 phase 병렬화를 하면 worker 10개 기준 analyzer image 동시 호출이 아래처럼 커진다.

```text
현재 최종 구조:
10 workers × 3 images = 30 image calls

phase 병렬화까지 하는 구조:
10 workers × 3 images × 2 phases = 60 image calls

runner text 10개까지 겹치면:
60 image + 10 text = 70 total GMS calls
```

보류 이유:

- image GMS burst가 2배로 증가한다.
- 같은 screenshot을 서로 다른 prompt로 동시에 2번 보내게 된다.
- packet merge 구조가 복잡해진다.
- 현재 병렬 3만으로도 약 20초 추가 개선이 확인되었다.

따라서 현재 최종안은:

```text
phase 병렬화 X
checkpoint 이미지 병렬 3 O
```

---

## 최종 판단

### 개선 효과

현재까지 확인한 가장 실용적인 개선은 아래 조합이다.

```text
label_integrity / label_role phase는 직렬 유지
각 phase 내부 checkpoint image GMS maxConcurrency=3
report_explainer compact prompt enabled
```

이 조합에서 최근 run 기준 Analyzer 처리 시간은:

```text
병렬 2 + compact: 약 60.0초
병렬 3 + compact: 약 40.0초
개선: 약 20.1초 단축, 약 33% 개선
```

### 남은 병목

현재 남은 주요 시간은:

| 구간 | 현재 평균 |
|---|---:|
| `label_integrity` | 약 10.0s |
| `label_role` | 약 14.2s |
| `report_explainer` | 약 15.6s |

이제 가장 큰 단일 고정 구간은 `report_explainer`다.

### 권장 다음 작업

1. 같은 시나리오로 병렬 3 run을 2~3회 더 반복해 편차 확인
2. 최종 리포트 내용 diff 확인
   - issueCount
   - topFindings
   - evidenceRefs
   - nudges
   - 사용자에게 보이는 문장
3. 운영 worker 수를 늘리기 전 GMS 장시간 soak / rate limit 기준 확인
4. phase 병렬화는 후순위로 보류

---

## MR에 쓸 수 있는 요약 문장

```text
Analyzer의 label_integrity / label_role 단계에서 checkpoint 이미지 GMS 호출을 phase 내부 병렬 처리하도록 개선했다. 최초 병렬화에서는 process_message_total 평균이 약 84.0초에서 63.5초로 줄었고, 이후 maxConcurrency=3 및 compact prompt 적용 상태의 최근 run에서는 약 60.0초에서 40.0초로 추가 감소했다. phase 자체 병렬화는 적용하지 않아 worker 10개 기준 analyzer image GMS 동시 호출 상한은 30으로 유지한다.
```
