# Analyzer worker 병렬 운영 Runbook

목적: `analysis.request` queue가 밀릴 때 analyzer-worker를 안전하게 수평 확장하고, RabbitMQ consumer 수와 운영 상태를 확인하는 절차를 고정한다.

## 1. 운영 기준

Analyzer 병렬 처리는 `ANALYZER_MQ_PREFETCH`를 먼저 키우는 방식이 아니라 analyzer-worker replica 수를 늘리는 방식으로 운영한다.

```text
ANALYZER_WORKER_REPLICAS=2
ANALYZER_MQ_PREFETCH=1
ANALYZER_GMS_LABEL_PARALLEL_ENABLED=true
ANALYZER_GMS_LABEL_MAX_CONCURRENCY=3
```

`ANALYZER_MQ_PREFETCH=1`은 worker 하나가 아직 ack하지 않은 분석 요청을 하나만 잡도록 제한한다. 분석 작업은 시간이 길고 GMS/API 호출을 포함하므로, 한 worker가 여러 메시지를 미리 잡는 것보다 worker replica를 늘려 RabbitMQ가 작업을 분산하게 하는 편이 운영 상태를 이해하기 쉽다.

`ANALYZER_GMS_LABEL_PARALLEL_ENABLED`와 `ANALYZER_GMS_LABEL_MAX_CONCURRENCY`는 분석 요청 여러 개를 동시에 처리한다는 뜻이 아니다. 하나의 analysis job 내부에서 일부 GMS label 작업을 병렬화하는 설정이다.

```text
분석 요청 병렬성 = analyzer-worker replica 수
분석 내부 GMS 병렬성 = ANALYZER_GMS_LABEL_MAX_CONCURRENCY
```

## 2. 운영 배포 적용

Jenkins 배포는 `.env.prod`의 `ANALYZER_WORKER_REPLICAS` 값을 읽어 다음 scale 옵션을 적용한다.

```bash
--scale analyzer-worker=${ANALYZER_WORKER_REPLICAS}
```

운영 서버에서 수동으로 조정해야 할 때는 `prod-compose.sh`를 사용한다.

```bash
cd /srv/wedge
bash infra/scripts/prod-compose.sh up -d --scale runner=3 --scale analyzer-worker=2 runner analyzer-worker
```

`runner=3`, `analyzer-worker=2`가 현재 권장 시작값이다. Runner가 브라우저 실행을 병렬로 처리하고, Analyzer가 완료된 evidence packet 분석을 2개 worker로 나눠 처리한다.

## 3. 운영 검증

컨테이너 수를 확인한다.

```bash
cd /srv/wedge
bash infra/scripts/prod-compose.sh ps runner analyzer-worker
```

RabbitMQ consumer 수를 확인한다.

```bash
cd /srv/wedge
bash infra/scripts/prod-compose.sh exec rabbitmq rabbitmqctl list_queues name consumers messages_ready messages_unacknowledged
```

기대값:

```text
run.execute.request consumers = 3
agent.execute.request consumers = 3
discovery.execute.request consumers = 3
scenario-authoring.execute.request consumers = 3
analysis.request consumers = 2
```

`analysis.request messages_ready`가 계속 증가하면 분석 요청이 처리량보다 빠르게 쌓이는 상태다. `messages_unacknowledged`가 `2` 근처로 오래 유지되면 analyzer-worker 2개가 계속 작업 중이라는 뜻이다.

## 4. 로컬 scale 검증

로컬 기본 `compose.dev.yaml`의 analyzer-worker는 metrics 확인을 위해 `127.0.0.1:9102:9102`를 publish한다. 같은 service를 여러 replica로 늘리면 host port가 충돌하므로 scale 전용 override를 함께 사용한다.

```bash
docker compose --env-file .env -f compose.dev.yaml -f infra/compose/compose.dev.analyzer-scale.yaml up -d --scale analyzer-worker=2 analyzer-worker
```

RabbitMQ consumer 수를 확인한다.

```bash
docker compose --env-file .env -f compose.dev.yaml exec rabbitmq rabbitmqctl list_queues name consumers messages_ready messages_unacknowledged
```

기대값:

```text
analysis.request consumers = 2
```

단일 analyzer-worker 개발 모드로 되돌릴 때는 override 없이 다시 생성한다.

```bash
docker compose --env-file .env -f compose.dev.yaml up -d --force-recreate analyzer-worker
```

## 5. Scale 조정 기준

처음부터 `analyzer-worker=3`으로 올리기보다 `2`부터 검증한다.

`analyzer-worker=3`으로 올릴 근거:

- `analysis.request messages_ready`가 반복적으로 쌓인다.
- `analysis.request messages_unacknowledged`가 worker 수만큼 오래 유지된다.
- Runner 작업은 끝났는데 리포트 생성이 늦게 밀린다.
- EC2 CPU/RAM 여유가 있다.
- GMS timeout 또는 rate limit 의심 로그가 없다.

증설 명령:

```bash
cd /srv/wedge
bash infra/scripts/prod-compose.sh up -d --scale analyzer-worker=3 analyzer-worker
```

원복 명령:

```bash
cd /srv/wedge
bash infra/scripts/prod-compose.sh up -d --scale analyzer-worker=1 analyzer-worker
```

## 6. 주의사항

- `ANALYZER_MQ_PREFETCH`는 기본값 `1`을 유지한다.
- worker replica 수와 GMS 내부 병렬 수를 동시에 크게 올리면 GMS 호출량이 빠르게 늘 수 있다.
- `analyzer-worker=3`과 `ANALYZER_GMS_LABEL_MAX_CONCURRENCY=3`을 함께 쓰면 최악의 순간에는 analyzer 쪽 GMS label 호출이 worker별로 동시에 발생할 수 있다.
- 운영 적용 후에는 RabbitMQ queue와 EC2 CPU/RAM을 같이 봐야 한다.

공식 기준:

- Docker Compose는 `docker compose up --scale SERVICE=REPLICAS`로 service replica 수를 조정한다.
- RabbitMQ prefetch는 consumer가 ack하지 않은 메시지를 몇 개까지 받을 수 있는지 제한한다. 긴 작업은 worker replica를 늘리고 prefetch는 낮게 유지하는 방식이 더 예측 가능하다.
