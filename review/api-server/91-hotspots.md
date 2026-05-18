# 91 - hotspots

## Ranking Method

Hotspots are ranked by confirmed severity, blast radius, number of cross-cutting lenses, and refactor/test leverage.

## 1. Analysis callback and JudgeResult persistence

Files:

- `apps/api-server/src/main/java/com/wedge/analysis/api/internal/AnalyzerCallbackService.java`
- `apps/api-server/src/main/java/com/wedge/analysis/application/JudgeResultPersistenceService.java`
- `apps/api-server/src/main/resources/mapper/analysis/AnalysisJobMapper.xml`
- `apps/api-server/src/main/resources/mapper/run/RunMapper.xml`
- `packages/contracts/schemas/judge-result.schema.json`

Why it is hot:

- `JudgeResultPersistenceService` is a 498-line boundary object doing lifecycle transition, contract parsing, projection rebuild, defaulting, and run projection updates.
- Terminal callbacks can rewrite job/run ownership.
- Terminal state is not monotonic.
- Required JudgeResult fields are defaulted instead of contract-validated.
- Guarded row counts are ignored.

First tests:

- Wrong stored `runId`, nonexistent job, completed-then-failed, failed-then-completed.
- Missing required JudgeResult fields.
- Zero-row current-run update returns conflict.

Refactor direction:

Split into callback identity validator, terminal transition policy, JudgeResult schema validator/mapper, projection writer, and run-currentness updater.

## 2. Run lifecycle, runner callbacks, and run access

Files:

- `apps/api-server/src/main/java/com/wedge/run/api/RunController.java`
- `apps/api-server/src/main/java/com/wedge/run/application/RunnerCallbackService.java`
- `apps/api-server/src/main/java/com/wedge/run/application/RunService.java`
- `apps/api-server/src/main/java/com/wedge/run/infrastructure/RunPersistenceAdapter.java`
- `apps/api-server/src/main/resources/mapper/run/RunMapper.xml`

Why it is hot:

- `/api/runs/{runId}/agent/start` skips project access.
- Step events can regress state.
- Item-level idempotency is missing in generic timeline.
- Agent step creation is read-then-insert.
- Agent idempotency completion uses weaker predicates than renew/release.

First tests:

- Cross-project agent-start denial.
- `STEP_COMPLETED` then delayed `STEP_STARTED`.
- Duplicate agent trace/event under different envelope id.
- Concurrent agent step creation.

Refactor direction:

Introduce `RunAccessGuard`, step transition policy, callback-item ledger, and atomic step/idempotency operations.

## 3. Evidence snapshot, checkpoint, and artifact persistence

Files:

- `apps/api-server/src/main/java/com/wedge/evidence/application/EvidenceService.java`
- `apps/api-server/src/main/java/com/wedge/evidence/application/CheckpointPersistenceService.java`
- `apps/api-server/src/main/java/com/wedge/evidence/application/EvidencePacketSignedUrlDecorator.java`
- `apps/api-server/src/main/resources/mapper/evidence/EvidencePacketMapper.xml`
- `apps/api-server/src/main/resources/mapper/evidence/CheckpointMapper.xml`
- `apps/api-server/src/main/java/com/wedge/evidence/infrastructure/S3ArtifactContentStore.java`

Why it is hot:

- EvidencePacket upsert returns stale packet for later analysis.
- Discovery checkpoint duplicate handling differs from run checkpoint handling.
- Whole-run reads are unbounded.
- S3 objects are loaded fully into memory.
- Signed URL generation failure silently degrades packets.

First tests:

- Second materialization after new evidence.
- Duplicate discovery checkpoint with new event id.
- Large artifact streaming/limit behavior.
- Signed URL partial failure diagnostics.

Refactor direction:

Define snapshot versioning, unify checkpoint idempotency, add evidence limits/windowed queries, and separate artifact metadata from streaming content.

## 4. Common outbox, MQ, and DLQ reliability

Files:

- `apps/api-server/src/main/java/com/wedge/common/infrastructure/outbox/OutboxMessagePersistenceAdapter.java`
- `apps/api-server/src/main/resources/mapper/common/outbox/OutboxMessageMapper.xml`
- all `*OutboxDispatcher.java`
- Rabbit publishers under run/discovery/scenario-authoring/analysis
- `apps/api-server/src/main/java/com/wedge/common/infrastructure/RunnerMqConfig.java`
- `apps/api-server/src/main/java/com/wedge/analysis/infrastructure/AnalysisMqConfig.java`
- `apps/api-server/src/main/java/com/wedge/run/infrastructure/RunnerExecutionDeadLetterListener.java`

Why it is hot:

- `PUBLISHED` is marked before broker-confirmed delivery.
- Retry exhaustion is invisible.
- Poison payload deserialization can wedge retry before attempt update.
- DLQs are configured without full domain settlement.
- Common adapter hardcodes domain message types.

First tests:

- Negative confirm/unroutable publish keeps row retryable.
- Max-attempt transition to terminal state.
- Poison payload quarantine.
- Discovery/scenario/analysis DLQ settlement.

Refactor direction:

Define confirmed-publish semantics, add terminal outbox states, persist last error, move message codecs out of common adapter, and add domain DLQ settlement.

## 5. Auth/project/security filters

Files:

- `apps/api-server/src/main/java/com/wedge/common/config/SecurityConfig.java`
- `apps/api-server/src/main/java/com/wedge/common/security/JwtAuthenticationFilter.java`
- `apps/api-server/src/main/java/com/wedge/common/security/InternalServiceTokenFilter.java`
- `apps/api-server/src/main/java/com/wedge/project/application/ProjectAccessService.java`
- `apps/api-server/src/main/java/com/wedge/project/application/DefaultProjectService.java`
- `apps/api-server/src/main/resources/mapper/project/ProjectAccessMapper.xml`
- `apps/api-server/src/main/java/com/wedge/auth/infrastructure/RefreshTokenRepository.java`

Why it is hot:

- Human path lists drift between security config and JWT filter.
- Archived projects pass active checks.
- Default project bootstrap regrants `OWNER`.
- Analyzer signature contract is not verified.
- Runner signature can be fail-open when secret blank.
- Refresh JWTs are stored raw.

First tests:

- Endpoint auth/project matrix.
- Archived project denied.
- Default membership not restored/upgraded.
- Analyzer invalid signature rejected.
- Refresh token raw value never stored.

Refactor direction:

Centralize human API auth matching, make project access predicates status-aware, split bootstrap from permission mutation, and harden internal callback credentials.

## 6. Report generation, detail, export, and share

Files:

- `apps/api-server/src/main/java/com/wedge/report/application/ReportGenerationService.java`
- `apps/api-server/src/main/java/com/wedge/report/application/ReportExportService.java`
- `apps/api-server/src/main/java/com/wedge/report/application/ReportDetailQueryService.java`
- `apps/api-server/src/main/java/com/wedge/report/application/ReportSummaryQueryService.java`
- `apps/api-server/src/main/java/com/wedge/report/application/ReportShareService.java`
- `apps/api-server/src/main/resources/mapper/report/ReportMapper.xml`

Why it is hot:

- Export can return an old report.
- Missing JudgeResult fields produce ready empty report data.
- Detail/export can mix report snapshot and live analysis projections.
- Shared artifact token grants all image artifacts for run.
- Summary/detail has query fan-out.

First tests:

- Older ready report plus newer latest analysis.
- Missing `summary`/`decision_map` rejects report generation.
- Report detail/export consistency after callback replay.
- Same-run unreferenced image denied by share token.

Refactor direction:

Define immutable report snapshot vs live report handle; key report/export to current analysis; restrict share artifact allowlist; batch report queries.

## 7. MCP decision gateway

Files:

- `apps/api-server/src/main/java/com/wedge/mcp/application/McpRunQueryService.java`
- `apps/api-server/src/main/java/com/wedge/mcp/gateway/application/McpDecisionSessionService.java`
- `apps/api-server/src/main/java/com/wedge/mcp/gateway/application/McpPendingDecisionResolutionService.java`
- `apps/api-server/src/main/java/com/wedge/mcp/gateway/infrastructure/InMemoryMcpPendingDecisionRegistry.java`
- `apps/api-server/src/main/java/com/wedge/mcp/gateway/infrastructure/InMemoryMcpDecisionSessionRegistry.java`
- `packages/contracts/mcp/tools.schema.json`

Why it is hot:

- Shared MCP token is broad authority.
- Tool/scopes not in machine contract.
- Pending resolution is not atomic.
- Registries are unbounded in-memory.
- Required audit/metrics are not implemented.

First tests:

- MCP cross-project read denied.
- Missing `wedge.decide` denied.
- Concurrent resolve samples only once.
- Expiry during sampling returns expired/conflict, not resolved.

Refactor direction:

Keep host-driven design, but add identity/scope/project checks, atomic claims, TTL store, contracts, audit logs, and metrics before production enablement.

## 8. Discovery and scenario authoring

Files:

- `apps/api-server/src/main/java/com/wedge/discovery/application/DiscoveryService.java`
- `apps/api-server/src/main/java/com/wedge/discovery/application/DiscoveryCallbackService.java`
- `apps/api-server/src/main/java/com/wedge/discovery/application/DiscoveryUrlValidator.java`
- `apps/api-server/src/main/java/com/wedge/discovery/application/DiscoveryExecuteRequestMessageFactory.java`
- `apps/api-server/src/main/java/com/wedge/scenarioauthoring/application/ScenarioAuthoringJobService.java`
- `apps/api-server/src/main/java/com/wedge/scenarioauthoring/application/ScenarioAuthoringCallbackService.java`

Why it is hot:

- SSRF protection is not at fetch boundary.
- Discovery checkpoint duplicates are not idempotent under different event ids.
- Late checkpoints after terminal state are under-specified.
- Scenario authoring trusts provider validation booleans.
- Create idempotency lacks request hash.

First tests:

- DNS rebinding/redirect-to-private behavior at Runner fetch.
- Duplicate discovery checkpoint with new event id.
- Terminal discovery plus late checkpoint.
- Same authoring idempotency key with different body.
- Invalid provider candidate/ScenarioPlan rejected.

Refactor direction:

Push network safety to Runner fetch boundary, align discovery checkpoint idempotency with run checkpoint, and validate provider outputs contract-first.

## 9. Contract artifacts and contract tests

Files:

- `packages/contracts/openapi/wedge_openapi.yaml`
- `packages/contracts/internal/runner-callback.schema.json`
- `packages/contracts/internal/analyzer-callback.schema.json`
- `packages/contracts/mq/messages.schema.json`
- `packages/contracts/mcp/tools.schema.json`
- `packages/contracts/schemas/judge-result.schema.json`
- `apps/api-server/src/test/java/**Contract**`

Why it is hot:

- Runner agent trace has competing shapes.
- MCP tools/scopes drift from implementation.
- MQ idempotency fields are optional despite operational reliance.
- Runtime error code enum differs from OpenAPI.
- OpenAPI smoke tests do not validate DTO/schema parity.

First tests:

- Duplicate schema/component detection.
- DTO-vs-schema MockMvc tests for runner/analyzer callbacks.
- Emitted MQ envelope schema validation.
- MCP tool registry parity.
- Error response schema validation.

Refactor direction:

Make `packages/contracts` executable: schema validators in API-server tests, generated fixture validation, and CI gate for contract drift.

