---
title: Wedge API Specification
document_type: api-spec
status: draft-v1
version: 1.0
last_updated: 2026-04-17
intended_use:
  - team_share
  - ai_tasking
  - implementation_reference
related_documents:
  - wedge_technical_architecture.md
---

# 1. 문서 목적

본 문서는 Wedge V1의 API 명세 문서다.  
대상은 아래와 같다.

- 프론트엔드 개발자
- Spring API Server 개발자
- Node Runner 개발자
- FastAPI Analyzer 개발자
- MCP tool 구현자
- AI 에이전트에게 작업을 지시하려는 팀원

이 문서는 아래를 정의한다.

1. 외부 공개 REST API
2. 내부 Runner callback API
3. 내부 Analyzer callback API
4. WebSocket 이벤트 계약
5. MCP tool 계약
6. 공통 응답 형식, 오류 형식, 인증/인가 규칙

---

# 2. API 설계 원칙

## API-001. 외부 API와 내부 API를 구분한다

- `/api/**` : 사용자/Web/MCP가 사용하는 제품 API
- `/internal/**` : Runner, Analyzer 같은 내부 서비스가 사용하는 callback/API

## API-002. 상태 변경은 비동기 작업으로 다룬다

다음 작업은 즉시 완료되지 않는다.

- run 시작
- run 중지
- 분석 요청
- 리포트 export

따라서 위 API는 일반적으로 `202 Accepted`를 반환하고, 실제 결과는 상태 조회 또는 WebSocket 이벤트를 통해 확인한다.

## API-003. API는 “도메인 동작”을 노출한다

외부 공개 API는 브라우저 제어 API가 아니다.  
사용자는 run, analysis, report 같은 도메인 개념을 통해 시스템을 사용한다.

## API-004. 상태는 서버 기준으로 해석한다

클라이언트는 API 응답과 WebSocket 이벤트를 참고하되,  
최종 상태 판단은 `GET /api/runs/{runId}` 응답을 기준으로 한다.

## API-005. 모든 상태 변경 POST는 idempotency를 고려한다

중복 요청 방지를 위해 아래 엔드포인트에는 `Idempotency-Key` 사용을 권장한다.

- `POST /api/runs`
- `POST /api/runs/{runId}/start`
- `POST /api/runs/{runId}/stop`
- `POST /api/runs/{runId}/analysis-jobs`
- `POST /api/runs/{runId}/reports`

## API-006. 공개 API는 `/api`를 사용하고 URI version은 두지 않는다

- 공개 제품 API base path는 `/api`
- 내부 callback API base path는 `/internal`
- WebSocket base path는 `/ws`
- MCP endpoint는 `/mcp`

버전 관리는 URI가 아니라 문서, OpenAPI, 릴리즈 노트, 계약 변경 절차로 관리한다.


---

# 3. 공통 규칙

## 3.1 Base URL

### 외부 API
```text
/api
```

### 내부 API
```text
/internal
```

### WebSocket
```text
/ws
```

### MCP
Spring 내 Remote MCP endpoint를 별도로 운영한다.  
MCP tool 계약은 본 문서 14장을 따른다.

## 3.2 데이터 형식

- Content-Type: `application/json`
- 시간: RFC 3339 UTC (`2026-04-17T12:00:00Z`)
- ID: UUID 문자열
- 금액/점수/확신도: 명시적 숫자형
- enum: 문자열

## 3.3 인증

### 외부 API
- `Authorization: Bearer <token>`

### 내부 API
- 내부 서비스 bearer token
- `X-Signature`
- `X-Event-Id`
- 필요 시 source allowlist 또는 mTLS

## 3.4 공통 헤더

### 권장 공통 요청 헤더
- `Authorization`
- `X-Correlation-Id`
- `Idempotency-Key` (상태 변경 POST에 권장)

### 내부 API 전용 헤더
- `X-Worker-Id`
- `X-Analyzer-Id`
- `X-Event-Id`
- `X-Signature`

---

# 4. 공통 응답 형식

## 4.1 성공 응답

### 단일 리소스
```json
{
  "data": {
    "id": "uuid",
    "type": "run"
  },
  "meta": {
    "requestId": "uuid"
  }
}
```

### 목록 응답
```json
{
  "data": [
    {
      "id": "uuid",
      "type": "run"
    }
  ],
  "meta": {
    "requestId": "uuid",
    "nextCursor": "opaque-cursor-or-null"
  }
}
```

## 4.2 오류 응답

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
    "requestId": "uuid"
  }
}
```

## 4.3 표준 오류 코드

| HTTP | code | 의미 |
|---|---|---|
| 400 | `validation_error` | 필수 필드 누락, 형식 오류 |
| 401 | `unauthorized` | 인증 실패 |
| 403 | `forbidden` | 권한 없음 |
| 404 | `not_found` | 리소스 없음 |
| 409 | `state_conflict` | 현재 상태에서 허용되지 않는 작업 |
| 422 | `unprocessable_request` | 의미적으로 처리 불가 |
| 429 | `rate_limited` | 요청 제한 |
| 500 | `internal_error` | 서버 내부 오류 |

---

# 5. 공통 모델

## 5.1 Run 상태 모델

### `status`
- `CREATED`
- `QUEUED`
- `STARTING`
- `RUNNING`
- `STOP_REQUESTED`
- `STOPPED`
- `ANALYZING`
- `COMPLETED`
- `FAILED`

### `resultCompleteness`
- `NONE`
- `PARTIAL`
- `FINAL`

### `analysisStatus`
- `NOT_STARTED`
- `QUEUED`
- `RUNNING`
- `COMPLETED`
- `FAILED`

## 5.2 Step 상태 모델

- `PENDING`
- `RUNNING`
- `PASSED`
- `FAILED`
- `SKIPPED`
- `BLOCKED`
- `STOPPED`

---

# 6. 인증 및 권한

## 6.1 Scope

- `wedge.read`
- `wedge.execute`
- `wedge.export`
- `wedge.admin`

## 6.2 Endpoint와 Scope 매핑 원칙

- 조회: `wedge.read`
- 실행/중지/분석: `wedge.execute`
- 리포트 export: `wedge.export`
- 삭제/강제중지/민감정보 조회: `wedge.admin`

## 6.3 승인(approval) 정책 원칙

- `read` 계열: 자동 또는 최소 승인
- `execute` 계열: 승인 필요
- `export` 계열: 승인 필요
- `admin` 계열: 강한 승인 필요

---

# 7. 외부 공개 REST API

## 7.1 Project API

### `GET /api/projects`
프로젝트 목록 조회

#### Scope
- `wedge.read`

#### Query
- `cursor` (optional)
- `limit` (optional, default 20, max 100)
- `workspaceId` (optional)

#### Response 예시
```json
{
  "data": [
    {
      "id": "project-uuid",
      "type": "project",
      "name": "Acme Landing",
      "baseUrl": "https://example.com",
      "workspaceId": "workspace-uuid",
      "status": "ACTIVE",
      "createdAt": "2026-04-17T12:00:00Z"
    }
  ],
  "meta": {
    "requestId": "req-uuid",
    "nextCursor": null
  }
}
```

### `POST /api/projects`
프로젝트 생성

#### Scope
- `wedge.execute`

#### Request
```json
{
  "name": "Acme Landing",
  "baseUrl": "https://example.com",
  "workspaceId": "workspace-uuid"
}
```

### `GET /api/projects/{projectId}`
프로젝트 상세 조회

#### Scope
- `wedge.read`

### `PATCH /api/projects/{projectId}`
프로젝트 수정

#### Scope
- `wedge.execute`

---

## 7.2 Scenario Template API

### `GET /api/scenario-templates`
시나리오 템플릿 목록 조회

#### Scope
- `wedge.read`

#### Query
- `status`
- `cursor`
- `limit`

### `GET /api/scenario-templates/{templateId}`
시나리오 템플릿 상세 조회

#### Scope
- `wedge.read`

### `GET /api/scenario-templates/{templateId}/versions/{versionId}`
시나리오 템플릿 버전 조회

#### Scope
- `wedge.read`

---

## 7.3 Run API

### `POST /api/runs`
run 생성

#### Scope
- `wedge.execute`

#### Headers
- `Idempotency-Key` 권장

#### Request
```json
{
  "projectId": "project-uuid",
  "name": "landing-signup-check-2026-04-17",
  "startUrl": "https://example.com",
  "goal": "무료 체험 시작 CTA 점검",
  "devicePreset": "desktop",
  "scenarioTemplateVersionId": "scenario-version-uuid",
  "scenarioOverrides": {
    "preferredCtaText": "무료 체험 시작",
    "inputValues": {
      "email": "qa+test@example.com"
    }
  }
}
```

#### Response (`201 Created`)
```json
{
  "data": {
    "id": "run-uuid",
    "type": "run",
    "projectId": "project-uuid",
    "name": "landing-signup-check-2026-04-17",
    "status": "CREATED",
    "resultCompleteness": "NONE",
    "analysisStatus": "NOT_STARTED",
    "createdAt": "2026-04-17T12:00:00Z"
  },
  "meta": {
    "requestId": "req-uuid"
  }
}
```

### `GET /api/runs`
run 목록 조회

#### Scope
- `wedge.read`

#### Query
- `projectId`
- `status`
- `analysisStatus`
- `createdFrom`
- `createdTo`
- `cursor`
- `limit`

### `GET /api/runs/{runId}`
run 상세 조회

#### Scope
- `wedge.read`

#### Response 예시
```json
{
  "data": {
    "id": "run-uuid",
    "type": "run",
    "projectId": "project-uuid",
    "name": "landing-signup-check-2026-04-17",
    "triggerSource": "WEB",
    "startUrl": "https://example.com",
    "goal": "무료 체험 시작 CTA 점검",
    "devicePreset": "desktop",
    "status": "RUNNING",
    "resultCompleteness": "PARTIAL",
    "analysisStatus": "NOT_STARTED",
    "currentStepOrder": 3,
    "startedAt": "2026-04-17T12:01:00Z",
    "finishedAt": null,
    "failureCode": null,
    "failureMessage": null,
    "latestSnapshot": {
      "artifactId": "artifact-uuid",
      "url": "https://cdn.example.com/path/frame.webp",
      "capturedAt": "2026-04-17T12:01:10Z"
    }
  },
  "meta": {
    "requestId": "req-uuid"
  }
}
```

### `POST /api/runs/{runId}/start`
run 실행 시작

#### Scope
- `wedge.execute`

#### Headers
- `Idempotency-Key` 권장

#### Response (`202 Accepted`)
```json
{
  "data": {
    "runId": "run-uuid",
    "status": "QUEUED"
  },
  "meta": {
    "requestId": "req-uuid"
  }
}
```

### `POST /api/runs/{runId}/stop`
run 중지 요청

#### Scope
- `wedge.execute`

#### Headers
- `Idempotency-Key` 권장

#### Request
```json
{
  "reason": "user_requested_stop"
}
```

#### Response (`202 Accepted`)
```json
{
  "data": {
    "runId": "run-uuid",
    "status": "STOP_REQUESTED"
  },
  "meta": {
    "requestId": "req-uuid"
  }
}
```

### `DELETE /api/runs/{runId}`
run 삭제

#### Scope
- `wedge.admin`

#### 비고
초기 V1에서는 soft delete를 권장한다.

---

## 7.4 Live / Step / Event / Artifact API

### `GET /api/runs/{runId}/live`
현재 실행 상태 및 최신 프레임 조회

#### Scope
- `wedge.read`

#### Response 예시
```json
{
  "data": {
    "runId": "run-uuid",
    "status": "RUNNING",
    "currentStepOrder": 3,
    "currentAction": "CLICK",
    "latestFrame": {
      "artifactId": "artifact-uuid",
      "url": "https://cdn.example.com/frame.webp",
      "capturedAt": "2026-04-17T12:01:10Z"
    }
  },
  "meta": {
    "requestId": "req-uuid"
  }
}
```

### `GET /api/runs/{runId}/steps`
step 목록 조회

#### Scope
- `wedge.read`

### `GET /api/runs/{runId}/steps/{stepId}`
step 상세 조회

#### Scope
- `wedge.read`

#### Response 예시
```json
{
  "data": {
    "id": "step-uuid",
    "runId": "run-uuid",
    "stepOrder": 3,
    "stepKey": "cta-click",
    "stepName": "무료 체험 시작 CTA 클릭",
    "stepType": "CLICK",
    "status": "RUNNING",
    "target": {
      "text": "무료 체험 시작",
      "selectorHint": "button[data-test='start-trial']"
    },
    "input": null,
    "output": null,
    "startedAt": "2026-04-17T12:01:05Z",
    "finishedAt": null,
    "errorCode": null,
    "errorMessage": null
  },
  "meta": {
    "requestId": "req-uuid"
  }
}
```

### `GET /api/runs/{runId}/events`
run 이벤트 목록 조회

#### Scope
- `wedge.read`

#### Query
- `cursor`
- `limit`
- `stepId`
- `eventType`

### `GET /api/runs/{runId}/artifacts`
artifact 목록 조회

#### Scope
- `wedge.read`

#### Query
- `type`
- `stepId`
- `cursor`
- `limit`

### `GET /api/runs/{runId}/signals`
issue signal 목록 조회

#### Scope
- `wedge.read`

#### Query
- `category`
- `source`
- `stepId`
- `cursor`
- `limit`

---

## 7.5 Analysis API

### `POST /api/runs/{runId}/analysis-jobs`
분석 작업 생성

#### Scope
- `wedge.execute`

#### Headers
- `Idempotency-Key` 권장

#### Request
```json
{
  "analysisType": "PRIMARY",
  "forceRebuildEvidenceBundle": false,
  "reason": "manual_reanalysis"
}
```

#### Response (`202 Accepted`)
```json
{
  "data": {
    "analysisJobId": "analysis-job-uuid",
    "runId": "run-uuid",
    "status": "QUEUED"
  },
  "meta": {
    "requestId": "req-uuid"
  }
}
```

### `GET /api/runs/{runId}/analysis-jobs`
run에 연결된 분석 작업 목록 조회

#### Scope
- `wedge.read`

### `GET /api/analysis-jobs/{analysisJobId}`
분석 작업 상세 조회

#### Scope
- `wedge.read`

#### Response 예시
```json
{
  "data": {
    "id": "analysis-job-uuid",
    "runId": "run-uuid",
    "analysisType": "PRIMARY",
    "status": "COMPLETED",
    "analyzerVersion": "analyzer-1.0.0",
    "promptVersion": "prompt-2026-04-17",
    "modelInfo": {
      "llm": "internal-model-x",
      "attentionModel": "deepgaze-vx"
    },
    "topFindings": [
      {
        "category": "CTA_VISIBILITY",
        "title": "CTA가 첫 화면에서 경쟁 요소에 가려짐",
        "confidence": 0.84
      }
    ],
    "createdAt": "2026-04-17T12:02:00Z",
    "finishedAt": "2026-04-17T12:02:20Z"
  },
  "meta": {
    "requestId": "req-uuid"
  }
}
```

---

## 7.6 Report API

### `POST /api/runs/{runId}/reports`
리포트 export 작업 생성

#### Scope
- `wedge.export`

#### Headers
- `Idempotency-Key` 권장

#### Request
```json
{
  "format": "PDF",
  "analysisJobId": "analysis-job-uuid"
}
```

#### Response (`202 Accepted`)
```json
{
  "data": {
    "reportId": "report-uuid",
    "runId": "run-uuid",
    "status": "QUEUED",
    "format": "PDF"
  },
  "meta": {
    "requestId": "req-uuid"
  }
}
```

### `GET /api/runs/{runId}/reports`
리포트 목록 조회

#### Scope
- `wedge.read`

### `GET /api/reports/{reportId}`
리포트 상세 조회

#### Scope
- `wedge.read`

#### Response 예시
```json
{
  "data": {
    "id": "report-uuid",
    "runId": "run-uuid",
    "analysisJobId": "analysis-job-uuid",
    "format": "PDF",
    "status": "COMPLETED",
    "downloadUrl": "https://cdn.example.com/reports/report.pdf",
    "createdAt": "2026-04-17T12:03:00Z"
  },
  "meta": {
    "requestId": "req-uuid"
  }
}
```

---

# 8. 내부 Runner Callback API

## 8.1 개요

Runner는 DB를 직접 변경하지 않는다.  
Runner는 내부 callback API로 상태와 evidence를 제출한다.

## 8.2 공통 규칙

### Headers
- `Authorization: Bearer <internal-token>`
- `X-Worker-Id`
- `X-Event-Id`
- `X-Signature`
- `X-Correlation-Id`

### 처리 원칙
- `X-Event-Id` 기준 idempotent 처리
- 동일 callback 재전송 가능
- signature 검증 실패 시 `401` 또는 `403`

---

## 8.3 `POST /internal/runner/runs/{runId}/accepted`

Runner가 run을 수락했음을 알린다.

### Request
```json
{
  "workerId": "runner-01",
  "acceptedAt": "2026-04-17T12:00:05Z",
  "browserSessionId": "session-uuid"
}
```

### Response
```json
{
  "data": {
    "runId": "run-uuid",
    "status": "STARTING"
  },
  "meta": {
    "requestId": "req-uuid"
  }
}
```

---

## 8.4 `POST /internal/runner/runs/{runId}/step-events`

Runner가 step 이벤트를 제출한다.

### Request
```json
{
  "events": [
    {
      "eventId": "event-uuid",
      "stepOrder": 3,
      "stepId": "step-uuid",
      "eventType": "STEP_STARTED",
      "occurredAt": "2026-04-17T12:01:05Z",
      "payload": {
        "stepKey": "cta-click",
        "stepType": "CLICK",
        "targetText": "무료 체험 시작"
      }
    },
    {
      "eventId": "event-uuid-2",
      "stepOrder": 3,
      "stepId": "step-uuid",
      "eventType": "ACTION_EXECUTED",
      "occurredAt": "2026-04-17T12:01:08Z",
      "payload": {
        "result": "SUCCESS"
      }
    }
  ]
}
```

### Event Type 예시
- `STEP_STARTED`
- `ACTION_EXECUTED`
- `STEP_COMPLETED`
- `CONSOLE_ERROR`
- `NETWORK_ERROR`
- `ISSUE_SIGNAL_DETECTED`

---

## 8.5 `POST /internal/runner/runs/{runId}/artifacts`

Runner가 artifact 메타데이터를 제출한다.

### Request
```json
{
  "artifacts": [
    {
      "artifactId": "artifact-uuid",
      "stepId": "step-uuid",
      "artifactType": "FRAME",
      "bucket": "wedge-artifacts",
      "key": "runs/run-uuid/frame-001.webp",
      "mimeType": "image/webp",
      "width": 1440,
      "height": 900,
      "sizeBytes": 93210,
      "sha256": "hex",
      "createdAt": "2026-04-17T12:01:10Z"
    }
  ]
}
```

---

## 8.6 `POST /internal/runner/runs/{runId}/finished`

실행 종료를 알린다.

### Request
```json
{
  "workerId": "runner-01",
  "executionFinishedAt": "2026-04-17T12:02:00Z",
  "summary": {
    "completedStepCount": 5,
    "failedStepCount": 0,
    "stopped": false
  }
}
```

### Response
```json
{
  "data": {
    "runId": "run-uuid",
    "status": "ANALYZING",
    "analysisStatus": "QUEUED"
  },
  "meta": {
    "requestId": "req-uuid"
  }
}
```

---

## 8.7 `POST /internal/runner/runs/{runId}/failed`

실행 실패를 알린다.

### Request
```json
{
  "workerId": "runner-01",
  "failedAt": "2026-04-17T12:01:30Z",
  "failureCode": "BROWSER_CRASH",
  "failureMessage": "Browser unexpectedly closed.",
  "resultCompleteness": "PARTIAL"
}
```

---

# 9. 내부 Analyzer Callback API

## 9.1 개요

Analyzer는 분석 결과를 내부 callback으로 제출한다.

## 9.2 공통 헤더

- `Authorization: Bearer <internal-token>`
- `X-Analyzer-Id`
- `X-Event-Id`
- `X-Signature`
- `X-Correlation-Id`

---

## 9.3 `POST /internal/analysis/jobs/{analysisJobId}/completed`

분석 완료 제출

### Request
```json
{
  "analysisJobId": "analysis-job-uuid",
  "runId": "run-uuid",
  "analyzerVersion": "analyzer-1.0.0",
  "promptVersion": "prompt-2026-04-17",
  "modelInfo": {
    "llm": "internal-model-x",
    "attentionModel": "deepgaze-vx",
    "ctrModel": "fuxi-ctr-v1"
  },
  "topFindings": [
    {
      "rank": 1,
      "category": "CTA_VISIBILITY",
      "title": "CTA가 첫 화면에서 약하게 보임",
      "description": "CTA 위 경쟁 요소가 2개 존재함",
      "confidence": 0.84,
      "impact": "HIGH",
      "evidenceRefs": [
        {
          "type": "artifact",
          "id": "artifact-uuid"
        }
      ]
    }
  ],
  "nudges": [
    {
      "title": "주 CTA 대비를 강화",
      "rationale": "시인성 경쟁을 줄여 클릭 가능성을 높임",
      "difficulty": "LOW",
      "expectedEffect": "CTR 증가 가설",
      "priority": "P1",
      "followUpQuestion": "현재 CTA 문구 A/B 테스트가 가능한가?"
    }
  ],
  "completedAt": "2026-04-17T12:02:20Z"
}
```

---

## 9.4 `POST /internal/analysis/jobs/{analysisJobId}/failed`

분석 실패 제출

### Request
```json
{
  "analysisJobId": "analysis-job-uuid",
  "runId": "run-uuid",
  "failedAt": "2026-04-17T12:02:20Z",
  "errorCode": "MODEL_TIMEOUT",
  "errorMessage": "LLM analysis timeout."
}
```

---

# 10. WebSocket API

## 10.1 개요

WebSocket은 사용자 UI용 실시간 채널이다.  
최종 상태의 기준은 REST `GET /api/runs/{runId}` 응답이며, WebSocket은 실시간 표시 최적화 채널이다.

## 10.2 연결

```text
GET /ws
Authorization: Bearer <token>
```

## 10.3 채널 개념

권장 채널 키:
- `run:{runId}`

실제 구현은 STOMP, raw WebSocket, socket wrapper 중 하나를 선택할 수 있으나, 이벤트 payload 구조는 아래를 따른다.

## 10.4 공통 이벤트 envelope

```json
{
  "type": "run_status_changed",
  "runId": "run-uuid",
  "timestamp": "2026-04-17T12:01:00Z",
  "payload": {}
}
```

## 10.5 이벤트 타입

### `run_status_changed`
```json
{
  "type": "run_status_changed",
  "runId": "run-uuid",
  "timestamp": "2026-04-17T12:01:00Z",
  "payload": {
    "status": "RUNNING",
    "resultCompleteness": "PARTIAL",
    "analysisStatus": "NOT_STARTED"
  }
}
```

### `step_started`
```json
{
  "type": "step_started",
  "runId": "run-uuid",
  "timestamp": "2026-04-17T12:01:05Z",
  "payload": {
    "stepId": "step-uuid",
    "stepOrder": 3,
    "stepName": "무료 체험 시작 CTA 클릭"
  }
}
```

### `step_finished`
```json
{
  "type": "step_finished",
  "runId": "run-uuid",
  "timestamp": "2026-04-17T12:01:09Z",
  "payload": {
    "stepId": "step-uuid",
    "stepOrder": 3,
    "status": "PASSED"
  }
}
```

### `latest_frame_available`
```json
{
  "type": "latest_frame_available",
  "runId": "run-uuid",
  "timestamp": "2026-04-17T12:01:10Z",
  "payload": {
    "artifactId": "artifact-uuid",
    "url": "https://cdn.example.com/frame.webp",
    "width": 1440,
    "height": 900
  }
}
```

### `issue_signal_detected`
```json
{
  "type": "issue_signal_detected",
  "runId": "run-uuid",
  "timestamp": "2026-04-17T12:01:15Z",
  "payload": {
    "category": "CTA_VISIBILITY",
    "source": "RULE_ENGINE",
    "confidence": 0.71
  }
}
```

### `analysis_started`
### `analysis_finished`

---

# 11. MCP Tool API

## 11.1 목적

MCP는 외부 에이전트가 Wedge를 사용할 수 있게 하는 도구 계약이다.  
도구는 브라우저 제어가 아니라 Wedge 기능을 노출한다.

## 11.2 Tool 목록

### Read
- `get_run_status`
- `get_run_summary`
- `list_run_events`
- `get_latest_snapshot`
- `get_step_evidence`
- `get_report`

### Execute
- `create_run`
- `start_run`
- `stop_run`
- `analyze_run`
- `generate_nudges`

### Export
- `export_report`

### Admin
- `delete_run`
- `force_stop_run`
- `replay_analysis`
- `get_sensitive_logs`

## 11.3 Tool 예시

### `create_run`
#### Input
```json
{
  "projectId": "project-uuid",
  "name": "landing-signup-check-2026-04-17",
  "startUrl": "https://example.com",
  "goal": "무료 체험 시작 CTA 점검",
  "devicePreset": "desktop",
  "scenarioTemplateVersionId": "scenario-version-uuid",
  "scenarioOverrides": {}
}
```

#### Output
```json
{
  "runId": "run-uuid",
  "status": "CREATED"
}
```

### `start_run`
#### Input
```json
{
  "runId": "run-uuid"
}
```

#### Output
```json
{
  "runId": "run-uuid",
  "status": "QUEUED"
}
```

### `get_run_status`
#### Output
```json
{
  "runId": "run-uuid",
  "status": "RUNNING",
  "resultCompleteness": "PARTIAL",
  "analysisStatus": "NOT_STARTED",
  "currentStepOrder": 3
}
```

### `analyze_run`
#### Input
```json
{
  "runId": "run-uuid",
  "analysisType": "PRIMARY"
}
```

#### Output
```json
{
  "analysisJobId": "analysis-job-uuid",
  "status": "QUEUED"
}
```

### `export_report`
#### Input
```json
{
  "runId": "run-uuid",
  "analysisJobId": "analysis-job-uuid",
  "format": "PDF"
}
```

#### Output
```json
{
  "reportId": "report-uuid",
  "status": "QUEUED"
}
```

## 11.4 MCP에서 비추천하는 도구

아래 도구는 기본적으로 노출하지 않는다.

- `click(selector)`
- `type(selector, value)`
- `eval_js(script)`
- `stream_live_browser`

---

# 12. 버전 정책

## 12.1 REST API
- URI versioning 사용: `/api`
- breaking change는 `/api/v2`에서 처리
- non-breaking change는 optional field 추가로 처리

## 12.2 WebSocket
- 이벤트 envelope는 유지
- 새로운 필드는 optional로 추가
- event `type`는 안정적으로 유지

## 12.3 내부 callback
- `packages/contracts/`의 schema version을 따른다
- breaking change 시 runner/analyzer와 함께 version up

## 12.4 MCP tool
- tool name은 stable 유지
- input/output field는 additive change 우선
- breaking change 시 tool suffix 또는 capability version 추가 검토

---

# 13. 구현 우선순위

## 13.1 1차 구현 우선순위
1. Project API
2. Scenario Template 조회 API
3. Run 생성/조회/시작/중지 API
4. Runner callback API
5. Analysis Job API
6. Report API
7. WebSocket 기본 이벤트
8. MCP Read/Execute 핵심 tool

## 13.2 2차 구현 우선순위
1. Admin API
2. replay_analysis
3. sensitive log access
4. export 정책 세분화
5. approval 정책 세밀화

---

# 14. AI 작업 지시용 가이드

이 문서는 AI에게 구체적 작업을 맡길 때 바로 참조할 수 있게 설계되었다.

## 14.1 좋은 지시 예시
- “7.3 `POST /api/runs`를 기준으로 Spring Controller, DTO, Service 메서드를 작성해”
- “8.4 `step-events` callback schema를 기준으로 runner callback consumer를 구현해”
- “10.5 `latest_frame_available` 이벤트를 기준으로 WebSocket publisher 코드를 작성해”
- “11.3 MCP `create_run`/`start_run` tool을 Spring adapter 형태로 구현해”
- “4.2 오류 형식을 모든 ControllerAdvice에 통일해”

## 14.2 Task 태그 권장안
- `[API]`
- `[INTERNAL]`
- `[WS]`
- `[MCP]`
- `[AUTH]`
- `[DB]`
- `[MQ]`

예:
- `[API][DB] run 생성 API와 test_run insert mapper 작성`
- `[INTERNAL][MQ] runner finished callback 처리 후 analysis.request 발행 로직 작성`
- `[MCP][AUTH] create_run tool에 wedge.execute scope 검증 추가`

---

# 15. 최종 권장안 요약

본 API 문서의 최종 권장안은 아래와 같다.

1. 외부 공개 API는 `/api` 아래에서 domain resource 중심으로 설계한다.
2. 장시간 작업(start/stop/analysis/export)은 `202 Accepted` 비동기 패턴으로 처리한다.
3. Runner와 Analyzer는 내부 callback API로만 상태/evidence/result를 제출한다.
4. WebSocket은 실시간 UI 최적화 채널이며, 최종 상태 기준은 REST run 조회 응답이다.
5. MCP는 Wedge 기능 호출기로 설계하며, domain-level tool만 노출한다.
6. 모든 계약은 `packages/contracts/` 아래에 파일로 관리한다.

이 문서는 Wedge V1 구현의 API 기준 문서로 사용한다.
