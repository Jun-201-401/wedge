# Wedge EC2 운영 서버 환경 기준선

이 문서는 Wedge 운영 서버(SSAFY EC2) 기준 환경 정보를 기록한다.

- 작성 목적:
  - 운영 서버 초기 세팅 기준을 팀 내에서 동일하게 유지
  - 로컬 개발 환경과 운영 환경을 명확히 분리
  - Jenkins/배포 자동화 전에 서버 바닥 상태를 먼저 고정
- 기준일: 2026-04-23
- 대상 서버: `k14c104.p.ssafy.io`

---

## 1. 운영 원칙

- 운영 서버 작업은 SSAFY EC2 규정을 우선 준수한다.
- 운영 서비스 루트는 `/srv/wedge`를 사용한다.
- 설정 파일은 `/etc/wedge`, 로그는 `/var/log/wedge`로 분리한다.
- 데이터 저장은 호스트 bind mount보다 Docker volume을 우선 사용한다.
- 운영 환경에서는 내부 인프라 포트를 외부에 직접 노출하지 않는다.

---

## 2. 현재 확인된 서버 정보

### 접속 정보

- SSH 사용자: `ubuntu`
- 접속 방식: `.pem` 키 기반 SSH
- 접속 예시:

```bash
ssh -i K14C104T.pem ubuntu@k14c104.p.ssafy.io
```

### 현재 확인 결과

- 현재 작업 계정: `ubuntu`
- 현재 홈 디렉토리: `/home/ubuntu`
- UFW 상태: `active`
- 현재 허용 포트:
  - `22/tcp`
  - `443`
  - `8989/tcp`

> `8989`는 이미 사용 중인 포트이므로 Wedge 신규 서비스 포트로 재사용하지 않는다.

---

## 3. 운영 디렉토리 정책

### 권장 구조

```text
/srv/wedge
/etc/wedge
/var/log/wedge
```

### 의미

- `/srv/wedge`
  - 운영 배포 루트
  - Docker Compose 파일, 배포 스크립트, 앱 배포 아티팩트 기준 위치
- `/etc/wedge`
  - 운영 환경 변수 파일, 서비스별 설정 파일
- `/var/log/wedge`
  - 운영 로그 저장 위치

### 초기 생성 명령

```bash
sudo mkdir -p /srv/wedge
sudo mkdir -p /etc/wedge
sudo mkdir -p /var/log/wedge
sudo chown ubuntu:ubuntu /srv/wedge
sudo chown ubuntu:ubuntu /etc/wedge
sudo chown ubuntu:ubuntu /var/log/wedge
```

---

## 4. Docker 설치 기준

### 설치 정책

- Ubuntu 기본 `docker.io` 패키지가 아니라 Docker 공식 apt repository를 사용한다.
- Compose는 standalone binary가 아니라 `docker compose` plugin 방식을 사용한다.

### 2026-04-23 확인 결과

- Docker Engine: `29.4.1`
- Docker Compose plugin: `v5.1.3`
- Docker service: `active (running)`

### 설치 패키지

```bash
docker-ce
docker-ce-cli
containerd.io
docker-buildx-plugin
docker-compose-plugin
```

---

## 5. 운영 포트 정책

### 최종 원칙

- 외부 공개 포트는 최소한으로 유지한다.
- 현재 기준 외부 공개 대상은 `22/tcp`, `18080/tcp`만 잡는다.
- Jenkins는 필요 시 `18081/tcp`를 후보로 보되, 기본값은 외부 비공개로 둔다.
- PostgreSQL, Redis, RabbitMQ는 외부 포트를 열지 않는다.
- 운영에서는 MinIO를 올리지 않고 AWS S3를 사용한다.

### 내부 포트 / 외부 포트 기준

| 서비스 | 내부 포트 | 외부 포트 | 외부 공개 여부 | 비고 |
|--------|----------:|----------:|----------------|------|
| SSH | 22 | 22 | 공개 | 서버 관리용 |
| Nginx | 80 | 18080 | 공개 | Wedge 외부 진입점 |
| Spring API | 8080 | 없음 | 비공개 | Nginx reverse proxy 뒤 내부 서비스 |
| Jenkins | 8080 | 18081 | 비공개 권장 | localhost 바인딩 또는 SSH 터널 권장 |
| PostgreSQL | 5432 | 없음 | 비공개 | 내부 연결만 |
| Redis | 6379 | 없음 | 비공개 | 내부 연결만 |
| RabbitMQ AMQP | 5672 | 없음 | 비공개 | 내부 서비스 간 메시징 |
| RabbitMQ Management UI | 15672 | 없음 | 비공개 | 운영 외부 노출 금지 |
| RabbitMQ inter-node | 25672 | 없음 | 비공개 | 클러스터/CLI 통신용 |
| RabbitMQ epmd | 4369 | 없음 | 비공개 | Erlang 노드 발견용 |
| AWS S3 | AWS 관리형 | AWS 관리형 | 외부 서비스 | EC2 포트 정책 대상 아님 |

### 이유

- SSAFY EC2 규정상 UFW를 유지하고 필요한 포트만 최소 허용해야 한다.
- Docker published port는 단순 UFW 인식과 별도로 외부 노출 위험이 있어, 내부 인프라 포트는 원칙적으로 publish하지 않는다.
- SSAFY 규정상 서비스 기본 포트를 그대로 외부 공개하지 않는 방향이 안전하므로, Spring API 외부 포트는 `18080`으로 분리한다.
- 운영에서는 Nginx만 외부 공개하고, API 및 내부 인프라는 내부 네트워크에서만 사용한다.

---

## 6. 현재 완료된 운영 서버 바닥 작업

- SSH 접속 확인 완료
- `ubuntu` 계정 및 작업 위치 확인 완료
- UFW 활성 상태 확인 완료
- Docker 공식 apt repository 기반 설치 완료
- Docker Compose plugin 설치 완료
- Docker service 실행 확인 완료

---

## 7. 아직 남은 작업

### 우선순위 높음

1. `/srv/wedge`, `/etc/wedge`, `/var/log/wedge` 실제 생성
2. 운영용 배포 구조 정의
   - 예: `compose.prod.yaml`, `.env.prod`, `apps/api-server/Dockerfile`
3. 운영 서비스 공개 포트 확정
4. Wedge 서비스별 EC2 배치 범위 결정
   - Spring API
   - PostgreSQL
   - Redis
   - RabbitMQ
   - Runner
   - MinIO

### 그 다음

1. Jenkins base build 확인
2. Jenkins 배포 파이프라인 초안
3. 운영용 compose / 배포 스크립트 정리

---

## 8. 주의 사항

- UFW 변경 전에는 SSH 세션을 2개 이상 확보한다.
- `/home`, 시스템 디렉토리, SSH 키 권한을 임의로 변경하지 않는다.
- 운영 비밀값은 Git에 커밋하지 않고 `/etc/wedge` 또는 배포 비밀 저장 경로에서 관리한다.
- DB/브로커/스토리지 데이터는 호스트 디렉토리 직접 관리보다 Docker volume을 우선 검토한다.

---

## 9. 참고 기준

- Docker 공식 Ubuntu 설치 문서
- Docker Compose plugin 설치 문서
- Docker port publishing / firewall 문서
- SSAFY EC2 운영 규정
- Linux FHS / `hier(7)` 기준
