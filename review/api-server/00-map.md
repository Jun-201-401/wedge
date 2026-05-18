# api-server Review Map

## Purpose

This map anchors the review to concrete api-server flows before any refactoring plan is produced. It is intentionally read-only: no application or contract files are modified by this review pass.

## Baseline Architecture

- Spring API Server is the canonical owner of DB writes, lifecycle state, REST APIs, internal callbacks, MQ publishing, WebSocket events, MCP adapter, and auth/project boundaries.
- Runner and Analyzer do not write directly to the DB. They call Spring internal endpoints; Spring persists state and payload projections.
- The repository follows a practical DDD-lite package shape per domain: `api`, `application`, `domain`, `infrastructure`.
- Shared contracts live under `packages/contracts`; implementation drift against those contracts is a first-class review concern.

## Domain Package Map

| Package | Primary Responsibility | Main Entrypoints | Main Application Classes | Persistence / Contracts |
|---|---|---|---|---|
| `analysis` | Analysis request lifecycle, Analyzer callback, JudgeResult persistence | `AnalysisController`, `AnalyzerCallbackController`, `EvidencePacketInternalController` | `AnalysisRequestService`, `AnalyzerCallbackService`, `JudgeResultPersistenceService` | `AnalysisJobMapper`, `AnalysisFindingMapper`, `RuleHitMapper`, `NudgeMapper`, `mapper/analysis/*.xml`, `judge-result.schema.json`, `analyzer-callback.schema.json` |
| `run` | Run lifecycle, runner callbacks, status transitions, agent/idempotency endpoints | `RunController`, `RunnerCallbackController`, `RunnerAgentIdempotencyController`, `RunnerMessageIdempotencyController` | `RunService`, `RunnerCallbackService`, `RunStatusTransitionPolicy`, `RunnerAgentIdempotencyService`, `RunnerMessageIdempotencyService` | `RunMapper`, `AgentIdempotencyMapper`, `RunnerMessageIdempotencyMapper`, `mapper/run/*.xml`, `runner-callback.schema.json`, `run-status.json` |
| `evidence` | Artifact/checkpoint/observation persistence, evidence packet assembly, signed URLs | public run artifact routes through `RunController`; internal writes via `RunnerCallbackService` | `EvidenceService`, `ArtifactPersistenceService`, `CheckpointPersistenceService`, `EvidencePacketAssembler`, `EvidencePacketSignedUrlDecorator` | `ArtifactMapper`, `CheckpointMapper`, `ObservationMapper`, `EvidencePacketMapper`, `evidence-packet.schema.json` |
| `discovery` | URL preflight/discovery lifecycle, runner callbacks, recommendation storage | `DiscoveryController`, `DiscoveryRunnerCallbackController` | `DiscoveryService`, `DiscoveryCallbackService`, `DiscoveryExecuteOutboxDispatcher` | `SiteDiscoveryMapper`, `ScenarioRecommendationMapper`, `site-discovery-result.schema.json`, MQ contracts |
| `scenarioauthoring` | Authoring job lifecycle between discovery recommendation and run materialization | `ScenarioAuthoringJobController`, `ScenarioAuthoringRunnerCallbackController` | `ScenarioAuthoringJobService`, `ScenarioAuthoringCallbackService`, `ScenarioAuthoringExecuteOutboxDispatcher` | `ScenarioAuthoringJobMapper`, `scenario-authoring.schema.json`, MQ contracts |
| `report` | Report generation, query/detail assembly, export, sharing | `ReportController` | `ReportGenerationService`, `ReportDetailQueryService`, `ReportSummaryQueryService`, `ReportShareService`, `ReportExportService` | `ReportMapper`, `ReportShareMapper`, OpenAPI and report response DTOs |
| `auth` / `project` | User auth, refresh sessions, project access/bootstrap | `AuthController`; project is mostly application/infrastructure | `AuthService`, `ProjectAccessService`, `DefaultProjectService`, `ProjectBootstrapService` | `UserAccountMapper`, `UserCredentialMapper`, `RefreshTokenRepository`, `ProjectAccessMapper`, `ProjectBootstrapMapper` |
| `mcp` | Run query tools and decision gateway/pending-decision tool surfaces | `WedgeRunMcpTools`, `McpDecisionGatewayTools`, `McpPendingDecisionTools`, `McpDecisionGatewayController` | `McpRunQueryService`, `McpDecisionGatewayService`, `McpDecisionSessionService`, `McpPendingDecisionResolutionService` | in-memory registries, MCP tool contracts |
| `common` | Security, response envelope, errors, request IDs, outbox, processed message storage | filters/controllers/config | `JwtTokenProvider`, `InternalServiceTokenFilter`, `OutboxMessagePersistenceAdapter`, `ProcessedMessagePersistenceAdapter` | `OutboxMessageMapper`, `ProcessedMessageMapper`, response/error DTOs |

## Large / High-Risk Anchors

The following anchors were selected because line counts and responsibilities suggest higher review yield:

- `JudgeResultPersistenceService` (498 lines): Analyzer callback projection into analysis job, findings, rules, and nudges.
- `RunService` (243 lines), `RunnerCallbackService` (346 lines), `RunMapper.xml` (422 lines): run lifecycle, status transitions, callback writes, query/read models.
- `EvidenceService` (342 lines), `CheckpointPersistenceService` (286 lines): artifact/checkpoint/evidence packet persistence and retrieval.
- `ScenarioAuthoringJobService` (462 lines): job creation, validation, provider policy, confirmation, outbox integration.
- `ReportDetailQueryService` (396 lines), `ReportGenerationService` (269 lines): report assembly and generated report persistence.
- `DiscoveryService` (240 lines), `DiscoveryCallbackService` (169 lines): discovery start/callback/recommendation persistence.
- `RunnerAgentIdempotencyService` (228 lines), idempotency mapper XMLs: duplicate execution and retry safety.

## Entrypoint Groups

### Public APIs

- `/api/auth/*`: signup, login, refresh, logout, me.
- `/api/discoveries`: create and query discovery jobs.
- `/api/scenario-authoring-jobs`: create, fetch, and confirm authoring jobs.
- `/api/runs/*`: create/list/read/delete/start/agent-start/stop/live/steps/events/artifacts/signals/evidence packet.
- `/api/runs/{runId}/analysis`: request analysis.
- `/api/runs/{runId}/report*`, `/api/reports/*`, `/api/report-shares/*`: report generation, detail, share, and shared artifact access.

### Internal APIs

- `/internal/runner/runs/{runId}/*`: runner accepted, step events, checkpoints, artifacts, finished, failed, control state, agent events/traces.
- `/internal/runner/discoveries/{discoveryId}/*`: discovery accepted, checkpoints, finished, failed.
- `/internal/runner/scenario-authoring-jobs/{authoringJobId}/*`: authoring accepted, finished, failed.
- `/internal/runner/agent-idempotency/*` and `/internal/runner/message-idempotency/*`: idempotency lookup/record/claim/renew/release.
- `/internal/analysis/jobs/{analysisJobId}/*`: Analyzer started/completed/failed callback.
- `/internal/analysis/evidence-packets/{evidencePacketId}`: Analyzer evidence fetch.
- `/internal/agent/mcp/*`: agent decision gateway and pending decision polling.

## Review Risk Axes

- Service responsibility overload and unclear domain/application/infrastructure boundaries.
- State transition correctness and invariant ownership.
- Duplicate, late, or concurrent callback handling.
- Transaction boundaries, `AFTER_COMMIT` event dispatch, `REQUIRES_NEW` outbox behavior, and recovery after publish failure.
- Query and mapper performance, pagination, projection, large JSON payload handling, and implicit index assumptions.
- Contract-first consistency between Java DTOs, MyBatis records, OpenAPI, JSON schemas, examples, and docs.
- Authorization and trust boundary enforcement for public APIs, internal callbacks, shared report URLs, and artifact access.
- Error response shape and recoverability.
- Observability: request IDs, logs, stuck job diagnosis, outbox retry visibility, dead-letter recovery.
- Tests that lock failure scenarios rather than only happy paths.

## Stop Condition

This review phase is complete only when all packet and lens markdown files exist under `review/api-server`, and synthesis files `90-merged-findings.md`, `91-hotspots.md`, and `99-refactor-plan-input.md` summarize the review evidence without modifying source code.
