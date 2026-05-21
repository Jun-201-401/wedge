# Wedge 포팅 매뉴얼

본 문서는 GitLab 소스 클론 이후 Wedge를 빌드 및 배포할 수 있도록 정리한 제출용 포팅 매뉴얼이다.

실제 비밀번호, API key, access key, token은 포함하지 않는다. 운영 secret은 `.env.prod`, Jenkins Credentials, EC2 로컬 파일에만 보관한다.

## 1. 프로젝트 개요

| 항목 | 내용 |
|---|---|
| 프로젝트명 | Wedge |
| 저장소 | `https://lab.ssafy.com/s14-final/S14P31C104.git` |
| 기본 배포 브랜치 | `develop` |
| 운영 도메인 | `wedge-app.duckdns.org` |
| 운영 배포 루트 | `/srv/wedge` |
| 주요 실행 방식 | Docker Compose 기반 다중 컨테이너 |

Wedge는 웹사이트의 사용자 흐름을 실제 브라우저로 실행하고, 수집된 evidence를 기반으로 UX/전환 리스크를 분석하는 서비스다.

핵심 실행 흐름:

```text
Client Browser
  -> nginx
  -> Web / React
  -> Spring Boot API Server
  -> RabbitMQ
      -> Runner(Node.js + TypeScript + Playwright)
      -> Analyzer(Python + Rule Engine + GMS Assist)
  -> PostgreSQL / Redis / S3-compatible Artifact Storage
```

## 2. 사용 JVM, 웹서버, WAS, 런타임 버전

### 2.1 API Server

| 구분 | 값 | 근거 파일 |
|---|---|---|
| JVM 빌드 이미지 | `eclipse-temurin:17-jdk` | `apps/api-server/Dockerfile` |
| JVM 실행 이미지 | `eclipse-temurin:17-jre` | `apps/api-server/Dockerfile` |
| Java toolchain | Java 17 | `apps/api-server/build.gradle` |
| Spring Boot | `3.5.14` | `apps/api-server/build.gradle` |
| Gradle Wrapper | `8.5` | `apps/api-server/gradle/wrapper/gradle-wrapper.properties` |
| WAS | Spring Boot embedded servlet container | `spring-boot-starter-web` |
| API port | `8080` | `apps/api-server/src/main/resources/application.yml` |
| 실행 profile | `prod`, `dev` | `compose.prod.yaml`, `compose.dev.yaml` |

참고: embedded WAS의 세부 Tomcat patch version은 Spring Boot BOM에 의해 결정되므로 제출 문서에서는 `Spring Boot 3.5.14 embedded WAS`로 표기한다.

### 2.2 Web / Frontend

| 구분 | 값 | 근거 파일 |
|---|---|---|
| 프레임워크 | React 18.3.1 | `apps/web/package.json` |
| 번들러 | Vite 7.3.2 | `apps/web/package.json` |
| TypeScript | 5.6.3 | `apps/web/package.json` |
| 빌드 이미지 | `node:24-alpine` | `apps/web/Dockerfile` |
| 정적 파일 서버 | `nginx:1.30.0-alpine` | `apps/web/Dockerfile` |
| 운영 reverse proxy | `nginx:1.30.0` | `compose.prod.yaml` |

### 2.3 Runner

| 구분 | 값 | 근거 파일 |
|---|---|---|
| 런타임 | Node.js 24 | `apps/runner/Dockerfile`, `apps/runner/package.json` |
| 언어 | TypeScript | `apps/runner/package.json` |
| 브라우저 자동화 | Playwright 1.59.1, Chromium | `apps/runner/package.json`, `apps/runner/Dockerfile` |
| 컨테이너 이미지 | `node:24-bookworm` | `apps/runner/Dockerfile` |
| 주요 역할 | MQ 작업 소비, 브라우저 실행, checkpoint/artifact callback | `apps/runner/README.md` |

Runner는 Python 기반이 아니다. Wedge Runner는 `Node.js / TypeScript + Playwright` 기반이다.

### 2.4 Analyzer

| 구분 | 값 | 근거 파일 |
|---|---|---|
| 런타임 이미지 | `python:3.13-slim` | `apps/analyzer/Dockerfile` |
| Python 요구 버전 | `>=3.11` | `apps/analyzer/pyproject.toml` |
| 웹 프레임워크/worker | FastAPI, Uvicorn, pika | `apps/analyzer/pyproject.toml` |
| 주요 역할 | EvidencePacket 분석, Rule Engine 판단, GMS 설명 보조 | `apps/analyzer/README.md` |

Analyzer는 deterministic Rule Engine 결과를 기준으로 판단하고, GMS는 리포트 설명 보조에 사용한다.

### 2.5 Infra / Middleware

| 구분 | 값 | 근거 파일 |
|---|---|---|
| PostgreSQL | `postgres:17` | `compose.dev.yaml`, `compose.prod.yaml` |
| Redis | `redis:8.6.2` | `compose.dev.yaml`, `compose.prod.yaml` |
| RabbitMQ | `rabbitmq:4.2-management` | `compose.dev.yaml`, `compose.prod.yaml` |
| Flyway | `redgate/flyway:12.6.0` | `.env.prod.example`, `compose.prod.yaml` |
| Local object storage | `minio/minio:RELEASE.2025-09-07T16-13-09Z` | `compose.dev.yaml` |
| MinIO client | `minio/mc:RELEASE.2025-08-13T08-35-41Z` | `compose.dev.yaml` |
| Jenkins | `jenkins/jenkins:2.555.1-jdk21` | `infra/jenkins/Dockerfile` |

운영에서는 MinIO를 사용하지 않고 AWS S3-compatible artifact storage를 사용한다.

### 2.6 IDE

저장소에 IDE 제품 버전을 고정하는 공식 설정은 없다. 팀 개발 환경 기준으로는 IntelliJ IDEA 계열에서 `apps/api-server`를 실행하며, API 서버의 기본 개발 profile은 `dev`다.

제출 시 IDE 항목은 다음처럼 적는 것이 안전하다.

```text
IDE: IntelliJ IDEA 계열 권장
JDK: Java 17
API Server local run: apps/api-server Gradle bootRun 또는 IntelliJ Spring Boot 실행 구성
Frontend editor: VS Code 또는 IntelliJ 계열 사용 가능
```

## 3. 빌드 및 실행 방법

### 3.1 소스 클론

```bash
git clone https://lab.ssafy.com/s14-final/S14P31C104.git
cd S14P31C104
git checkout develop
```

### 3.2 로컬 개발 인프라 실행

로컬 개발에서는 API 서버를 IntelliJ 또는 Gradle로 실행하고, PostgreSQL/RabbitMQ/Redis/MinIO/Runner/Analyzer는 Docker Compose로 실행할 수 있다.

```bash
docker compose --env-file .env -f compose.dev.yaml up -d postgres rabbitmq redis minio minio-init runner analyzer-worker
```

API 서버 로컬 실행:

```bash
cd apps/api-server
./gradlew bootRun
```

Windows PowerShell에서는 다음처럼 실행한다.

```powershell
cd apps/api-server
.\gradlew.bat bootRun
```

Web 포함 전체 Docker Compose 실행이 필요하면 profile을 사용한다.

```bash
docker compose --env-file .env -f compose.dev.yaml --profile api --profile web up -d
```

### 3.3 Web 빌드

```bash
cd apps/web
npm ci
npm run build
```

### 3.4 Runner 실행/테스트

```bash
cd apps/runner
npm ci
npm run start -- --consume-mq
```

Playwright 브라우저 설치가 별도로 필요할 때:

```bash
npm run playwright:install
```

### 3.5 Analyzer 실행

```bash
cd apps/analyzer
python -m pip install --upgrade pip
python -m pip install -e .
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

운영/개발 Compose에서는 analyzer worker가 다음 command로 실행된다.

```text
python scripts/consume_analysis_requests.py
```

## 4. 빌드 및 실행 환경변수

### 4.1 환경변수 파일

| 파일 | 용도 | 비고 |
|---|---|---|
| `.env` | 로컬 개발 기본 환경 | 실제 값 포함 가능, 외부 공유 금지 |
| `.env.docker` | Docker 기반 로컬 실행 환경 | 실제 값 포함 가능, 외부 공유 금지 |
| `.env.prod` | 운영 배포 환경 | 실제 운영 secret 포함, 외부 공유 금지 |
| `.env.prod.example` | 운영 환경변수 템플릿 | 제출 문서 기준으로 참조 가능 |
| `.env.monitoring` | Prometheus/Grafana 로컬 또는 운영 설정 | 실제 값 포함 가능, 외부 공유 금지 |
| `.env.monitoring.example` | monitoring 환경변수 템플릿 | 제출 문서 기준으로 참조 가능 |

### 4.2 핵심 환경변수 카탈로그

| 변수 | 필수 | Secret | 사용 컴포넌트 | 용도 |
|---|---:|---:|---|---|
| `POSTGRES_USER` | 예 | 아니오 | PostgreSQL, API, Flyway | DB 사용자 |
| `POSTGRES_PASSWORD` | 예 | 예 | PostgreSQL, API, Flyway | DB 비밀번호 |
| `POSTGRES_DB` | 예 | 아니오 | PostgreSQL, API, Flyway | DB 이름 |
| `SPRING_DATASOURCE_URL` | 로컬 | 아니오 | API | 로컬 datasource URL |
| `SPRING_DATASOURCE_USERNAME` | 로컬 | 아니오 | API | 로컬 datasource 사용자 |
| `SPRING_DATASOURCE_PASSWORD` | 로컬 | 예 | API | 로컬 datasource 비밀번호 |
| `REDIS_HOST` | 예 | 아니오 | API | Redis host |
| `REDIS_PORT` | 로컬 | 아니오 | Redis/API | 로컬 Redis port |
| `RABBITMQ_USER` | 예 | 아니오 | RabbitMQ, API, Runner, Analyzer | MQ 사용자 |
| `RABBITMQ_PASSWORD` | 예 | 예 | RabbitMQ, API, Runner, Analyzer | MQ 비밀번호 |
| `WEDGE_RUNNER_MQ_EXCHANGE` | 예 | 아니오 | API, RabbitMQ | main exchange, 기본 `wedge.direct` |
| `WEDGE_RUN_EXECUTE_QUEUE` | 예 | 아니오 | API, Runner | `run.execute.request` |
| `WEDGE_AGENT_EXECUTE_QUEUE` | 예 | 아니오 | API, Runner | `agent.execute.request` |
| `WEDGE_DISCOVERY_EXECUTE_QUEUE` | 예 | 아니오 | API, Runner | `discovery.execute.request` |
| `WEDGE_SCENARIO_AUTHORING_EXECUTE_QUEUE` | 예 | 아니오 | API, Runner | `scenario-authoring.execute.request` |
| `WEDGE_ANALYSIS_REQUEST_QUEUE` | 예 | 아니오 | API, Analyzer | `analysis.request` |
| `JWT_SECRET` | 예 | 예 | API | JWT signing secret, 32자 이상 필요 |
| `INTERNAL_SERVICE_TOKEN` | 예 | 예 | API, Runner, Analyzer | internal API 인증 |
| `INTERNAL_RUNNER_CALLBACK_SIGNATURE_SECRET` | 예 | 예 | API, Runner | Runner callback HMAC secret |
| `INTERNAL_ANALYZER_CALLBACK_SIGNATURE_SECRET` | 예 | 예 | API, Analyzer | Analyzer callback HMAC secret |
| `WEDGE_ARTIFACT_STORAGE` | 예 | 아니오 | API | artifact content store 모드 |
| `WEDGE_ARTIFACT_BUCKET` | 운영 | 아니오 | API | S3 bucket |
| `RUNNER_ARTIFACT_STORAGE` | 예 | 아니오 | Runner | artifact upload 모드 |
| `RUNNER_ARTIFACT_BUCKET` | 운영 | 아니오 | Runner | artifact upload bucket |
| `AWS_REGION` | 운영 | 아니오 | API, Runner | AWS region |
| `AWS_ACCESS_KEY_ID` | 운영 | 예 | API, Runner | S3 access key |
| `AWS_SECRET_ACCESS_KEY` | 운영 | 예 | API, Runner | S3 secret key |
| `ANALYZER_GMS_ENABLED` | 선택 | 아니오 | Analyzer | GMS 보조 설명 활성화 |
| `ANALYZER_GMS_API_KEY` | 선택 | 예 | Analyzer | GMS API key |
| `ANALYZER_GMS_MODEL` | 선택 | 아니오 | Analyzer | Analyzer GMS model |
| `GMS_OPENAI_CHAT_COMPLETIONS_ENDPOINT` | 선택 | 아니오 | Runner | OpenAI-compatible GMS endpoint |
| `GMS_API_KEY` | 선택 | 예 | Runner | GMS API key |
| `GMS_DEFAULT_MODEL` | 선택 | 아니오 | Runner | Runner LLM default model |
| `RUNNER_AGENT_DECISION_MODE` | 예 | 아니오 | Runner | `heuristic`, `llm`, `mcp` |
| `RUNNER_REPLICAS` | 운영 | 아니오 | Compose/Jenkins | Runner scale-out 수 |
| `ANALYZER_WORKER_REPLICAS` | 운영 | 아니오 | Compose/Jenkins | Analyzer worker scale-out 수 |
| `RUNNER_MQ_PREFETCH` | 운영 | 아니오 | Runner | MQ prefetch |
| `ANALYZER_MQ_PREFETCH` | 운영 | 아니오 | Analyzer | MQ prefetch |
| `WEDGE_MCP_SERVER_ENABLED` | 선택 | 아니오 | API | MCP adapter 활성화 |
| `WEDGE_MCP_SERVICE_TOKEN` | 선택 | 예 | API/MCP | MCP internal verification token |
| `NGINX_HTTP_PORT` | 운영 | 아니오 | nginx | HTTP port |
| `NGINX_HTTPS_PORT` | 운영 | 아니오 | nginx | HTTPS port |
| `FLYWAY_IMAGE` | 운영 | 아니오 | Flyway | migration image |

## 5. DB 접속 정보 및 ERD 기준 파일

### 5.1 개발 DB

| 항목 | 값 |
|---|---|
| DBMS | PostgreSQL 17 |
| Compose service | `postgres` |
| Container name | `wedge-postgres-dev` |
| Host port | `127.0.0.1:5432` |
| DB name/user/password | `.env`의 `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` 기준 |

### 5.2 운영 DB

| 항목 | 값 |
|---|---|
| DBMS | PostgreSQL 17 |
| Compose service | `postgres` |
| 외부 공개 | 없음 |
| API 연결 | `jdbc:postgresql://postgres:5432/${POSTGRES_DB}` |
| migration | Flyway `migration` profile |
| DB 계정/비밀번호 | `.env.prod`의 `POSTGRES_USER`, `POSTGRES_PASSWORD` 기준 |

### 5.3 ERD/스키마 기준 파일

| 파일 | 용도 |
|---|---|
| `docs/02_data_model_and_db.md` | DB 모델 설명과 핵심 테이블 목록 |
| `docs/wedge_schema.sql` | schema snapshot |
| `infra/db/migrations/*.sql` | 운영/개발 공통 migration 원본 |
| `docs/flyway_prod_migration_runbook.md` | 운영 Flyway 적용 절차 |
| `apps/api-server/src/main/resources/mapper/**/*.xml` | MyBatis SQL mapper |

핵심 테이블 계층:

```text
User / Workspace / Project
Scenario / SiteDiscovery / ScenarioRecommendation / ScenarioAuthoringJob / Run / Step
Checkpoint / Observation / Artifact / EvidencePacket
AnalysisJob / RuleHit / Finding / Nudge / Report / Share
Agent / MCP / Outbox / ProcessedMessage / Worker
```

## 6. 배포 절차

### 6.1 Jenkins 기준 운영 배포

Jenkins는 `develop` 브랜치 push를 GitLab webhook으로 받아 EC2 `/srv/wedge`에서 배포한다.

주요 단계:

1. `develop` branch checkout
2. EC2 `/srv/wedge`에서 `origin/develop` fetch
3. commit SHA 기준 app image tag 생성
4. API/Web/Runner/Analyzer Docker image build
5. RabbitMQ topology 검증
6. migration 변경 시 Flyway `info`, `migrate`
7. app 컨테이너 재생성 및 scale 적용
8. health check 성공 시 `.deploy/current.env`, `.deploy/current.sha` 승격

관련 파일:

| 파일 | 역할 |
|---|---|
| `Jenkinsfile` | GitLab webhook, build, deploy, migration, health check |
| `compose.prod.yaml` | 운영 runtime compose |
| `compose.jenkins.yaml` | Jenkins container compose |
| `infra/scripts/prod-compose.sh` | `.env.prod` + `.deploy/current.env` 안전 wrapper |
| `infra/jenkins/Dockerfile` | Jenkins image baseline |
| `infra/jenkins/plugins.txt` | Jenkins plugin 목록 |

### 6.2 운영 수동 compose 명령

운영에서는 직접 `docker compose --env-file .env.prod -f compose.prod.yaml ...`를 호출하지 않고 wrapper를 사용한다.

```bash
cd /srv/wedge
bash infra/scripts/prod-compose.sh ps
bash infra/scripts/prod-compose.sh logs --tail=100 api-server
```

이 wrapper는 `.env.prod`와 `.deploy/current.env`가 모두 존재하고, `API_SERVER_IMAGE`, `WEB_IMAGE`, `RUNNER_IMAGE`, `ANALYZER_IMAGE`가 정의되어 있는지 검증한다.

### 6.3 Flyway migration

운영 migration은 normal `up -d`에 포함하지 않고, `migration` profile로 명시 실행한다.

```bash
docker compose --env-file .env.prod -f compose.prod.yaml --profile migration run --rm flyway info
docker compose --env-file .env.prod -f compose.prod.yaml --profile migration run --rm flyway migrate
```

주의:

- 운영에서 `clean` 금지
- 기존 운영 DB에 Flyway를 처음 도입할 때는 baseline 먼저 수행
- 이미 적용된 migration SQL은 수정하지 않고 새 migration을 추가

### 6.4 RabbitMQ topology

주요 exchange/queue:

| Queue | Producer | Consumer |
|---|---|---|
| `run.execute.request` | Spring API Server | Runner |
| `agent.execute.request` | Spring API Server | Runner Agent Runtime |
| `discovery.execute.request` | Spring API Server | Runner |
| `scenario-authoring.execute.request` | Spring API Server | Runner |
| `analysis.request` | Spring API Server | Analyzer |

RabbitMQ는 작업 분배용 message broker이며 최종 상태 저장소가 아니다. Runner/Analyzer 결과는 result queue가 아니라 Spring internal callback API로 반영된다.

## 7. 배포 시 특이사항

1. 운영 app image tag는 commit SHA 기반으로 생성한다.
2. 실제 운영 반영 기준은 Git HEAD가 아니라 `.deploy/current.env`와 `.deploy/current.sha`다.
3. PostgreSQL, Redis, RabbitMQ는 운영에서 외부 포트를 공개하지 않는다.
4. 운영 artifact storage는 AWS S3를 사용한다. local/dev에서는 filesystem 또는 MinIO를 사용할 수 있다.
5. Runner와 Analyzer는 DB에 직접 쓰지 않고 Spring internal callback으로 상태를 전달한다.
6. callback 요청은 `INTERNAL_SERVICE_TOKEN`과 HMAC signature secret으로 보호한다.
7. RabbitMQ queue 이름은 실제 코드 기준 이름을 사용해야 한다. `wedge.task.queue`, `wedge.result.queue` 같은 임의 이름은 사용하지 않는다.
8. Jenkins는 Wedge runtime compose와 분리된 `compose.jenkins.yaml`로 관리한다.
9. 운영 nginx는 `wedge-app.duckdns.org`와 Let's Encrypt 인증서를 사용한다.
10. `.env.prod` 실제 값은 제출 문서에 복사하지 않는다.

## 8. 빠른 검증 명령

### 8.1 로컬 개발 smoke

```bash
node infra/scripts/apply-dev-db-migrations.mjs
node infra/scripts/seed-real-run-smoke.mjs
node infra/scripts/real-run-e2e-smoke.mjs
node infra/scripts/real-agent-run-e2e-smoke.mjs
```

### 8.2 운영 상태 확인

```bash
cd /srv/wedge
bash infra/scripts/prod-compose.sh ps
bash infra/scripts/prod-compose.sh logs --tail=100 api-server
bash infra/scripts/prod-compose.sh logs --tail=100 runner analyzer-worker
```

### 8.3 RabbitMQ topology 변경 시

```bash
docker compose --env-file .env.prod -f compose.prod.yaml up -d --force-recreate rabbitmq
bash infra/rabbitmq/provision-prod-user.sh
```

운영에서는 Jenkins 자동 배포 경로가 RabbitMQ 관련 파일 변경을 감지해 필요한 경우 재생성을 수행한다.

