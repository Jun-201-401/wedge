# Lens 03 - contract-api-boundary

## Scope

Cross-packet review of `packages/contracts`, OpenAPI, MQ schemas, MCP schemas, internal callback schemas, API-server DTOs, runner/analyzer mirrors, and docs.

## Summary

Overall severity: `HIGH`.

The repository is intended to be contract-first, but canonical contracts are not consistently authoritative across OpenAPI, MQ, MCP, internal callbacks, and Java DTOs. Several paths can reject schema-valid payloads or accept invalid contract data.

## Findings

### HIGH - Runner agent trace callback has competing shapes

Evidence:

- `runner-callback.schema.json` defines full `taskId/attemptId/occurredAt/trace`: `packages/contracts/internal/runner-callback.schema.json:1044`.
- The same file also defines `AgentTraceRequest` as trace-only: `packages/contracts/internal/runner-callback.schema.json:1086`.
- OpenAPI repeats the split: `packages/contracts/openapi/wedge_openapi.yaml:5351`, `:5664`.
- API-server requires full shape: `apps/api-server/src/main/java/com/wedge/run/api/internal/runner/dto/RunnerAgentTraceRequest.java:8`.

Failure scenario:

A client generated from the trace-only schema sends `{ "trace": ... }`; Spring rejects it, or generator behavior depends on duplicate component choice.

Fix direction:

Pick one callback shape contract-first. Remove the duplicate schema/component and align TypeScript types, runner emission, OpenAPI, and Java DTO.

Contract-test gaps:

Add duplicate OpenAPI component detection and a schema-valid `agent-traces` MockMvc contract test.

### HIGH - JudgeResult boundary is not contract-validated

Evidence:

- `judge-result.schema.json` requires `evidence_schema_version`, `rule_registry_id`, `summary`, `issues`, and `decision_map`: `packages/contracts/schemas/judge-result.schema.json:6`.
- API-server accepts raw maps: `apps/api-server/src/main/java/com/wedge/analysis/api/internal/dto/AnalyzerCompletedRequest.java:17`.
- Persistence only validates issue stages and defaults required fields: `apps/api-server/src/main/java/com/wedge/analysis/application/JudgeResultPersistenceService.java:95`, `:208`.
- Existing tests accept a minimal non-schema-complete JudgeResult: `apps/api-server/src/test/java/com/wedge/analysis/application/JudgeResultPersistenceServiceTest.java:307`.

Failure scenario:

Analyzer sends schema-invalid JudgeResult; API marks analysis completed with fallback projection data and loses linkage such as `rule_registry_id`.

Fix direction:

Validate `judgeResult` against the schema before completion. Persist `rule_registry_id`. Make top-level callback `nudges` vs nested `judgeResult.nudges` one canonical source.

### HIGH - MCP implemented tools/scopes drift from machine contract

Evidence:

- MCP contract lacks `register_mcp_decision_session`, `resolve_mcp_pending_decision`, and `wedge.decide`: `packages/contracts/mcp/tools.schema.json:25`, `:56`.
- Implemented tools exist: `apps/api-server/src/main/java/com/wedge/mcp/gateway/api/McpDecisionGatewayTools.java:22`, `apps/api-server/src/main/java/com/wedge/mcp/gateway/api/McpPendingDecisionTools.java:17`.
- Docs require project access, client policy, audit, and `wedge.decide`: `docs/mcp_server_design.md:385`.

Failure scenario:

Contract-driven MCP clients cannot discover decision tools, while token-bearing MCP clients can use implemented paths without documented scope/project boundaries.

Fix direction:

Promote implemented tools/scopes into `tools.schema.json`; enforce MCP client identity, scope, project/run access, and audit at tool entry.

### HIGH - Analyzer callback signature is required but not verified

Evidence:

- OpenAPI requires `X-Signature` for analyzer completion: `packages/contracts/openapi/wedge_openapi.yaml:2421`.
- Controller requires it: `apps/api-server/src/main/java/com/wedge/analysis/api/internal/AnalyzerCallbackController.java:47`.
- Header validation only checks nonblank: `apps/api-server/src/main/java/com/wedge/analysis/api/internal/AnalyzerCallbackHeaders.java:6`.
- HMAC verification is gated to `/internal/runner/**`: `apps/api-server/src/main/java/com/wedge/common/security/InternalServiceTokenFilter.java:74`, `:116`.

Failure scenario:

A holder of the internal bearer token can forge analyzer callbacks despite the contract implying body integrity.

Fix direction:

Verify analyzer HMAC with an analyzer-specific secret, or remove signature from analyzer contracts/docs/client and state bearer-only trust.

### MEDIUM - MQ idempotency/correlation fields are optional in schema but operationally required

Evidence:

- `messages.schema.json` is canonical per package README: `packages/contracts/README.md:58`.
- Run messages define but do not require `correlationId`/`idempotencyKey`: `packages/contracts/mq/messages.schema.json:251`, `:263`.
- Same pattern appears for agent/analysis messages: `packages/contracts/mq/messages.schema.json:295`, `:339`.
- API-server factories emit these fields: `apps/api-server/src/main/java/com/wedge/run/application/RunExecuteRequestMessageFactory.java:54`, `apps/api-server/src/main/java/com/wedge/run/application/AgentExecuteRequestMessageFactory.java:37`, `apps/api-server/src/main/java/com/wedge/analysis/application/AnalysisRequestService.java:106`.

Failure scenario:

A schema-valid producer omits `idempotencyKey`; duplicate suppression cannot safely replay.

Fix direction:

Require `correlationId` and `idempotencyKey` for outbox-published MQ envelopes or document/test fallback idempotency rules.

### MEDIUM - Error code contract does not match runtime shape

Evidence:

- Runtime error codes are lowercase strings in `ErrorCode`: `apps/api-server/src/main/java/com/wedge/common/error/ErrorCode.java:5`.
- `ApiError.code` serializes that runtime string: `apps/api-server/src/main/java/com/wedge/common/response/ApiError.java:6`.
- OpenAPI defines uppercase/generic `ErrorCode` values: `packages/contracts/openapi/wedge_openapi.yaml:3238`.

Failure scenario:

Generated clients reject or misclassify real error bodies.

Fix direction:

Update OpenAPI to enumerate actual lowercase runtime codes, or change runtime serialization to the documented enum.

## Contract-Test Gaps

- Duplicate component/schema detection for OpenAPI and JSON schemas.
- DTO-vs-schema MockMvc tests for runner callbacks, analyzer callbacks, and report responses.
- Schema validation for emitted MQ messages.
- MCP tool registry parity tests.
- Error response serialization validation against OpenAPI.

