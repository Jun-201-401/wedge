# 02. 데이터 모델과 DB

## 1. DB 설계 원칙

Wedge DB는 두 가지를 동시에 지원해야 한다.

1. Spring이 운영 상태를 안정적으로 관리한다.
2. Runner/Analyzer가 사용하는 evidence domain model을 재현 가능하게 저장한다.

따라서 DB는 다음 계층으로 구성한다.

```text
User / Workspace / Project
Scenario / Run / Step
Checkpoint / Observation / Artifact / EvidencePacket
AnalysisJob / RuleHit / Finding / Nudge / Report / Share
Agent / MCP / Outbox / ProcessedMessage / Worker
```

## 2. 상태 모델

`test_run`은 세 가지 상태 축을 분리한다.

| Column | Meaning | Values |
|---|---|---|
| `status` | 실행 lifecycle | CREATED, QUEUED, STARTING, RUNNING, STOP_REQUESTED, STOPPED, COMPLETED, FAILED |
| `result_completeness` | 실행 결과 완성도 | NONE, PARTIAL, FINAL |
| `analysis_status` | 분석 lifecycle | NOT_STARTED, QUEUED, RUNNING, COMPLETED, FAILED |

이렇게 분리하는 이유:

- 사용자가 중지해도 partial evidence가 있을 수 있다.
- 실행은 실패했지만 분석 가능한 checkpoint가 있을 수 있다.
- 분석 실패와 브라우저 실행 실패는 다른 문제다.
- `status`는 브라우저 실행 lifecycle만 표현하고, 분석 진행은 `analysis_status`로만 표현한다.

예시:

```text
status=STOPPED, result_completeness=PARTIAL, analysis_status=COMPLETED
status=FAILED, result_completeness=NONE, analysis_status=NOT_STARTED
status=COMPLETED, result_completeness=FINAL, analysis_status=COMPLETED
```

## 3. 핵심 테이블

| Table | Purpose |
|---|---|
| `user_account` | 사용자 |
| `workspace` | 조직/개인 작업공간 |
| `workspace_member` | 워크스페이스 멤버십 |
| `project` | 분석 대상 서비스 |
| `project_member` | 프로젝트 권한 |
| `scenario_template` | 템플릿 논리 단위 |
| `scenario_template_version` | 실행 가능한 template snapshot |
| `rule_registry` | Rule set version |
| `test_run` | 테스트 실행 1회 |
| `test_run_step` | 실행 step 상태 |
| `test_run_event` | UI/운영용 run event log |
| `artifact` | S3 artifact metadata |
| `checkpoint` | meaningful state capture |
| `observation` | normalized fact |
| `evidence_packet` | Spring-materialized EvidencePacket domain payload snapshot |
| `analysis_job` | 분석 작업; `evidence_packet_id`로 분석 입력 snapshot을 고정 |
| `rule_hit` | Rule Engine raw hit |
| `analysis_finding` | 사용자-facing finding |
| `nudge` | 개선 제안 |
| `report` | report metadata |
| `report_share` | 공유 링크 |
| `agent_client_policy` | MCP/client 정책 |
| `mcp_invocation_log` | MCP 호출 감사 로그 |
| `outbox_message` | DB→MQ reliable publishing |
| `processed_message` | idempotency |
| `worker_instance` | Runner/Analyzer worker 상태 |

## 4. Evidence 저장 구조

기존 `page_snapshot` 중심 모델은 폐기한다.
Wedge의 evidence는 page가 아니라 action 이후 checkpoint가 핵심이다.

```text
test_run
  └─ test_run_step
      └─ checkpoint
          ├─ observation[]
          └─ artifact[]
```

### checkpoint

Checkpoint는 의미 있는 상태 전이 이후 생성한다.

예시:

- initial page load settled
- CTA clicked and form appeared
- invalid form submitted and errors appeared
- pricing plan selected
- final commit screen reached

### observation

Observation은 raw DOM이나 screenshot에서 추출한 normalized fact다.

Examples:

- `cta_candidate`
- `cta_cluster`
- `heading_structure`
- `form_field`
- `form_error`
- `trust_signal`
- `target_size_issue`
- `contrast_issue`
- `network_failure`
- `console_error`
- `performance_metric`

### evidence_packet

`evidence_packet`은 Runner가 생성한 domain payload의 snapshot이다.  
DB normalized tables가 운영 조회에 유리하고, packet snapshot은 Analyzer 재실행/디버깅에 유리하다.

둘 다 유지한다.

## 5. Soft delete

V1에서 soft delete를 적용하는 핵심 테이블:

- `workspace`
- `project`
- `test_run`
- `report`

모든 테이블에 무조건 적용하지 않는다.  
Artifact와 observation은 run/report retention 정책으로 관리한다.

## 6. 동시성

핵심 entity에는 `version` 컬럼을 둔다.

- `workspace`
- `project`
- `test_run`
- `test_run_step`
- `analysis_job`
- `report`

상태 전이는 compare-and-set 방식으로 처리한다.

예시:

```sql
UPDATE test_run
SET status = 'RUNNING', version = version + 1
WHERE id = :run_id
  AND status = 'STARTING'
  AND version = :expected_version;
```

## 7. Outbox / Idempotency

### outbox_message

Spring이 DB 상태를 바꾼 뒤 RabbitMQ message를 발행해야 할 때 사용한다.  
DB write와 MQ publish 사이의 불일치를 줄인다.

### processed_message

Runner/Analyzer callback이나 RabbitMQ message는 at-least-once 전송을 전제로 한다.  
중복 처리는 `message_id` 또는 `X-Event-Id`로 한다.

## 8. V1에서 제외한 테이블

| Excluded | Reason |
|---|---|
| `project_environment` | 일반 사용자/개인 서비스에 과함 |
| `test_account` | credential 보안 설계가 무거움 |
| `approval_request` | 초기 UX 복잡도 증가 |
| `usage_meter` | 과금 정책 확정 전에는 보류 |

대신 다음 필드는 남겨 추후 확장 가능하게 한다.

- `test_run.start_url`
- `test_run.device_preset`
- `artifact.size_bytes`
- `analysis_job.duration_ms`
- `mcp_invocation_log`
- `report_share`
