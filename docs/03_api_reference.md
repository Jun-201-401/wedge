# 03. API reference와 transport 계약

## 1. 목적

이 문서는 Wedge의 API와 transport 계약을 사람과 AI agent가 이해할 수 있게 설명한다.  
Machine-readable REST 계약은 `packages/contracts/openapi/wedge_openapi.yaml`을 기준으로 한다.

## 1.1 읽는 법

- 공통 응답/에러 형식은 `4. 공통 response 형식`을 먼저 확인한다.
- 실제 public endpoint 목록은 `6. Public REST endpoint matrix`를 기준으로 본다.
- Runner/Analyzer callback은 `8. Internal callback API`를 기준으로 본다.
- Machine-readable 계약은 `packages/contracts/openapi/wedge_openapi.yaml`을 최종 기준으로 둔다.

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

Public REST success responses use `data` + `meta`. Public REST error responses use `error` + `meta`.

Rules:

- `meta.requestId` is included in every JSON response.
- `meta.correlationId` is included when present or derived from the request id.
- Success responses do not include top-level `code` or `message` by default. Frontend UX copy owns success messages.
- Error responses use stable `snake_case` `error.code` values for frontend, SDK, and agent branching.
- Validation errors use `error.details.fields[]`.
- Async commands should return HTTP `202` when accepted and include the resulting resource status in `data`.

### 단일 resource

```json
{
  "data": {
    "id": "uuid"
  },
  "meta": {
    "requestId": "req_...",
    "correlationId": "corr_..."
  }
}
```

### 목록 response

```json
{
  "data": [],
  "meta": {
    "requestId": "req_...",
    "correlationId": "corr_...",
    "nextCursor": null,
    "hasMore": false
  }
}
```

### Error response

Generic resource or state errors use a stable `error.code` and may include resource-specific context in `details`.

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
    "requestId": "req_...",
    "correlationId": "corr_..."
  }
}
```

### Unauthorized error response

```json
{
  "error": {
    "code": "unauthorized",
    "message": "Authentication is required."
  },
  "meta": {
    "requestId": "req_...",
    "correlationId": "corr_..."
  }
}
```

### Forbidden error response

```json
{
  "error": {
    "code": "forbidden",
    "message": "Permission is denied."
  },
  "meta": {
    "requestId": "req_...",
    "correlationId": "corr_..."
  }
}
```

### Validation error response

```json
{
  "error": {
    "code": "validation_failed",
    "message": "Request validation failed.",
    "details": {
      "fields": [
        {"field": "email", "code": "invalid", "message": "must be a well-formed email address"}
      ]
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
| 400 | `invalid_request` | invalid request shape |
| 401 | `unauthorized` | missing/invalid auth |
| 403 | `forbidden` | permission denied |
| 404 | `not_found` | resource not found |
| 409 | `state_conflict` | invalid state transition |
| 422 | `validation_failed` | validation or semantically invalid input |
| 429 | `rate_limited` | too many requests |
| 500 | `internal_error` | server error |

Domain-specific error codes should still use stable `snake_case` values. Discovery/scenario-fit candidate codes include `discovery_not_found`, `discovery_expired`, `discovery_failed`, `scenario_not_applicable`, `scenario_fit_low_confidence`, `no_entrypoint_found`, and `unsafe_scenario_action`.

Report/artifact candidate codes are deferred until the relevant API/service implementation exists. Expected first candidates are `report_not_found`, `artifact_not_found`, `report_not_ready`, `report_archived`, `report_share_expired`, and `report_share_revoked`.

## 6. Public REST endpoint matrix

OpenAPI와 동일한 public `/api` endpoint만 여기에 둔다. 삭제/복구 정책이 확정되지 않은 project delete는 V1 public API에서 제외한다.

### Auth

Human web auth endpoints are first-party V1 endpoints. MCP/agent client auth remains a separate OAuth-style client identity and scope model.

```text
POST /api/auth/signup
POST /api/auth/login
POST /api/auth/refresh
POST /api/auth/logout
GET  /api/auth/me
```

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

### Discoveries

```text
POST   /api/discoveries
GET    /api/discoveries/{discoveryId}
```

Discovery는 URL-first Preflight를 시작하고 추천 시나리오를 조회하는 공개 API다. Discovery 결과의 최종 source of truth는 Spring DB다.

### Scenario Authoring

```text
POST   /api/scenario-authoring-jobs
GET    /api/scenario-authoring-jobs/{authoringJobId}
POST   /api/scenario-authoring-jobs/{authoringJobId}/confirm
```

ScenarioAuthoring은 Discovery recommendation과 Run 생성 사이의 계약 단계다. API shape는 V1 계약 방향을 고정하기 위한 문서 기준이며, OpenAPI/앱 구현은 후속 작업에서 `packages/contracts`를 먼저 갱신한 뒤 진행한다.

Authoring job/result는 별도 실행 DSL이 아니다. Provider는 기존 `ScenarioPlan` schema를 만족하는 candidate만 제출하며, Spring은 confirmed candidate를 입력으로 `POST /api/runs` 또는 내부 materializer에서 ScenarioPlan + fit requirements를 고정한다. ScenarioAuthoring 기반 run path에서 Runner는 authoring job/result를 받지 않고, 고정된 ScenarioPlan만 실행한다. Runner Agent Runtime은 별도 `agent.execute.request` / agent callback stream(`agent-events`, `agent-traces`) 경로이며, 상세 contract-first 기준은 `docs/runner_agent_runtime_implementation_plan.md`를 따른다.

### Runs

```text
POST   /api/runs
GET    /api/runs
GET    /api/runs/{runId}
DELETE /api/runs/{runId}
POST   /api/runs/{runId}/start
POST   /api/runs/{runId}/agent/start
POST   /api/runs/{runId}/stop
GET    /api/runs/{runId}/live
GET    /api/runs/{runId}/steps
GET    /api/runs/{runId}/steps/{stepId}
GET    /api/runs/{runId}/events
GET    /api/runs/{runId}/artifacts
GET    /api/runs/{runId}/signals
GET    /api/runs/{runId}/evidence-packet
```

`POST /api/runs` request는 `sourceDiscoveryId`를 선택적으로 받을 수 있고, ScenarioAuthoring 구현 후에는 `sourceAuthoringJobId`와 confirmed `candidateId`를 선택적으로 받을 수 있다. Run response는 `sourceDiscoveryId`, `sourceAuthoringJobId`, `scenarioFitStatus`, `scenarioFitReason`, `scenarioFitSummary`를 포함한다. `sourceAuthoringJobId`의 OpenAPI/서버 구현은 후속 계약 작업으로 미룬다.

`/api/runs/{runId}/signals`는 `rule_hit` raw table이 아니라 user-facing issue signal projection이다. 저장 기준은 `analysis_finding`/`nudge`와 EvidencePacket references다.

Issue response는 stage를 필수로 포함한다.

```json
{
  "issueId": "issue_001",
  "criterionId": "PATH-CTA-002",
  "stage": "CTA",
  "axis": "Path",
  "severity": 2,
  "confidence": 0.78,
  "priorityScore": 2.03,
  "evidenceRefs": ["cp_001.obs_002"],
  "summary": "같은 결정 순간에서 primary급 CTA가 3개 경쟁합니다.",
  "recommendations": ["Primary CTA를 1개로 정리하세요."]
}
```

`stage`는 backend Rule Engine이 StageContext에서 정한다. LLM은 stage 값을 생성하거나 수정하지 않는다. UI는 enum을 그대로 노출하지 않고 `FIRST_VIEW → 첫 화면 이해`, `VALUE → 가치 이해`, `CTA → 행동 선택`, `INPUT → 입력 진행`, `COMMIT → 최종 확정`으로 변환해 보여준다.

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

#### Report Summary / Detail 응답 구분 기준

Report Summary API는 리포트 목록, 대시보드, 미리보기 카드에서 사용하는 가벼운 응답이다.
상태, 마찰 점수, 요약 문장, decision map 요약, 중요도가 높은 finding 3개와 사용 가능한 preview image 정도만 포함한다.
finding별 preview image는 같은 stage의 checkpoint screenshot을 우선 사용하고, 없으면 report artifact, 없으면 run의 최신 screenshot을 fallback으로 사용한다.

Report Detail API는 리포트 상세 화면에서 사용하는 전체 응답이다.
전체 finding 목록, finding별 nudge, evidence refs, 대표 screenshot artifact, visual evidence metadata를 포함할 수 있다.
초기 화면에서는 Summary와 같은 우선순위 상위 3개 finding을 먼저 보여주고, 사용자가 더보기를 누르면 같은 Detail 응답 안의 나머지 finding을 priority score 순서로 확장한다.

Summary 응답은 모든 finding, nudge, artifact를 매번 전부 조합하지 않는다.
Detail 응답은 report, analysis_finding, nudge, artifact, evidence reference를 조합해 상세 화면 렌더링에 필요한 정보를 제공한다.

Run result 또는 report response는 Decision Map을 포함한다.

```json
{
  "decisionMap": [
    {
      "stage": "FIRST_VIEW",
      "displayName": "첫 화면 이해",
      "status": "PASS",
      "issueIds": [],
      "summary": "첫 화면에서 핵심 메시지와 CTA가 관찰되었습니다."
    },
    {
      "stage": "CTA",
      "displayName": "행동 선택",
      "status": "WARNING",
      "issueIds": ["issue_001"],
      "summary": "같은 결정 순간에서 primary급 CTA가 3개 경쟁합니다."
    },
    {
      "stage": "INPUT",
      "displayName": "입력 진행",
      "status": "NOT_APPLICABLE",
      "issueIds": []
    }
  ]
}
```

`scenarioFitStatus`와 `decisionMap.status`는 다른 값이다.

- `scenarioFitStatus`: 선택한 시나리오가 URL에 적용 가능한지.
- `decisionMap.status`: 관찰된 stage에서 issue가 있는지.

## 7. 주요 request 예시

### Discovery 생성

```http
POST /api/discoveries
Idempotency-Key: idem_create_discovery_001
```

`projectId`를 생략하면 현재 사용자 default Project를 자동 생성하거나 재사용한다. 명시하면 기존처럼 해당 Project 권한을 검사한다.

```json
{
  "url": "https://example.com",
  "devicePreset": "desktop",
  "viewport": {
    "width": 1440,
    "height": 900
  }
}
```

Response:

```json
{
  "data": {
    "discoveryId": "uuid",
    "projectId": "uuid",
    "status": "QUEUED"
  },
  "meta": {
    "requestId": "req_..."
  }
}
```

### Discovery 결과 조회

```http
GET /api/discoveries/{discoveryId}
```

Response:

```json
{
  "data": {
    "discoveryId": "uuid",
    "projectId": "uuid",
    "status": "COMPLETED",
    "inputUrl": "https://example.com",
    "finalUrl": "https://example.com",
    "summary": {
      "detectedFlowTypes": ["LANDING_CTA", "SIGNUP_LEAD_FORM"],
      "missingFlowTypes": ["PURCHASE_CHECKOUT"],
      "primaryCtaCount": 2,
      "formCandidateCount": 1,
      "pricingEntrypointCount": 0,
      "checkoutEntrypointCount": 0
    },
    "scenarioRecommendations": [
      {
        "scenarioType": "LANDING_CTA",
        "recommendationLevel": "HIGH",
        "confidence": 0.86,
        "reason": "첫 화면에서 '무료로 시작' CTA가 발견되었습니다.",
        "evidenceRefs": ["cp_001.obs_002"],
        "suggestedStartUrl": "https://example.com"
      },
      {
        "scenarioType": "PURCHASE_CHECKOUT",
        "recommendationLevel": "LOW",
        "confidence": 0.22,
        "reason": "가격, 장바구니, 결제 진입점이 발견되지 않았습니다.",
        "evidenceRefs": ["cp_001.obs_008"]
      }
    ]
  },
  "meta": {
    "requestId": "req_..."
  }
}
```


### ScenarioAuthoring job 생성

```http
POST /api/scenario-authoring-jobs
Idempotency-Key: idem_create_authoring_job_001
```

```json
{
  "projectId": "uuid",
  "sourceDiscoveryId": "uuid",
  "requestedGoal": "무료 체험 CTA까지의 흐름 점검",
  "preferredScenarioType": "LANDING_CTA",
  "selectedRecommendation": {
    "scenarioType": "LANDING_CTA",
    "evidenceRefs": ["cp_001.obs_002"]
  },
  "providerPolicy": {
    "providerOrder": ["CODEX", "CLAUDE_CODE", "INTERNAL_LLM", "RULE_BASED"],
    "timeoutMs": 60000,
    "fallbackAllowed": true,
    "approvalRequired": true
  }
}
```

Response:

```json
{
  "data": {
    "authoringJobId": "uuid",
    "status": "QUEUED",
    "sourceDiscoveryId": "uuid",
    "candidateCount": 0,
    "providerOrder": ["CODEX", "CLAUDE_CODE", "INTERNAL_LLM", "RULE_BASED"]
  },
  "meta": {
    "requestId": "req_..."
  }
}
```

### ScenarioAuthoring candidate 확정

```http
POST /api/scenario-authoring-jobs/{authoringJobId}/confirm
Idempotency-Key: idem_confirm_authoring_candidate_001
```

Request는 confirmed `candidateId`를 지정한다. Confirmed candidate의 embedded `ScenarioPlan`은 Run materialization 입력으로만 사용된다. 브라우저 조작, Runner action 실행, raw DOM 수집을 직접 트리거하지 않는다.

### Run 생성

```http
POST /api/runs
Idempotency-Key: idem_create_run_001
```

```json
{
  "projectId": "uuid",
  "sourceDiscoveryId": "uuid",
  "sourceAuthoringJobId": "uuid",
  "sourceAuthoringCandidateId": "uuid",
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

### Agent Run 시작

```http
POST /api/runs/{runId}/agent/start
Idempotency-Key: idem_start_agent_run_001
```

동작:

- CREATED 상태의 Run을 QUEUED로 전환한다.
- `agent.execute.request` outbox/MQ 메시지를 발행한다.
- 같은 project/startUrl/goal의 이전 성공 AgentTrace가 있으면 `AgentTask.replay_hints`로 주입한다.

Response는 일반 Run 시작과 같은 `AckResponse` shape를 사용한다.

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

### Scenario fit UX policy

- Discovery recommendationLevel이 LOW여도 사용자는 강제로 실행할 수 있다.
- 단, Run 시작 시 scenario fit check를 다시 수행한다.
- fit check 실패 시 `FAILED`가 아니라 `scenarioFitStatus=NOT_APPLICABLE`과 mismatch report로 응답한다.

## 8. Internal callback API

Internal callback은 public API가 아니다.

```text
POST /internal/runner/discoveries/{discoveryId}/accepted
POST /internal/runner/discoveries/{discoveryId}/checkpoints
POST /internal/runner/discoveries/{discoveryId}/finished
POST /internal/runner/discoveries/{discoveryId}/failed

POST /internal/runner/runs/{runId}/accepted
POST /internal/runner/runs/{runId}/step-events
POST /internal/runner/runs/{runId}/checkpoints
POST /internal/runner/runs/{runId}/artifacts
POST /internal/runner/runs/{runId}/finished
POST /internal/runner/runs/{runId}/failed

POST /internal/runner/runs/{runId}/agent-events
POST /internal/runner/runs/{runId}/agent-traces

POST /internal/analysis/jobs/{analysisJobId}/started
POST /internal/analysis/jobs/{analysisJobId}/completed
POST /internal/analysis/jobs/{analysisJobId}/failed
```

### Discovery checkpoint callback uses the same `X-Event-Id`, `X-Worker-Id`, `X-Signature` headers and the same checkpoint/artifact/observation shape as run checkpoint callbacks. Discovery finished callbacks additionally include `finalUrl` and recommendation raw `summary`.

### Runner callback payload examples

The examples below show the run callback payloads sent from Runner to Spring. The machine-readable source of truth is `packages/contracts/internal/runner-callback.schema.json`.

#### Accepted callback

```http
POST /internal/runner/runs/{runId}/accepted
X-Event-Id: evt_runner_accepted_001
X-Worker-Id: runner_001
X-Signature: hmac-sha256=...
```

```json
{
  "workerId": "runner_001",
  "acceptedAt": "2026-04-23T01:00:00Z",
  "browserSessionId": "browser_session_001"
}
```

#### Step event callback

```http
POST /internal/runner/runs/{runId}/step-events
X-Event-Id: evt_step_batch_001
X-Worker-Id: runner_001
X-Signature: hmac-sha256=...
```

```json
{
  "events": [
    {
      "eventId": "9c6b0f8a-2e7b-4c4d-8e25-b6cc8f82c6c4",
      "stepOrder": 1,
      "stepKey": "step_001_goto",
      "eventType": "STEP_STARTED",
      "occurredAt": "2026-04-23T01:00:01Z",
      "payload": {
        "actionType": "goto",
        "target": "https://example.com"
      }
    }
  ]
}
```

#### Artifact callback

```http
POST /internal/runner/runs/{runId}/artifacts
X-Event-Id: evt_artifact_batch_001
X-Worker-Id: runner_001
X-Signature: hmac-sha256=...
```

```json
{
  "artifacts": [
    {
      "artifactId": "6c0e01a0-32c6-45fd-a73d-bd7dfdf5ac6b",
      "stepKey": "step_001_goto",
      "artifactType": "SCREENSHOT",
      "bucket": "wedge-artifacts",
      "key": "run_001/step_001_goto/screenshot.png",
      "mimeType": "image/png",
      "width": 1440,
      "height": 900,
      "sizeBytes": 128304,
      "sha256": "b3f4c9d9c4f4b21c2f0f8e2d0f1e9d0b1c2a3f4e5d6c7b8a9f0e1d2c3b4a5968",
      "createdAt": "2026-04-23T01:00:03Z"
    }
  ]
}
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
      "primaryStage": "FIRST_VIEW",
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

#### Finished callback

```http
POST /internal/runner/runs/{runId}/finished
X-Event-Id: evt_runner_finished_001
X-Worker-Id: runner_001
X-Signature: hmac-sha256=...
```

```json
{
  "workerId": "runner_001",
  "executionFinishedAt": "2026-04-23T01:01:00Z",
  "summary": {
    "completedStepCount": 3,
    "failedStepCount": 0,
    "stopped": false
  }
}
```

#### Failed callback

```http
POST /internal/runner/runs/{runId}/failed
X-Event-Id: evt_runner_failed_001
X-Worker-Id: runner_001
X-Signature: hmac-sha256=...
```

```json
{
  "workerId": "runner_001",
  "failedAt": "2026-04-23T01:01:00Z",
  "failureCode": "RUNNER_EXECUTION_FAILED",
  "failureMessage": "Navigation timed out after 30000ms.",
  "resultCompleteness": "PARTIAL"
}
```

#### Agent event callback

Runner Agent Runtime은 관찰/결정/정책/검증 이벤트 batch를 별도 agent callback으로 전달한다.

```http
POST /internal/runner/runs/{runId}/agent-events
X-Event-Id: evt_agent_events_001
X-Worker-Id: runner_001
X-Signature: hmac-sha256=...
```

Payload shape is `AgentEventBatch` in `packages/contracts/internal/runner-callback.schema.json`; each event uses `packages/contracts/schemas/agent-event.schema.json`.

#### Agent trace callback

Runner Agent Runtime은 최종 `AgentTrace`를 TRACE artifact와 별도 trace callback으로 전달한다.

```http
POST /internal/runner/runs/{runId}/agent-traces
X-Event-Id: evt_agent_trace_001
X-Worker-Id: runner_001
X-Signature: hmac-sha256=...
```

Payload shape is `AgentTraceRequest` in `packages/contracts/internal/runner-callback.schema.json`; `trace` uses `packages/contracts/schemas/agent-trace.schema.json`.

## 9. RabbitMQ

RabbitMQ는 작업 분배용이다.  
Canonical MQ contract는 `packages/contracts/mq/messages.schema.json`의 envelope다. `mq/*.request.schema.json` 개별 파일은 이 envelope의 payload `$defs`를 참조하는 얇은 작업별 entrypoint다.

Run execution message는 Spring이 고정한 `scenarioTemplateVersionId`와 materialized `scenarioPlan`을 포함한다. MVP Analyzer message는 Spring이 저장한 EvidencePacket snapshot을 가리키는 `evidencePacketId`를 포함하고, Analyzer는 내부 API `/internal/analysis/evidence-packets/{evidencePacketId}`로 packet을 조회한다.

Runner Agent Runtime contract-first 구현 범위에는 `agent.execute.request` 별도 MQ message가 포함된다. 이 메시지는 `ScenarioPlan`을 확장하지 않고 `AgentTask`를 전달하며, Runner는 AgentTrace를 TRACE artifact와 agent callback으로 남긴다. Machine-readable agent callback payloads are defined in `packages/contracts/internal/runner-callback.schema.json`. 상세 contract-first 계획은 `docs/runner_agent_runtime_implementation_plan.md`를 기준으로 한다.

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
agent.execute.request      # contract-first payload: AgentTask
discovery.execute.request  # payload: discoveryId + url + devicePreset + viewport + maxDurationMs + maxScrollCount
discovery.evaluate.request # payload: discoveryId + evidencePacketRef
analysis.request           # MVP payload: evidencePacketId + analysisType(PRIMARY/REPROCESS/COMPARE)
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
discovery_status_changed
discovery_checkpoint_created
scenario_recommendations_ready
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
브라우저 원격 조종기는 아니다. MCP는 Discovery, ScenarioAuthoring, Run, Report 같은 Wedge API 경계를 호출할 수 있지만 Playwright page를 직접 조작하거나 브라우저 세션을 원격 제어하지 않는다.

허용 tool:

V1 필수 read-only tool:

```text
get_run_status
get_run_summary
list_run_events
get_latest_snapshot
get_step_evidence
get_evidence_packet
get_discovery_result
list_scenario_authoring_jobs
get_scenario_authoring_job
get_report
list_reports
```

V1 선택 execute/export tool. client policy와 OAuth scope가 허용할 때만 활성화한다. ScenarioAuthoring provider는 async job/result tool을 사용하며 browser session을 직접 조작하지 않는다.

```text
discover_site
submit_scenario_authoring_result
create_run_from_discovery
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

Human web users use V1 first-party email/password auth with JWT access/refresh tokens. Password hashes are stored outside `user_account` in `user_credential`.

MCP/agent clients use OAuth-style client identity and scope policy.

Scopes:

| Scope | Meaning |
|---|---|
| `wedge.read` | read run/evidence/report |
| `wedge.execute` | create/start/stop/analyze |
| `wedge.export` | export/share report |
| `wedge.admin` | admin operations |

Project-level access는 JWT claim만 보지 않고 Spring DB에서 검증한다.
