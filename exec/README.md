# Wedge exec 제출 산출물 안내

이 디렉터리는 Wedge 최종 제출/포팅용 산출물을 모아두는 공간이다.

## 파일 구성

| 파일/디렉터리 | 용도 |
|---|---|
| `porting-manual.md` | GitLab clone 이후 빌드/배포할 수 있도록 정리한 포팅 매뉴얼 |
| `external-services-onboarding.md` | 프로젝트에서 사용하는 외부 서비스 가입/키 발급/주입 위치 정리 |
| `db-dumps/` | PostgreSQL DB 덤프 최신본 및 복구 안내 |

## 작성 기준

- 실제 코드, Dockerfile, Compose, Jenkinsfile, 환경변수 파일을 기준으로 작성한다.
- 실제 비밀번호, API key, access key, token, private key는 문서에 직접 적지 않는다.
- 제출 문서에는 변수명, 용도, 주입 위치, 검증 방법만 적는다.
- DB 덤프는 제출 전 민감 데이터 포함 여부를 반드시 검토한다.

## 현재 산출물 기준

- 포팅 매뉴얼: `porting-manual.md`
- 외부 서비스 문서: `external-services-onboarding.md`
- DB 덤프 최신본: `db-dumps/wedge_dev_sanitized_20260521_114009.sql`

