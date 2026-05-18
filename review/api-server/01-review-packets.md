# api-server Review Packets

## Review Strategy

The review unit is a business flow packet, not a single file and not the whole service. Each packet starts from an entrypoint and traces through application service, domain objects, mapper/XML queries, contracts, and tests. Cross-cutting lens reviews then check repeated risks across all packets.

Every detailed review must:

- Cite concrete `file:line` evidence for each finding.
- Include the failure scenario that makes the finding matter.
- Separate actual bugs/security risks from refactor candidates.
- Mark uncertain findings as `확인 필요`.
- Avoid taste-only style comments.
- Leave source code unchanged.

## Wave 0 - Setup and Map

Artifacts:

- `00-map.md`
- `01-review-packets.md`

Purpose:

- Fix the review scope and file structure.
- Identify domain flows, public/internal entrypoints, high-risk anchors, and contract/doc references.

## Wave 1 - Core Persistence and Execution Flows

### Packet 01: `analysis-judge-result-persistence`

Output: `packets/01-analysis-judge-result-persistence.md`

Scope:

- `AnalyzerCallbackController`
- `AnalyzerCallbackService`
- `JudgeResultPersistenceService`
- `AnalysisRequestService`
- `analysis/domain/*.java`
- `analysis/infrastructure/*.java`
- `mapper/analysis/*.xml`
- `packages/contracts/schemas/judge-result.schema.json`
- `packages/contracts/internal/analyzer-callback.schema.json`
- analysis tests

Focus:

- Analyzer callback trust boundary, DTO/contract drift, persistence correctness, analysis status transitions, idempotency, transaction/partial failure, query/write shape, and tests.

### Packet 02: `run-lifecycle-runner-callback`

Output: `packets/02-run-lifecycle-runner-callback.md`

Scope:

- `RunController`
- `RunnerCallbackController`
- `RunnerAgentIdempotencyController`
- `RunnerMessageIdempotencyController`
- `RunService`
- `RunnerCallbackService`
- `RunStatusTransitionPolicy`
- `RunnerAgentIdempotencyService`
- `RunnerMessageIdempotencyService`
- `RunPersistenceAdapter`
- `run/infrastructure/*.java`
- `mapper/run/*.xml`
- runner callback/idempotency/run status contracts
- run tests

Focus:

- Public command vs internal callback ownership, state machine invariants, duplicate/late callbacks, outbox safety, idempotency, authorization, mapper/query shape, and tests.

### Packet 03: `evidence-artifact-checkpoint-persistence`

Output: `packets/03-evidence-artifact-checkpoint-persistence.md`

Scope:

- `EvidenceService`
- `ArtifactPersistenceService`
- `CheckpointPersistenceService`
- `EvidencePacketAssembler`
- `EvidencePacketSignedUrlDecorator`
- content store/writer classes
- evidence commands/domain/infrastructure
- `mapper/evidence/*.xml`
- `RunnerCallbackService` evidence calls
- evidence packet and runner callback contracts
- evidence tests and relevant runner callback tests

Focus:

- Artifact/checkpoint idempotency, duplicate callbacks, large payload/query risks, signed URL authorization, object store consistency, contract shape, and tests.

## Wave 2 - Generation and Read Model Flows

### Packet 04: `discovery-execution-callback`

Output: `packets/04-discovery-execution-callback.md`

Scope:

- `DiscoveryController`
- `DiscoveryRunnerCallbackController`
- `DiscoveryService`
- `DiscoveryCallbackService`
- `DiscoveryExecuteOutboxDispatcher`
- discovery commands/domain/infrastructure
- `mapper/discovery/*.xml`
- site discovery/result and MQ contracts
- discovery tests

Focus:

- Discovery idempotency, URL validation, limited-action lifecycle, callback ordering, recommendation persistence, outbox recovery, and contract drift.

### Packet 05: `scenario-authoring-flow`

Output: `packets/05-scenario-authoring-flow.md`

Scope:

- `ScenarioAuthoringJobController`
- `ScenarioAuthoringRunnerCallbackController`
- `ScenarioAuthoringJobService`
- `ScenarioAuthoringCallbackService`
- authoring outbox/message classes
- `ScenarioAuthoringJobMapper` and XML
- scenario-authoring contracts/examples
- scenario authoring tests

Focus:

- Discovery recommendation to authoring job boundary, candidate validation, confirmation/materialization assumptions, provider policy, idempotency, outbox, and contract-first consistency.

### Packet 06: `report-generation-query-share`

Output: `packets/06-report-generation-query-share.md`

Scope:

- `ReportController`
- `ReportGenerationService`
- `ReportDetailQueryService`
- `ReportSummaryQueryService`
- `ReportShareService`
- `ReportExportService`
- report DTO/domain/infrastructure
- `mapper/report/*.xml`
- OpenAPI/report contracts and report tests

Focus:

- Report read-model correctness, query performance, artifact/share authorization, stale data risks, generated JSON/file consistency, response shape, and tests.

## Wave 3 - Boundary, Tooling, and Shared Reliability Flows

### Packet 07: `auth-project-access-boundary`

Output: `packets/07-auth-project-access-boundary.md`

Scope:

- `AuthController`
- `AuthService`
- auth DTO/domain/infrastructure
- `RefreshTokenRepository`
- `ProjectAccessService`
- `DefaultProjectService`
- `ProjectBootstrapService`
- project mappers/XML
- security config/filters where relevant
- auth/project/security tests

Focus:

- Session/refresh safety, resource authorization, principal/project mapping, token handling, bootstrap assumptions, error shape, and tests.

### Packet 08: `mcp-decision-gateway`

Output: `packets/08-mcp-decision-gateway.md`

Scope:

- `WedgeRunMcpTools`
- `McpRunQueryService`
- `McpDecisionGatewayTools`
- `McpPendingDecisionTools`
- `McpDecisionGatewayController`
- gateway application classes
- in-memory registries
- MCP contracts/docs/tests

Focus:

- MCP tool contract consistency, pending decision lifecycle, in-memory state limitations, auth/trust boundary, idempotency, observability, and tests.

### Packet 09: `common-outbox-idempotency`

Output: `packets/09-common-outbox-idempotency.md`

Scope:

- `OutboxMessagePersistenceAdapter`
- `OutboxMessageMapper` and XML
- `ProcessedMessagePersistenceAdapter`
- `ProcessedMessageMapper` and XML
- all `*OutboxDispatcher`
- Rabbit publishers and MQ config
- dead-letter listener
- relevant tests

Focus:

- Outbox dispatch reliability, publish failure recovery, duplicate message handling, transaction boundaries, dead-letter visibility, and operational diagnostics.

## Wave 4 - Cross-Cutting Lens Reviews

Artifacts:

- `lenses/01-repository-query-performance.md`
- `lenses/02-transaction-concurrency-idempotency.md`
- `lenses/03-contract-api-boundary.md`
- `lenses/04-security-authz-internal-callback.md`
- `lenses/05-error-handling-response-shape.md`
- `lenses/06-test-coverage-gaps.md`
- `lenses/07-observability-ops.md`

Purpose:

- Check repeated concerns across domains after packet reviews.
- Promote repeated packet-level issues into shared patterns.
- Identify root causes that need one coordinated refactor rather than isolated edits.

## Synthesis

Artifacts:

- `90-merged-findings.md`: deduplicated finding list with severity, category, evidence, and failure scenario.
- `91-hotspots.md`: ranked services/flows/files most likely to need refactoring or tests first.
- `99-refactor-plan-input.md`: structured input for a later `$plan --consensus` refactoring plan. This is not the final implementation plan.

The synthesis must classify each item as:

- `confirmed-bug`
- `security-authz-risk`
- `contract-mismatch`
- `transaction-concurrency-risk`
- `query-performance-risk`
- `ddd-responsibility-refactor`
- `test-gap`
- `observability-ops-gap`
- `deferred-design-decision`
