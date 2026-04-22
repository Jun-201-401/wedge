# Wedge RabbitMQ Topology

로컬/개발용 RabbitMQ 토폴로지 초안. `definitions.json`을 `management.load_definitions`로 부팅 시 일괄 선언한다.

- 큐 소유권: [queue-ownership.md](./queue-ownership.md)
- 토폴로지 정의: [definitions.json](./definitions.json)
- 브로커 설정: [rabbitmq.conf](./rabbitmq.conf)
- Management UI: http://localhost:15672 (compose 기동 후)

## 네이밍 규칙

```
queue / routing_key : <domain>.<action>.request | <domain>.<action>.dlq
exchange            : wedge.direct | wedge.dlq
```

- `domain` ∈ {`run`, `discovery`, `analysis`, `report`}
- `action`은 domain별 자유 (`execute`, `evaluate`, `export` 등)
- `request` 큐와 DLQ는 1:1 대응, routing_key는 큐 이름과 동일
- exchange만 `wedge.` prefix를 붙임 — 단일 vhost(`/`) 단일 프로젝트 전제라 큐/routing_key에는 prefix 불필요
- 다른 서비스와 브로커를 공유하게 되면 prefix 정책 재논의

## Exchange 전략

- `wedge.direct`: 모든 request 라우팅. routing_key = 큐 이름으로 1:1 direct binding.
- `wedge.dlq`: 실패 격리. request 큐의 `x-dead-letter-exchange` 타겟.

## 운영 전환 시 TODO (V1 초안에서는 의도적으로 제외)

아래 항목은 현재 "로컬/개발 초안" 범위 밖이며, 운영 진입 전 반드시 재검토한다.
WDAY-025(dummy publish/consume) 검증 후 실증 데이터로 값 결정 권장.

| 항목 | 현재 상태 | 운영 전 필요 작업 | 우선순위 |
|---|---|---|---|
| vhost | 기본 `/` 사용 | 전용 vhost (`/wedge` 등) 분리 + 권한 범위 제한 | 中 |
| Policy 분리 | DLX를 큐 argument에 하드코딩 | `policies`로 패턴 매칭 일괄 적용 (큐 재생성 없이 정책 변경 가능) | 高 |
| Retry 전략 | DLQ만 존재, 재시도 없음 | 지연 재시도 큐(TTL + DLX loop) 또는 consumer 측 N회 재시도 후 DLQ | 高 |
| Queue type | 기본 `classic` | `x-queue-type: quorum` 검토 (3.8+ 권장, classic mirrored deprecated) | 中 |
| DLQ 보관 한도 | 무제한 | DLQ에 `x-message-ttl`(예: 7d) 또는 `x-max-length` policy 적용 | 高 |
| Unroutable 방어 | 없음 | `wedge.direct`에 `alternate-exchange` → `wedge.unroutable` 큐 | 低 |
| 사용자/권한 | `RABBITMQ_DEFAULT_USER` env (dev guest 대체) | definitions에 `users` / `permissions` 정의 또는 외부 주입 | 中 |
| Consumer 튜닝 | `prefetch` 미지정 | 워크로드별 `prefetch_count` 결정 (Runner vs Analyzer 부하 특성 다름) | 中 |

## 변경 절차

`definitions.json` 수정 시:

1. 관련 문서/계약 동기화 (publisher/consumer 코드가 생기면 routing_key 상수도 포함)
2. RabbitMQ 컨테이너 재생성 — `management.load_definitions`는 부팅 시에만 로드되므로 `up -d`만으로는 반영 안 됨:
   ```bash
   docker compose -f docker-compose.dev.yml up -d --force-recreate rabbitmq
   ```
   (또는 `docker compose ... restart rabbitmq`)
3. Management UI에서 exchange/queue/binding 반영 확인
4. Publisher/consumer 재시작

Breaking change (큐 이름/arguments 변경)는 기존 큐 삭제 필요. dev에서 RabbitMQ volume만 초기화하려면:

```bash
docker compose -f docker-compose.dev.yml stop rabbitmq
docker compose -f docker-compose.dev.yml rm -f rabbitmq
docker volume rm wedge-dev_rabbitmq_data
docker compose -f docker-compose.dev.yml up -d rabbitmq
```

⚠️ `docker compose down -v`는 **전체 스택의 모든 volume**(postgres/minio 포함)을 삭제하므로 사용 금지.
