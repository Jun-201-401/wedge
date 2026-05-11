# MCP Pending Decision E2E Verification

## Purpose

This document verifies that Wedge's MCP decision path works end to end without violating the MCP Sampling boundary.

The target flow is:

```text
Runner MCP mode
  -> API Server POST /internal/agent/mcp/pending-decisions
  -> API Server stores a short-lived pending decision
  -> MCP Host calls resolve_mcp_pending_decision
  -> API Server calls sampling/createMessage inside that MCP tool request
  -> API Server validates and stores AgentDecision
  -> Runner polls GET /internal/agent/mcp/pending-decisions/{pendingDecisionId}
  -> Runner parses AgentDecision, applies candidate/policy checks, and continues
```

This is a local/internal verification only. It is not a production enablement step.

## Official Basis

MCP Sampling is a client feature. The server asks the connected MCP Client or Host to create a message, while the client keeps control over model access, model selection, permissions, and user review.

Spring AI exposes sampling from MCP tool handling code through `McpSyncRequestContext`. The context is injected into the tool call, and the safe usage pattern is to check `sampleEnabled()` and call `sample(...)` inside that active MCP request.

Therefore, this E2E must prove that Wedge does not store `McpSyncRequestContext` for later use. The Runner creates only a pending decision. Sampling happens only when the MCP Host invokes `resolve_mcp_pending_decision`.

References:

- [MCP Sampling 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/client/sampling)
- [Spring AI MCP annotation special parameters](https://docs.spring.io/spring-ai/reference/api/mcp/mcp-annotations-special-params.html)

## Preconditions

Use a local or internal environment only.

Required services:

```text
Postgres
Redis
RabbitMQ
API Server
Runner
MCP Inspector or another MCP Host that declares sampling capability
```

Required API Server properties:

```text
WEDGE_MCP_SERVER_ENABLED=true
WEDGE_MCP_SERVICE_TOKEN=<local MCP service token>
INTERNAL_SERVICE_TOKEN=<local internal service token>
WEDGE_MCP_PENDING_DECISION_TTL=PT5M
```

Required Runner properties:

```text
RUNNER_AGENT_DECISION_MODE=mcp
RUNNER_AGENT_MCP_GATEWAY_URL=http://localhost:8080/internal/agent/mcp/decision
RUNNER_AGENT_MCP_SERVICE_TOKEN=<same local internal service token>
RUNNER_AGENT_MCP_GATEWAY_TIMEOUT_MS=180000
```

`RUNNER_AGENT_MCP_GATEWAY_URL` may still point at `/decision`. The Runner transport maps it to `/pending-decisions` internally.

## Fixed Local Fixture

The simplest local verification uses the checked-in agent message fixture:

```text
apps/runner/examples/run-execute.agent.request.json
```

Its run id is:

```text
00000000-0000-4000-8000-000000000905
```

Use this exact `runId` when calling `register_mcp_decision_session`.

## Verification Steps

### 1. Start Local Infrastructure

From the repository root:

```bash
docker compose -f compose.dev.yaml up -d postgres rabbitmq redis minio
```

Apply local migrations if the dev database is not current:

```bash
node infra/scripts/apply-dev-db-migrations.mjs
```

### 2. Start API Server With MCP Enabled

From `apps/api-server`, start the API Server with MCP enabled. Use local-only placeholder tokens, not production secrets.

PowerShell example:

```powershell
$env:WEDGE_MCP_SERVER_ENABLED="true"
$env:WEDGE_MCP_SERVICE_TOKEN="<local-mcp-service-token>"
$env:INTERNAL_SERVICE_TOKEN="<local-internal-service-token>"
$env:WEDGE_MCP_PENDING_DECISION_TTL="PT5M"
.\gradlew.bat bootRun
```

Health check:

```bash
curl http://localhost:8080/actuator/health
```

Expected:

```text
UP
```

### 3. Connect MCP Inspector

Connect MCP Inspector to:

```text
http://localhost:8080/mcp
```

Set the request header:

```text
Authorization: Bearer <local-mcp-service-token>
```

Confirm:

```text
initialize succeeds
tools/list includes register_mcp_decision_session
tools/list includes resolve_mcp_pending_decision
```

The Inspector must declare sampling capability. If the tool result later reports sampling unsupported, this E2E is blocked by the selected MCP Host.

### 4. Register The MCP Decision Session

In MCP Inspector, call:

```text
register_mcp_decision_session
```

Arguments:

```json
{
  "runId": "00000000-0000-4000-8000-000000000905"
}
```

Expected result:

```text
runId matches
samplingSupported=true
sessionId is present
clientName is present
expiresAt is in the future
```

If `samplingSupported=false`, stop here. The selected Host cannot resolve MCP decisions through sampling.

### 5. Start Runner In MCP Mode

From `apps/runner`, run the fixture message with MCP mode enabled.

PowerShell example:

```powershell
$env:RUNNER_AGENT_DECISION_MODE="mcp"
$env:RUNNER_AGENT_MCP_GATEWAY_URL="http://localhost:8080/internal/agent/mcp/decision"
$env:RUNNER_AGENT_MCP_SERVICE_TOKEN="<local-internal-service-token>"
$env:RUNNER_AGENT_MCP_GATEWAY_TIMEOUT_MS="180000"
npm run start -- --message-file examples/run-execute.agent.request.json
```

Expected Runner behavior:

```text
Runner starts the agent task
Runner reaches a decision point
Runner creates a pending decision through API Server
Runner waits for pending decision completion
```

If the Runner times out before step 6, increase `RUNNER_AGENT_MCP_GATEWAY_TIMEOUT_MS` and `WEDGE_MCP_PENDING_DECISION_TTL`.

### 6. Resolve The Pending Decision From MCP Inspector

While Runner is waiting, call:

```text
resolve_mcp_pending_decision
```

Arguments:

```json
{}
```

Expected successful result:

```text
resolved=true
pendingDecisionId is present
runId=00000000-0000-4000-8000-000000000905
decision is present
decision.kind is act, checkpoint, or finish
model is present when the Host returns one
```

The tool may return:

```text
resolved=false
message="No pending MCP decision is available for this session."
```

That means Runner has not created the pending decision yet, the runId was not registered for this session, or another call already resolved it. Wait for the Runner decision point and call again.

### 7. Confirm Runner Completion Or Safe Stop

Expected Runner behavior after the MCP tool resolves:

```text
Runner receives COMPLETED pending decision
Runner parses AgentDecision
Runner maps targetKey only through observed candidates
Runner applies policy/verifier checks
Runner continues or stops safely
```

Success does not require a full business run to finish. This E2E passes when the pending MCP decision is consumed by Runner without heuristic fallback and without direct MCP browser control.

## Success Criteria

All of the following must be true:

```text
MCP Inspector can initialize and list tools
register_mcp_decision_session succeeds for the fixture runId
registered session reports samplingSupported=true
Runner MCP mode creates a pending decision
resolve_mcp_pending_decision resolves that pending decision
sampling runs inside the MCP tool call
API Server stores the decision as COMPLETED
Runner receives the completed decision
Runner does not fallback to heuristic in MCP mode
Runner does not execute raw selector, JavaScript, DOM, cookie, token, or storage content from MCP
```

## Expected Failure Matrix

| Symptom | Expected meaning | Action |
| --- | --- | --- |
| `mcp_session_unavailable` | runId has no active MCP session or Host does not support sampling | Call `register_mcp_decision_session` again with the exact Runner runId |
| `mcp_sampling_bridge_unavailable` | sampling failed or returned invalid content | Check Inspector sampling support and returned JSON |
| Runner timeout | Host did not resolve before timeout | Increase timeout/TTL or call `resolve_mcp_pending_decision` sooner |
| pending status `EXPIRED` | API Server pending TTL elapsed | Re-run from session registration |
| invalid targetKey rejection | Host selected a candidate not observed by Runner | This is correct fail-closed behavior |
| `resolved=false` | No pending decision exists for the current session | Wait for Runner to reach decision or verify runId/session |

## Evidence To Record

When the E2E passes, record the following in the commit or follow-up doc:

```text
API Server commit hash
Runner commit hash
MCP Host name and version
MCP protocolVersion observed by Inspector
samplingSupported value
registered runId
pendingDecisionId
resolve_mcp_pending_decision result
Runner terminal status or safe-stop status
Relevant logs with secrets redacted
```

Do not paste production tokens, JWT secrets, AWS keys, RabbitMQ passwords, cookies, or presigned URLs into the verification result.

## 2026-05-11 Local Verification Result

This local verification was executed with MCP Inspector v0.21.2 and the Wedge API Server running locally.

### Baseline Sampling Check

Before running the Runner E2E, the Inspector sampling baseline was checked with:

```text
mcp_sampling_decision_spike
```

Result:

```json
{
  "success": true,
  "samplingSupported": true,
  "clientName": "inspector-client",
  "model": "stub-model",
  "stopReason": "END_TURN",
  "decision": {
    "decisionType": "ACT",
    "tool": "click",
    "candidateId": "candidate_1",
    "reason": "Click the visible primary CTA candidate.",
    "confidence": 0.85
  },
  "validation": {
    "jsonParsed": true,
    "schemaValid": true,
    "candidateAllowed": true,
    "safetyValid": true
  }
}
```

This proves that the API Server can request `sampling/createMessage` from the connected MCP Host during an MCP tool call, and that the returned text can be parsed and validated as decision JSON.

### Runner Pending Decision E2E

The local Runner request was generated from:

```text
apps/runner/examples/run-execute.agent.request.json
```

For this verification, the fixture was copied to:

```text
apps/runner/.runner-artifacts/mcp-e2e-agent-request.json
```

The request was adjusted to use:

```text
runId=00000000-0000-4000-8000-000000000090
RUNNER_AGENT_DECISION_MODE=mcp
RUNNER_AGENT_MCP_GATEWAY_TIMEOUT_MS=600000
RUNNER_BROWSER_MODE=simulated
RUNNER_CALLBACK_MODE=file
RUNNER_AGENT_IDEMPOTENCY_STORE_ENABLED=false
```

The MCP Host session was registered with:

```json
{
  "runId": "00000000-0000-4000-8000-000000000090",
  "clientName": "inspector-client",
  "samplingSupported": true,
  "samplingRoutingReady": false
}
```

The first pending decision was resolved through `resolve_mcp_pending_decision`:

```json
{
  "resolved": true,
  "message": "MCP pending decision was resolved.",
  "pendingDecisionId": "189c4488-666f-4984-8fb1-ed483502b866",
  "runId": "00000000-0000-4000-8000-000000000090",
  "model": "stub-model",
  "stopReason": "END_TURN",
  "decision": {
    "kind": "act",
    "actionType": "goto",
    "targetKey": null,
    "scrollY": null,
    "stage": "FIRST_VIEW",
    "reason": "Open the provided start URL before continuing the simulated run.",
    "confidence": 0.9
  }
}
```

The second pending decision was resolved through `resolve_mcp_pending_decision`:

```json
{
  "resolved": true,
  "message": "MCP pending decision was resolved.",
  "pendingDecisionId": "530a8235-5518-47c3-a70f-b3960f8eea30",
  "runId": "00000000-0000-4000-8000-000000000090",
  "model": "stub-model",
  "stopReason": "END_TURN",
  "decision": {
    "kind": "finish",
    "actionType": "checkpoint",
    "targetKey": null,
    "scrollY": null,
    "stage": "COMMIT",
    "reason": "Finish after verifying the MCP pending decision round trip.",
    "confidence": 0.8
  }
}
```

The Runner completed without `runner failed`, `decision_failed`, or MCP pending decision timeout:

```json
{
  "service": "runner",
  "runId": "00000000-0000-4000-8000-000000000090",
  "summary": {
    "completedStepCount": 1,
    "failedStepCount": 0,
    "stopped": false
  },
  "delivery": {
    "status": "DELIVERY_COMPLETE",
    "issues": []
  }
}
```

### Verified Behavior

This run verified the intended Host-driven pending decision flow:

```text
Runner created a pending MCP decision through API Server.
API Server stored the pending decision by runId/session route.
MCP Inspector resolved the pending decision from the active MCP Host session.
API Server requested sampling/createMessage inside the resolve tool call.
Inspector returned strict AgentDecision JSON.
API Server validated and completed the pending decision.
Runner polled and consumed the completed decision.
Runner continued after the first decision and exited cleanly after the second decision.
```

The verification also confirmed that a too-short Runner timeout can fail the run even if the Inspector later resolves the pending decision. The successful rerun used a 600000 ms gateway timeout to give a human operator enough time to submit Inspector sampling responses.

## Production Gate

Do not enable MCP mode as the production default after this local check alone.

Production enablement requires:

```text
OAuth/OIDC or equivalent MCP client identity and scope policy
MCP invocation audit log
clear user approval or operator approval model for sampling
timeout and TTL tuned for real Host latency
observability for pending created/resolved/expired/failed counts
load behavior decision for in-memory pending decisions versus Redis/DB-backed pending store
```
