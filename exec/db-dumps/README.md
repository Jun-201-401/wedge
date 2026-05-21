# Wedge DB 덤프 산출물

이 디렉터리는 Wedge PostgreSQL DB 덤프 파일을 보관한다.

## 현재 포함 파일

| 파일 | 기준 | 설명 |
|---|---|---|
| `wedge_dev_sanitized_20260521_114009.sql` | 로컬 개발 DB `wedge-postgres-dev` | 민감/내부 runtime table data를 제외한 SQL dump |

## 생성 기준

생성 일시: `2026-05-21 11:40:09 KST`

생성 대상:

```text
container: wedge-postgres-dev
database : wedge_dev
user     : ssafy
dbms     : PostgreSQL 17.9
```

생성 명령:

```powershell
docker exec wedge-postgres-dev pg_dump `
  -U ssafy `
  -d wedge_dev `
  --no-owner `
  --no-privileges `
  --clean `
  --if-exists `
  --exclude-table-data=public.user_credential `
  --exclude-table-data=public.mcp_invocation_log `
  --exclude-table-data=public.processed_message `
  --exclude-table-data=public.outbox_message `
  --exclude-table-data=public.agent_idempotency_record `
  --exclude-table-data=public.runner_message_idempotency_record `
  > exec\db-dumps\wedge_dev_sanitized_20260521_114009.sql
```

## 제외한 테이블 데이터

| 테이블 | 제외 이유 |
|---|---|
| `user_credential` | password hash 등 인증 관련 데이터 |
| `mcp_invocation_log` | 내부 호출 로그/요청 payload 포함 가능성 |
| `processed_message` | callback idempotency payload hash/runtime 데이터 |
| `outbox_message` | MQ publish payload 포함 가능성 |
| `agent_idempotency_record` | Agent 실행 idempotency runtime 데이터 |
| `runner_message_idempotency_record` | Runner message idempotency runtime 데이터 |

테이블 구조 자체는 dump에 포함되어 있으며, 위 테이블의 data row만 제외했다.

## 복구 예시

새 PostgreSQL 컨테이너 또는 로컬 DB에 복구할 때:

```bash
psql -U <DB_USER> -d <DB_NAME> -f exec/db-dumps/wedge_dev_sanitized_20260521_114009.sql
```

Docker 컨테이너에 복구할 때:

```bash
docker exec -i <postgres-container> psql -U <DB_USER> -d <DB_NAME> < exec/db-dumps/wedge_dev_sanitized_20260521_114009.sql
```

## 제출 전 주의

1. 최종 시연 데이터가 운영/demo DB에 따로 있다면 제출 직전에 동일한 기준으로 dump를 다시 생성한다.
2. secret, password hash, token, private URL, callback payload가 포함되지 않았는지 재검토한다.
3. 운영 DB에서 dump를 생성할 경우 `pg_dump` 실행 전 백업/접근 권한/개인정보 포함 여부를 팀에서 확인한다.
4. `infra/db/migrations/*.sql`은 schema 재현용 migration이고, 본 디렉터리의 SQL 파일은 제출용 DB dump다.

