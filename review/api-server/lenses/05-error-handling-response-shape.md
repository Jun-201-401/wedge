# Lens 05 - error-handling-response-shape

## Scope

Cross-packet review of controller/service error handling, exception mapping, response shape, stale success responses, partial failure behavior, and OpenAPI error contracts.

## Summary

The common failure mode is optimistic success: services often persist partial state or default required fields, then return a success response while guarded updates, schema validation, or downstream side effects have failed or no-oped.

## Findings

### HIGH - Analyzer terminal callbacks can report success after stale guarded updates

Evidence:

- `saveCompleted` and `saveFailed` ignore `updateCurrentAnalysisState` row counts: `apps/api-server/src/main/java/com/wedge/analysis/application/JudgeResultPersistenceService.java:101`, `:108`.
- SQL is guarded by `latest_analysis_job_id`: `apps/api-server/src/main/resources/mapper/run/RunMapper.xml:301-310`.
- Terminal upserts can rewrite `analysis_job.run_id`: `apps/api-server/src/main/resources/mapper/analysis/AnalysisJobMapper.xml:74-76`, `:97-100`.
- Success response is still built after persistence: `apps/api-server/src/main/java/com/wedge/analysis/application/JudgeResultPersistenceService.java:389-396`.

Failure scenario:

A callback for an old or wrong job persists projections, guarded run update no-ops, and API still returns completed/failed.

Fix direction:

Validate existing job/run/current-job relation before terminal writes and reject zero-row guarded updates as `STATE_CONFLICT` unless idempotent.

### HIGH - Evidence packet materialization returns stale success

Evidence:

- Fresh packet counts are built: `apps/api-server/src/main/java/com/wedge/evidence/application/EvidenceService.java:171-187`.
- Upsert conflict leaves old JSON/counts intact: `apps/api-server/src/main/resources/mapper/evidence/EvidencePacketMapper.xml:25-37`.
- New analysis queues against the returned packet id: `apps/api-server/src/main/java/com/wedge/analysis/application/AnalysisRequestService.java:64-71`.

Failure scenario:

Late evidence arrives after first analysis; second analysis request returns accepted but Analyzer receives the first snapshot.

Fix direction:

Make snapshots immutable per analysis or refresh packet content on conflict.

### HIGH - Outbox marks messages `PUBLISHED` before broker delivery is proven

Evidence:

- Dispatchers call publisher then mark published: `apps/api-server/src/main/java/com/wedge/run/application/RunExecuteOutboxDispatcher.java:45-49`, `apps/api-server/src/main/java/com/wedge/analysis/application/AnalysisRequestOutboxDispatcher.java:44-48`.
- Publishers use `RabbitTemplate.convertAndSend` without confirms: `apps/api-server/src/main/java/com/wedge/run/infrastructure/RabbitRunRequestPublisher.java:37-40`.
- Prod Rabbit config has no publisher confirm/return settings: `apps/api-server/src/main/resources/application-prod.yml:14-18`.

Failure scenario:

Unroutable or negatively confirmed publish is marked `PUBLISHED`; retry stops and the run/analysis remains queued.

Fix direction:

Enable publisher confirms/returns and mark `PUBLISHED` only after positive confirm, or rename state to attempted-publish and expose failure.

### HIGH - Required contract fields are defaulted into successful responses

Evidence:

- `JudgeResultPersistenceService` defaults missing issue fields to fallback values: `apps/api-server/src/main/java/com/wedge/analysis/application/JudgeResultPersistenceService.java:203-218`, `:382`, `:467-488`.
- `ReportGenerationService` converts missing `summary`/`decision_map` to `{}`/`[]` while setting report `READY`: `apps/api-server/src/main/java/com/wedge/report/application/ReportGenerationService.java:112-124`, `:261-268`.

Failure scenario:

Malformed Analyzer output becomes persisted findings and a ready empty report instead of a contract error.

Fix direction:

Validate JudgeResult against shared schema before completion/report generation and remove defaults for required fields.

### MEDIUM - Report export can return stale ready data

Evidence:

- `ReportExportService.findReadyReport` selects a ready report when `analysisJobId` is null: `apps/api-server/src/main/java/com/wedge/report/application/ReportExportService.java:68-80`.
- Report generation ignores guarded update count: `apps/api-server/src/main/java/com/wedge/report/application/ReportGenerationService.java:75-82`.

Failure scenario:

Newer analysis exists without a matching report, but export returns an older report as current.

Fix direction:

Export only the report matching latest analysis, or require explicit matching `analysisJobId`.

### MEDIUM - Infrastructure failures are masked as client failures

Evidence:

- JWT filter catches broad `Exception` and emits `invalid_token`: `apps/api-server/src/main/java/com/wedge/common/security/JwtAuthenticationFilter.java:61-72`.
- S3 missing content is mapped to `RUN_NOT_FOUND`: `apps/api-server/src/main/java/com/wedge/evidence/infrastructure/S3ArtifactContentStore.java:57-63`.

Failure scenario:

DB/S3 outage appears as 401/404 client state instead of 5xx or artifact-specific failure.

Fix direction:

Catch JWT verification exceptions narrowly. Add artifact-specific error codes such as `artifact_not_found`.

### MEDIUM - Partial failure paths silently degrade payloads

Evidence:

- Signed URL decoration catches runtime failures and returns packet without URLs: `apps/api-server/src/main/java/com/wedge/evidence/application/EvidencePacketSignedUrlDecorator.java:83-116`.
- MCP registry can return expired record unchanged, while resolver still returns `resolved=true`: `apps/api-server/src/main/java/com/wedge/mcp/gateway/infrastructure/InMemoryMcpPendingDecisionRegistry.java:87-99`, `apps/api-server/src/main/java/com/wedge/mcp/gateway/application/McpPendingDecisionResolutionService.java:80-88`.

Failure scenario:

Analyzer receives no signed URL with only a warning; MCP client sees resolved success with null decision after TTL expiry.

Fix direction:

Expose partial diagnostics or count successful signed URLs. Require completed status and non-null decision before `resolved=true`.

### MEDIUM - OpenAPI error-code schema does not match runtime

Evidence:

- Runtime error codes are lowercase strings: `apps/api-server/src/main/java/com/wedge/common/error/ErrorCode.java:5-23`.
- OpenAPI defines uppercase/generic codes: `packages/contracts/openapi/wedge_openapi.yaml:3238-3268`.

Failure scenario:

Generated clients reject or misclassify real error bodies.

Fix direction:

Align OpenAPI with actual lowercase runtime codes or change runtime serialization to documented enum.

### MEDIUM - Discovery checkpoint duplicate behavior is inconsistent

Evidence:

- Run checkpoint insert ignores duplicate keys: `apps/api-server/src/main/resources/mapper/evidence/CheckpointMapper.xml:75-88`.
- Discovery checkpoint insert lacks equivalent handling: `apps/api-server/src/main/resources/mapper/evidence/CheckpointMapper.xml:90-102`.
- Discovery callback persists checkpoints after checking only existence: `apps/api-server/src/main/java/com/wedge/discovery/application/DiscoveryCallbackService.java:68-79`.

Failure scenario:

Duplicate discovery checkpoint under a new event id returns a global conflict instead of idempotent ack; late checkpoints mutate terminal discovery evidence.

Fix direction:

Align discovery insert with run insert and define terminal checkpoint policy.

