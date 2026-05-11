# MCP Decision Gateway Runtime

## Purpose

MCP Decision Gateway is the boundary between the asynchronous Runner worker and an active MCP Host session.

The Runner must not call an MCP Host directly and must not allow an MCP response to execute browser primitives by itself. The Runner sends a constrained `AgentObservation` projection to the API Server gateway, receives an `AgentDecision` candidate, and then applies the same schema, candidate, verifier, and policy checks used by the existing agent runtime.

## Official Protocol Boundary

MCP Sampling is a client feature. The MCP Server requests `sampling/createMessage` from the connected MCP Client or Host, and the Client or Host keeps control of model access, model selection, and user approval.

Therefore, Runner-side MCP mode cannot be implemented as a direct LLM API call from the worker. The Runner is an MQ worker and may run without an active MCP session. The API Server owns MCP sessions and is the only component that can route a sampling request to the selected MCP Host session.

## Runtime Flow

```text
Runner Agent Runtime
  -> AgentMcpDecisionClient
  -> API Server MCP Decision Gateway
  -> runId-based MCP decision session registry
  -> pending decision registry
  -> active MCP Host polls resolve_mcp_pending_decision
  -> sampling/createMessage inside the current MCP tool request
  -> AgentDecision JSON
  -> Runner parser / candidate allow-list / policy
  -> fixed browser tool execution
```

Before Runner can use MCP mode, an MCP Host must explicitly register the current MCP session for the target run:

```text
MCP Host
  -> tools/call register_mcp_decision_session(runId)
  -> API Server stores runId -> MCP session lease
```

The lease is in-memory and time-limited. It is a routing boundary, not durable workflow state.

## Runner Contract

Runner sends only a constrained observation:

```text
runId
goal
startUrl
state.started
state.scrollCount
state.clickedTargetKeys
page.finalUrl
page.title
page.candidates[]
allowedActions
outputSchema
```

`runId` is the correlation key the API Server can later use to resolve run ownership, project context, and the active MCP Host session. Runner must not send an MCP session id; session selection remains an API Server responsibility.

Candidate IDs are opaque values such as `candidate_001`. The payload must not expose full DOM, screenshots, cookies, storage values, arbitrary selectors for model selection, JavaScript execution hooks, or credentials.

## Decision Contract

The gateway response must be parseable as the existing Runner `AgentDecision` shape:

```text
kind: act | checkpoint | finish
actionType: goto | click | scroll | checkpoint
targetKey: observed opaque candidate id for click
stage: FIRST_VIEW | VALUE | CTA | INPUT | COMMIT
reason
confidence
```

The response is not executable until the Runner maps `targetKey` back to an observed component and passes existing verifier and policy checks.

## Current Implementation Status

Current Runner code provides the first boundary:

```text
RUNNER_AGENT_DECISION_MODE=mcp
RUNNER_AGENT_MCP_GATEWAY_URL=http://api-server:8080/internal/agent/mcp/decision
RUNNER_AGENT_MCP_SERVICE_TOKEN=<internal gateway token>
RUNNER_AGENT_MCP_GATEWAY_TIMEOUT_MS=10000
```

The Runner MCP transport resolves the configured gateway URL to the pending decision endpoint. Existing `/decision` URLs are mapped to:

```text
POST /internal/agent/mcp/pending-decisions
GET /internal/agent/mcp/pending-decisions/{pendingDecisionId}
```

Runner MCP mode fails closed when the gateway is unavailable, a pending decision expires, or polling times out. It does not silently fall back to heuristic decisions in MCP mode.

The API Server currently exposes the internal gateway entrypoint:

```text
POST /internal/agent/mcp/decision
```

This endpoint is protected by the internal service token and accepts the constrained Runner observation contract.

The API Server also exposes the MCP registration tool:

```text
register_mcp_decision_session(runId)
```

This tool records the current MCP Host session as the decision session for the run and captures whether the client declared sampling support. The registry currently stores only routing metadata:

```text
runId
sessionId
clientName
samplingSupported
registeredAt
expiresAt
```

It intentionally does not persist SDK request context or execute sampling from the internal HTTP request yet. Therefore, `/internal/agent/mcp/decision` still fails closed: it returns `mcp_session_unavailable` when no route exists, or `mcp_sampling_bridge_unavailable` after route resolution until a documented direct bridge is implemented.

MCP session selection now has a first in-memory boundary and `McpSamplingBridge` has a first interface boundary. The default bridge implementation intentionally returns `mcp_sampling_bridge_unavailable`.

The current API/library inspection found:

```text
McpSyncRequestContext.sample(...)
McpSyncServerExchange.createMessage(...)
```

These are public APIs for bidirectional sampling while handling a stateful MCP request. No public Spring AI or Java MCP SDK API has been wired here that resolves a later HTTP request's `sessionId` back into an active `McpSyncServerExchange`. Because of that, Wedge must not store `McpSyncRequestContext` itself in the registry and call it later.

To avoid storing request-scoped MCP context, the API Server now also provides a host-driven pending decision boundary:

```text
POST /internal/agent/mcp/pending-decisions
GET /internal/agent/mcp/pending-decisions/{pendingDecisionId}
```

The first endpoint stores the constrained Runner observation as a short-lived pending decision for the run's registered MCP session. The second endpoint lets Runner-side transport code poll the current pending decision status later.

The MCP Host resolves pending work through this tool:

```text
resolve_mcp_pending_decision
```

That tool only runs sampling inside the fresh MCP tool call where `McpSyncRequestContext` is available. The sampling result is parsed as `AgentDecision`, validated against allowed action types and observed candidate `targetKey` values, and then stored back on the pending decision.

Production MCP mode must remain disabled until the pending flow is verified end-to-end with an active MCP Host:

```text
1. MCP Host registers the run with register_mcp_decision_session
2. Runner creates a pending decision in MCP mode
3. MCP Host runs resolve_mcp_pending_decision while the run is waiting
4. Runner receives the completed AgentDecision
5. Runner applies its existing parser, candidate allow-list, verifier, and policy checks
```
