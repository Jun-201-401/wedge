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
  -> McpSamplingBridge
  -> active MCP Host session
  -> sampling/createMessage
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

It intentionally does not persist SDK request context or execute sampling from the internal HTTP request yet. Therefore, `/internal/agent/mcp/decision` still returns a typed `mcp_session_unavailable` failure after resolving the route until the actual server-to-client sampling bridge is implemented.

MCP session selection now has a first in-memory boundary and `McpSamplingBridge` has a first interface boundary. The default bridge implementation intentionally returns `mcp_sampling_bridge_unavailable`.

The current API/library inspection found:

```text
McpSyncRequestContext.sample(...)
McpSyncServerExchange.createMessage(...)
```

These are public APIs for bidirectional sampling while handling a stateful MCP request. No public Spring AI or Java MCP SDK API has been wired here that resolves a later HTTP request's `sessionId` back into an active `McpSyncServerExchange`. Because of that, Wedge must not store `McpSyncRequestContext` itself in the registry and call it later.

Production MCP mode must remain disabled until one of these is implemented:

```text
1. a documented direct bridge from registered session to createMessage
2. a host-driven pending decision flow that performs sampling inside a fresh MCP tool call
```
