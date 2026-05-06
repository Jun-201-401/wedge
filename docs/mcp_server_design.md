# Wedge MCP Server Design

## 1. 목적

Wedge MCP Server는 외부 AI Agent가 Wedge의 분석 결과, evidence, report를 안전하게 조회할 수 있도록 제공하는 공식 adapter다.

Wedge에서 MCP는 브라우저 원격 조종기가 아니다. MCP는 Wedge의 기존 기능을 외부 AI Agent가 표준 tool 인터페이스로 호출할 수 있게 하는 기능 호출 계층이다.

```text
External AI Agent
  -> Wedge MCP Server
  -> Spring application service
  -> PostgreSQL / artifact storage / report projection
```

따라서 V1 MCP Server의 1차 목적은 다음으로 제한한다.

```text
외부 AI Agent가 Wedge의 Run / Evidence / Report 결과를 read-only로 조회한다.
```

상태 변경, 실행 시작, 분석 재요청, report export, Agent 분석 결과 write-back은 V1 MCP Server의 필수 범위에서 제외하고 후속 단계에서 다룬다.

## 2. 공식 기준

이 문서는 2026-05-05 기준 다음 공식 문서를 근거로 한다.

| 영역 | 기준 |
|---|---|
| MCP protocol | [Model Context Protocol Specification 2025-11-25](https://modelcontextprotocol.io/specification) |
| MCP tools | [MCP Tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools) |
| MCP transport | [MCP Transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports) |
| MCP authorization | [MCP Authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization) |
| Spring MCP server | [Spring AI MCP Server Boot Starter](https://docs.spring.io/spring-ai/reference/api/mcp/mcp-server-boot-starter-docs.html) |
| Spring AI version support | [Spring AI Getting Started](https://docs.spring.io/spring-ai/reference/getting-started.html) |

공식 MCP Tools 기준에서 server는 language model이 호출할 수 있는 tool을 노출한다. 각 tool은 고유한 name, description, inputSchema를 가진다. outputSchema는 구조화된 결과를 제공할 때 사용한다.

MCP tool은 model-controlled 호출이 가능하므로 trust & safety와 security 기준이 필요하다. 공식 Tools 문서는 tool input validation, access control, rate limit, output sanitization, audit log를 보안 고려사항으로 제시한다.

MCP의 표준 transport는 stdio와 Streamable HTTP다. Wedge MCP Server는 외부 AI Agent가 운영 HTTPS endpoint로 접근하는 remote server이므로 Streamable HTTP를 기준으로 한다.

## 3. Wedge 내부 기준

Wedge의 기준 서버는 Spring API Server다.

```text
apps/api-server
  auth       human user auth / JWT
  discovery  Site Discovery lifecycle
  run        Run lifecycle and status transition
  evidence   checkpoint / artifact / EvidencePacket
  analysis   analysis request and analyzer callback
  report     report summary/detail
```

MCP adapter는 새로운 domain owner가 아니라 기존 application service를 호출하는 adapter다.

```text
REST Controller      -> application service
Internal Callback    -> application service
MCP Tool Adapter     -> application service
```

이 원칙에 따라 MCP adapter는 mapper나 DB를 직접 호출하지 않는다.

```text
Allowed:
MCP tool -> McpToolFacade -> RunService / EvidenceService / ReportQueryService

Not allowed:
MCP tool -> MyBatis Mapper -> DB
```

## 4. 구현 방향

Wedge MCP Server는 `apps/api-server` 내부 adapter로 구현한다.

선택 이유:

- Wedge의 Run, Evidence, Report 기준 데이터와 권한 검증이 이미 `api-server`에 있다.
- MCP는 별도 제품 서버가 아니라 기존 Wedge 기능을 외부 AI Agent에 여는 새 입구다.
- 기존 application service를 재사용하면 상태 전이, project access, error handling 기준이 갈라지지 않는다.
- 별도 `apps/mcp-server`는 REST 재호출, 인증 중복, DTO 변환, 배포 단위 증가가 필요하므로 현재 완성형 기준에서는 우선순위가 낮다.

다만 MCP adapter 내부 구조는 최소한의 경계를 둔다.

```text
com.wedge.mcp
  McpToolFacade
  WedgeReadOnlyMcpTools
  McpAuthorizationService
  McpInvocationLogService
  dto
```

이 구조는 별도 서버 분리를 목표로 한 과설계가 아니라, adapter가 domain/application 내부 구현에 직접 달라붙지 않도록 하기 위한 기본 경계다.

## 5. Spring / MCP 기술 기준

Wedge는 현재 `spring-boot-starter-web` 기반 Spring MVC application이다. 따라서 MCP Server starter는 WebFlux가 아니라 WebMVC starter를 기준으로 한다.

```text
spring-ai-starter-mcp-server-webmvc
spring.ai.mcp.server.protocol=STREAMABLE
spring.ai.mcp.server.type=SYNC
```

판단:

- WebMVC: Wedge가 Spring MVC 기반이다.
- STREAMABLE: remote HTTP MCP server의 최신 표준 transport 방향이다.
- SYNC: V1 read-only tool은 DB 조회와 service 호출 중심이므로 synchronous model로 충분하다.

Spring AI 공식 문서는 Spring Boot `3.4.x`와 `3.5.x` 지원을 명시한다. Wedge는 현재 Spring Boot `3.3.5`이므로 Spring AI MCP starter 도입 전 Spring Boot upgrade spike가 필요하다.

권장 upgrade 방향:

```text
Spring Boot 3.5.x latest patch
Spring AI 1.1.5
```

판단:

- Spring AI 공식 지원 범위 안에 있다.
- Boot 4.x는 변화 폭이 크므로 MCP adapter spike 목적에는 과하다.
- Boot 3.4.x는 변화 폭이 상대적으로 작지만, 2026년 기준으로는 3.5.x가 지원 기간과 최신 patch 측면에서 더 적합하다.
- 안정성은 latest minor가 아니라 latest supported patch를 사용하는 방식으로 확보한다.

## 6. V1 read-only tool 범위

V1 MCP Server는 read-only tool만 제공한다.

| Tool | Category | Scope | Approval | 목적 |
|---|---|---|---|---|
| `get_run_status` | read | `wedge.read` | never | Run 상태와 lifecycle 요약 조회 |
| `get_run_summary` | read | `wedge.read` | never | Run + evidence count + latest checkpoint 요약 조회 |
| `list_run_events` | read | `wedge.read` | never | Run event timeline 조회 |
| `get_latest_snapshot` | read | `wedge.read` | never | 최신 frame/checkpoint snapshot 조회 |
| `get_step_evidence` | read | `wedge.read` | never | 특정 step의 evidence 조회 |
| `get_evidence_packet` | read | `wedge.read` | never | 분석 입력으로 사용할 EvidencePacket 조회 |
| `get_report` | read | `wedge.read` | never | report detail 조회 |
| `list_reports` | read | `wedge.read` | never | Run 또는 project report 목록 조회 |

이 목록은 `packages/contracts/mcp/tools.schema.json`의 read tool 목록과 맞춰 관리한다. tool 이름, category, requiredScope, approvalPolicy는 docs가 아니라 contract가 최종 기준이다.

## 7. V1 제외 범위

다음 tool은 V1 read-only MCP Server에서 제외한다.

| Tool | 제외 이유 |
|---|---|
| `discover_site` | Runner 작업을 큐잉하는 상태 변경 tool이다. idempotency, 승인, 비용 제어가 필요하다. |
| `create_run` | Run resource 생성 tool이다. project 권한, quota, idempotency 정책이 필요하다. |
| `create_run_from_discovery` | Discovery 결과와 ScenarioPlan materialization 정책이 필요하다. |
| `start_run` | 실제 브라우저 실행을 시작하므로 human approval과 중복 실행 방지가 필요하다. |
| `stop_run` | 실행 상태를 변경하므로 write scope와 감사 로그가 필요하다. |
| `analyze_run` | Analyzer 작업을 큐잉하므로 상태 변경 tool이다. |
| `generate_nudges` | 분석/제안 생성 방식과 저장 정책이 확정되어야 한다. |
| `export_report` | 파일 생성과 외부 공유 정책이 필요하다. |
| `submit_scenario_authoring_result` | 외부 Agent 결과 write-back tool이므로 별도 검증과 저장 정책이 필요하다. |

V2에서 execute/write-back tool을 추가할 때는 다음을 먼저 확정한다.

```text
wedge.execute / wedge.export scope
human approval policy
idempotency key
rate limit
tool invocation audit
project-level access check
output sanitization
```

## 8. Tool과 Spring service 매핑

V1 read-only tool은 기존 application service를 재사용한다.

| Tool | Spring service 후보 | 비고 |
|---|---|---|
| `get_run_status` | `RunService.getRun` | 가장 먼저 구현할 spike tool |
| `get_run_summary` | `RunService.getRun`, `EvidenceService.getRunEvidenceSummary` | run 상태와 evidence count 결합 |
| `list_run_events` | 현재 구현 확인 필요 | `RunController.listRunEvents`는 현재 빈 목록 반환 상태로 보임 |
| `get_latest_snapshot` | `EvidenceService.getRunEvidenceSummary` | latest frame/checkpoint 중심 |
| `get_step_evidence` | 현재 구현 확인 필요 | step별 evidence query service가 필요할 수 있음 |
| `get_evidence_packet` | `EvidenceService.getRunEvidencePacket` | Agent 분석 입력으로 가장 중요 |
| `get_report` | `ReportDetailQueryService`, `ReportGenerationService.getRunReport` | reportId/runId 기준을 tool contract에서 확정 필요 |
| `list_reports` | `ReportSummaryQueryService` | runId 기준부터 시작 권장 |

현재 구현이 부족한 tool은 억지로 만들지 않는다. V1 구현 순서는 실제 service가 준비된 것부터 진행한다.

권장 구현 순서:

```text
1. get_run_status
2. get_evidence_packet
3. get_latest_snapshot
4. list_reports
5. get_report
6. get_run_summary
7. list_run_events / get_step_evidence
```

## 9. 인증과 권한

MCP endpoint는 public anonymous endpoint가 아니다.

현재 `SecurityConfig`는 `/mcp/**`를 denyAll로 막고 있다. 이 상태는 MCP 전용 인증/권한이 준비되기 전까지 유지한다.

V1 최소 정책:

```text
required scope: wedge.read
project access: Spring DB 기준으로 확인
client policy: agent_client_policy 기준으로 allowlist 확인
audit log: mcp_invocation_log 기록
```

MCP Authorization 공식 기준은 OAuth protected resource model을 요구한다. 완전한 OAuth 2.1 authorization server 구성이 MVP 범위를 넘는다면, 운영 공개 전까지 다음 중 하나를 명확히 선택해야 한다.

```text
1. dev/internal only MCP endpoint
2. service token 기반 제한적 검증
3. OAuth/OIDC 기반 정식 MCP resource server
```

운영 공개 기준으로는 3번을 목표로 한다. 1번 또는 2번은 spike와 내부 검증용 임시 단계로만 사용한다.

금지:

```text
human web JWT를 MCP client token으로 그대로 재사용
token audience 검증 없이 bearer token 수락
raw SQL tool 제공
browser_click / browser_eval_js 제공
전체 network dump 원문 제공
```

## 10. 감사 로그

모든 MCP tool call은 `mcp_invocation_log`에 기록한다.

기록 대상:

```text
oauth_client_id
user_id
project_id
tool_name
request_summary_jsonb
response_summary_jsonb
status
started_at
finished_at
error_code
error_message
```

request/response summary에는 민감정보와 대용량 payload를 저장하지 않는다.

예:

```text
저장 가능: runId, reportId, evidencePacketId, status, counts
저장 금지: full DOM, screenshot base64, raw network payload, token, secret
```

## 11. Tool 응답 원칙

MCP tool 응답은 Agent가 이해하기 쉬운 구조화 결과를 제공한다.

원칙:

- input은 JSON Schema로 검증한다.
- output은 structured content로 제공할 수 있게 DTO를 분리한다.
- 대용량 artifact 원문을 직접 반환하지 않는다.
- screenshot은 artifact metadata 또는 content URL/reference로 제공한다.
- DOM/network/console 정보는 EvidencePacket에 포함된 요약 또는 normalized observation 중심으로 제공한다.
- business error는 Agent가 수정/재시도할 수 있는 메시지로 반환한다.

예:

```json
{
  "runId": "uuid",
  "status": "COMPLETED",
  "analysisStatus": "COMPLETED",
  "resultCompleteness": "FINAL",
  "currentStepOrder": 3,
  "startedAt": "2026-05-05T10:00:00+09:00",
  "finishedAt": "2026-05-05T10:01:30+09:00"
}
```

## 12. 검증 기준

MCP adapter spike는 다음 기준을 통과해야 한다.

```text
Spring Boot 3.5.x upgrade compile 성공
Spring AI MCP WebMVC starter 적용 후 application context 로드 성공
기존 api-server test 통과
기존 /api/auth, /api/runs, /internal/runner 보안 동작 유지
/actuator/health 정상
MCP tools/list에서 get_run_status 확인
MCP tools/call get_run_status 성공
mcp_invocation_log 기록 확인
```

초기 검증은 dev DB와 seed run을 사용한다. 운영 데이터와 운영 MCP 공개는 별도 보안 검토 후 진행한다.

## 13. 단계별 작업 계획

```text
1. docs/mcp_server_design.md 작성
2. packages/contracts/mcp/tools.schema.json과 V1 read-only 범위 정합성 확인
3. Spring Boot 3.5.x upgrade spike
4. Spring AI MCP WebMVC starter 추가
5. MCP server STREAMABLE / SYNC 설정 추가
6. get_run_status tool 1개 구현
7. MCP client 또는 inspector로 tools/list, tools/call 검증
8. mcp_invocation_log 저장 구현
9. get_evidence_packet, get_latest_snapshot 확장
10. V2 execute/write-back tool 설계
```

## 14. 최종 판단

Wedge MCP Server는 `api-server` 내부 adapter로 시작한다.

V1의 정석 범위는 read-only tool이다. 외부 AI Agent가 Wedge의 evidence와 report를 읽고 해석할 수 있게 하는 것이 우선이며, Run 생성/시작/분석 요청/write-back은 보안과 승인 정책을 확정한 뒤 V2에서 추가한다.

Spring AI 1.1.5와 MCP 2025-11-25 기준을 따르기 위해 Spring Boot는 3.5.x latest patch로 upgrade spike를 진행한다. 이 선택은 안정성, 지원 범위, 최신 공식 문서 정합성을 함께 고려한 기준이다.
