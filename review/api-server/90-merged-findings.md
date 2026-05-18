# 90 - merged findings

## Scope

Deduplicated synthesis from:

- `packets/01` through `packets/09`
- `lenses/01` through `lenses/07`

No source code was edited during this review.

## Executive Verdict

The API server is not merge-ready for production hardening. No single category explains the risk; the repeated pattern is boundary drift:

- human authorization is sometimes controller-local and can be skipped;
- internal callbacks can mutate canonical state without validating stored aggregate ownership;
- contract-first artifacts exist but are not executable gates;
- outbox/idempotency primitives exist but their semantics are weaker than their names imply;
- read models and snapshots can report stale success;
- operational failures can disappear into logs or non-terminal states.

## Severity Summary

| Severity | Count | Notes |
| --- | ---: | --- |
| CRITICAL | 0 | No immediate unauthenticated remote exploit was confirmed. |
| HIGH | 16 | Must address before production/default use. |
| MEDIUM | 17 | Should address with the same refactor/test wave where related. |
| LOW | 0 | Taste/style-only comments were intentionally excluded. |

## HIGH Findings

### H01 - Agent run start skips project authorization

- Category: `security-authz-risk`, `confirmed-bug`
- Sources: Packet 02, Packet 07, Lens 04, Lens 06
- Evidence: `RunController.startAgentRun` accepts only `runId` and calls service directly: `apps/api-server/src/main/java/com/wedge/run/api/RunController.java:104-110`; other run paths use project access checks: `apps/api-server/src/main/java/com/wedge/run/api/RunController.java:242`.
- Failure scenario: an authenticated user starts agent execution for a run in another project.
- Fix direction: add `RunAccessGuard` or require `userId` in run mutation commands; add cross-project forbidden regression test.

### H02 - Analyzer terminal callbacks can create/reassign jobs and cross run ownership

- Category: `transaction-concurrency-risk`, `security-authz-risk`, `confirmed-bug`
- Sources: Packet 01, Lens 02, Lens 04, Lens 05
- Evidence: callback validation checks path/body id only: `AnalyzerCallbackService.java:53`; terminal upserts from callback body: `JudgeResultPersistenceService.java:94`, `:106`; SQL rewrites `analysis_job.run_id`: `AnalysisJobMapper.xml:74`, `:98`.
- Failure scenario: a terminal callback for an unrequested job or wrong `runId` persists projections and silently no-ops current-run update.
- Fix direction: load/lock stored job, verify run/current-job ownership and legal state transition, and never rewrite `run_id` from callback payload.

### H03 - Analyzer terminal state is not monotonic

- Category: `transaction-concurrency-risk`, `confirmed-bug`
- Sources: Packet 01, Lens 02, Lens 05
- Evidence: `saveCompleted()` always clears/reinserts projections: `JudgeResultPersistenceService.java:94`; `saveFailed()` upserts failed without clearing completed projections: `JudgeResultPersistenceService.java:106`.
- Failure scenario: completed then failed with different event ids leaves failed job state with completed projection rows.
- Fix direction: terminal transitions only from non-terminal states; terminal replays require matching idempotent payload or return conflict.

### H04 - JudgeResult is not contract-validated before completion/reporting

- Category: `contract-mismatch`, `confirmed-bug`
- Sources: Packet 01, Packet 06, Lens 03, Lens 05, Lens 06
- Evidence: schema requires `summary`, `decision_map`, `rule_registry_id`: `packages/contracts/schemas/judge-result.schema.json:6`; API accepts raw maps: `AnalyzerCompletedRequest.java:17`; persistence defaults missing required fields: `JudgeResultPersistenceService.java:203-218`.
- Failure scenario: schema-invalid Analyzer output becomes completed analysis and ready report with fallback/empty data.
- Fix direction: validate against shared schema before `COMPLETED` and before report generation; persist `rule_registry_id`; remove defaults for required fields.

### H05 - EvidencePacket snapshots can be stale

- Category: `query-performance-risk`, `transaction-concurrency-risk`, `confirmed-bug`
- Sources: Packet 03, Lens 01, Lens 02, Lens 05, Lens 06
- Evidence: fresh packet is assembled: `EvidenceService.java:171`; conflict upsert returns existing row without refreshing JSON/counts: `EvidencePacketMapper.xml:25`.
- Failure scenario: late evidence arrives after first analysis; a second analysis references stale packet bytes.
- Fix direction: immutable per-analysis snapshots or true refresh-on-conflict semantics tied to `analysis_job.evidence_packet_id`.

### H06 - Outbox marks messages `PUBLISHED` before broker-confirmed delivery

- Category: `transaction-concurrency-risk`, `observability-ops-gap`, `confirmed-bug`
- Sources: Packet 09, Lens 02, Lens 05, Lens 07
- Evidence: dispatchers mark published after `publish()`: `RunExecuteOutboxDispatcher.java:47`; publishers use plain `convertAndSend`: `RabbitRunRequestPublisher.java:39`; prod config lacks confirm/return settings: `application-prod.yml:14-18`.
- Failure scenario: unroutable/negative broker delivery is removed from retry and command is lost.
- Fix direction: enable publisher confirms/returns with mandatory publish and mark `PUBLISHED` only after positive confirmation.

### H07 - Outbox retry exhaustion is invisible

- Category: `observability-ops-gap`, `transaction-concurrency-risk`
- Sources: Packet 09, Lens 07, Lens 06
- Evidence: schema status has only `PENDING/PUBLISHED/FAILED`: `docs/wedge_schema.sql:518-528`; retry query excludes max attempts: `OutboxMessageMapper.xml:51-55`; no `last_error`/`exhausted_at`.
- Failure scenario: failed rows stop retrying but remain merely `FAILED`, with no terminal state or alert field.
- Fix direction: add `EXHAUSTED`/`DEAD_LETTERED`, last error, exhausted timestamp, metric, and operational query.

### H08 - DLQs are configured without full aggregate settlement

- Category: `observability-ops-gap`, `transaction-concurrency-risk`
- Sources: Packet 09, Lens 07, Lens 06
- Evidence: discovery/scenario DLQs exist: `RunnerMqConfig.java:66-101`; analysis DLQ exists: `AnalysisMqConfig.java:14-30`; listener handles only run/agent: `RunnerExecutionDeadLetterListener.java:28-34`.
- Failure scenario: poisoned discovery/scenario/analysis command lands in DLQ while aggregate remains queued/running.
- Fix direction: add domain DLQ listeners or generic DLQ dispatcher that marks owning aggregate failed with `x-death` metadata.

### H09 - MCP service token grants broad run read/decision binding

- Category: `security-authz-risk`, `deferred-design-decision`
- Sources: Packet 08, Lens 03, Lens 04, Lens 07
- Evidence: MCP gets shared principal: `InternalServiceTokenFilter.java:85-90`; run query calls `RunService.getRun`: `McpRunQueryService.java:17-19`; session register accepts run id without scope/project checks: `McpDecisionSessionService.java:16-29`.
- Failure scenario: a token-bearing MCP client reads guessed run ids or registers as decision host for a run it should not control.
- Fix direction: introduce MCP client identity, `wedge.read`/`wedge.decide` scopes, project/run/session ownership checks, and audit.

### H10 - MCP pending decision resolution is not atomic

- Category: `transaction-concurrency-risk`, `deferred-design-decision`
- Sources: Packet 08, Lens 02, Lens 05
- Evidence: pending selection is read-before-sample: `InMemoryMcpPendingDecisionRegistry.java:75-84`; completion can overwrite: `InMemoryMcpPendingDecisionRegistry.java:87-110`.
- Failure scenario: two resolver calls sample and complete the same pending decision; later result overwrites earlier result.
- Fix direction: atomic `PENDING -> RESOLVING -> COMPLETED` claim with idempotent duplicate handling.

### H11 - Internal callback HMAC is uneven and partly fail-open

- Category: `security-authz-risk`, `contract-mismatch`
- Sources: Packet 01, Packet 05, Packet 07, Lens 03, Lens 04
- Evidence: runner HMAC returns true if secret blank: `InternalServiceTokenFilter.java:128-130`; analyzer sends/requires `X-Signature`: `AnalyzerCallbackController.java:47`, `apps/analyzer/app/clients/spring_callback.py:79-90`; filter verifies HMAC only for `/internal/runner/**`.
- Failure scenario: bearer-token holder can forge analyzer callbacks despite signature contract; runner HMAC can be disabled by missing secret.
- Fix direction: verify analyzer signatures or remove signature contract; fail closed in non-local profiles when runner HMAC secret is absent.

### H12 - Discovery SSRF guard is only API-time

- Category: `security-authz-risk`
- Sources: Packet 04, Lens 04, Lens 06
- Evidence: API validates resolved address: `DiscoveryUrlValidator.java:54-64`; execute message still sends original URL: `DiscoveryExecuteRequestMessageFactory.java:25-30`.
- Failure scenario: DNS rebinding or redirect sends Runner/browser to localhost or metadata IP after initial validation.
- Fix direction: enforce network guard at Runner/browser fetch boundary, including redirects/re-resolution, or pass pinned resolution policy.

### H13 - Project access permits archived projects

- Category: `security-authz-risk`, `confirmed-bug`
- Sources: Packet 07, Lens 04, Lens 06
- Evidence: access service calls `existsActiveProject`: `ProjectAccessService.java:18-24`; mapper checks only `deleted_at IS NULL`: `ProjectAccessMapper.xml:4-10`; schema has `ACTIVE/ARCHIVED`.
- Failure scenario: member of archived project can create runs/discoveries/authoring jobs.
- Fix direction: require `project.status = 'ACTIVE'` and active membership in the access predicate.

### H14 - Default project bootstrap can regrant `OWNER`

- Category: `security-authz-risk`, `ddd-responsibility-refactor`
- Sources: Packet 07, Lens 04, Lens 06
- Evidence: `DefaultProjectService` always ensures membership: `DefaultProjectService.java:24-31`; mapper updates role to `OWNER` on conflict: `ProjectAccessMapper.xml:72-78`.
- Failure scenario: discovery without `projectId` restores/upgrades old default project membership.
- Fix direction: do not mutate existing membership during default resolution; use `ON CONFLICT DO NOTHING` or explicit audited regrant.

### H15 - Refresh tokens are stored as reusable bearer secrets

- Category: `security-authz-risk`
- Sources: Packet 07, Lens 04
- Evidence: full refresh JWT stored/compared in Redis: `RefreshTokenRepository.java:27-40`; raw token passed from `AuthService`: `AuthService.java:110-120`.
- Failure scenario: Redis snapshot/read leak exposes live refresh JWTs.
- Fix direction: store keyed digest/JTI only and compare digests atomically during rotation.

### H16 - Contracted project APIs are unreachable/not implemented

- Category: `contract-mismatch`, `confirmed-bug`
- Sources: Packet 07
- Evidence: docs/OpenAPI list `/api/projects`; security config authenticates selected API families then denies `/api/**`: `SecurityConfig.java:70`, `:85`; JWT human paths omit `/api/projects`: `JwtAuthenticationFilter.java:23`.
- Failure scenario: generated/frontend client follows contract and receives denied/unreachable project API.
- Fix direction: implement and secure `/api/projects/**`, or remove from public contract until available.

## MEDIUM Findings

### M01 - Runner step events can regress state and duplicate timeline rows

- Category: `transaction-concurrency-risk`
- Evidence: step updates overwrite status: `RunMapper.xml:313`; item-level uniqueness missing in generic timeline.
- Fix direction: item event ledger, monotonic transition predicates, append timeline only for newly inserted item event.

### M02 - Discovery checkpoint duplicate handling differs from run checkpoints

- Category: `transaction-concurrency-risk`, `error-handling-response-shape`
- Evidence: run checkpoint insert has conflict-ignore; discovery checkpoint insert does not: `CheckpointMapper.xml:75-102`.
- Fix direction: align discovery insert with run conflict handling or catch/reload duplicates.

### M03 - Late evidence policy is undefined

- Category: `deferred-design-decision`, `transaction-concurrency-risk`
- Evidence: discovery/run checkpoint paths persist after terminal checks are not consistently applied.
- Fix direction: reject late evidence after terminal state or persist with explicit late status and tests.

### M04 - Scenario authoring trusts provider validation booleans

- Category: `contract-mismatch`, `ddd-responsibility-refactor`
- Evidence: Packet 05 found Spring accepts provider validation results without independently validating candidate/ScenarioPlan shape.
- Fix direction: validate provider output against contract before `READY`.

### M05 - Scenario authoring create idempotency lacks request hash comparison

- Category: `transaction-concurrency-risk`
- Evidence: create replay keyed by project/user/idempotency key only.
- Fix direction: persist canonical request hash and reject same key with different body.

### M06 - Report export can return stale report data

- Category: `confirmed-bug`, `query-performance-risk`
- Evidence: `ReportExportService` selects first ready report when `analysisJobId` is null: `ReportExportService.java:68-80`.
- Fix direction: export current latest-analysis report or require matching `analysisJobId`.

### M07 - Report detail/export mixes snapshots with live projections

- Category: `ddd-responsibility-refactor`, `query-performance-risk`
- Evidence: report stores summary/decision map, detail reads findings/nudges live.
- Fix direction: decide report snapshot vs live-handle model and enforce it.

### M08 - Shared report token grants run-image-wide artifact access

- Category: `security-authz-risk`
- Evidence: `ReportShareService` delegates by run id/artifact id; `EvidenceService` allows any image artifact in run.
- Fix direction: restrict to report-referenced artifact ids or document/test run-wide image access.

### M09 - Whole-run evidence reads and callback payloads are unbounded

- Category: `query-performance-risk`
- Evidence: evidence service loads all artifacts/checkpoints/observations and callback batch has no max.
- Fix direction: limits, paging/windowing, packet byte guard, aggregate summary queries.

### M10 - Artifact/blob reads load full objects into memory

- Category: `query-performance-risk`
- Evidence: S3 content store uses `getObjectAsBytes`.
- Fix direction: streaming response, presigned URL for large objects, size/type limits.

### M11 - Report summary/detail has N+1-style fan-out

- Category: `query-performance-risk`
- Evidence: report summary/detail performs per-report/per-finding/per-checkpoint lookups.
- Fix direction: batch query top findings, screenshots, and checkpoint metadata.

### M12 - Indexes do not fully match read paths

- Category: `query-performance-risk`
- Evidence: event/recommendation/finding ordering does not fully match schema indexes.
- Fix direction: add access-path indexes and high-cardinality fixtures.

### M13 - MCP in-memory registries are unbounded

- Category: `observability-ops-gap`, `deferred-design-decision`
- Evidence: pending/session maps retain completed/expired entries.
- Fix direction: bounded cleanup or Redis/DB TTL store.

### M14 - MCP resolved response can hide expiry/null decision

- Category: `error-handling-response-shape`
- Evidence: resolver returns resolved from completed record without requiring `COMPLETED` and non-null decision.
- Fix direction: return expired/conflict if completion did not produce a valid decision.

### M15 - MQ idempotency/correlation fields are optional in schema

- Category: `contract-mismatch`
- Evidence: MQ schema defines but does not require `correlationId`/`idempotencyKey`.
- Fix direction: require fields or document fallback duplicate-handling contract.

### M16 - Error code contract does not match runtime

- Category: `contract-mismatch`, `error-handling-response-shape`
- Evidence: runtime serializes lowercase codes; OpenAPI lists uppercase/generic enum.
- Fix direction: align OpenAPI and runtime error code schema.

### M17 - Signed URL generation silently degrades packets

- Category: `error-handling-response-shape`, `observability-ops-gap`
- Evidence: signed URL decoration catches runtime failures and continues without explicit packet diagnostics.
- Fix direction: surface partial diagnostics and metrics by artifact/reason.

## Cross-Cutting Root Causes

1. Boundary ownership is split between controllers, services, mappers, and contracts.
2. Contract artifacts are not executable tests.
3. Idempotency is mostly envelope-level; item-level/event-level replay is under-specified.
4. "Latest/current" semantics are spread across query ordering, run projection fields, and ignored row counts.
5. Operational failure states are not first-class domain states.

