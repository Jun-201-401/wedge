# Lens 07 - observability-ops

## Scope

Cross-packet review of runtime visibility, audit logs, operational failure states, metrics, DLQ handling, outbox diagnostics, callback failure traceability, and production gates.

## Summary

Actuator is present, but the high-risk flows are mostly observable only through ordinary logs and persisted domain status. Several failure paths can become operationally invisible: outbox exhaustion, partial signed URL generation, MCP pending expiry/failure, unhandled DLQs, stale guarded updates, and analyzer/runner callback conflicts.

## Findings

### HIGH - MCP audit table exists in design/DDL but implemented tool calls are not logged

Evidence:

- Schema defines `mcp_invocation_log`: `docs/wedge_schema.sql:503-516`.
- Design requires all MCP tool calls to be recorded: `docs/mcp_server_design.md:435-437`.
- Production gate requires MCP invocation audit log and pending decision metrics: `docs/mcp_pending_decision_e2e_verification.md:458-466`.
- Reviewed MCP create/resolve/read code has no mapper/service writing `mcp_invocation_log`; `rg` found no `MeterRegistry`, `Counter`, `Timer`, or `ObservationRegistry` usage under `apps/api-server`.

Failure scenario:

MCP read/decision abuse, expiry, or sampling failure cannot be correlated to client/session/project/run in production.

Fix direction:

Add an MCP audit service around every tool/internal gateway entry with client identity, project/run, tool, status, request/response summaries, and error code. Add counters/timers for pending created/resolved/expired/failed.

### HIGH - Outbox failure exhaustion is not operationally visible

Evidence:

- Outbox status has only `PENDING`, `PUBLISHED`, and `FAILED`: `docs/wedge_schema.sql:518-528`.
- Retry query excludes rows at max attempts: `apps/api-server/src/main/resources/mapper/common/outbox/OutboxMessageMapper.xml:51-55`.
- `markFailed` stores only status and next attempt, not `last_error` or exhausted timestamp: `apps/api-server/src/main/resources/mapper/common/outbox/OutboxMessageMapper.xml:70-75`.

Failure scenario:

After max attempts, a failed row remains `FAILED` but is no longer selected. Operators have no terminal state, last error, or alert-specific field.

Fix direction:

Add `EXHAUSTED`/`DEAD_LETTERED`, `last_error`, `exhausted_at`, attempt metadata, operational query, and alert metric.

### HIGH - Configured DLQs do not all have state-settling listeners

Evidence:

- Discovery and scenario-authoring queues are configured with DLQs: `apps/api-server/src/main/java/com/wedge/common/infrastructure/RunnerMqConfig.java:66-101`.
- Analysis queue is configured with DLQ: `apps/api-server/src/main/java/com/wedge/analysis/infrastructure/AnalysisMqConfig.java:14-30`.
- Listener subscribes only to run and agent DLQs: `apps/api-server/src/main/java/com/wedge/run/infrastructure/RunnerExecutionDeadLetterListener.java:28-34`.

Failure scenario:

Poison discovery/scenario/analysis messages can land in DLQ while user-visible aggregate state remains queued/running.

Fix direction:

Add DLQ listeners for every configured queue or a generic message-type-based listener that marks owning aggregates failed and logs `x-death` metadata.

### MEDIUM - Broker publish failure diagnostics are insufficient

Evidence:

- Prod Rabbit config contains host/port/user/password but no publisher confirm/return settings: `apps/api-server/src/main/resources/application-prod.yml:14-18`.
- Dispatchers log warning and call `markFailed` when publisher throws, but successful `convertAndSend` is treated as published.

Failure scenario:

Unroutable messages can be marked published and disappear without an operational signal.

Fix direction:

Enable confirms/returns, record broker failure reason on outbox row, and publish metrics for confirm ack/nack/return.

### MEDIUM - Signed URL decoration silently degrades Analyzer input

Evidence:

- Signed URL generation failure is logged and returns false: `apps/api-server/src/main/java/com/wedge/evidence/application/EvidencePacketSignedUrlDecorator.java:101-116`.
- Packet creation continues without an explicit partial-failure field.

Failure scenario:

Analyzer receives no signed URL for relevant screenshots, but operators see only a warning and cannot tell from the packet why image evidence is missing.

Fix direction:

Add packet diagnostics for signed URL failures and metrics by artifact type/reason.

### MEDIUM - Stale row-count conflicts are not surfaced as operational events

Evidence:

- Analysis and report paths call guarded latest-run update queries but ignore zero-row results: `apps/api-server/src/main/java/com/wedge/analysis/application/JudgeResultPersistenceService.java:101`, `apps/api-server/src/main/java/com/wedge/report/application/ReportGenerationService.java:81`.
- Guarded SQL is intended to protect current analysis state: `apps/api-server/src/main/resources/mapper/run/RunMapper.xml:301-310`.

Failure scenario:

Stale callbacks or concurrent currentness races are accepted without explicit conflict response or metric.

Fix direction:

Treat zero-row guarded updates as `STATE_CONFLICT` and add counters/log fields for stale callback/currentness conflicts.

### MEDIUM - Actuator is installed but domain metrics are absent

Evidence:

- Actuator dependency exists: `apps/api-server/build.gradle:25`.
- Security exposes health: `apps/api-server/src/main/java/com/wedge/common/config/SecurityConfig.java:58`.
- No `MeterRegistry`, `Counter`, `Timer`, or `ObservationRegistry` usage was found under `apps/api-server`.

Failure scenario:

Production health can be green while domain queues, callbacks, pending decisions, and report/evidence materialization are failing or stale.

Fix direction:

Add domain counters/timers for callback accepted/rejected/idempotent/conflict, outbox due/published/failed/exhausted, DLQ settled, evidence packet materialized/stale, report generated/exported/stale, MCP pending states, and security denials.

## Operational Test Gaps

- Outbox max-attempt transition and alert-state test.
- DLQ listener tests for discovery/scenario/analysis.
- MCP audit log write and metric tests for success/failure/denial/expiry.
- Signed URL partial-failure diagnostic tests.
- Zero-row guarded update conflict tests.
- Smoke metric presence tests for critical counters.

