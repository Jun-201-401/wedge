# 03. API reference와 transport 계약

## 1. 목적

이 문서는 Wedge의 API와 transport 계약을 사람과 AI agent가 이해할 수 있게 설명한다.  
Machine-readable REST 계약은 `packages/contracts/openapi/wedge_openapi.yaml`을 기준으로 한다.

## 2. Base path

| Area | Base Path | Purpose |
|---|---|---|
| Public REST API | `/api` | Web UI, external API client |
| Internal Callback API | `/internal` | Runner/Analyzer callback |
| WebSocket | `/ws` | live run event stream |
| Remote MCP | `/mcp` | external agent adapter |

`/api/v1`은 사용하지 않는다.  
Versioning은 OpenAPI version, schema version, release note로 관리한다.

## 3. 공통 header

### Public API

```http
Authorization: Bearer <access-token>
Content-Type: application/json
X-Correlation-Id: req_...
Idempotency-Key: idem_...   # state-changing POST 권장
```

### Internal callback API

```http
Authorization: Bearer <service-token>
X-Event-Id: evt_...
X-Worker-Id: runner_... or analyzer_...
X-Signature: hmac-sha256=...
```

`X-Event-Id`와 `X-Worker-Id`는 internal callback에서 필수다. `X-Event-Id`는 idempotency key로 사용한다.

## 4. 공통 response 형식

### 단일 resource

```json
{
  "data": {
    "id": "uuid"
  },
  "meta": {
    "requestId": "req_..."
  }
}
```

### 목록 response

```json
{
  "data": [],
  "meta": {
    "requestId": "req_...",
    "nextCursor": null
  }
}
```

### Error response

```json
{
  "error": {
    "code": "state_conflict",
    "message": "Run is already running.",
    "details": {
      "runId": "uuid",
      "currentStatus": "RUNNING"
    }
  },
  "meta": {
    "requestId": "req_..."
  }
}
```

## 5. 표준 error code

| HTTP | code | Meaning |
|---|---|---|
| 400 | `validation_error` | invalid request shape |
| 401 | `unauthorized` | missing/invalid auth |
| 403 | `forbidden` | permission denied |
| 404 | `not_found` | resource not found |
| 409 | `state_conflict` | invalid state transition |
| 422 | `unprocessable_request` | semantically invalid |
| 429 | `rate_limited` | too many requests |
| 500 | `internal_error` | server error |

## 6. Public REST endpoint matrix

OpenAPI와 동일한 public `/api` endpoint만 여기에 둔다. 삭제/복구 정책이 확정되지 않은 project delete는 V1 public API에서 제외한다.

### Projects

```text
GET   /api/projects
POST  /api/projects
GET   /api/projects/{projectId}
PATCH /api/projects/{projectId}
```

### Scenario templates

```text
GET /api/scenario-templates
GET /api/scenario-templates/{templateId}
GET /api/scenario-templates/{templateId}/versions/{versionId}
```

### Runs

```text
POST   /api/runs
GET    /api/runs
GET    /api/runs/{runId}
DELETE /api/runs/{runId}
POST   /api/runs/{runId}/start
POST   /api/runs/{runId}/stop
GET    /api/runs/{runId}/live
GET    /api/runs/{runId}/steps
GET    /api/runs/{runId}/steps/{stepId}
GET    /api/runs/{runId}/events
GET    /api/runs/{runId}/artifacts
GET    /api/runs/{runId}/signals
GET    /api/runs/{runId}/evidence-packet
```

`/api/runs/{runId}/signals`는 `rule_hit` raw table이 아니라 user-facing issue signal projection이다. 저장 기준은 `analysis_finding`/`nudge`와 EvidencePacket references다.

### Analysis

```text
GET  /api/runs/{runId}/analysis-jobs
POST /api/runs/{runId}/analysis-jobs
GET  /api/analysis-jobs/{analysisJobId}
```

### Reports

```text
POST /api/runs/{runId}/reports
GET  /api/runs/{runId}/reports
GET  /api/reports/{reportId}
GET  /api/reports/{reportId}/shares
POST /api/reports/{reportId}/shares
```

## 7. 주요 request 예시

### Run 생성

```http
POST /api/runs
Idempotency-Key: idem_create_run_001
```

```json
{
  "projectId": "uuid",
  "name": "Landing CTA audit",
  "startUrl": "https://example.com",
  "scenarioTemplateVersionId": "uuid",
  "devicePreset": "desktop",
  "goal": "무료 체험 CTA까지의 흐름 점검"
}
```

### Run 시작

```http
POST /api/runs/{runId}/start
Idempotency-Key: idem_start_run_001
```

Response:

```json
{
  "data": {
    "runId": "uuid",
    "status": "QUEUED"
  },
  "meta": {
    "requestId": "req_..."
  }
}
```

### Report share 생성

```http
POST /api/reports/{reportId}/shares
```

```json
{
  "expiresAt": "2026-06-30T00:00:00Z"
}
```

Response:

```json
{
  "data": {
    "id": "uuid",
    "reportId": "uuid",
    "shareUrl": "https://app.wedge.example.com/share/rpt_...",
    "expiresAt": "2026-06-30T00:00:00Z",
    "revokedAt": null
  },
  "meta": {
    "requestId": "req_..."
  }
}
```

## 8. Internal callback API

Internal callback은 public API가 아니다.

```text
POST /internal/runner/runs/{runId}/accepted
POST /internal/runner/runs/{runId}/step-events
POST /internal/runner/runs/{runId}/checkpoints
POST /internal/runner/runs/{runId}/artifacts
POST /internal/runner/runs/{runId}/finished
POST /internal/runner/runs/{runId}/failed

POST /internal/analysis/jobs/{analysisJobId}/completed
POST /internal/analysis/jobs/{analysisJobId}/failed
```

### Checkpoint callback

Runner는 checkpoint batch를 Spring에 전달한다. Internal runner callback은 안정적인 ScenarioPlan `step_id`를 `stepKey`로 사용하고, Spring은 이 값을 DB UUID인 `test_run_step.id`로 해석한다.

```http
POST /internal/runner/runs/{runId}/checkpoints
X-Event-Id: evt_checkpoint_batch_001
X-Worker-Id: runner_001
X-Signature: hmac-sha256=...
```

```json
{
  "checkpoints": [
    {
      "checkpointId": "cp_001",
      "stepKey": "step_001_goto",
      "stage": "FIRST_VIEW",
      "trigger": {"type": "goto", "target": "https://example.com"},
      "settle": {"strategy": "network_idle", "durationMs": 1832, "status": "settled"},
      "state": {},
      "observations": [],
      "deltas": [],
      "artifactRefs": []
    }
  ]
}
```

## 9. RabbitMQ

RabbitMQ는 작업 분배용이다.  
Canonical MQ contract는 `packages/contracts/mq/messages.schema.json`의 envelope다. `mq/*.request.schema.json` 개별 파일은 이 envelope의 payload `$defs`를 참조하는 얇은 작업별 entrypoint다.

Run execution message는 Spring이 고정한 `scenarioTemplateVersionId`와 materialized `scenarioPlan`을 포함한다. Analyzer message는 full EvidencePacket blob 대신 Spring이 저장한 `evidencePacketId`를 포함한다.

MQ payload는 camelCase envelope를 사용한다.

```json
{
  "messageId": "msg_...",
  "messageType": "run.execute.request",
  "schemaVersion": "current",
  "createdAt": "2026-04-20T01:00:00Z",
  "producer": "spring-api",
  "payload": {}
}
```

Queues:

```text
run.execute.request        # payload: scenarioTemplateVersionId + scenarioPlan
analysis.request           # payload: evidencePacketId + analysisType(PRIMARY/REPROCESS/COMPARE)
report.export.request      # payload: format(PDF/MARKDOWN/HTML/JSON)
run.execute.dlq
analysis.dlq
report.export.dlq
```

## 10. WebSocket

Endpoint:

```text
/ws/runs/{runId}
```

Event envelope:

```json
{
  "eventId": "evt_...",
  "eventType": "checkpoint_created",
  "runId": "uuid",
  "occurredAt": "2026-04-20T01:00:00Z",
  "payload": {}
}
```

Canonical event names:

```text
run_status_changed
step_started
step_finished
checkpoint_created
latest_frame_available
issue_signal_detected
analysis_started
analysis_finished
run_failed
```

`analysis_completed`는 사용하지 않는다. `analysis_finished`로 통일한다.

## 11. MCP

MCP는 Wedge 기능 호출기다.  
브라우저 원격 조종기는 아니다.

허용 tool:

V1 필수 read-only tool:

```text
get_run_status
get_run_summary
list_run_events
get_latest_snapshot
get_step_evidence
get_evidence_packet
get_report
list_reports
```

V1 선택 execute/export tool. client policy와 OAuth scope가 허용할 때만 활성화한다.

```text
create_run
start_run
stop_run
analyze_run
generate_nudges
export_report
```

금지 tool:

```text
browser_click
browser_eval_js
raw_sql_query
get_full_network_dump
```

Tool schema:

```text
packages/contracts/mcp/tools.schema.json
```

## 12. Auth / Scope

Scopes:

| Scope | Meaning |
|---|---|
| `wedge.read` | read run/evidence/report |
| `wedge.execute` | create/start/stop/analyze |
| `wedge.export` | export/share report |
| `wedge.admin` | admin operations |

Project-level access는 JWT claim만 보지 않고 Spring DB에서 검증한다.
