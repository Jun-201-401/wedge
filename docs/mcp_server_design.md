# Wedge MCP Server Design

## 1. 목적

Wedge MCP Server는 Wedge가 특정 AI provider에 고정되지 않고 외부 AI Agent와 연동할 수 있도록 제공하는 공식 adapter다.

현재 Wedge의 AI 연동은 GMS 기반 기능을 포함하지만, 프로젝트 진행 과정에서 GMS, 개인 AI Agent, 외부 Agent 연동 방식은 바뀔 수 있다. 따라서 MCP Server의 제품 관점 1차 목표는 Runner Agent의 판단 provider를 고정하지 않고, GMS/Gemini 모드와 MCP 기반 사용자 LLM 모드를 선택할 수 있는 표준 통로를 마련하는 것이다.

이 목표는 "MCP가 LLM 자체를 대체한다"는 뜻이 아니다. MCP는 판단 모델이 아니라 tool/context protocol이다. Wedge가 목표로 하는 것은 GMS/Gemini 제거가 아니라 다음 provider 선택 구조다.

```text
Provider options:
1. heuristic
   -> LLM 없이 규칙 기반 판단

2. gms / llm
   -> Wedge 운영 측 GMS/Gemini/LLM provider 호출

3. mcp
   -> 사용자 또는 외부 MCP Host가 제공하는 LLM 판단 사용
   -> MCP 모드에서는 운영 측 GMS/Gemini API key를 사용하지 않음
```

목표 형태:

```text
Runner Agent Runtime
  -> selected DecisionProvider
    -> HeuristicDecisionClient
    -> AgentLlmDecisionClient
    -> AgentMcpDecisionClient
  -> AgentDecision
  -> Runner validation / policy / fixed tool execution
```

즉, Wedge는 GMS/Gemini 모드를 유지하면서 MCP Host가 제공하는 외부 AI 판단을 Wedge의 Run / Evidence / Report / Agent Runtime 흐름에 추가 provider로 연결한다.

Wedge에서 MCP는 브라우저 원격 조종기가 아니다. MCP는 Wedge의 기존 기능을 외부 AI Agent가 표준 tool 인터페이스로 호출할 수 있게 하는 기능 호출 계층이다.

```text
External AI Agent
  -> Wedge MCP Server
  -> Spring application service
  -> PostgreSQL / artifact storage / report projection
```

다만 구현 단계는 한 번에 provider 선택 구조 전체로 뛰지 않는다. V1 MCP Server의 1차 구현 목적은 다음으로 제한한다.

```text
Wedge API Server 안에 MCP 표준 통로를 마련하고,
외부 AI Agent가 Wedge의 Run / Evidence / Report 결과를 read-only로 조회할 수 있는 최소 tool surface를 제공한다.
```

MCP 기반 사용자 LLM 판단 구조, 시나리오 추천 자동화, 상태 변경, 실행 시작, 분석 재요청, report export, Agent 분석 결과 write-back은 V1 MCP Server의 필수 범위에서 제외하고 후속 단계에서 다룬다. 이 후속 단계의 중심 개념은 `MCP Decision Gateway`다.

## 2. 공식 기준

이 문서는 2026-05-07 재확인 기준 다음 공식 문서를 근거로 한다. MCP 공식 `latest` specification은 `2025-11-25`다.

| 영역 | 기준 |
|---|---|
| MCP protocol | [Model Context Protocol Specification 2025-11-25](https://modelcontextprotocol.io/specification) |
| MCP architecture | [MCP Architecture](https://modelcontextprotocol.io/specification/2025-11-25/architecture) |
| MCP tools | [MCP Tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools) |
| MCP transport | [MCP Transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports) |
| MCP authorization | [MCP Authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization) |
| MCP sampling | [MCP Sampling](https://modelcontextprotocol.io/specification/2025-11-25/client/sampling) |
| Spring MCP server | [Spring AI MCP Server Boot Starter](https://docs.spring.io/spring-ai/reference/api/mcp/mcp-server-boot-starter-docs.html) |
| Spring MCP client | [Spring AI MCP Client Boot Starter](https://docs.spring.io/spring-ai/reference/api/mcp/mcp-client-boot-starter-docs.html) |
| Spring AI version support | [Spring AI Getting Started](https://docs.spring.io/spring-ai/reference/getting-started.html) |

공식 MCP Tools 기준에서 server는 language model이 호출할 수 있는 tool을 노출한다. 각 tool은 고유한 name, description, inputSchema를 가진다. outputSchema는 구조화된 결과를 제공할 때 사용한다.

MCP tool은 model-controlled 호출이 가능하므로 trust & safety와 security 기준이 필요하다. 공식 Tools 문서는 tool input validation, access control, rate limit, output sanitization, audit log를 보안 고려사항으로 제시한다.

MCP의 표준 transport는 stdio와 Streamable HTTP다. Wedge MCP Server는 외부 AI Agent가 운영 HTTPS endpoint로 접근하는 remote server이므로 Streamable HTTP를 기준으로 한다.

MCP Decision Gateway에서 "GMS/Gemini key 없이 사용자 또는 외부 MCP Host의 LLM 판단을 사용한다"는 목표는 MCP Sampling 공식 흐름을 핵심 검증 대상으로 둔다. Sampling은 MCP server가 client/host 쪽 model capability에 생성을 요청하는 기능이며, 이때 model access, model selection, permission control은 client/host 쪽에 남는다. 따라서 Wedge MCP 모드는 단순 tool 호출만으로 완성되는 것이 아니라, 연결 대상 MCP Host가 Sampling capability와 사용자 승인 UX를 제공하는지 별도 spike로 확인해야 한다.

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

## 6. V1 우선 구현 read-only tool 범위

V1 MCP Server는 read-only tool만 제공한다. 다만 `packages/contracts/mcp/tools.schema.json`의 모든 read tool을 한 번에 구현하지 않고, Run / Evidence / Report 조회에 필요한 tool부터 우선 구현한다.

이 범위는 "Wedge의 최종 MCP 사용 시나리오"가 아니라 "GMS 또는 외부 AI Agent 연동을 나중에 교체/확장할 수 있는 최소 기반"이다. 따라서 tool은 실제 service가 준비된 순서대로 작게 추가하고, 특정 provider나 특정 화면 UX에 종속된 계약은 V1에서 확정하지 않는다.

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

이 목록은 V1 우선 구현 범위다. tool 이름, category, requiredScope, approvalPolicy의 최종 허용 값은 `packages/contracts/mcp/tools.schema.json`이 기준이다. 계약상 read tool의 `approvalPolicy`는 `never` 또는 `on_failure`를 허용할 수 있지만, V1 우선 구현 tool은 상태 변경이 없는 조회 기능이므로 `never`로 시작한다.

## 7. MCP Decision Gateway 목표

MCP Decision Gateway는 Runner Agent Runtime의 decision provider 중 하나다. GMS/Gemini provider를 제거하는 것이 아니라, 사용자가 MCP 모드를 선택했을 때 운영 측 GMS/Gemini API key를 사용하지 않고 외부 AI 판단을 연결하기 위한 후속 목표다.

이 구조에서 MCP Server는 LLM 자체가 아니다. MCP Server는 외부 MCP Host, 사용자 AI Agent, 또는 MCP Sampling을 지원하는 client가 제공하는 LLM 판단을 Wedge의 표준 계약으로 받아들이는 gateway다.

공식 MCP architecture 기준에서 Host는 client connection, permission, user authorization, AI/LLM integration, sampling coordination을 담당한다. Server는 tool/resource/prompt를 제공하고 필요한 경우 client interface를 통해 sampling을 요청할 수 있다. 따라서 Wedge가 MCP 모드에서 운영 측 GMS/Gemini API key를 사용하지 않으려면, Wedge가 LLM을 직접 들고 있는 것이 아니라 MCP Host 또는 client가 제공하는 Sampling capability를 통해 판단 결과를 받아야 한다.

목표 구조:

```text
Runner Agent Runtime
  -> AgentMcpDecisionClient
  -> MCP Decision Gateway
  -> External MCP Host / User AI / Local Agent / MCP Sampling-capable client
  -> AgentDecision JSON 반환
  -> Runner schema validation
  -> policy validation
  -> fixed Playwright tool execution
```

또는 MCP Host가 주도하는 사용 흐름:

```text
User AI Agent / MCP Host
  -> Wedge MCP Server
  -> create/request agent run
  -> get run status
  -> get evidence / trace / report
  -> 사용자에게 결과 설명
```

MCP 모드에서 Wedge가 GMS key를 사용하지 않는다는 말은 Wedge 운영 서버가 Gemini/GMS API를 직접 호출하지 않는다는 뜻이다. `llm` 모드에서는 기존처럼 운영 측 GMS/Gemini provider를 사용할 수 있다. 실제 MCP 모드의 판단 주체는 MCP Host 쪽 LLM, 사용자 로컬 LLM, 또는 외부 Agent다.

허용:

```text
MCP Host가 AgentObservation을 바탕으로 AgentDecision JSON 생성
MCP Server가 Run/Evidence/Report/Trace를 tool로 제공
MCP Server가 판단 결과를 Wedge contract로 정규화
Runner가 모든 판단 결과를 다시 검증하고 실행
```

금지:

```text
MCP Server가 raw Playwright remote control API가 되는 것
MCP tool로 browser_eval_js / raw selector click을 제공하는 것
MCP 판단 결과를 Runner가 검증 없이 실행하는 것
전체 DOM / screenshot base64 / network dump / secret을 그대로 MCP 요청에 싣는 것
MCP Host의 LLM 결과를 최종 성공 판정으로 단독 인정하는 것
```

MCP Decision Gateway의 핵심 계약은 Runner Agent Runtime 문서의 원칙과 동일해야 한다.

```text
LLM decision JSON
  -> schema validation
  -> candidate resolution
  -> policy check
  -> fixed Playwright tool execution
  -> observation
  -> verification
```

따라서 MCP Decision Gateway는 Runner의 실행 책임을 가져오지 않는다. Runner는 최종 실행 책임과 safety policy를 계속 소유한다.

## 8. 사용자 사용 시나리오

MCP 기능 완성 후의 사용자는 크게 두 유형으로 나눈다.

### 사용자 1: Wedge 웹 UI + 운영 측 LLM 사용

사용자 1은 자기 로컬 LLM이나 MCP Host를 준비하지 않고 Wedge 웹 사이트를 통해 서비스를 사용한다.

```text
User Browser
  -> Wedge Web
  -> Wedge API / Runner / Analyzer
  -> 운영 측 GMS/Gemini/LLM provider 호출
  -> Run / Evidence / Report 제공
```

이 경우 LLM 비용은 Wedge 운영 측에서 발생한다. 실제 운영 서비스에서는 다음 정책이 필요하다.

```text
usage monitoring
rate limit
cost protection
abuse prevention
```

다만 SSAFY MVP 범위에서는 과금, 크레딧, 결제, 요금제 기능을 구현하지 않는다. 이 문서의 MCP 작업 범위는 decision provider 선택 구조와 MCP 기반 판단 연결이다.

사용자 경험은 기존 웹 사용 흐름과 동일하게 유지할 수 있다.

### 사용자 2: 개인 MCP Host / 로컬 AI Agent 사용

사용자 2는 Claude Desktop, Claude Code, Codex류 client, 로컬 Agent 앱처럼 MCP Host 또는 MCP Client 역할을 수행할 수 있는 환경을 가진 사용자다.

```text
User MCP Host / Local AI Agent
  -> Wedge MCP Server
  -> Wedge Run / Evidence / Report / Agent tool 호출
  -> 사용자 AI가 판단과 설명 수행
```

이 경우 Wedge 운영 측은 사용자 요청마다 GMS/Gemini API를 직접 호출하지 않는다. 따라서 운영 측 LLM 비용은 사용자 1 흐름보다 낮아질 수 있다.

다만 "사용자가 기존 Wedge 웹 UI를 그대로 쓰면서 자기 로컬 LLM만 Wedge 처리 LLM으로 자동 연결"되는 것은 기본 웹 구조만으로는 성립하지 않는다. 브라우저 웹앱은 보안상 사용자의 로컬 MCP/LLM에 임의로 연결할 수 없다.

웹 UI 중심으로 사용자 로컬 LLM을 쓰려면 다음 중 하나가 추가로 필요하다.

```text
local bridge daemon
desktop app
browser extension
user-hosted MCP Host session
explicit pairing / authorization flow
```

따라서 1차 MCP Decision Gateway 목표는 웹 UI 중심 연동이 아니라 MCP Host 중심 연동으로 제한한다.

```text
1차 권장 흐름:
사용자는 자기 AI client에서 Wedge MCP Server를 연결한다.
사용자는 AI에게 URL 분석을 요청한다.
AI는 Wedge MCP tools를 호출해 run 생성, 상태 조회, evidence 조회, report 조회를 수행한다.
```

웹 UI와 사용자 로컬 LLM을 직접 연결하는 흐름은 별도 제품/보안 설계가 필요한 후속 범위다.

## 9. V1 제외 범위

다음 tool은 V1 우선 구현 범위에서 제외한다.

| Tool | 제외 이유 |
|---|---|
| `get_discovery_result` | Discovery 결과 조회 tool이지만 V1의 첫 목표를 Run / Evidence / Report 조회로 제한하므로 후순위로 둔다. |
| `list_scenario_authoring_jobs` | Agent-assisted scenario recommendation 흐름에 필요한 read tool이므로 scenario authoring 설계와 함께 다룬다. |
| `get_scenario_authoring_job` | Agent-assisted scenario recommendation 흐름에 필요한 read tool이므로 scenario authoring 설계와 함께 다룬다. |
| `discover_site` | Runner 작업을 큐잉하는 상태 변경 tool이다. idempotency, 승인, 비용 제어가 필요하다. |
| `create_run` | Run resource 생성 tool이다. project 권한, quota, idempotency 정책이 필요하다. |
| `create_run_from_discovery` | Discovery 결과와 ScenarioPlan materialization 정책이 필요하다. |
| `start_run` | 실제 브라우저 실행을 시작하므로 human approval과 중복 실행 방지가 필요하다. |
| `stop_run` | 실행 상태를 변경하므로 write scope와 감사 로그가 필요하다. |
| `analyze_run` | Analyzer 작업을 큐잉하므로 상태 변경 tool이다. |
| `generate_nudges` | 분석/제안 생성 방식과 저장 정책이 확정되어야 한다. |
| `export_report` | 파일 생성과 외부 공유 정책이 필요하다. |
| `submit_scenario_authoring_result` | 외부 Agent 결과 write-back tool이므로 별도 검증과 저장 정책이 필요하다. |

후순위 read tool과 V2 execute/write-back tool을 추가할 때는 다음을 먼저 확정한다.

```text
wedge.execute / wedge.export scope
human approval policy
idempotency key
rate limit
tool invocation audit
project-level access check
output sanitization
```

## 10. Tool과 Spring service 매핑

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

## 11. 인증과 권한

MCP endpoint는 public anonymous endpoint가 아니다.

현재 spike 구현에서는 `InternalServiceTokenFilter`가 `/mcp`, `/mcp/**` 요청의 bearer token을 검증한다. `SecurityConfig`의 `/mcp` matcher는 Spring AI Streamable HTTP transport의 async dispatch를 막지 않기 위해 `permitAll`로 둔다. 이 설정은 anonymous 공개를 의미하지 않는다. token 검증은 security authorization 단계가 아니라 MCP 전용 filter 단계에서 수행한다.

V1 최소 정책:

```text
required scope: wedge.read
project access: Spring DB 기준으로 확인
client policy: agent_client_policy 기준으로 allowlist 확인
audit log: mcp_invocation_log 기록
```

MCP Decision Gateway 단계에서는 read scope와 decision scope를 분리한다.

```text
wedge.read: Run / Evidence / Report 조회
wedge.decide: AgentObservation 기반 AgentDecision 생성 또는 수신
wedge.execute: Run 생성/시작 같은 상태 변경 요청
```

`wedge.decide`는 실제 브라우저 실행 권한이 아니다. 판단 결과를 반환하거나 외부 MCP Host의 판단을 Wedge contract로 정규화하는 권한이다. 실제 실행은 Runner가 `AgentDecision`을 검증한 뒤 내부 policy에 따라 수행한다.

MCP Authorization 공식 기준은 OAuth protected resource model을 요구한다. 완전한 OAuth 2.1 authorization server 구성이 MVP 범위를 넘는다면, 운영 공개 전까지 다음 중 하나를 명확히 선택해야 한다.

```text
1. dev/internal only MCP endpoint
2. service token 기반 제한적 검증
3. OAuth/OIDC 기반 정식 MCP resource server
```

운영 공개 기준으로는 3번을 목표로 한다. 1번 또는 2번은 spike와 내부 검증용 임시 단계로만 사용한다.

현재 spike 구현은 2번을 사용한다.

```text
WEDGE_MCP_SERVER_ENABLED=true
WEDGE_MCP_SERVICE_TOKEN=<internal-only-token>
Authorization: Bearer <internal-only-token>
```

이 방식은 MCP endpoint와 tool 동작을 내부에서 검증하기 위한 임시 접근 정책이다. 운영 공개용 정식 인증 모델은 아니며, 외부 공개 전에는 OAuth/OIDC 기반 resource server 또는 그에 준하는 client identity/scope 검증으로 전환해야 한다.

금지:

```text
human web JWT를 MCP client token으로 그대로 재사용
token audience 검증 없이 bearer token 수락
raw SQL tool 제공
browser_click / browser_eval_js 제공
전체 network dump 원문 제공
AgentDecision 검증 없이 실행
```

## 12. 감사 로그

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

## 13. Tool 응답 원칙

MCP tool 응답은 Agent가 이해하기 쉬운 구조화 결과를 제공한다.

원칙:

- input은 JSON Schema로 검증한다.
- output은 structured content로 제공할 수 있게 DTO를 분리한다.
- 대용량 artifact 원문을 직접 반환하지 않는다.
- screenshot은 artifact metadata 또는 content URL/reference로 제공한다.
- DOM/network/console 정보는 EvidencePacket에 포함된 요약 또는 normalized observation 중심으로 제공한다.
- business error는 Agent가 수정/재시도할 수 있는 메시지로 반환한다.
- Decision Gateway 응답은 `AgentDecision` 계약을 따른다.
- Decision Gateway 응답에는 raw selector, arbitrary JavaScript, secret, full DOM 원문을 포함하지 않는다.

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

Decision Gateway 응답 예:

```json
{
  "decisionType": "ACT",
  "tool": "click",
  "candidateId": "candidate_3",
  "reason": "Primary cart or checkout entry candidate is visible.",
  "confidence": 0.82
}
```

이 응답은 MCP Server 또는 외부 MCP Host가 반환할 수 있지만, Runner는 이 결과를 그대로 실행하지 않는다. Runner는 schema validation, candidate resolution, policy check를 통과한 경우에만 fixed Playwright tool을 실행한다.

## 14. MCP Sampling spike

MCP Decision Gateway 구현 전에는 MCP Sampling이 Wedge 목표에 맞게 동작하는지 별도 spike로 검증한다. 이 spike의 목적은 MCP Server가 LLM을 대체하는지 확인하는 것이 아니라, Wedge MCP Server가 연결된 MCP Host / Client의 LLM capability에 판단 요청을 보내고 `AgentDecision` 형태의 응답을 받을 수 있는지 확인하는 것이다.

상세 계획은 [mcp_sampling_spike_plan.md](mcp_sampling_spike_plan.md)를 기준으로 한다.

이 설계 문서에는 결론만 남긴다.

```text
성공:
  MCP를 GMS/Gemini provider의 제거가 아니라 대체 선택지(provider option)로 붙일 수 있다.
  다음 단계는 Runner Agent Runtime에 mcp decision provider를 추가하는 설계/구현이다.

부분 성공:
  sampling round-trip은 가능하지만 JSON 제어, validation, 보안 제한, Host UX가 불안정하다.
  MCP provider는 experimental 또는 internal-only provider로 제한하고 GMS/Gemini provider를 기본 유지한다.

실패:
  MCP Tools 기반 read-only 연동은 유지한다.
  MCP만으로 GMS/Gemini 없는 Runner decision provider를 구현한다는 가정은 보류한다.
  local bridge, desktop app, user-hosted agent connector, 또는 Wedge outbound MCP client 구조를 재검토한다.
```

## 15. 검증 기준

MCP adapter spike는 다음 기준을 통과해야 한다.

```text
Spring Boot 3.5.x upgrade compile 성공
Spring AI MCP WebMVC starter 적용 후 application context 로드 성공
MCP server enable/disable 환경변수 구성
기존 api-server test 통과
기존 /api/auth, /api/runs, /internal/runner 보안 동작 유지
/actuator/health 정상
get_run_status 같은 최소 read-only tool 구현
향후 Run / Evidence / Report / Analysis tool을 추가할 수 있는 패키지 구조 마련
MCP endpoint는 인증/권한 정책 확정 전까지 운영 공개하지 않음
```

MCP client 또는 inspector 기반 `tools/list`, `tools/call` 검증과 `mcp_invocation_log` 기록 확인은 MCP endpoint 접근 정책을 정한 뒤 진행한다.

초기 검증은 dev DB와 seed run을 사용한다. 운영 데이터와 운영 MCP 공개는 별도 보안 검토 후 진행한다.

현재 로컬 검증 결과:

```text
MCP server enabled: true
MCP endpoint: /mcp
MCP access policy: Authorization: Bearer <WEDGE_MCP_SERVICE_TOKEN>
MCP protocol version verified with Spring AI server: 2025-06-18
health: UP
initialize: HTTP 200
tools/list: HTTP 200, get_run_status 확인
tools/call get_run_status: HTTP 200, isError=false
```

위 검증 결과의 `2025-06-18`은 문서 기준 버전이 아니라 현재 Spring AI MCP server와 initialize 과정에서 확인된 runtime protocolVersion이다. 설계 기준은 MCP 공식 latest인 `2025-11-25`로 잡되, 구현 전 Spring AI `1.1.5`가 실제로 협상하는 protocolVersion과 Sampling 지원 범위를 별도 spike로 재확인한다.

검증에 사용한 run:

```text
runId: ed1e0dcc-b595-40d8-914f-d1cb4d69bfdc
name: Real Run E2E Smoke
status: COMPLETED
resultCompleteness: FINAL
analysisStatus: NOT_STARTED
currentStepOrder: 2
```

주의:

```text
mcp_invocation_log 기록은 아직 구현하지 않았다.
OAuth/OIDC 기반 정식 MCP resource server도 아직 구현하지 않았다.
현재 service token 방식은 내부 검증용 spike 정책이다.
```

MCP Decision Gateway 검증 기준은 별도로 둔다.

```text
MCP 공식 latest 2025-11-25 기준과 Spring AI 1.1.5 runtime protocolVersion 재확인
Spring AI MCP client/server에서 Sampling request/response 지원 범위 확인
AgentObservation input schema 정의
AgentDecision output schema 정의
Runner decision provider mode에 mcp 추가
AgentMcpDecisionClient가 MCP Decision Gateway 호출 가능
MCP Host / Client가 LLM 판단을 제공하는 최소 spike 성공
MCP 모드에서 GMS/Gemini key 없이 fixture 기반 decision round-trip 성공
LLM 모드에서는 기존 GMS/Gemini provider 경로 유지
Runner가 MCP decision 결과를 schema/policy/candidate 검증 후 실행
검증 실패 decision은 실행하지 않고 typed failure로 기록
full DOM / screenshot base64 / secret이 request/response/audit log에 저장되지 않음
```

## 16. 단계별 작업 계획

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
10. 사용자 시나리오 기준 MCP tool surface 재정의
11. AgentObservation / AgentDecision 계약 정의
12. MCP 2025-11-25 / Spring AI 1.1.5 protocolVersion 재검증
13. MCP Sampling 지원 범위 spike
14. MCP Decision Gateway spike 설계
15. Runner AgentMcpDecisionClient 설계
16. MCP 모드 fixture decision round-trip 검증
17. LLM 모드와 MCP 모드 선택 설정 검증
18. V2 execute/write-back tool 설계
```

## 17. 최종 판단

Wedge MCP Server는 `api-server` 내부 adapter로 시작한다.

제품 관점의 1차 목표는 Runner Agent 판단 provider를 선택 가능하게 만드는 것이다. GMS/Gemini provider는 유지하고, MCP provider를 추가해 외부 MCP Host 또는 사용자 AI Agent의 LLM 판단을 Wedge 흐름에 연결한다. 다만 구현 순서는 read-only MCP adapter를 먼저 안정화하고, 그 다음 MCP Decision Gateway로 확장한다.

V1의 정석 범위는 MCP 사용 환경 마련과 최소 read-only tool surface다. 외부 AI Agent가 Wedge의 Run, Evidence, Report를 읽고 해석할 수 있게 하는 것이 우선이다.

V2의 핵심은 `MCP Decision Gateway`다. 이 단계에서는 `heuristic`, `llm`, `mcp` decision provider를 명확히 분리한다. `llm` 모드는 기존 GMS/Gemini provider를 유지하고, `mcp` 모드는 MCP Host가 제공하는 외부 AI 판단을 `AgentDecision` 계약으로 받아 Runner가 검증 후 실행한다.

Run 생성/시작/분석 요청/write-back은 보안과 승인 정책을 확정한 뒤 V2 execute/write-back tool로 추가한다. 이때도 MCP Server는 브라우저 원격 조종기가 아니며, Runner의 policy와 fixed tool execution 경계를 침범하지 않는다.

Spring AI 1.1.5와 MCP 2025-11-25 기준을 따르기 위해 Spring Boot는 3.5.x latest patch로 upgrade spike를 진행한다. 이 선택은 안정성, 지원 범위, 최신 공식 문서 정합성을 함께 고려한 기준이다.

