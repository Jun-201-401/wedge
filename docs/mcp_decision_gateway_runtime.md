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
  -> active MCP Host session
  -> sampling/createMessage
  -> AgentDecision JSON
  -> Runner parser / candidate allow-list / policy
  -> fixed browser tool execution
```

## Runner Contract

Runner sends only a constrained observation:

```text
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

This endpoint is protected by the internal service token and accepts the constrained Runner observation contract. It intentionally returns a typed `mcp_session_unavailable` failure until MCP Host session selection and sampling routing are implemented.

MCP session selection is still not implemented. It must be designed before enabling MCP mode in production.
