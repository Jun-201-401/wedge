# Packet 01 - analysis-judge-result-persistence

## Scope

Read-only review of Analyzer callback handling and JudgeResult persistence. This packet traces the flow from `/internal/analysis/jobs/{analysisJobId}` callbacks through analysis job persistence, projection rebuild, run analysis state update, and related contracts/tests.

## Flow Map

1. `AnalysisRequestService.requestPrimaryAnalysis()` creates `analysis_job`, sets run analysis state to `QUEUED`, materializes an EvidencePacket snapshot, and publishes `analysis.request`.
2. Analyzer calls `AnalyzerCallbackController` for `/started`, `/completed`, or `/failed`.
3. `AnalyzerCallbackService` validates required callback headers, validates path/body `analysisJobId`, records idempotency by consumer plus `X-Event-Id`, then delegates.
4. `JudgeResultPersistenceService` updates `analysis_job`, clears/rebuilds `rule_hit`, `analysis_finding`, and `nudge` projections, and calls `RunMapper.updateCurrentAnalysisState`.

## Files Reviewed

- `apps/api-server/src/main/java/com/wedge/analysis/api/internal/AnalyzerCallbackController.java`
- `apps/api-server/src/main/java/com/wedge/analysis/api/internal/AnalyzerCallbackService.java`
- `apps/api-server/src/main/java/com/wedge/analysis/api/internal/dto/*.java`
- `apps/api-server/src/main/java/com/wedge/analysis/application/AnalysisRequestService.java`
- `apps/api-server/src/main/java/com/wedge/analysis/application/JudgeResultPersistenceService.java`
- `apps/api-server/src/main/java/com/wedge/analysis/domain/*.java`
- `apps/api-server/src/main/java/com/wedge/analysis/infrastructure/*.java`
- `apps/api-server/src/main/resources/mapper/analysis/*.xml`
- `apps/api-server/src/main/resources/mapper/run/RunMapper.xml`
- `packages/contracts/internal/analyzer-callback.schema.json`
- `packages/contracts/schemas/judge-result.schema.json`
- relevant analysis/security/report tests and docs

## Invariants Expected

- Callback path `analysisJobId`, body `analysisJobId`, body `runId`, and stored `analysis_job.run_id` must agree.
- Terminal Analyzer callbacks must not create or reassign jobs that Spring never requested.
- Terminal state must be monotonic: `COMPLETED` and `FAILED` should not overwrite each other accidentally.
- JudgeResult must satisfy the shared contract before Spring marks analysis `COMPLETED`.
- Projection rows must reflect one canonical source of truth.
- Analyzer callback trust boundary must either validate signatures or explicitly be bearer-token-only.

## Failure Scenarios Checked

- Duplicate callback with the same `X-Event-Id`.
- Started callback after terminal job state.
- Completed/failed callback with mismatched `runId`.
- Completed then failed, or failed then completed, using different event ids.
- Schema-valid top-level `nudges` without nested `judgeResult.nudges`.
- Malformed JudgeResult maps with required fields missing.
- Stale/non-current analysis job callback.
- Analyzer `X-Signature` header handling.

## Findings

### CRITICAL

None.

### HIGH

1. Terminal callbacks can create or reassign analysis jobs because stored job/run ownership is not validated.

Evidence:

- `AnalyzerCallbackService` validates only path/body `analysisJobId`, not stored job ownership or stored `runId`: `apps/api-server/src/main/java/com/wedge/analysis/api/internal/AnalyzerCallbackService.java:53-68`.
- `saveCompleted()` and `saveFailed()` upsert directly from callback body: `apps/api-server/src/main/java/com/wedge/analysis/application/JudgeResultPersistenceService.java:94-108`.
- `AnalysisJobMapper.xml` conflict paths overwrite `run_id`: `apps/api-server/src/main/resources/mapper/analysis/AnalysisJobMapper.xml:74-76`, `:97-100`.
- `RunMapper.updateCurrentAnalysisState()` is guarded by `latest_analysis_job_id`, but callers ignore the row count: `apps/api-server/src/main/resources/mapper/run/RunMapper.xml:301-310`, `apps/api-server/src/main/java/com/wedge/analysis/application/JudgeResultPersistenceService.java:101`, `:108`.

Failure scenario:

Analyzer sends a callback for `analysisJobId=A` with wrong `runId=B`, or sends a callback for a job id that Spring never created. The `analysis_job` row can be inserted or rewritten, projections are inserted for the wrong run, and the run update can silently no-op.

Fix direction:

Load and validate the existing `analysis_job` before terminal persistence, preferably with row-level locking. Require stored `id`, stored `run_id`, expected lifecycle state, and current run linkage to match. Never rewrite `analysis_job.run_id` in terminal upsert paths. Check the `RunMapper.updateCurrentAnalysisState()` result and raise `STATE_CONFLICT` on zero rows unless this is a verified idempotent replay.

2. Terminal callbacks can overwrite each other and leave stale projections.

Evidence:

- `saveStarted()` explicitly handles existing terminal statuses: `apps/api-server/src/main/java/com/wedge/analysis/application/JudgeResultPersistenceService.java:71-90`.
- `saveCompleted()` always clears/reinserts projections and upserts completed: `apps/api-server/src/main/java/com/wedge/analysis/application/JudgeResultPersistenceService.java:94-102`.
- `saveFailed()` always upserts failed and does not clear completed projections: `apps/api-server/src/main/java/com/wedge/analysis/application/JudgeResultPersistenceService.java:105-108`.
- SQL unconditionally sets terminal status on conflict: `apps/api-server/src/main/resources/mapper/analysis/AnalysisJobMapper.xml:74-88`, `:97-103`.

Failure scenario:

A completed callback persists findings/nudges. Later, a failed callback with a different event id changes the job/run analysis status to `FAILED`, while completed `rule_hit`, `analysis_finding`, and `nudge` rows remain.

Fix direction:

Allow complete/fail only from `QUEUED` or `RUNNING`. If the job is already terminal, return an idempotent/ignored response when payload identity matches; otherwise raise `STATE_CONFLICT`. Add completed-then-failed and failed-then-completed regression tests.

### MEDIUM

1. Contract-valid top-level callback nudges are not persisted.

Evidence:

- Analyzer callback schema requires top-level `nudges`: `packages/contracts/internal/analyzer-callback.schema.json:77-100`.
- The callback example supplies top-level nudges while nested `judgeResult` may not contain `nudges`: `packages/contracts/internal/analyzer-callback.schema.json:157-260`.
- Persistence ignores `request.nudges()` for projection and reads only `judgeResult.nudges`: `apps/api-server/src/main/java/com/wedge/analysis/application/JudgeResultPersistenceService.java:193-200`.
- Top-level nudges are only preserved in raw output JSON: `apps/api-server/src/main/java/com/wedge/analysis/application/JudgeResultPersistenceService.java:160-170`.

Failure scenario:

Analyzer sends a schema-valid callback with top-level nudges and no nested `judgeResult.nudges`. Spring marks analysis completed but persists `nudgeCount=0`, so report/detail APIs lose suggestions.

Fix direction:

Choose one canonical nudge source. Either persist top-level `request.nudges()` or make nested `judgeResult.nudges` required and update schema/examples/tests accordingly.

2. JudgeResult is not contract-validated before completion.

Evidence:

- `AnalyzerCompletedRequest` accepts `judgeResult` as `Map<String,Object>`: `apps/api-server/src/main/java/com/wedge/analysis/api/internal/dto/AnalyzerCompletedRequest.java:16-20`.
- Persistence validates only issue stages and defaults required fields: `apps/api-server/src/main/java/com/wedge/analysis/application/JudgeResultPersistenceService.java:95-97`, `:203-218`, `:410-459`.
- `judge-result.schema.json` requires top-level and issue fields: `packages/contracts/schemas/judge-result.schema.json:6-14`, `:199-212`.
- Current tests accept minimal, non-schema-complete JudgeResult maps: `apps/api-server/src/test/java/com/wedge/analysis/application/JudgeResultPersistenceServiceTest.java:307-315`.

Failure scenario:

Analyzer omits `criterion_id`, `severity`, `confidence`, `evidence_refs`, `schema_version`, or `evidence_schema_version`; Spring still stores `UNKNOWN`/`0` projections and marks analysis completed.

Fix direction:

Validate against `packages/contracts/schemas/judge-result.schema.json` before `upsertCompleted()`, or replace raw maps with structured DTOs plus Bean Validation. Remove defaults that mask required contract failures.

3. `rule_registry_id` is required by JudgeResult but not persisted.

Evidence:

- JudgeResult requires `rule_registry_id`: `packages/contracts/schemas/judge-result.schema.json:9-10`, `:25-27`.
- Docs map it to `analysis_job.rule_registry_id`: `docs/09_JudgeResult.md:42-45`, `:227-230`.
- `toCompletedAnalysisJob()` never sets `ruleRegistryId`: `apps/api-server/src/main/java/com/wedge/analysis/application/JudgeResultPersistenceService.java:116-128`.
- `AnalysisJobMapper.xml` can persist the field but currently receives null: `apps/api-server/src/main/resources/mapper/analysis/AnalysisJobMapper.xml:64-78`.

Failure scenario:

Completed analysis jobs cannot be tied to the rule registry version that produced them, weakening audit, calibration, and regression diagnosis.

Fix direction:

Parse and validate `judgeResult.rule_registry_id`, align DB type expectations with the contract, and set it on `AnalysisJob` before upsert.

4. Analyzer `X-Signature` is required and sent but not verified. 확인 필요 if bearer-only is intentional.

Evidence:

- Controller requires `X-Signature`: `apps/api-server/src/main/java/com/wedge/analysis/api/internal/AnalyzerCallbackController.java:47-49`, `:62-64`.
- Analyzer client computes HMAC: `apps/analyzer/app/clients/spring_callback.py:79-90`, `:104-110`.
- `InternalServiceTokenFilter` verifies HMAC only for `/internal/runner/**`: `apps/api-server/src/main/java/com/wedge/common/security/InternalServiceTokenFilter.java:74-83`, `:116-118`.
- Tests assert analyzer callbacks do not use runner signature secret: `apps/api-server/src/test/java/com/wedge/common/security/InternalServiceTokenFilterTest.java:93-105`.

Failure scenario:

Any holder of the internal bearer token can forge analyzer terminal callbacks. The required signature header gives no actual tamper protection.

Fix direction:

Either add analyzer callback HMAC validation with an analyzer-specific secret or remove the signature header requirement from analyzer contracts/client and document bearer-token-only trust.

### LOW

None.

## Query Risks

- Report generation and detail/summary reads use latest analysis job/projection rows; if terminal upsert rewrites `run_id` or terminal callbacks leave stale projections, report APIs can select the wrong job or leak completed findings under a failed job.
- `ReportGenerationService` reads latest job by run id: `apps/api-server/src/main/java/com/wedge/report/application/ReportGenerationService.java:55-70`.
- Report projection reads rely on `analysis_job_id`: `apps/api-server/src/main/java/com/wedge/report/application/ReportGenerationService.java:194-213`, `apps/api-server/src/main/java/com/wedge/report/application/ReportDetailQueryService.java:81-107`, `apps/api-server/src/main/java/com/wedge/report/application/ReportSummaryQueryService.java:58-65`.

## Transaction / Concurrency Risks

- Idempotency insert participates in the callback transaction; rollback should allow retry. This part appears sound.
- Competing terminal callbacks with different event ids are not treated as conflicts.
- Ignored `updateCurrentAnalysisState()` row counts allow partial persistence without run projection acceptance.

## Contract Boundary Risks

- `analyzer-callback.schema.json` says `runId` is UUID, but its completed example uses `run_001`: `packages/contracts/internal/analyzer-callback.schema.json:44-46`, `:103-106`. 확인 필요: contract/example tests may copy invalid examples.
- Top-level `nudges` vs nested `judgeResult.nudges` has no single authority.
- OpenAPI lists analyzer `X-Signature`, but server verification is bearer-only for analyzer paths.
- Application service imports internal API DTOs directly, binding persistence to HTTP callback shape: `apps/api-server/src/main/java/com/wedge/analysis/application/JudgeResultPersistenceService.java:5-7`.

## DDD / Responsibility Issues

- `JudgeResultPersistenceService` owns lifecycle transition, contract parsing, JSON serialization, projection mapping, fallback defaulting, issue/nudge linking, and run projection updates in one 498-line service.
- Domain objects such as `AnalysisJob`, `AnalysisFinding`, `RuleHit`, and `Nudge` are mutable data containers; lifecycle and contract invariants live in service and mapper code.
- A small application policy/command layer would make the callback boundary explicit without forcing a full DDD rewrite.

## Test Gaps

- Completed/failed callback with mismatched `runId` against an existing job.
- Callback for nonexistent `analysisJobId`.
- Completed-then-failed and failed-then-completed terminal conflicts.
- JudgeResult schema validation for required fields/ranges.
- Top-level nudge persistence or rejection.
- Analyzer signature verification if HMAC is intended.

## Refactor Candidates

- Add an `AnalysisJobTerminalTransition` or policy method that loads/validates the job before projection writes.
- Replace raw `Map<String,Object>` JudgeResult parsing with a validated DTO/schema validator adapter.
- Split callback DTOs from application commands.
- Persist `rule_registry_id`.
- Remove projection defaults for contract-required fields once validation exists.

## Architect Lane

Architectural Status: `BLOCK`.

The direction is acceptable for an MVP projection sink, but two blockers prevent approval:

- Terminal callbacks are allowed to upsert a job without proving it exists, belongs to the callback run, or is current.
- JudgeResult is canonical contract data but is not contract-validated before Spring persists projections and marks analysis complete.

Strongest counterargument:

The service intentionally keeps Spring as a projection sink: Analyzer owns JudgeResult semantics, Spring preserves raw output, and projection rebuild is atomic. For an internal bearer-protected path, raw-map tolerance can reduce integration friction while Analyzer/schema iteration continues.

Synthesis:

Keep Analyzer as JudgeResult producer and Spring as persistence/projection owner, but make the boundary explicit with job identity validation, terminal transition legality, current-job checks, and schema validation before upsert.

## Confidence

High for persistence/state and contract mismatch findings. Medium for analyzer signature because bearer-token-only may be intentional, but current header/client behavior is misleading.

## Verification Notes

- Subagent reported `gradle clean test --tests 'com.wedge.analysis.*'` passed after an initial stale build hashing issue.
- No source files were edited.
