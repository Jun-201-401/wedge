# Analyzer observation type index performance experiment

## 목적

Analyzer Rule Engine에서 Rule handler가 필요한 observation type을 찾을 때마다 `StageContext.observations` 전체를 반복 스캔하는 구조의 비용을 확인하고, observation type별 dictionary index가 개선 효과를 낼 수 있는지 실험한다.

## 기존 구조

현재 helper 위치: `apps/analyzer/app/rule_engine/handler_utils.py`

```python
def observations_of_type(context: StageContext, *types: str) -> list[ObservationRecord]:
    return [record for record in context.observations if record.observation.get("type") in types]
```

이 helper는 Rule handler 여러 곳에서 사용된다.

- CTA/Journey: `cta_candidate`
- Form: `form_field`, `missing_label`
- Reliability: `network_failure`, `console_error`, `network_timeline`
- Target Size / Path Choice: `interactive_components`
- Feedback: `loading_state`, `settle_response`

Rule lookup 수를 r, stage context 안의 observation 수를 n이라고 하면 반복 조회 비용은 대략 `O(r * n)`이다.

## 실험 설계

실험/검증 파일:

- `apps/analyzer/app/tests/test_observation_type_index.py`
  - production `StageContextBuilder` / `observations_of_type` 기준 결과 동등성 검증
  - multi-type 조회 순서 보존, duplicate type argument, `dataclasses.replace` 시 index 재생성 검증
  - 반복 스캔 work와 index work의 구조적 차이 검증
- `apps/analyzer/scripts/benchmark_observation_type_index.py`
  - synthetic `StageContext`를 만들어 observation 수와 rule lookup 수별 평균 시간 측정
  - indexed path는 production `build_observation_type_index`와 `observations_of_type`를 사용한다.

index 방식은 observation type을 key로 하는 dictionary를 만든다. 다만 기존 list scan은 observation 원래 순서를 보존하므로, multi-type 조회에서도 동일한 순서를 유지하기 위해 index bucket에 원래 position을 함께 저장했다.

## 검증 결과

검증 명령:

```bash
cd apps/analyzer
python3 -m unittest app.tests.test_observation_type_index
```

결과:

- 5개 테스트 통과
- index 조회 결과가 반복 스캔 결과와 동일함을 확인
- multi-type 조회에서 기존 observation 순서가 유지됨을 확인
- `StageContext`의 observations가 `dataclasses.replace`로 바뀌어도 index가 재생성됨을 확인
- 1,200 observations, 80 rule lookups 기준 work가 `96,000` scan checks에서 `1,320` index build/probes로 줄어드는 구조를 확인

## Benchmark 결과

측정 명령:

```bash
cd apps/analyzer
python3 scripts/benchmark_observation_type_index.py
```

측정 결과:

| observations | rule lookups | scan avg ms | indexed avg ms | speedup |
| ---: | ---: | ---: | ---: | ---: |
| 100 | 20 | 0.0623 | 0.0324 | 1.92x |
| 100 | 80 | 0.2140 | 0.0918 | 2.33x |
| 100 | 200 | 0.5404 | 0.1932 | 2.80x |
| 500 | 20 | 0.2474 | 0.1001 | 2.47x |
| 500 | 80 | 0.9704 | 0.2607 | 3.72x |
| 500 | 200 | 2.4412 | 0.5470 | 4.46x |
| 1000 | 20 | 0.4794 | 0.1932 | 2.48x |
| 1000 | 80 | 1.8707 | 0.4296 | 4.35x |
| 1000 | 200 | 4.6150 | 0.9875 | 4.67x |
| 5000 | 20 | 2.2361 | 1.1270 | 1.98x |
| 5000 | 80 | 9.0220 | 2.2507 | 4.01x |
| 5000 | 200 | 25.1299 | 6.7273 | 3.74x |
| 10000 | 20 | 4.7526 | 2.4749 | 1.92x |
| 10000 | 80 | 19.9520 | 5.1833 | 3.85x |
| 10000 | 200 | 47.8806 | 9.7370 | 4.92x |

## 해석

이번 실험에서는 production helper 기준 index 생성 비용까지 포함해도 모든 측정 구간에서 index 방식이 더 빨랐다. 특히 rule lookup 수가 증가할수록 반복 스캔 비용은 선형으로 계속 증가하지만, index 방식은 최초 1회 build 이후 type key 조회 중심으로 비용이 줄어든다.

다만 이 개선은 GMS/LLM 호출 같은 외부 지연을 줄이는 종류의 최우선 병목 개선은 아니다. Rule Engine 자체가 커지고 observation packet이 커질 때 평가 구조가 안정적으로 유지되도록 하는 구조 개선에 가깝다.

## Production 적용

적용 가치가 있어 `StageContext`에 `observation_type_index`를 추가하고, `observations_of_type(context, *types)`가 index를 사용하도록 반영했다.

적용 방식:

1. `StageContext`가 `__post_init__`에서 observations 기반 `observation_type_index`를 생성한다.
2. `StageContextBuilder`는 기존처럼 stage별 observations를 넘기고, index는 `StageContext` 생성 시 자동으로 파생된다.
3. `observations_of_type(context, *types)`는 파생된 index를 사용한다.
4. multi-type 조회에서 기존 scan과 같은 observation 순서를 유지한다.

주의할 점:

- 단순히 `type -> records` bucket을 이어 붙이면 multi-type 조회 순서가 바뀐다.
- 기존 handler가 observation 순서에 의존할 가능성이 있으므로 position을 함께 저장하고, multi-type 결과를 원래 index 기준으로 정렬해야 한다.

## 발표 포인트

> Analyzer Rule Engine은 Rule이 늘어날수록 같은 EvidencePacket observations를 반복해서 탐색할 수 있습니다. 이를 줄이기 위해 StageContext 생성 시 observation type을 key로 하는 dictionary index를 구성했고, 기존 반복 스캔과 동일한 결과를 유지하면서 production helper benchmark 기준 약 1.9배에서 4.9배 정도 빠른 조회가 가능했습니다. 특히 multi-type 조회에서도 기존 observation 순서를 보존하도록 position 기반 정렬을 설계해, 성능 개선과 Rule 재현성을 함께 지키는 방향으로 검증했습니다.

## 발표용 정리

### 제목

Rule Engine 확장성을 위한 Evidence Access Pattern 개선

### 한 줄 요약

Analyzer Rule Engine에서 Rule마다 Evidence observation 전체를 반복 탐색하던 구조를, StageContext 생성 시 observation type별 index를 만들어 필요한 evidence를 바로 조회하는 구조로 개선했다.

### 쉽게 설명하면

Analyzer는 EvidencePacket 안의 observation을 기반으로 여러 UX Rule을 평가한다.

- CTA Rule은 `cta_candidate`를 찾는다.
- Form Rule은 `form_field`를 찾는다.
- Reliability Rule은 `network_failure`, `console_error`를 찾는다.
- Target Size Rule은 `interactive_components`를 찾는다.

기존 구조에서는 각 Rule이 필요한 observation을 찾을 때마다 전체 observation 목록을 다시 훑는다.

```text
기존: Rule마다 전체 observations scan
개선: StageContext 생성 시 1회 index build 후 type key 조회
```

즉 Rule 수가 늘고 EvidencePacket이 커질수록 반복 탐색 비용이 누적된다.

```text
기존 비용 구조: Rule lookup 수 * observation 수
개선 비용 구조: observation 수만큼 1회 index build + type key 조회
```

### 기술적으로 강조할 부분

단순히 dictionary를 쓰는 것만으로는 부족하다. multi-type 조회에서 기존 observation 순서가 바뀔 수 있기 때문이다.

예를 들어 기존 observations 순서가 다음과 같다고 하자.

```text
[network_failure A, console_error B, network_failure C]
```

단순 bucket 조회를 하면 이렇게 합쳐질 수 있다.

```text
network_failure -> [A, C]
console_error -> [B]
합친 결과 -> [A, C, B]
```

하지만 기존 전체 scan 결과는 다음 순서다.

```text
[A, B, C]
```

Rule 결과의 재현성을 유지하려면 observation의 원래 position을 함께 저장하고, multi-type 조회 시 원래 순서대로 정렬해야 한다. 이번 실험은 이 순서 보존까지 포함해서 반복 scan과 동일한 결과를 검증했다.

### 발표 흐름

1. Analyzer는 LLM보다 먼저 deterministic Rule Engine으로 UX 문제를 판단한다.
2. Rule Engine은 EvidencePacket의 observations를 type별로 찾아 평가한다.
3. 기존 구조에서는 Rule handler가 필요한 type을 찾을 때마다 전체 observations를 반복 scan했다.
4. StageContext 생성 시 observation type별 index를 만들면 Rule은 key로 바로 조회할 수 있다.
5. 단순 dictionary 적용이 아니라, multi-type 조회에서도 기존 observation 순서를 보존해 Rule 평가 재현성을 유지했다.
6. benchmark에서 반복 scan 대비 약 1.9x~4.9x 빠른 결과를 확인했다.

### 발표 문장 예시

Analyzer는 Rule Engine이 먼저 UX 문제를 deterministic하게 판단하고, LLM은 이후 설명을 다듬는 구조입니다. 그래서 Rule 평가 과정의 재현성과 확장성이 중요합니다.

기존에는 Rule마다 필요한 evidence type을 찾기 위해 StageContext의 observations 전체를 반복해서 순회했습니다. Rule 수가 늘거나 EvidencePacket이 커지면 같은 목록을 계속 다시 탐색하는 비용이 생깁니다.

이를 개선하기 위해 StageContext 생성 시 observation type을 key로 하는 index를 구성했습니다. Rule handler는 필요한 evidence type을 key로 바로 조회할 수 있고, benchmark에서는 반복 scan 대비 약 1.9배에서 4.9배 빠른 결과를 확인했습니다.

특히 단순 dictionary 적용에서 끝내지 않고, multi-type 조회에서도 기존 observation 순서를 보존하도록 position 기반 정렬을 설계했습니다. 그래서 성능 개선뿐 아니라 Rule Engine의 판단 재현성도 유지할 수 있습니다.
