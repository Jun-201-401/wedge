# Packet 08 - mcp-decision-gateway

## Scope

Read-only review of MCP run query tools, MCP decision session registration, pending decision creation/resolution, in-memory registries, contracts/docs, runner gateway integration, and scoped tests.

## Flow Map

1. Runner builds a constrained observation payload and calls API Server pending-decision endpoints instead of calling an MCP Host directly.
2. API Server creates a pending decision for a run/session.
3. MCP Host registers a stateful decision session and calls MCP tools to resolve pending decisions.
4. `McpPendingDecisionResolutionService` invokes MCP sampling inside the active MCP request and validates the returned decision.
5. Runner polls the pending decision status and maps the result to fixed browser actions.

## Files Reviewed

- `apps/api-server/src/main/java/com/wedge/mcp/**`
- `apps/api-server/src/main/java/com/wedge/common/security/InternalServiceTokenFilter.java`
- `apps/api-server/src/main/java/com/wedge/run/api/RunController.java`
- `apps/api-server/src/main/java/com/wedge/run/application/RunService.java`
- `apps/runner/src/agent/mcp-decision-gateway.ts`
- `apps/runner/src/agent/llm-decision-parser.ts`
- `packages/contracts/mcp/tools.schema.json`
- `packages/contracts/schemas/agent-decision.schema.json`
- MCP design/runtime docs and MCP tests

## Invariants Expected

- MCP clients must not read or bind arbitrary runs with only a shared service token.
- MCP decision sampling must happen inside an active MCP Host request.
- Pending decisions must be claimed/resolved atomically.
- Terminal pending states must not report success without a stored decision.
- Implemented MCP tools/scopes must be present in machine-readable contracts.
- In-memory registries must be bounded or explicitly non-production.
- Decision validation must match the runner-consumed contract.

## Findings

### CRITICAL

None.

### HIGH

1. MCP clients can read or bind arbitrary runs with only the shared MCP token.

Evidence:

- `get_run_status` delegates directly to `RunService.getRun`: `apps/api-server/src/main/java/com/wedge/mcp/application/McpRunQueryService.java:17`.
- Public run reads enforce project access separately in `RunController`: `apps/api-server/src/main/java/com/wedge/run/api/RunController.java:242`.
- Decision session registration accepts `runId` without run existence, project membership, or MCP client scope checks: `apps/api-server/src/main/java/com/wedge/mcp/gateway/application/McpDecisionSessionService.java:16`.
- Docs require project access/client policy and a separate `wedge.decide` scope: `docs/mcp_server_design.md:385`, `:394`.

Failure scenario:

Any MCP client holding `WEDGE_MCP_SERVICE_TOKEN` can call `get_run_status` for a guessed UUID or register itself as decision host for another run.

Fix direction:

Enforce MCP client identity, scope (`wedge.read`/`wedge.decide`), project/run access, and run-session ownership before reads or decision-session registration.

2. Pending decision resolution is not atomic and can resolve the same item twice.

Evidence:

- `findNextPendingForSession` selects pending work by stream read: `apps/api-server/src/main/java/com/wedge/mcp/gateway/infrastructure/InMemoryMcpPendingDecisionRegistry.java:75-84`.
- Sampling happens before completion: `apps/api-server/src/main/java/com/wedge/mcp/gateway/application/McpPendingDecisionResolutionService.java:67`.
- `complete()` can overwrite a record and does not reject already completed decisions: `apps/api-server/src/main/java/com/wedge/mcp/gateway/infrastructure/InMemoryMcpPendingDecisionRegistry.java:87-110`.

Failure scenario:

Two concurrent `resolve_mcp_pending_decision` calls for the same session both sample the same pending decision; the later completion overwrites the earlier decision.

Fix direction:

Add an atomic claim state or CAS transition such as `PENDING -> RESOLVING -> COMPLETED`, with duplicate completion returning conflict or the existing idempotent result.

3. Expiry during sampling can return `resolved=true` with no decision.

Evidence:

- `complete()` returns an `EXPIRED` record unchanged when TTL elapsed: `apps/api-server/src/main/java/com/wedge/mcp/gateway/infrastructure/InMemoryMcpPendingDecisionRegistry.java:95`.
- Resolver still builds a resolved response after `complete`: `apps/api-server/src/main/java/com/wedge/mcp/gateway/application/McpPendingDecisionResolutionService.java:82`.

Failure scenario:

Host approval/model latency exceeds TTL. API reports a resolved response, while Runner later polls an expired/null decision.

Fix direction:

After completion, require `status == COMPLETED` and a non-null decision. Return explicit expired/conflict failure otherwise.

### MEDIUM

1. Machine-readable MCP contracts do not include the implemented decision tools.

Evidence:

- `packages/contracts/mcp/tools.schema.json` includes `get_run_status` but not `register_mcp_decision_session` or `resolve_mcp_pending_decision`: `packages/contracts/mcp/tools.schema.json:25`.
- MCP schema scopes omit `wedge.decide`: `packages/contracts/mcp/tools.schema.json:56`.
- Implemented tools exist in `McpDecisionGatewayTools` and `McpPendingDecisionTools`: `apps/api-server/src/main/java/com/wedge/mcp/gateway/api/McpDecisionGatewayTools.java:22`, `apps/api-server/src/main/java/com/wedge/mcp/gateway/api/McpPendingDecisionTools.java:17`.

Failure scenario:

Contract-driven clients/tests reject or omit the decision gateway tools.

Fix direction:

Promote the decision-session tools and scopes into `packages/contracts/mcp/tools.schema.json` and relevant internal endpoint contracts before relying on them.

2. AgentDecision validation is incomplete versus the documented runtime contract.

Evidence:

- Runtime docs require `kind`, `actionType`, `targetKey`, `stage`, `reason`, and `confidence`: `docs/mcp_decision_gateway_runtime.md:64`.
- Validator checks kind/reason/confidence/actionType/click target only: `apps/api-server/src/main/java/com/wedge/mcp/gateway/application/McpPendingDecisionResolutionService.java:170-207`.
- It allows blank `actionType` for checkpoint/finish: `apps/api-server/src/main/java/com/wedge/mcp/gateway/application/McpPendingDecisionResolutionService.java:186`.
- The shared `agent-decision.schema.json` has a different richer shape with required `description`, `action`, `settleStrategy`, `stage`, and `targetKey`: `packages/contracts/schemas/agent-decision.schema.json:26-42`.

Failure scenario:

The model returns a decision with invalid `stage`, missing action-specific fields, or a shape that API stores as completed but Runner rejects or mishandles.

Fix direction:

Make the gateway decision mini-contract explicit in `packages/contracts`, then validate all required fields, stage enum, and action-specific payload rules.

3. Pending/session registries are unbounded in-memory stores.

Evidence:

- Decisions and creation order are stored in maps: `apps/api-server/src/main/java/com/wedge/mcp/gateway/infrastructure/InMemoryMcpPendingDecisionRegistry.java:28-31`.
- Create always inserts records: `apps/api-server/src/main/java/com/wedge/mcp/gateway/infrastructure/InMemoryMcpPendingDecisionRegistry.java:60`.
- Completed/expired decisions are not removed from the maps.

Failure scenario:

Repeated MCP runs accumulate completed/expired records until API memory grows without bound.

Fix direction:

Add bounded eviction/cleanup, remove after terminal poll, or move pending/session state to Redis/DB with TTL.

4. Required audit/observability is not implemented.

Evidence:

- Design docs require every MCP tool call to be recorded in `mcp_invocation_log`: `docs/mcp_server_design.md:435`.
- Production gate requires pending created/resolved/expired/failed metrics: `docs/mcp_pending_decision_e2e_verification.md:458`.
- Scoped MCP create/resolve code has no audit logger/meter around registration or pending resolution.

Failure scenario:

Expired/failed decisions cannot be correlated to client/session/run during incidents.

Fix direction:

Record audit summaries and counters/timers for session registration, pending create, resolve success/failure, expiry, and sampling failures.

5. Runner-facing session ownership is ambiguous.

Evidence:

- Runtime docs say Runner must not send an MCP session id and API Server owns session selection: `docs/mcp_decision_gateway_runtime.md:58-60`.
- Internal pending response includes `sessionId`: `apps/api-server/src/main/java/com/wedge/mcp/gateway/api/internal/dto/McpPendingDecisionResponse.java:9-16`.

Failure scenario:

The response shape suggests session identity is runner-visible even though the architecture intends API Server to keep session routing internal.

Fix direction:

Remove `sessionId` from Runner-facing responses unless Runner has a real use for it, or document why it is exposed and how it must not be used for authority.

## Architectural Status

`WATCH`.

The host-driven pending-decision architecture is directionally correct: Runner does not call an MCP Host directly, API Server owns session routing, and sampling is triggered inside an active MCP tool request. It is not production-clear yet because identity/scope, project authorization, durable pending-state ownership, contract promotion, and observability remain spike-grade.

## Verification Evidence

- Code-reviewer lane ran `gradle test --tests 'com.wedge.mcp.*' --tests 'com.wedge.common.security.InternalServiceTokenFilterTest'`; result was failed with 3 failures in `McpDecisionGatewayControllerTest` at lines `82`, `93`, and `108`.
- Static `rg` checks found no scoped console logging, empty catches, or obvious hardcoded API key patterns.
- Architect lane checked flow ownership against docs and marked the packet `WATCH`.
- No source files were edited.

## Recommendation

REQUEST CHANGES for production use. Keep the current host-driven design, but gate it behind explicit MCP identity/scope/project checks, atomic pending resolution, bounded state, promoted contracts, and observable audit events.
