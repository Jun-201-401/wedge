# compose.dev.yaml 버전 선정 근거

이 문서는 `S14P31C104/compose.dev.yaml`에서 사용하는 이미지 버전 선정 근거를 정리한다.

---

## 1. PostgreSQL

### 선정 버전
```
image: postgres:17
```

### 선정 근거

| 버전 | 지원 종료 | 상태 |
|------|-----------|------|
| 18 | 2030년 11월 | 최신, 안정성 검증 중 |
| **17** | 2029년 11월 | ✅ **선정** — 신규 프로젝트 권장 |
| 16 | 2028년 11월 | 유효하나 17이 더 권장 |
| 15 | 2027년 11월 | 지원 중 |
| 14 | 2026년 11월 | 지원 중 |

- 신규 프로젝트라 마이그레이션 비용 없음
- 16 대비 지원 기간 1년 더 김
- 16과 사용법 차이 없어 팀원 혼란 없음
- `latest` 미사용 이유: 팀원마다 다른 버전을 받을 수 있어 명시적 버전 고정

### 참고 링크
- PostgreSQL 공식 릴리즈: https://www.postgresql.org/support/versioning/
- Docker Hub: https://hub.docker.com/_/postgres/tags

---

## 2. RabbitMQ

### 선정 버전
```
image: rabbitmq:4.2-management
```

### 선정 근거

**버전 4.2 선정:**

| 버전 | Community Support 종료 | 상태 |
|------|----------------------|------|
| 4.2 | 2026년 7월 31일 | ✅ 현재 유일하게 지원되는 버전 |
| 4.1 | 2026년 1월 31일 | ❌ 종료 |
| 4.0 | 2025년 4월 15일 | ❌ 종료 |
| 3.13 | 2024년 9월 18일 | ❌ 종료 |

2026년 4월 기준 Community Support가 유지되는 버전은 4.2가 유일하다.

**management 태그 선정:**

| 태그 | Management UI(15672) | 선정 |
|------|---------------------|------|
| `4.2` | ❌ 없음 | 운영 환경용 |
| `4.2-management` | ✅ 있음 | ✅ 개발 환경용 |
| `4.2-management-alpine` | ✅ 있음 | 경량, 디버깅 불편 |

개발 환경에서 queue/exchange 확인 및 메시지 흐름 디버깅이 필요하므로 Management UI 포함 버전 선정.

> 운영 환경(EC2)에서는 `4.2` 사용 권장. Management UI가 외부에 노출되면 보안 위험.

### 포트 정보

| 포트 | 용도 |
|------|------|
| 5672 | AMQP 메시지 송수신 (Spring/Runner 연결) |
| 15672 | Management UI (브라우저 접속) |

### 참고 링크
- RabbitMQ 공식 릴리즈 정보: https://www.rabbitmq.com/release-information
- Docker Hub: https://hub.docker.com/_/rabbitmq/tags

---

## 3. MinIO

### 선정 버전
```
image: minio/minio:RELEASE.2025-09-07T16-13-09Z
```

### 선정 근거

**MinIO vs LocalStack:**

| | MinIO | LocalStack |
|-|-------|------------|
| 우리 용도 적합성 | ✅ S3만 필요 | ❌ AWS 전체 서비스, 과함 |
| 무게 | 가벼움 | 무거움 |
| 설정 복잡도 | 낮음 | 높음 |
| Management UI | ✅ 무료 | ✅ 일부 유료 |

Wedge는 S3 파일 저장/조회만 필요. RabbitMQ도 별도 운영 중이라 LocalStack 불필요.

**날짜 기반 release tag 선정 이유:**

- MinIO 공식 배포 태그는 날짜 기반 `RELEASE.XXXX` 형식을 사용한다
- `latest` 대신 명시적 release tag를 사용해야 팀원 간 dev 환경 재현성이 유지된다
- 현재 dev compose는 팀 공용 실행 진입점이므로 실행 시점마다 다른 이미지를 받는 구성을 피한다

**`mc` 클라이언트 태그 분리 이유:**

- MinIO 서버와 초기화용 `mc`는 별도 이미지로 배포된다
- `minio-init`는 healthcheck 대신 `mc ready`로 준비 완료를 직접 확인한 뒤 버킷을 생성한다
- 이 방식이 최근 MinIO 이미지에서 `curl` 미포함으로 인해 healthcheck가 깨지는 문제를 피하기에 더 안전하다

### 포트 정보

| 포트 | 용도 |
|------|------|
| 9000 | API (파일 업로드/다운로드) |
| 9001 | Management UI (브라우저 접속) |

### 버킷
- `wedge-artifacts`: `minio-init` 컨테이너가 `mc ready` 확인 후 자동 생성

### 참고 링크
- MinIO Container Docs: https://min.io/docs/minio/container/index.html
- MinIO Healthcheck API: https://min.io/docs/minio/macos/operations/monitoring/healthcheck-probe.html
- Docker Hub (MinIO): https://hub.docker.com/r/minio/minio/tags
- Docker Hub (mc): https://hub.docker.com/r/minio/mc/tags

---

## 4. Redis

### 선정 버전
```
image: redis:8.6.2
```

### 선정 근거

**버전 8.6.2 선정:**

- Redis 공식 릴리즈 기준 최신 안정 패치 버전 사용
- `latest` 대신 명시적 버전 고정으로 팀원 간 실행 환경 차이 방지
- 로컬 개발 환경에서도 재현 가능한 인프라 구성을 유지하기 위함

**기본 태그(`redis:8.6.2`) 선정:**

| 태그 | 특징 | 선정 |
|------|------|------|
| `redis:8.6.2` | 공식 기본 이미지, 일반적인 개발 환경에 적합 | ✅ |
| `redis:8.6.2-alpine` | 경량 이미지, 디버깅/패키지 확장 시 불편 가능 | 보류 |
| `latest` | 실행 시점에 따라 버전 변경 가능 | ❌ |

현재 Wedge는 Spring Boot의 `spring-boot-starter-data-redis`를 통해 Redis를 사용하며, 개발 환경에서는 기본 문자열 저장/조회 수준의 기능이 먼저 필요하다. 따라서 가장 보편적이고 예측 가능한 공식 기본 이미지를 선택한다.

### 포트 정보

| 포트 | 용도 |
|------|------|
| 6379 | Redis 기본 포트 (Spring API Server 연결) |

### 로컬 개발 환경 정책

- `127.0.0.1:${REDIS_PORT}:6379` 로 바인딩하여 외부 전체 노출 방지
- 데이터 유지를 위해 Docker volume 사용
- `redis-cli ping` healthcheck 추가
- 운영 환경에서는 인증/보안 설정을 별도로 검토해야 함

### 참고 링크
- Redis 공식 릴리즈 노트: https://redis.io/docs/latest/operate/oss_and_stack/stack-with-enterprise/release-notes/redisce/redisos-8.6-release-notes/
- Docker Hub: https://hub.docker.com/_/redis/

---

## 5. 환경별 포트 정책

| 서비스 | 개발(로컬) | 운영(EC2) |
|--------|-----------|-----------|
| PostgreSQL | 5432 | 변경 필요 (SSAFY 보안 정책) |
| Redis | 6379 | 변경 필요 (SSAFY 보안 정책) |
| RabbitMQ AMQP | 5672 | 변경 필요 (SSAFY 보안 정책) |
| RabbitMQ UI | 15672 | 변경 필요 (SSAFY 보안 정책) |
| MinIO API | 9000 | 로컬 전용, 운영 미사용 |
| MinIO UI | 9001 | 로컬 전용, 운영 미사용 |

SSAFY EC2 보안 정책상 기본 포트 변경 필요. `.env` 파일로 환경별 포트 관리.
