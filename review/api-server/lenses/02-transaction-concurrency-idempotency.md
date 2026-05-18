# Lens 02 - transaction-concurrency-idempotency

## Scope

Cross-packet review of transaction boundaries, state transitions, row-count checks, duplicate callback handling, outbox dispatch, and idempotency predicates.

## Architectural Status

`BLOCK`.

The API server has useful primitives: transactional handlers, `processed_message` envelope dedupe, expected-status SQL updates, and `FOR UPDATE SKIP LOCKED` outbox selection. The blocking pattern is that several guarantees are weaker than their names/contracts imply: terminal callbacks can rewrite ownership/state, outbox success is not broker-confirmed, event idempotency is envelope-level rather than item-level, and stale snapshots/events can become canonical.

## Findings

### HIGH - Analyzer terminal callbacks can create/reassign jobs

Evidence:

- `AnalyzerCallbackService` validates only path/body `analysisJobId`: `apps/api-server/src/main/java/com/wedge/analysis/api/internal/AnalyzerCallbackService.java:53`.
- Terminal persistence upserts from callback body: `apps/api-server/src/main/java/com/wedge/analysis/application/JudgeResultPersistenceService.java:94`, `:106`.
- SQL rewrites `analysis_job.run_id` on conflict: `apps/api-server/src/main/resources/mapper/analysis/AnalysisJobMapper.xml:74`, `:98`.
- Guarded run update row count is ignored: `apps/api-server/src/main/resources/mapper/run/RunMapper.xml:301`, `apps/api-server/src/main/java/com/wedge/analysis/application/JudgeResultPersistenceService.java:101`.

Failure scenario:

A terminal callback for a stored `analysisJobId` but wrong `runId`, or for an unrequested job, can insert/rewrite ownership and projections while the intended run update silently no-ops.

Fix direction:

Load/lock the existing job before terminal writes. Require stored job id/run id/lifecycle/current-run linkage to match. Never rewrite `run_id` from callback payload.

### HIGH - Completed/failed Analyzer callbacks are not monotonic

Evidence:

- `saveCompleted()` always upserts completed and clears/reinserts projections: `apps/api-server/src/main/java/com/wedge/analysis/application/JudgeResultPersistenceService.java:94`.
- `saveFailed()` always upserts failed and does not clear completed projection rows: `apps/api-server/src/main/java/com/wedge/analysis/application/JudgeResultPersistenceService.java:106`.
- Terminal SQL overwrites status on conflict: `apps/api-server/src/main/resources/mapper/analysis/AnalysisJobMapper.xml:74`, `:97`.

Failure scenario:

`completed` persists findings, then `failed` with a new event id flips status to failed while completed projections remain queryable.

Fix direction:

Allow terminal transitions only from non-terminal states. For terminal replays, require same identity/payload or raise `STATE_CONFLICT`.

### HIGH - Outbox `PUBLISHED` is not broker-confirmed

Evidence:

- Dispatchers mark rows published after `publish()`: `apps/api-server/src/main/java/com/wedge/run/application/RunExecuteOutboxDispatcher.java:47`.
- Publisher uses plain `RabbitTemplate.convertAndSend`: `apps/api-server/src/main/java/com/wedge/run/infrastructure/RabbitRunRequestPublisher.java:39`.
- Outbox row transitions to `PUBLISHED`: `apps/api-server/src/main/resources/mapper/common/outbox/OutboxMessageMapper.xml:61`.

Failure scenario:

Missing binding, wrong route, or negative broker confirmation removes the row from retry and loses the command.

Fix direction:

Enable publisher confirms/returns with mandatory publishing, then mark `PUBLISHED` only after positive confirmation.

### HIGH - EvidencePacket snapshots can be stale for later analysis

Evidence:

- Materialization assembles current evidence: `apps/api-server/src/main/java/com/wedge/evidence/application/EvidenceService.java:171`.
- Upsert conflicts on `(run_id, schema_version)` and does not refresh packet JSON/counts: `apps/api-server/src/main/resources/mapper/evidence/EvidencePacketMapper.xml:25`, `:32`.
- New analysis jobs reference the returned packet id: `apps/api-server/src/main/java/com/wedge/analysis/application/AnalysisRequestService.java:64`.

Failure scenario:

Late evidence arrives after first analysis; second analysis still gets the old packet id.

Fix direction:

Use immutable per-analysis snapshots or true refresh-on-conflict semantics.

### MEDIUM - Runner step/event idempotency is too coarse

Evidence:

- Step events append a run event then update step state: `apps/api-server/src/main/java/com/wedge/run/application/RunnerCallbackService.java:197`.
- SQL overwrites step status without stale-event predicates: `apps/api-server/src/main/resources/mapper/run/RunMapper.xml:313`.
- Generic timeline has no runner item-event uniqueness: `docs/wedge_schema.sql:253`.
- Agent events dedupe in `runner_agent_event` but still append generic timeline rows: `apps/api-server/src/main/resources/mapper/run/RunMapper.xml:344`, `apps/api-server/src/main/java/com/wedge/run/application/RunnerCallbackService.java:167`.

Failure scenario:

A delayed `STEP_STARTED` can regress a completed step; retried agent events can duplicate UI timeline rows.

Fix direction:

Persist per-item event ids or a callback-item ledger. Add step transition and occurred-at monotonic checks.

### MEDIUM - Agent step creation is read-then-insert

Evidence:

- `resolveOrCreateAgentStep` reads then inserts: `apps/api-server/src/main/java/com/wedge/run/infrastructure/RunPersistenceAdapter.java:155`.
- DB has unique `(run_id, step_order)` and `(run_id, step_key)` constraints: `docs/wedge_schema.sql:248`.

Failure scenario:

Concurrent callbacks for the same agent step both miss and insert; one fails with duplicate key.

Fix direction:

Use atomic upsert/reselect or catch duplicate-key and re-read.

### MEDIUM - Discovery checkpoint duplicate handling differs from run checkpoints

Evidence:

- Run checkpoint insert ignores duplicate `(run_id, checkpoint_key)`: `apps/api-server/src/main/resources/mapper/evidence/CheckpointMapper.xml:75`, `:87`.
- Discovery checkpoint insert lacks equivalent conflict handling: `apps/api-server/src/main/resources/mapper/evidence/CheckpointMapper.xml:90`.
- Service expects zero-row insert to re-read existing checkpoint: `apps/api-server/src/main/java/com/wedge/evidence/application/CheckpointPersistenceService.java:86`.

Failure scenario:

Same discovery checkpoint arrives under a new event id and rolls back with duplicate key instead of idempotent ack.

Fix direction:

Add `ON CONFLICT (discovery_id, checkpoint_key) DO NOTHING` or catch/reload duplicates.

### MEDIUM - Late evidence policy is undefined

Evidence:

- Discovery checkpoint path persists after only checking discovery existence: `apps/api-server/src/main/java/com/wedge/discovery/application/DiscoveryCallbackService.java:77`.
- Run checkpoint/artifact callbacks persist regardless of terminal checks used by step events: `apps/api-server/src/main/java/com/wedge/run/application/RunnerCallbackService.java:100`, `:118`.

Failure scenario:

`finished` commits, then delayed checkpoint/artifact changes latest evidence and later analysis/report inputs.

Fix direction:

Explicitly reject late evidence after terminal state, or persist it as late evidence with a visible status.

### MEDIUM - Idempotency predicates are narrow

Evidence:

- Scenario authoring create replays by idempotency key without request hash comparison: `apps/api-server/src/main/java/com/wedge/scenarioauthoring/application/ScenarioAuthoringJobService.java:60`.
- Agent completion matches less identity than renew/release: `apps/api-server/src/main/resources/mapper/run/AgentIdempotencyMapper.xml:78`, `:91`, `:102`.
- Runner message idempotency is first-writer terminal record only: `apps/api-server/src/main/java/com/wedge/run/application/RunnerMessageIdempotencyService.java:38`.

Failure scenario:

Same idempotency key aliases a different public request, or stale worker context completes a different attempt.

Fix direction:

Store request hashes for public idempotency, match full lease identity for agent completion, and add in-progress claims before duplicate-prone terminal work.

## Test Gaps

- Analyzer wrong-run/nonexistent-job/completed-then-failed/failed-then-completed tests.
- Outbox negative-confirm, poison-payload, and max-attempt exhaustion tests.
- Evidence second-materialization test after evidence changes.
- Runner out-of-order step event and duplicate item event tests.
- Discovery duplicate checkpoint and late checkpoint tests.
- Scenario authoring same key with different body.
- Agent completion with mismatched run/task/attempt.
- Report stale latest-analysis race tests.

