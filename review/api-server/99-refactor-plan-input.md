# 99 - refactor plan input

## Purpose

This is structured input for a later `$plan --consensus` refactoring plan. It is not the final implementation plan and does not modify source code.

## Target Outcome

Make `apps/api-server` production-hardened for core run/discovery/analysis/report flows by fixing the highest-risk boundary drift:

- authorization is enforced at command boundaries;
- internal callbacks cannot mutate the wrong aggregate;
- shared contracts are executable gates;
- idempotency and outbox states match their operational claims;
- snapshots/current reports are tied to explicit versions;
- failures are visible as domain states, metrics, logs, or contract errors.

## Constraints

- Repository is contract-first: update `packages/contracts` before app-specific code when payload shape changes.
- Keep diffs small and reviewable.
- Lock behavior with regression tests before changing risky flows.
- No new dependencies unless explicitly justified and approved.
- Preserve current MVP product behavior unless the behavior is a confirmed bug/security risk.

## Non-Goals

- Do not redesign every domain at once.
- Do not replace MyBatis/Spring stack.
- Do not implement a full OAuth MCP production rollout in the first hardening pass.
- Do not rewrite report UI/client behavior until API currentness and contracts are fixed.

## Proposed Workstreams

### Workstream A - Safety Test Harness First

Goal:

Create regression tests that fail for the confirmed high-risk bugs before implementation changes.

Must-cover tests:

- Cross-project denial for `/api/runs/{runId}/agent/start`.
- Analyzer callback wrong run, nonexistent job, completed-then-failed, failed-then-completed.
- Missing JudgeResult required fields rejected.
- EvidencePacket second materialization after evidence change.
- Outbox negative confirm/unroutable publish not marked `PUBLISHED`.
- Outbox max-attempt exhaustion visible.
- Discovery/scenario/analysis DLQ settlement.
- Report export stale latest-analysis rejection.

Stop condition:

P0 tests exist and fail for current behavior or are explicitly documented as characterization tests when current behavior must be preserved temporarily.

### Workstream B - Human Authorization and Project Access Boundary

Findings addressed:

- H01, H13, H14, H15, H16

Changes to consider:

- Add `RunAccessGuard.ensureRunAccessible(runId, userId)`.
- Require `userId` on every human run mutation, including `startAgentRun`.
- Make `ProjectAccessService` check `project.status = 'ACTIVE'`.
- Change default project reuse so it does not upgrade membership.
- Store refresh-token digest/JTI instead of raw refresh JWT.
- Align `/api/projects/**` contracts with implementation/security.

Acceptance criteria:

- Every human endpoint family has auth/project tests.
- Archived projects are denied.
- Default project resolution does not regrant permissions.
- Raw refresh tokens are not persisted.

### Workstream C - Analyzer Callback and JudgeResult Boundary

Findings addressed:

- H02, H03, H04, H11, M16

Changes to consider:

- Introduce `AnalysisJobTerminalTransitionPolicy`.
- Load/lock stored `analysis_job` before terminal persistence.
- Reject callbacks for unknown job, wrong run, stale current job, or illegal terminal transition.
- Validate `judgeResult` against schema before completion.
- Persist `rule_registry_id`.
- Decide one canonical nudge source.
- Verify analyzer HMAC or remove signature contract.

Acceptance criteria:

- Terminal callbacks are monotonic.
- No terminal callback can create/reassign `analysis_job.run_id`.
- Missing required JudgeResult fields fail before completion/report generation.
- Analyzer signature behavior matches contract.

### Workstream D - Evidence Snapshot and Artifact Boundary

Findings addressed:

- H05, M02, M03, M09, M10, M17

Changes to consider:

- Choose immutable per-analysis EvidencePacket snapshots or refresh-on-conflict semantics.
- Tie `analysis_job.evidence_packet_id` to exact packet bytes used by Analyzer.
- Align discovery checkpoint duplicate handling with run checkpoint handling.
- Define late evidence policy after terminal run/discovery.
- Add packet/callback size limits and paged/windowed evidence queries.
- Stream large artifacts or presign them.
- Add signed URL partial diagnostics.

Acceptance criteria:

- Second analysis after new evidence uses fresh intended packet.
- Duplicate discovery checkpoint is idempotent.
- Late evidence policy is tested.
- Large artifact reads do not require loading entire object into memory.

### Workstream E - Outbox, MQ, DLQ, and Idempotency

Findings addressed:

- H06, H07, H08, M01, M05, M15

Changes to consider:

- Configure publisher confirms/returns and mandatory publish.
- Mark `PUBLISHED` only after positive broker confirm.
- Add `EXHAUSTED`/`DEAD_LETTERED`, `last_error`, `exhausted_at`.
- Quarantine poison payload rows inside retry failure boundary.
- Add DLQ settlement for discovery/scenario/analysis.
- Add request hash to public idempotency records.
- Tighten agent completion predicates to full lease identity.
- Add per-item callback idempotency for runner events.

Acceptance criteria:

- Broker negative/unroutable publish remains retryable.
- Max attempts produce visible terminal state.
- Each configured DLQ has an aggregate-settlement or alert path.
- Duplicate item callbacks do not regress state or duplicate timeline.

### Workstream F - Report Currentness and Share Boundary

Findings addressed:

- M06, M07, M08, H04

Changes to consider:

- Require report export to match latest analysis or explicit `analysisJobId`.
- Check guarded update counts in report generation.
- Decide report model: immutable snapshot vs live analysis handle.
- Restrict shared artifact content to artifacts referenced by shared report detail, or document run-wide image sharing.
- Batch report summary/detail queries.

Acceptance criteria:

- Export never returns an old report as current.
- Report detail/export cannot mix incompatible versions.
- Share token artifact access is tested and intentionally scoped.

### Workstream G - MCP Gateway Production Gate

Findings addressed:

- H09, H10, M13, M14

Changes to consider:

- Promote MCP decision tools/scopes into `packages/contracts/mcp/tools.schema.json`.
- Add client identity/scope/project/run checks at MCP tool entry.
- Add atomic pending decision claim.
- Add bounded TTL store or cleanup.
- Add MCP audit log and pending decision metrics.
- Ensure expiry during sampling returns expired/conflict, not resolved success.

Acceptance criteria:

- `wedge.read` and `wedge.decide` are enforced separately.
- Cross-project MCP run reads/decision registration are denied.
- Concurrent resolution samples once.
- MCP audit and metrics exist for success/failure/denial/expiry.

### Workstream H - Contract Test Gate

Findings addressed:

- H04, H16, M15, M16 plus all contract drift findings.

Changes to consider:

- Add schema validation helpers for JSON schemas under `packages/contracts`.
- Validate DTO samples for runner callbacks, analyzer callbacks, MQ messages, MCP tools, report responses, and error responses.
- Add duplicate OpenAPI component/schema detection.
- Validate emitted MQ envelopes from API-server factories.

Acceptance criteria:

- Contract tests fail when implementation DTOs drift from `packages/contracts`.
- Runtime error codes validate against OpenAPI.
- Runner agent trace has one canonical schema shape.
- MCP tool registry parity is tested.

### Workstream I - Observability and Operations

Findings addressed:

- H07, H08, M13, M17 and Lens 07.

Changes to consider:

- Add counters/timers for callbacks, outbox, DLQ, evidence packet materialization, report generation/export, MCP pending decisions, and security denials.
- Add structured logs with aggregate ids and event ids for conflict paths.
- Add operational queries for outbox exhausted/DLQ/pending MCP failures.
- Add audit records for MCP tool calls.

Acceptance criteria:

- Health can be green while domain-specific metrics expose failing queues/callbacks.
- Stale callback/currentness conflicts are visible.
- Outbox exhaustion and DLQ settlement are alertable.

## Suggested Order

1. Safety tests for H01/H02/H03/H04/H05/H06.
2. Human auth/project fixes.
3. Analyzer callback and JudgeResult contract fixes.
4. Evidence snapshot correctness.
5. Outbox publish/exhaustion/DLQ reliability.
6. Report currentness/share boundary.
7. Contract test gate expansion.
8. MCP production gate hardening.
9. Observability metrics/audit pass.

Reasoning:

Start with bugs that can cause cross-project action, wrong aggregate mutation, stale analysis input, and lost commands. These create the highest blast radius and make later refactors safer.

## Verification Commands

Baseline commands from repo guidance:

```bash
cd apps/api-server && gradle test
```

Useful targeted suites to create or expand:

```bash
cd apps/api-server
gradle test --tests com.wedge.run.api.RunControllerTest
gradle test --tests com.wedge.analysis.*
gradle test --tests com.wedge.evidence.*
gradle test --tests com.wedge.report.*
gradle test --tests com.wedge.mcp.*
```

## Open Questions For Planning

1. Should EvidencePacket snapshots be immutable per analysis request, or refreshed per `(run_id, schema_version)`?
2. Should report detail be an immutable report snapshot or a live view over analysis projections?
3. Is MCP decision gateway intended for production in the near term, or should it remain behind an explicit non-production gate?
4. Should shared report tokens grant all run image artifacts or only artifacts referenced by the report?
5. What profile/environment should fail startup when runner/analyzer callback HMAC secrets are missing?

