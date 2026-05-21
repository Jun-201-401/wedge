# Wedge 외부 서비스 가입/활용 정리

본 문서는 Wedge 프로젝트에서 사용하는 외부 서비스를 가입/키 발급/주입 위치/검증 방법 중심으로 정리한다.

실제 secret 값은 포함하지 않는다. 문서에는 변수명과 관리 위치만 기록한다.

## 1. 사용 중인 외부 서비스 요약

| 서비스 | 사용 여부 | 용도 |
|---|---:|---|
| AWS S3 | 사용 | screenshot, trace, report artifact 저장 |
| SSAFY GMS | 사용 | Analyzer report explanation, Runner LLM/ScenarioAuthoring/Agent decision 보조 |
| DuckDNS | 사용 | 운영 도메인 |
| Let's Encrypt | 사용 | HTTPS 인증서 |
| GitLab | 사용 | 소스 저장소, Jenkins webhook |
| Jenkins | 사용 | EC2 배포 자동화 |
| Mattermost Incoming Webhook | 사용 | Jenkins 배포 알림 |
| Docker Hub | 사용 | base image pull |
| npm Registry | 사용 | Web/Runner dependency install |
| Maven Central / Gradle Distribution | 사용 | API Server dependency/build tool download |
| PyPI | 사용 | Analyzer Python dependency install |
| 소셜 로그인 | 미사용 | Wedge human auth는 first-party email/password + JWT |
| Photon Cloud | 미사용 | 해당 기능 없음 |
| 외부 코드 컴파일 서비스 | 미사용 | 사용자가 제출한 코드를 외부에서 컴파일하는 기능 없음 |

## 2. AWS S3

| 항목 | 내용 |
|---|---|
| 용도 | Runner artifact upload, API artifact content access |
| 가입/준비 필요 | 예 |
| 발급 항목 | AWS access key, secret key, region, bucket |
| 운영 bucket 예시 | `wedge-artifacts-prod` |
| 주입 위치 | `.env.prod`, `compose.prod.yaml` |
| local 대체 | filesystem 또는 MinIO |

환경변수:

| 변수 | 용도 | Secret |
|---|---|---:|
| `AWS_REGION` | AWS region | 아니오 |
| `AWS_ACCESS_KEY_ID` | S3 access key | 예 |
| `AWS_SECRET_ACCESS_KEY` | S3 secret key | 예 |
| `WEDGE_ARTIFACT_STORAGE` | API artifact read mode, 운영 `s3` | 아니오 |
| `WEDGE_ARTIFACT_BUCKET` | API artifact bucket | 아니오 |
| `RUNNER_ARTIFACT_STORAGE` | Runner artifact upload mode, 운영 `s3` | 아니오 |
| `RUNNER_ARTIFACT_BUCKET` | Runner upload bucket | 아니오 |

검증 포인트:

1. Runner가 screenshot/trace artifact를 S3에 업로드한다.
2. Runner callback에는 file body가 아니라 `bucket`, `key`, size, hash metadata가 전달된다.
3. API는 artifact metadata를 기준으로 `/api/runs/{runId}/artifacts/{artifactId}/content`를 제공한다.

관련 근거:

- `compose.prod.yaml`
- `.env.prod.example`
- `apps/api-server/README.md`
- `apps/runner/README.md`
- `docs/01_architecture_and_project_structure.md`

## 3. SSAFY GMS

| 항목 | 내용 |
|---|---|
| 용도 | AI Assist / LLM provider |
| 가입/준비 필요 | 예, SSAFY GMS API key 필요 |
| 사용 위치 | Analyzer, Runner ScenarioAuthoring, Runner Agent decision |
| 기본 endpoint | `https://gms.ssafy.io/gmsapi` 계열 |
| 주입 위치 | `.env`, `.env.docker`, `.env.prod` |

Analyzer 환경변수:

| 변수 | 용도 | Secret |
|---|---|---:|
| `ANALYZER_GMS_ENABLED` | Analyzer GMS 사용 여부 | 아니오 |
| `ANALYZER_GMS_API_KEY` | Analyzer GMS API key | 예 |
| `ANALYZER_GMS_MODEL` | Analyzer model | 아니오 |
| `ANALYZER_GMS_BASE_URL` | GMS base URL | 아니오 |
| `ANALYZER_GMS_OPENAI_RESPONSES_PATH` | Responses-compatible path | 아니오 |
| `ANALYZER_GMS_TIMEOUT_SECONDS` | timeout | 아니오 |
| `ANALYZER_GMS_LABEL_PARALLEL_ENABLED` | label 보조 병렬 호출 여부 | 아니오 |
| `ANALYZER_GMS_LABEL_MAX_CONCURRENCY` | label 병렬 수 | 아니오 |
| `ANALYZER_GMS_REPORT_COMPACT_PROMPT_ENABLED` | compact prompt 사용 여부 | 아니오 |

Runner 환경변수:

| 변수 | 용도 | Secret |
|---|---|---:|
| `GMS_OPENAI_CHAT_COMPLETIONS_ENDPOINT` | OpenAI-compatible chat completions endpoint | 아니오 |
| `GMS_API_KEY` | Runner 공통 GMS key | 예 |
| `GMS_DEFAULT_MODEL` | Runner 기본 model | 아니오 |
| `GMS_DEFAULT_TIMEOUT_MS` | Runner 기본 timeout | 아니오 |
| `RUNNER_SCENARIO_AUTHORING_LLM_ENDPOINT` | ScenarioAuthoring 전용 endpoint override | 아니오 |
| `RUNNER_SCENARIO_AUTHORING_LLM_API_KEY` | ScenarioAuthoring 전용 key override | 예 |
| `RUNNER_AGENT_LLM_ENDPOINT` | Agent decision LLM endpoint | 아니오 |
| `RUNNER_AGENT_LLM_API_KEY` | Agent decision LLM key | 예 |

검증 포인트:

1. `ANALYZER_GMS_ENABLED=true`일 때 Analyzer가 Rule Engine 결과 이후 설명 보조를 수행한다.
2. GMS 실패 시 Analyzer는 deterministic Rule Engine 결과를 유지한다.
3. Runner Agent decision은 LLM 결과를 그대로 실행하지 않고 verifier/policy check를 통과해야 한다.

관련 근거:

- `apps/analyzer/README.md`
- `apps/analyzer/app/providers/gms.py`
- `apps/runner/README.md`
- `apps/runner/src/config/index.ts`
- `.env.prod.example`

## 4. DuckDNS

| 항목 | 내용 |
|---|---|
| 용도 | 운영 도메인 |
| 도메인 | `wedge-app.duckdns.org` |
| 가입/준비 필요 | 예 |
| 프로젝트 반영 위치 | `infra/nginx/wedge.prod.conf` |
| 검증 포인트 | `https://wedge-app.duckdns.org` 접속 |

주의:

- DuckDNS token은 repo에 넣지 않는다.
- DNS update 자동화가 있다면 EC2 또는 별도 운영 스크립트에서 관리한다.

## 5. Let's Encrypt

| 항목 | 내용 |
|---|---|
| 용도 | HTTPS 인증서 |
| 가입/준비 필요 | 별도 계정 필수 아님 |
| 인증서 경로 | `/etc/letsencrypt/live/wedge-app.duckdns.org/` |
| challenge 경로 | `/var/www/certbot` |
| 프로젝트 반영 위치 | `infra/nginx/wedge.prod.conf`, `compose.prod.yaml` |

검증 포인트:

```bash
curl -I https://wedge-app.duckdns.org
```

## 6. GitLab

| 항목 | 내용 |
|---|---|
| 용도 | 소스 저장소, Jenkins webhook trigger |
| 저장소 | `https://lab.ssafy.com/s14-final/S14P31C104.git` |
| 배포 branch | `develop` |
| Jenkins credential | `gitlab-https`, `gitlab-ec2-readonly`, `gitlab-webhook-token` |
| 프로젝트 반영 위치 | `Jenkinsfile` |

운영 배포에서는 Jenkins가 EC2에서 GitLab read-only credential을 사용해 `origin/develop`을 fetch한다.

## 7. Jenkins

| 항목 | 내용 |
|---|---|
| 용도 | CI/CD 배포 자동화 |
| 실행 방식 | EC2 내부 Docker container |
| 이미지 | `jenkins/jenkins:2.555.1-jdk21` |
| compose | `compose.jenkins.yaml` |
| 외부 공개 | 기본 비공개, `127.0.0.1:18081` 바인딩 |
| 접속 방식 | SSH tunnel |

Jenkins Credentials:

| Credential id | 용도 | Secret |
|---|---|---:|
| `gitlab-https` | Jenkins checkout | 예 |
| `gitlab-ec2-readonly` | EC2에서 GitLab fetch | 예 |
| `gitlab-webhook-token` | GitLab webhook trigger token | 예 |
| `ec2-ssh` | EC2 SSH deploy key | 예 |
| `mattermost-webhook` | 배포 알림 webhook | 예 |

## 8. Mattermost Incoming Webhook

| 항목 | 내용 |
|---|---|
| 용도 | Jenkins 배포 성공/실패 알림 |
| 가입/준비 필요 | 예, Mattermost 채널 incoming webhook 생성 |
| 주입 위치 | Jenkins Credentials `mattermost-webhook` |
| 코드 반영 위치 | `Jenkinsfile` |

검증 포인트:

1. Jenkins 성공 시 Mattermost 성공 메시지 수신
2. Jenkins 실패 시 failed stage와 error log 일부 수신

## 9. 코드 빌드/컴파일 외부 의존성

Wedge는 사용자가 작성한 코드를 외부 서비스에서 컴파일하는 기능은 없다. 다만 애플리케이션 빌드 시 일반 package registry에 접근한다.

| 서비스 | 가입 필요 | 용도 | 근거 |
|---|---:|---|---|
| Docker Hub | 보통 불필요 | base image pull | Dockerfile, compose |
| npm Registry | 보통 불필요 | Web/Runner dependency install | `apps/web/package.json`, `apps/runner/package.json` |
| Maven Central | 보통 불필요 | Spring dependency download | `apps/api-server/build.gradle` |
| Gradle Distribution | 보통 불필요 | Gradle wrapper download | `gradle-wrapper.properties` |
| PyPI | 보통 불필요 | Analyzer dependency install | `apps/analyzer/pyproject.toml` |
| Playwright Browser CDN | 네트워크 필요 | Chromium browser install | `apps/runner/Dockerfile` |

사내망/제한망에서는 위 registry 접근이 차단될 수 있으므로 proxy 또는 mirror 설정이 필요하다.

## 10. 미사용 외부 서비스

| 항목 | Wedge 기준 |
|---|---|
| 소셜 로그인 | 사용하지 않음. Human auth는 first-party email/password + JWT |
| OAuth/OIDC 소셜 인증 | 현재 운영 로그인 기능으로 사용하지 않음. MCP/agent client identity 설계 문서에는 future/auth 모델로 언급됨 |
| Photon Cloud | 사용하지 않음 |
| 결제 PG | 사용하지 않음 |
| 외부 코드 컴파일 API | 사용하지 않음 |

## 11. secret 관리 원칙

1. 실제 secret 값은 Git 저장소와 제출 문서에 기록하지 않는다.
2. `.env.prod.example`에는 변수명과 placeholder만 둔다.
3. 운영 secret은 EC2 `.env.prod`와 Jenkins Credentials에만 둔다.
4. DB dump 제출 전 `user_credential`, callback payload, token성 로그 포함 여부를 확인한다.
5. 발표/제출 문서에는 서비스명, 발급 항목, 변수명, 검증 방법만 포함한다.

