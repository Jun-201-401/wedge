# Lens 01 - repository-query-performance

## Scope

Cross-packet review of repository/query services, MyBatis XML, projection reads, artifact content reads, and report/evidence assembly paths.

## Summary

The largest query-performance risks are not classic N+1 alone. The bigger pattern is that query methods often define "latest" or "snapshot" by convenience ordering/upsert semantics instead of by the exact business version being requested. That creates both stale reads and avoidable query load.

## Findings

### HIGH - EvidencePacket snapshot selection can serve stale analysis input

Evidence:

- `EvidenceService` assembles current artifacts/checkpoints/observations before materialization: `apps/api-server/src/main/java/com/wedge/evidence/application/EvidenceService.java:171`.
- `EvidencePacketMapper.xml` conflicts on `(run_id, schema_version)` and returns the old row without refreshing `packet_jsonb` or counts: `apps/api-server/src/main/resources/mapper/evidence/EvidencePacketMapper.xml:25`.
- Packet evidence: `review/api-server/packets/03-evidence-artifact-checkpoint-persistence.md:52`.

Failure scenario:

A run is analyzed, late evidence arrives, and analysis is requested again. The second analysis can reference the first stale packet.

Fix direction:

Choose immutable per-analysis snapshots or update packet JSON/counts/timestamps on conflict.

Test gaps:

Materialize twice after adding evidence and assert the second analysis references fresh packet bytes/counts.

### HIGH - Latest report/export selection can return stale report state

Evidence:

- `ReportExportService` accepts `analysisJobId=null` and picks a ready report by run: `apps/api-server/src/main/java/com/wedge/report/application/ReportExportService.java:68`.
- `ReportMapper.xml` orders run reports only by `created_at DESC`: `apps/api-server/src/main/resources/mapper/report/ReportMapper.xml:31`.
- `ReportGenerationService` resolves latest analysis separately: `apps/api-server/src/main/java/com/wedge/report/application/ReportGenerationService.java:68`.
- Guarded latest-analysis updates are ignored by callers: `apps/api-server/src/main/resources/mapper/run/RunMapper.xml:301`, `apps/api-server/src/main/java/com/wedge/analysis/application/JudgeResultPersistenceService.java:101`.

Failure scenario:

A newer analysis is queued/completed/failed while an older report exists. Export returns the old report while the run report state says not ready or failed.

Fix direction:

Resolve/export only the report matching current `latest_analysis_job_id`, or require explicit `analysisJobId` and reject stale exports with `409`.

Test gaps:

Add stale-currentness tests for older ready report plus newer latest analysis with no matching report.

### MEDIUM - Whole-run reads and payload assembly are unbounded

Evidence:

- Evidence live summary loads all artifacts/checkpoints/observations: `apps/api-server/src/main/java/com/wedge/evidence/application/EvidenceService.java:141`.
- Packet assembly does the same: `apps/api-server/src/main/java/com/wedge/evidence/application/EvidenceService.java:160`.
- Observation/checkpoint/artifact read mappers have no limit/windowing: `apps/api-server/src/main/resources/mapper/evidence/ObservationMapper.xml:25`, `CheckpointMapper.xml:57`, `ArtifactMapper.xml:68`.
- Runner checkpoint batch has a minimum but no maximum: `apps/api-server/src/main/java/com/wedge/run/api/internal/runner/dto/RunnerCheckpointsRequest.java:8`.

Failure scenario:

Long or buggy runs accumulate large JSONB rows and callbacks; API heap, DB memory, and Analyzer packet size grow without bound.

Fix direction:

Add callback size limits, packet byte limits, summary aggregate queries, and paged/windowed evidence reads.

### MEDIUM - Report query fan-out creates N+1-style lookup pressure

Evidence:

- Report summary maps each report to top findings: `apps/api-server/src/main/java/com/wedge/report/application/ReportSummaryQueryService.java:36`.
- Top findings are queried per report: `apps/api-server/src/main/java/com/wedge/report/application/ReportSummaryQueryService.java:62`.
- Preview image resolver can perform artifact lookups per finding/report: `apps/api-server/src/main/java/com/wedge/report/application/ReportPreviewImageResolver.java:27`.
- Detail query fetches checkpoint scroll data per distinct checkpoint key: `apps/api-server/src/main/java/com/wedge/report/application/ReportDetailQueryService.java:240`.

Failure scenario:

A run with many reports/findings causes many small artifact/checkpoint queries under report list/detail load.

Fix direction:

Batch top findings by report/analysis ids, prefetch screenshots once per run, and fetch checkpoint scroll metadata in one query.

### MEDIUM - Indexes do not fully match access-path ordering

Evidence:

- Event pagination filters/orders by `(run_id, occurred_at, id)` with optional step/type filters: `apps/api-server/src/main/resources/mapper/run/RunMapper.xml:128`.
- Schema index is only `(run_id, occurred_at DESC)`: `docs/wedge_schema.sql:623`.
- Recommendations order by confidence/time: `apps/api-server/src/main/resources/mapper/discovery/ScenarioRecommendationMapper.xml:18`, while schema indexes by `(discovery_id, recommendation_level)`: `docs/wedge_schema.sql:588`.
- Top findings order by `priority_score DESC NULLS LAST, rank_order ASC`: `apps/api-server/src/main/resources/mapper/analysis/AnalysisFindingMapper.xml:37`.

Failure scenario:

High-cardinality runs/discoveries/reports degrade into extra sorts or less selective scans.

Fix direction:

Add indexes matching real read paths and add DB integration/performance fixtures for high-cardinality cases.

### MEDIUM - Artifact/blob loading can exhaust API heap

Evidence:

- S3 content store loads the whole object as bytes: `apps/api-server/src/main/java/com/wedge/evidence/infrastructure/S3ArtifactContentStore.java:44`, `:50`.
- Run artifact content endpoint exposes object bytes through API: `apps/api-server/src/main/java/com/wedge/run/api/RunController.java:203`.

Failure scenario:

Large HAR/trace/DOM/report artifacts are loaded fully into memory, causing GC pressure or OOM.

Fix direction:

Stream with `InputStreamResource`, presign large artifacts, and enforce size/type limits.

### MEDIUM - Report reads mix immutable snapshot data with mutable projections

Evidence:

- Report stores summary and decision map: `apps/api-server/src/main/java/com/wedge/report/application/ReportGenerationService.java:112`.
- Report detail reads findings/nudges live from analysis projections: `apps/api-server/src/main/java/com/wedge/report/application/ReportDetailQueryService.java:81`.
- Completed callbacks can clear/reinsert projections: `apps/api-server/src/main/java/com/wedge/analysis/application/JudgeResultPersistenceService.java:94`, `:174`.

Failure scenario:

A callback replay mutates findings/nudges for an existing report while report summary/decision map remain old.

Fix direction:

Define reports as immutable snapshots or live handles. If snapshot, store findings/nudges/highlights under report ownership.

