# MCP Sampling Spike Plan

MCP Decision Gateway 구현 전에는 MCP Sampling이 Wedge 목표에 맞게 동작하는지 먼저 검증한다. 이 spike의 목적은 "MCP Server가 LLM을 대체할 수 있는가"가 아니라, "Wedge MCP Server가 연결된 MCP Host / Client의 LLM capability에 판단 요청을 보내고 `AgentDecision` 형태의 응답을 받을 수 있는가"를 확인하는 것이다.

## 1. 검증 질문

이 spike는 다음 질문에 답해야 한다.

```text
1. Spring AI 1.1.5 기반 MCP server가 initialize 과정에서 어떤 protocolVersion을 협상하는가?
2. 연결된 MCP Client / Host가 sampling capability를 선언하는가?
3. Wedge MCP Server 또는 별도 spike server가 sampling/createMessage 요청을 보낼 수 있는가?
4. MCP Host 쪽 LLM이 JSON-only AgentDecision 응답을 반환할 수 있는가?
5. Wedge가 반환값을 schema validation / policy validation 대상으로 사용할 수 있는가?
6. sampling 요청과 응답에 full DOM, screenshot base64, token, secret이 포함되지 않도록 제한할 수 있는가?
7. Host가 sampling을 지원하지 않을 때 실패를 typed failure로 구분할 수 있는가?
```

## 2. 최소 성공 흐름

최소 성공 흐름은 실제 Runner와 Playwright 실행을 붙이지 않고, fixture 기반 observation만 사용한다.

```text
MCP Host / Client
  -> Wedge MCP Server 연결
  -> initialize에서 sampling capability 확인
  -> Wedge가 fixture AgentObservation으로 sampling/createMessage 요청
  -> Host 쪽 LLM이 AgentDecision JSON 반환
  -> Wedge가 AgentDecision schema validation 수행
  -> candidateId가 fixture candidate 목록에 존재하는지 검증
```

이 단계에서는 실제 클릭, 이동, 스크롤을 실행하지 않는다. Runner 실행 책임은 이후 `AgentMcpDecisionClient` 단계에서만 연결한다.

## 3. Fixture 입력

Sampling spike 입력은 실제 EvidencePacket 전체가 아니라 decision에 필요한 최소 observation으로 제한한다.

```json
{
  "runId": "fixture-run-id",
  "stepKey": "step_001_goto_start_url",
  "goal": "Find the primary landing page CTA.",
  "startUrl": "https://example.com/",
  "currentUrl": "https://example.com/",
  "allowedActions": ["click", "scroll", "finish"],
  "candidates": [
    {
      "candidateId": "candidate_1",
      "role": "link",
      "text": "Start now",
      "visible": true,
      "risk": "LOW"
    },
    {
      "candidateId": "candidate_2",
      "role": "button",
      "text": "Subscribe",
      "visible": true,
      "risk": "LOW"
    }
  ]
}
```

금지 입력:

```text
full DOM
screenshot base64
raw network payload
cookie / token / credential
arbitrary selector
arbitrary JavaScript
```

## 4. 기대 출력

Sampling 응답은 자연어 설명이 아니라 `AgentDecision` JSON으로 제한한다.

```json
{
  "decisionType": "ACT",
  "tool": "click",
  "candidateId": "candidate_1",
  "reason": "The visible Start now link is the clearest primary CTA candidate.",
  "confidence": 0.82
}
```

허용 action과 candidate는 요청에 포함된 목록 안에서만 선택할 수 있다. 응답이 JSON parse, schema validation, candidate validation, policy validation 중 하나라도 실패하면 실행 가능한 decision으로 취급하지 않는다.

## 5. 성공 기준

```text
Spring AI 1.1.5 MCP runtime protocolVersion 확인 완료
MCP Client / Host sampling capability 확인 완료
sampling/createMessage 요청/응답 round-trip 성공
AgentDecision JSON parse 성공
AgentDecision schema validation 성공
candidateId allow-list 검증 성공
금지 데이터가 sampling request/response에 포함되지 않음
sampling 미지원 Host에서 typed unsupported failure 확인
```

## 6. 실패 시 판단

Sampling spike가 실패하면 실패 원인에 따라 다음처럼 분기한다.

```text
Spring AI server에서 sampling request API 접근 불가
  -> Spring AI MCP SDK 직접 사용 또는 별도 MCP gateway process 검토

연결 대상 Host가 sampling capability 미지원
  -> MCP Tools 기반 read-only 연동은 유지하되, 사용자 LLM decision provider는 해당 Host에서 불가

Host가 sampling은 지원하지만 승인 UX 또는 JSON 출력 제어가 불안정
  -> MCP 모드는 experimental provider로 제한하고 GMS/Gemini provider를 기본 유지

민감정보/대용량 데이터 제한이 어려움
  -> EvidencePacket 전체 전달 금지, AgentObservation projection 계층 선행 구현
```

## 7. 이번 spike 제외 범위

```text
실제 Run 생성
실제 Playwright 실행
Runner AgentMcpDecisionClient 구현
운영 MCP endpoint 공개
OAuth/OIDC resource server 전환
과금/크레딧/결제 기능
```

## 8. Spring AI MCP API 조사 결과

2026-05-08 기준 공식 문서와 현재 Wedge 의존성을 대조한 결과, MCP Sampling spike는 Spring AI `1.1.5` / MCP Java SDK `0.17.0` 조합에서 검증 가능한 범위로 판단한다.

현재 Wedge 의존성:

```text
Spring Boot: 3.5.14
Spring AI BOM: 1.1.5
MCP Java SDK: 0.17.0
MCP server starter: spring-ai-starter-mcp-server-webmvc
MCP server protocol: STREAMABLE
MCP server type: SYNC
```

공식 문서 기준:

```text
Spring AI MCP Server Boot Starter는 WebMVC Streamable-HTTP server를 지원한다.
Spring AI MCP special parameters는 McpSyncRequestContext / McpAsyncRequestContext를 통해 sampling 호출을 지원한다.
Spring AI MCP client annotations는 @McpSampling으로 server의 sampling request를 처리하는 client handler를 지원한다.
MCP 공식 spec은 sampling capability를 client가 initialize 단계에서 선언해야 한다고 정의한다.
MCP 공식 architecture는 Host가 AI/LLM integration과 sampling coordination을 담당하고, Server는 client interface를 통해 sampling을 요청할 수 있다고 정의한다.
```

로컬 SDK에서 확인한 주요 API:

```text
McpSyncServerExchange.getClientCapabilities()
McpSyncServerExchange.createMessage(CreateMessageRequest)
McpAsyncServerExchange.createMessage(CreateMessageRequest)
McpSchema.ClientCapabilities.sampling()
McpSchema.CreateMessageRequest
McpSchema.CreateMessageResult
McpSyncRequestContext.sampleEnabled()
McpSyncRequestContext.sample(...)
McpAsyncRequestContext.sampleEnabled()
McpAsyncRequestContext.sample(...)
@McpSampling(clients = "...")
```

따라서 sampling spike는 다음 두 방식 중 하나로 진행할 수 있다.

```text
권장 1순위:
@McpTool 메서드에 McpSyncRequestContext를 주입받고,
context.sampleEnabled() 확인 후 context.sample(...)로 sampling 요청

대안:
@McpTool 메서드에 McpSyncServerExchange를 주입받고,
exchange.getClientCapabilities().sampling() 확인 후 exchange.createMessage(...) 호출
```

Spike용 MCP Client / Host는 sampling handler가 필요하다. Spring AI 기반 테스트 client를 만든다면 `@McpSampling(clients = "...")` handler로 `CreateMessageRequest`를 받아 fixture `CreateMessageResult`를 반환하게 만들 수 있다.

중요 제약:

```text
sampling은 client capability다. 모든 MCP Host가 지원한다고 가정하면 안 된다.
client initialize 결과에서 sampling capability를 반드시 확인한다.
Stateless MCP server는 roots, elicitation, sampling 같은 bidirectional operation을 지원하지 않는 것으로 취급한다.
Wedge는 현재 STREAMABLE / SYNC 구성이므로 sampling spike 대상은 stateless가 아니라 stateful Streamable-HTTP 연결이다.
```

## 9. Sampling spike 최소 코드 설계

Sampling spike 코드는 운영 기능이 아니라 검증용 코드다. 따라서 실제 Run / Runner / Playwright와 연결하지 않고, MCP server와 MCP client 사이의 sampling round-trip만 확인한다.

### 9.1 Server side

Wedge API Server 안에는 spike 전용 tool을 둔다. 기존 `get_run_status`와 같은 read-only tool과 섞이지 않도록 패키지와 tool name에서 spike 성격을 명확히 드러낸다.

```text
apps/api-server/src/main/java/com/wedge/mcp/spike/
  McpSamplingDecisionSpikeTools.java
  McpSamplingDecisionSpikeService.java
  dto/
    SamplingDecisionSpikeResponse.java
    SpikeAgentDecision.java
    SpikeAgentObservation.java
```

Tool name:

```text
mcp_sampling_decision_spike
```

Tool 책임:

```text
1. McpSyncRequestContext 주입
2. context.sampleEnabled() 확인
3. fixture AgentObservation 생성
4. JSON-only AgentDecision을 요구하는 sampling prompt 생성
5. context.sample(...) 호출
6. CreateMessageResult에서 text content 추출
7. AgentDecision JSON parse
8. schema 수준 검증
9. candidate allow-list 검증
10. 검증 결과를 SamplingDecisionSpikeResponse로 반환
```

예상 tool skeleton:

```java
@Component
@RequiredArgsConstructor
@ConditionalOnProperty(name = "spring.ai.mcp.server.enabled", havingValue = "true")
class McpSamplingDecisionSpikeTools {
    private final McpSamplingDecisionSpikeService service;

    @McpTool(
            name = "mcp_sampling_decision_spike",
            description = "Internal spike tool that verifies MCP client sampling can return an AgentDecision JSON for a fixture observation.",
            annotations = @McpTool.McpAnnotations(
                    title = "MCP Sampling Decision Spike",
                    readOnlyHint = true,
                    destructiveHint = false,
                    idempotentHint = false
            )
    )
    SamplingDecisionSpikeResponse runSamplingDecisionSpike(McpSyncRequestContext context) {
        return service.run(context);
    }
}
```

`idempotentHint=false`로 둔다. DB 상태는 바꾸지 않지만 외부 MCP Host의 LLM sampling을 호출하므로 순수 조회와 동일하게 취급하지 않는다.

Service 핵심 흐름:

```java
SamplingDecisionSpikeResponse run(McpSyncRequestContext context) {
    if (!context.sampleEnabled()) {
        return SamplingDecisionSpikeResponse.unsupported("Client did not declare sampling capability.");
    }

    SpikeAgentObservation observation = SpikeAgentObservation.fixture();
    CreateMessageResult result = context.sample(s -> s
            .systemPrompt("Return only AgentDecision JSON. Do not include markdown.")
            .message(buildDecisionPrompt(observation))
            .temperature(0.0)
            .maxTokens(500)
    );

    String text = extractText(result);
    SpikeAgentDecision decision = parseAndValidate(text, observation.allowedCandidateIds());
    return SamplingDecisionSpikeResponse.success(decision, result.model(), result.stopReason());
}
```

실제 구현 시 `CreateMessageRequest` builder를 직접 쓰는 방식도 허용한다. 다만 1차 spike는 Spring AI special parameter 문서가 권장하는 `McpSyncRequestContext.sample(...)` 흐름을 우선한다.

### 9.2 Client side

sampling을 처리할 MCP Client / Host가 필요하다. 실제 Claude Desktop, Codex류 Host가 sampling을 지원하는지는 별도 검증 대상이다. 안정적인 1차 검증을 위해 Spring AI 기반 테스트 client를 별도 실행 단위로 둔다.

권장 위치:

```text
apps/api-server/src/test/java/com/wedge/mcp/spike/
  McpSamplingSpikeClientFixture.java
```

또는 운영 코드와 완전히 분리하려면:

```text
infra/mcp-sampling-spike-client/
```

테스트 client 책임:

```text
1. Wedge MCP Server에 Streamable-HTTP client로 연결
2. client capabilities에 sampling 선언
3. @McpSampling(clients = "...") handler 등록
4. CreateMessageRequest를 받아 fixture AgentDecision JSON을 CreateMessageResult로 반환
5. mcp_sampling_decision_spike tool 호출
6. response.success=true 확인
```

예상 client sampling handler skeleton:

```java
@Component
class McpSamplingSpikeClientHandlers {
    @McpSampling(clients = "wedge-mcp-server")
    CreateMessageResult handleSampling(CreateMessageRequest request) {
        String decisionJson = """
                {
                  "decisionType": "ACT",
                  "tool": "click",
                  "candidateId": "candidate_1",
                  "reason": "The fixture primary CTA is visible.",
                  "confidence": 0.82
                }
                """;

        return CreateMessageResult.builder()
                .role(Role.ASSISTANT)
                .content(new TextContent(decisionJson))
                .model("fixture-sampling-client")
                .build();
    }
}
```

### 9.3 Response DTO

Spike 응답은 성공/실패를 사람이 읽을 수 있게 하되, 다음 구현 판단에 필요한 값을 구조화해서 반환한다.

```json
{
  "success": true,
  "samplingSupported": true,
  "protocolVersion": "runtime-confirmed-separately",
  "model": "fixture-sampling-client",
  "stopReason": "END_TURN",
  "decision": {
    "decisionType": "ACT",
    "tool": "click",
    "candidateId": "candidate_1",
    "reason": "The fixture primary CTA is visible.",
    "confidence": 0.82
  },
  "validation": {
    "jsonParsed": true,
    "schemaValid": true,
    "candidateAllowed": true
  },
  "errorCode": null,
  "errorMessage": null
}
```

실패 응답 예:

```json
{
  "success": false,
  "samplingSupported": false,
  "decision": null,
  "validation": {
    "jsonParsed": false,
    "schemaValid": false,
    "candidateAllowed": false
  },
  "errorCode": "MCP_SAMPLING_UNSUPPORTED",
  "errorMessage": "Connected MCP client did not declare sampling capability."
}
```

### 9.4 Validation rules

```text
decisionType: ACT | FINISH | WAIT 중 하나
tool: allowedActions 안의 값만 허용
candidateId: fixture candidates 안의 candidateId만 허용
confidence: 0.0 이상 1.0 이하
reason: blank 금지, 최대 길이 제한
raw selector / JavaScript / token-like string 포함 금지
```

### 9.5 구현 커밋 경계

Sampling spike 최소 코드는 다음 커밋 하나로 제한한다.

```text
add: mcp_sampling_decision_spike server tool
add: fixture AgentObservation / AgentDecision DTO
add: parsing and validation service
add: unit tests for unsupported / invalid JSON / invalid candidate / success path
optional: local test client fixture
```

이 커밋에는 다음을 포함하지 않는다.

```text
Runner AgentMcpDecisionClient
RUNNER_AGENT_DECISION_MODE=mcp
실제 Run 기반 EvidencePacket 변환
운영 설정 enable
GMS/Gemini provider 변경
```

## 10. Sampling spike 성공/실패 결론 기준

Sampling spike의 결론은 단순히 "동작했다/안 했다"로 끝내지 않는다. MCP 공식 spec과 Spring AI 1.1.5 공식 API 기준으로, 다음 구현 단계에 진입할 수 있는지 판단해야 한다.

### 10.1 성공 판정

다음 조건을 모두 만족하면 MCP Decision Gateway 구현으로 진행할 수 있다.

```text
1. MCP server가 stateful Streamable-HTTP 세션에서 동작한다.
2. 연결된 MCP Client / Host가 initialize 단계에서 sampling capability를 선언한다.
3. Wedge tool 내부에서 McpSyncRequestContext.sampleEnabled()가 true를 반환한다.
4. Wedge tool이 sampling/createMessage 흐름으로 fixture AgentObservation을 전달한다.
5. MCP Client / Host가 CreateMessageResult를 반환한다.
6. 반환 content에서 AgentDecision JSON을 추출할 수 있다.
7. AgentDecision JSON parse가 성공한다.
8. AgentDecision schema validation이 성공한다.
9. candidateId가 요청 fixture의 candidate allow-list 안에 있다.
10. sampling request/response에 full DOM, screenshot base64, token, secret, raw selector, arbitrary JavaScript가 포함되지 않는다.
11. sampling 미지원 client에서 MCP_SAMPLING_UNSUPPORTED 같은 typed failure를 반환한다.
```

성공 결론:

```text
MCP를 GMS/Gemini provider의 제거가 아니라 대체 선택지(provider option)로 붙일 수 있다.
다음 단계는 Runner Agent Runtime에 mcp decision provider를 추가하는 설계/구현이다.
```

성공 후 다음 작업:

```text
1. packages/contracts 또는 runner 내부에 AgentObservation / AgentDecision 계약 확정
2. api-server에 MCP Decision Gateway service 설계
3. runner에 AgentMcpDecisionClient 추가
4. RUNNER_AGENT_DECISION_MODE=heuristic|llm|mcp 설정 확장
5. MCP decision 결과를 Runner validation / policy / candidate resolution 뒤에만 실행
```

### 10.2 부분 성공 판정

sampling round-trip은 성공하지만 JSON 제어, validation, 보안 제한 중 일부가 실패하면 부분 성공으로 본다.

```text
sampling/createMessage 호출 성공
CreateMessageResult 수신 성공
하지만 JSON-only 출력이 불안정하거나,
candidate allow-list 검증 실패가 잦거나,
불필요한 context가 request/response에 섞이거나,
Host 승인 UX가 자동화 흐름에 부적합함
```

부분 성공 결론:

```text
MCP 모드는 즉시 기본 provider로 두지 않는다.
MCP provider는 experimental 또는 internal-only provider로 제한한다.
GMS/Gemini provider는 기본 경로로 유지한다.
AgentObservation projection과 AgentDecision validator를 먼저 강화한다.
```

부분 성공 후 다음 작업:

```text
1. AgentObservation payload 축소
2. prompt와 output parser 강화
3. validation failure taxonomy 정의
4. MCP Host별 capability matrix 작성
5. fixture test client 기준으로만 mcp provider 실험
```

### 10.3 실패 판정

다음 중 하나라도 핵심 조건에서 막히면 MCP Decision Gateway 구현으로 바로 넘어가지 않는다.

```text
client가 sampling capability를 선언하지 않음
Spring AI server context에서 sampleEnabled()가 항상 false
stateful Streamable-HTTP 세션에서 sampling request를 보낼 수 없음
sampling/createMessage 호출이 SDK 또는 transport 수준에서 실패
Host가 sampling request를 사용자 승인 UX 없이 거부하거나 처리하지 않음
CreateMessageResult에서 안정적으로 text content를 얻을 수 없음
typed failure로 실패 원인을 구분할 수 없음
```

실패 결론:

```text
MCP Tools 기반 read-only 연동은 유지한다.
MCP만으로 GMS/Gemini 없는 Runner decision provider를 구현한다는 가정은 보류한다.
사용자 LLM 판단 구조는 별도 local bridge, desktop app, user-hosted agent connector, 또는 Wedge가 MCP client가 되는 구조를 재검토한다.
```

실패 후 다음 작업:

```text
1. 실패 원인을 client capability / Spring AI API / transport / Host UX / validation 중 하나로 분류
2. read-only MCP Server 범위를 계속 안정화
3. 사용자 LLM 연동은 MCP Host 중심인지, Wedge outbound MCP client 중심인지 재설계
4. GMS/Gemini provider를 계속 기본 provider로 유지
```

### 10.4 결론 기록 형식

Spike 실행 후 결과는 문서 또는 별도 ADR에 다음 형식으로 남긴다.

```text
Decision:
  SUCCESS | PARTIAL_SUCCESS | FAILURE

Environment:
  Spring Boot:
  Spring AI:
  MCP Java SDK:
  MCP protocolVersion:
  Transport:
  Server type:
  Client / Host:

Observed capabilities:
  sampling:
  sampling.tools:
  sampling.context:

Round-trip result:
  sampleEnabled:
  createMessage:
  responseContentType:
  jsonParsed:
  schemaValid:
  candidateAllowed:
  typedFailureOnUnsupported:

Security check:
  noFullDom:
  noScreenshotBase64:
  noTokenOrSecret:
  noRawSelector:
  noArbitraryJavaScript:

Next action:
  proceedToMcpProvider | keepReadOnlyOnly | redesignBridge | keepExperimental
```

### 10.5 로컬 Inspector 검증 결과

검증 일시: 2026-05-08

```text
Decision:
  SUCCESS

Environment:
  Spring Boot: 3.5.14
  Spring AI: 1.1.5
  MCP Java SDK: 0.17.0
  MCP protocolVersion: 2025-06-18
  Transport: Streamable HTTP
  Server type: Spring AI MCP Server WebMVC
  Client / Host: MCP Inspector v0.21.2

Observed capabilities:
  sampling: true
  sampling.tools: mcp_sampling_decision_spike
  sampling.context: none

Round-trip result:
  sampleEnabled: true
  createMessage: success
  responseContentType: text
  jsonParsed: true
  schemaValid: true
  candidateAllowed: true
  typedFailureOnUnsupported: implemented

Security check:
  noFullDom: true
  noScreenshotBase64: true
  noTokenOrSecret: true
  noRawSelector: true
  noArbitraryJavaScript: true

Next action:
  proceedToMcpProvider
```

검증에 사용한 MCP tool 응답:

```json
{
  "success": true,
  "samplingSupported": true,
  "sessionId": "7cd3e2a1-8499-4ed2-a295-f6317570abce",
  "clientName": "inspector-client",
  "model": "stub-model",
  "stopReason": "END_TURN",
  "decision": {
    "decisionType": "ACT",
    "tool": "click",
    "candidateId": "candidate_1",
    "reason": "The fixture primary CTA is visible and should be selected.",
    "confidence": 0.82
  },
  "validation": {
    "jsonParsed": true,
    "schemaValid": true,
    "candidateAllowed": true,
    "safetyValid": true
  },
  "errorCode": null,
  "errorMessage": null
}
```

이번 검증으로 확인한 범위:

```text
MCP Inspector가 Wedge MCP Server에 연결했다.
Authorization: Bearer <WEDGE_MCP_SERVICE_TOKEN> 기반 내부 검증 토큰이 통과했다.
tools/list에서 mcp_sampling_decision_spike tool이 노출됐다.
Wedge MCP Server가 sampling/createMessage 요청을 MCP Host 쪽으로 보냈다.
MCP Inspector가 Sampling approval UI를 통해 assistant text 응답을 반환했다.
Wedge MCP Server가 AgentDecision JSON을 파싱하고 schema / candidate allow-list / safety 검증을 통과시켰다.
```

이번 검증으로 아직 확인하지 않은 범위:

```text
실제 Runner Agent Runtime의 decision provider로 연결하지 않았다.
실제 run observation / evidence / screenshot artifact를 Sampling payload로 넘기지 않았다.
Claude Desktop, Codex, 기타 실제 LLM Host의 자동 Sampling 응답은 검증하지 않았다.
Inspector의 stub-model과 수동 승인 JSON을 사용했다.
운영 공개 인증 모델, OAuth/OIDC, 사용자별 권한 scope는 검증하지 않았다.
```

결론:

```text
MCP Sampling은 Wedge MCP Decision Gateway의 기술적 기반으로 사용할 수 있다.
GMS/Gemini provider를 제거하지 않고, mcp provider를 대체 선택지로 추가하는 다음 구현 단계로 진행한다.
단, 실제 provider 승격 전에는 Runner 계약, payload 축소, Host별 capability matrix, timeout/approval UX 정책을 별도 검증한다.
```

## References

- [MCP Sampling Spec](https://modelcontextprotocol.io/specification/2025-11-25/client/sampling)
- [MCP Architecture](https://modelcontextprotocol.io/specification/2025-11-25/architecture)
- [Spring AI MCP Special Parameters](https://docs.spring.io/spring-ai/reference/api/mcp/mcp-annotations-special-params.html)
- [Spring AI MCP Client Annotations](https://docs.spring.io/spring-ai/reference/api/mcp/mcp-annotations-client.html)
- [Spring AI MCP Server Boot Starter](https://docs.spring.io/spring-ai/reference/api/mcp/mcp-server-boot-starter-docs.html)
