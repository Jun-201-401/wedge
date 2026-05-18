# 100 - API server refactor execution plan

## Status

Created before source edits on branch `refactor/api-server-hardening`.

This file is the tracked handoff copy of the executable Ralph plan. The runtime PRD and test spec also exist under `.omx/plans`, but `.omx/` is ignored by git.

Runtime artifacts:

- `.omx/plans/prd-api-server-hardening-2026-05-18.md`
- `.omx/plans/test-spec-api-server-hardening-2026-05-18.md`
- `.omx/context/api-server-hardening-20260518T040646Z.md`

## Why This Plan Exists

The review artifacts identify broad risk, but they are not an implementation plan. Refactoring will proceed by small behavior slices so the work does not become a package-wide cleanup that loses the original production risks.

## Execution Order

1. Slice A - Human run and project access boundary
2. Slice B - Analyzer callback identity, terminal transition, and JudgeResult gate
3. Slice C - Evidence snapshot and artifact boundary
4. Slice D - Outbox, MQ, DLQ, and idempotency reliability
5. Slice E - Report currentness and share boundary
6. Slice F - Contract gate, MCP gate, and observability

## Slice A - Human Run and Project Access Boundary

Findings: H01, H13, H14, partial H16.

Change target:

- `RunController.startAgentRun` must receive `Authentication` and call the same access guard used by other run mutations.
- `ProjectAccessMapper.existsActiveProject` must require active project status, not only non-deleted project rows.
- Default project bootstrap must not restore or upgrade project membership as a side effect of default project resolution.

Required evidence:

- Cross-project agent start denial test.
- Authorized agent start success test.
- Archived project denial test.
- Default project member non-regrant test.

## Slice B - Analyzer Callback Identity, Terminal Transition, and JudgeResult Gate

Findings: H02, H03, H04, H11, M16.

Change target:

- Terminal callbacks load stored job state before persistence.
- Unknown or wrong-run job callbacks are rejected.
- Terminal transitions are monotonic.
- JudgeResult required fields are validated before completion/report readiness.
- Analyzer signature contract is aligned with runtime behavior.

Required evidence:

- Wrong-run, nonexistent-job, completed-then-failed, failed-then-completed tests.
- Missing `summary`, `decision_map`, and `rule_registry_id` tests.
- Current-run guarded update conflict test.

## Slice C - Evidence Snapshot and Artifact Boundary

Findings: H05, M02, M03, M09, M10, M17.

Change target:

- Evidence packet materialization must not reuse stale packet bytes for a later analysis.
- `analysis_job.evidence_packet_id` must identify the exact packet sent to Analyzer.
- Discovery checkpoint duplicate handling must match run checkpoint idempotency or reject predictably.
- Late evidence policy must be explicit.

Required evidence:

- Second materialization after new evidence test.
- Duplicate discovery checkpoint test.
- Late evidence policy test.
- Signed URL partial failure diagnostic test.

## Slice D - Outbox, MQ, DLQ, and Idempotency Reliability

Findings: H06, H07, H08, M01, M05, M15.

Change target:

- Do not mark outbox rows `PUBLISHED` before confirmed delivery.
- Retry exhaustion must become visible terminal state.
- DLQ handlers must settle or alert owning aggregates for configured domains.
- Idempotency must include request hash or item identity where duplicate bodies can diverge.

Required evidence:

- Positive confirm publishes.
- Negative/unroutable publish stays retryable.
- Max attempts terminal state test.
- Poison payload quarantine test.
- Discovery/scenario/analysis DLQ settlement tests.

## Slice E - Report Currentness and Share Boundary

Findings: M06, M07, M08, H04.

Change target:

- Export must target latest compatible analysis or explicit `analysisJobId`.
- Detail/export must not mix incompatible report and analysis versions.
- Shared artifact access must be scoped intentionally.

Required evidence:

- Stale latest-analysis rejection test.
- Explicit compatible analysis export test.
- Share token unreferenced artifact denial or documented run-wide allow test.

## Slice F - Contract Gate, MCP Gate, and Observability

Findings: H09, H10, H16, M13, M14, M15, M16.

Change target:

- Add executable contract tests for DTO/schema drift.
- Align `/api/projects/**` contracts with implementation/security.
- Enforce MCP identity/scope/run ownership before production use.
- Make pending decision resolution atomic and bounded.
- Add metrics/audit/log evidence for denial, expiry, conflict, outbox exhaustion, and callback conflicts.

Required evidence:

- Contract tests for analyzer/runner callbacks, MQ envelopes, MCP tools, report/error responses.
- MCP read/decide scope tests.
- Concurrent pending decision resolution test.
- Expired/null decision response test.

## Global Verification

Per slice:

```bash
cd apps/api-server && gradle test --tests <targeted suites>
```

Final:

```bash
cd apps/api-server && gradle test
```

Completion requires:

- all addressed findings mapped to commits or documented blockers;
- no uncommitted source changes except intentionally ignored Ralph runtime artifacts;
- architect/verifier review of changed files;
- ai-slop-cleaner pass scoped to changed files and regression re-run.

