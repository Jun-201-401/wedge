# Packet 06 - report-generation-query-share

## Scope

Read-only review of report create/generate/detail/summary/export/share/shared-artifact flow.

## Flow Map

- Generate: `POST /api/runs/{runId}/report` -> `ReportGenerationService.generateRunReport` -> latest completed `AnalysisJob` -> `report` row.
- Read run projection: `GET /api/runs/{runId}/report` -> latest analysis status plus matching report.
- Summary: `GET /api/runs/{runId}/reports` -> report rows -> top findings -> preview image lookup.
- Detail/shared detail: `GET /api/reports/{reportId}` or `GET /api/report-shares/{token}` -> report -> findings/nudges/highlights.
- Export: `POST /api/runs/{runId}/reports` -> ready report -> markdown artifact content plus artifact metadata.
- Share: create/list/revoke report shares; shared artifact endpoint resolves token -> report run -> image artifact content.

## Files Reviewed

- `apps/api-server/src/main/java/com/wedge/report/**`
- `apps/api-server/src/main/resources/mapper/report/*.xml`
- `apps/api-server/src/main/java/com/wedge/evidence/application/EvidenceService.java`
- analysis/evidence mappers used by report reads
- `packages/contracts/openapi/wedge_openapi.yaml`
- `packages/contracts/schemas/judge-result.schema.json`
- report docs and tests

## Invariants Expected

- Human report reads/exports/shares must be project-authorized.
- Shared token access must only expose the intended report and safe report image artifacts.
- Generated report JSON must preserve valid `JudgeResult.summary` and `decision_map`.
- Exported markdown metadata and content-store bytes must describe the same report.
- “Latest” run report state must not export stale analysis results as current.
- OpenAPI enums and DTO values must match.

## Failure Scenarios Checked

- Missing/failed/not-yet-completed analysis.
- Existing report reuse and concurrent insert.
- Expired/revoked/deleted share token.
- Shared artifact from wrong run or non-image artifact.
- Malformed stored report JSON.
- Multiple reports for one run and latest/stale report selection.
- Export content write vs DB persistence failure.
- OpenAPI/client enum compatibility.

## Findings

### CRITICAL

None.

### HIGH

1. Export can return an old report that is not current for the latest analysis state.

Evidence:

- `createRunReportExport(..., analysisJobId=null)` selects an existing report rather than requiring latest analysis linkage: `apps/api-server/src/main/java/com/wedge/report/application/ReportExportService.java:68`.
- `ReportMapper.xml` orders by `created_at DESC`: `apps/api-server/src/main/resources/mapper/report/ReportMapper.xml:31`.
- `getRunReport` keys readiness to the latest analysis job: `apps/api-server/src/main/java/com/wedge/report/application/ReportGenerationService.java:94`.

Failure scenario:

A newer analysis is queued/completed/failed but has no matching report. Export returns an older report while run report state says `GENERATABLE` or `FAILED`.

Fix direction:

Require `analysisJobId` for export, or resolve/export only the report matching the latest analysis job used by `getRunReport`; reject stale reports with `409`.

2. Report generation silently converts missing required JudgeResult fields into `READY` empty report data.

Evidence:

- `ReportGenerationService.toReport()` reads `judgeResult.summary` and `decision_map` with permissive `asMap`/`asList`: `apps/api-server/src/main/java/com/wedge/report/application/ReportGenerationService.java:112-124`, `:261-268`.
- JudgeResult schema requires these fields: `packages/contracts/schemas/judge-result.schema.json:6`; decision map items require display fields around `:485`.

Failure scenario:

Malformed Analyzer output omits required `summary` or `decision_map`. Spring persists a `READY` report with `{}`/`[]`, masking the contract failure and potentially producing empty reports or later 500s.

Fix direction:

Validate JudgeResult on callback or report generation and fail explicitly instead of defaulting required report data.

### MEDIUM

1. `HIGHLIGHT_SCREENSHOT` response source is absent from OpenAPI.

Evidence:

- Implementation can return `HIGHLIGHT_SCREENSHOT`: `apps/api-server/src/main/java/com/wedge/report/application/ReportPreviewImageResolver.java:23`, `:74`.
- OpenAPI enum lists only `STAGE_SCREENSHOT`, `REPORT_ARTIFACT`, `LATEST_SCREENSHOT`: `packages/contracts/openapi/wedge_openapi.yaml:5117`.

Failure scenario:

Generated clients reject valid server responses.

Fix direction:

Add `HIGHLIGHT_SCREENSHOT` to OpenAPI or map it to a documented enum.

2. Shared artifact access is run-scoped, not report-reference-scoped.

Evidence:

- `ReportShareService.getSharedArtifactContent` resolves token/report then delegates by run id and artifact id: `apps/api-server/src/main/java/com/wedge/report/application/ReportShareService.java:89-95`.
- `EvidenceService.getRunImageArtifactContent` allows any image artifact in that run: `apps/api-server/src/main/java/com/wedge/evidence/application/EvidenceService.java:210-217`.
- OpenAPI describes shared token access to image artifacts connected to the report’s run: `packages/contracts/openapi/wedge_openapi.yaml:2768-2775`.

Failure scenario:

A valid share token plus any known image artifact UUID from the same run can fetch that artifact even if it is not referenced by the shared report detail.

Fix direction:

Restrict shared artifact content to artifact ids present in the shared report read model, or explicitly document/test that a share token grants all image artifacts for the run.

3. Report generation ignores guarded run update row counts and can return stale readiness.

Evidence:

- Generation reads latest completed analysis, inserts/reuses report, then updates run state: `apps/api-server/src/main/java/com/wedge/report/application/ReportGenerationService.java:64-82`.
- `RunMapper.updateCurrentAnalysisState` is guarded by `latest_analysis_job_id`: `apps/api-server/src/main/resources/mapper/run/RunMapper.xml:301`.
- Return count is ignored; existing-report path uses unguarded `updateLatestReport`: `apps/api-server/src/main/resources/mapper/run/RunMapper.xml:280`.

Failure scenario:

A newer analysis is queued concurrently. API returns `READY` for a report that did not become the run’s latest report.

Fix direction:

Check update counts and retry/return stale-state conflict. Use guarded latest-report update tied to `analysisJobId`.

4. Export content write and artifact metadata persistence are not atomic.

Evidence:

- Markdown bytes are written before artifact metadata persistence: `apps/api-server/src/main/java/com/wedge/report/application/ReportExportService.java:100-103`.

Failure scenario:

DB persistence fails after content write, leaving orphaned content; or a future metadata-first change could leave metadata pointing to missing content.

Fix direction:

Use reservation/finalization or outbox-style artifact export with compensation.

5. Report snapshot consistency is partial.

Evidence:

- `ReportGenerationService` stores only summary/decision map in `report`: `apps/api-server/src/main/java/com/wedge/report/application/ReportGenerationService.java:112-124`.
- Detail/export continue reading mutable analysis projections: `apps/api-server/src/main/java/com/wedge/report/application/ReportDetailQueryService.java:81-151`.
- `JudgeResultPersistenceService.saveCompleted` can delete/reinsert findings/nudges for the same analysis job: `apps/api-server/src/main/java/com/wedge/analysis/application/JudgeResultPersistenceService.java:94-101`, `:174-178`.
- `ReportMapper.updateAnalysisProjection` exists but is not called in production: `apps/api-server/src/main/java/com/wedge/report/infrastructure/ReportMapper.java:16`.

Failure scenario:

A completed callback replay with a new event id changes findings/nudges while existing report summary/decision map remain stale, mixing versions in detail/export.

Fix direction:

Define report as immutable snapshot or live projection handle. If live, refresh summary/decision map when accepted completed-callback upserts update projections.

### LOW

1. Shared report/artifact error codes are imprecise.

Evidence:

- Missing/non-image shared artifact can surface as `run_not_found`: `apps/api-server/src/main/java/com/wedge/evidence/application/EvidenceService.java:213`.
- Expired/revoked shares surface as `report_not_found`: `apps/api-server/src/main/java/com/wedge/report/application/ReportShareService.java:108`.
- Docs list more precise candidates: `docs/03_api_reference.md:175`.

Failure scenario:

Clients cannot distinguish expired share, revoked share, missing artifact, and wrong artifact type for actionable UI states.

Fix direction:

Add specific report-share/artifact error codes if UI needs those states.

## Query Risks

- Summary list fan-out: per report, `topFindings` calls `findTopByAnalysisJobId`, plus preview artifact lookups.
- Detail batches findings/nudges, but highlight image lookup can be one artifact query per distinct highlighted screenshot.
- `CheckpointMapper.findByRunIdAndCheckpointKey` is cached per request, reducing but not eliminating fan-out.

## Transaction / Concurrency Risks

- Report generation ignores run update row counts, allowing stale concurrent analysis/report mismatch.
- Export content store and DB metadata are not atomic.
- Share creation locks report row before reuse/insert; token collision retry is not implemented but entropy is high.

## Contract Boundary Risks

- `HIGHLIGHT_SCREENSHOT` enum missing from OpenAPI.
- Required JudgeResult fields default during report generation instead of being enforced.
- Markdown export is implementation-only; docs may still mention broader queue payload formats, but current OpenAPI correctly narrows endpoint response.

## DDD / Responsibility Issues

- Report rows are partial snapshots while detail/export read mutable analysis/evidence projections. The model is not explicitly “snapshot” or “live handle.”
- `report.artifact_id` semantics are unclear: schema has it, export does not set it, preview resolver treats report artifact as screenshot fallback.
- Shared token boundary is clear, but artifact boundary is run-image-wide rather than report-reference-wide.

## Test Gaps

- Stale export when older report exists and newer latest analysis has no report or failed analysis.
- Missing required `summary`/`decision_map` must fail before `READY`.
- OpenAPI/schema contract test for `ReportPreviewImage.source`.
- Shared-artifact denial for same-run but non-report-referenced image.
- Fresh report tests did not pass in one subagent environment because of classpath `NoClassDefFoundError`; treat test evidence as incomplete.

## Refactor Candidates

- Extract report-currentness resolver shared by generate/get/export.
- Add JudgeResult/report projection validator.
- Batch summary top findings and preview artifact lookups.
- Separate export artifact reservation/finalization.
- Decide immutable snapshot vs live projection handle and encode that boundary in service names/tests.

## Architect Lane

Architectural Status: `WATCH`.

The flow is coherent for MVP: Spring materializes reports from Analyzer projections, share tokens are explicit bearer secrets, and export is synchronous Markdown artifact generation. Watch items are partial snapshot/live projection ambiguity and run-scoped shared artifact access.

Strongest counterargument:

The lean design avoids duplicating all finding/nudge data into reports. Shared artifact access still requires an unguessable token plus artifact UUID and only returns image MIME types.

Synthesis:

Keep lean analysis-backed reports, but define whether reports are immutable snapshots or live projection handles. Lowest-risk path: live handles plus callback refresh of report summary/decision map, report-scoped artifact allowlist, and separate generated-export artifact link.

## Confidence

Medium-high on flow and contract findings. Reduced by incomplete local report test pass evidence from subagent.

## Verification Notes

- No source files were edited.
