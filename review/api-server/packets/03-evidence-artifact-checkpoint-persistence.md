# Packet 03 - evidence-artifact-checkpoint-persistence

## Scope

Read-only review of evidence persistence, checkpoint/artifact callback writes, EvidencePacket assembly, signed URL decoration, and artifact content store boundaries.

## Flow Map

Runner callback sends checkpoints/artifacts -> `RunnerCallbackService` performs duplicate envelope check and step resolution -> `CheckpointPersistenceService` / `ArtifactPersistenceService` write metadata and observations -> `EvidenceService` queries whole-run evidence -> `EvidencePacketAssembler` builds contract-shaped packets -> `EvidencePacketSignedUrlDecorator` adds transient signed URLs -> Analyzer fetches stored snapshot by `evidencePacketId`.

## Files Reviewed

- `apps/api-server/src/main/java/com/wedge/evidence/application/*.java`
- `apps/api-server/src/main/java/com/wedge/evidence/application/command/*.java`
- `apps/api-server/src/main/java/com/wedge/evidence/domain/*.java`
- `apps/api-server/src/main/java/com/wedge/evidence/infrastructure/*.java`
- `apps/api-server/src/main/resources/mapper/evidence/*.xml`
- `apps/api-server/src/main/java/com/wedge/run/application/RunnerCallbackService.java`
- runner callback DTO/controller files relevant to checkpoint/artifact callbacks
- `packages/contracts/schemas/evidence-packet.schema.json`
- `packages/contracts/internal/runner-callback.schema.json`
- relevant evidence/run tests and docs

## Invariants Expected

- Duplicate runner callbacks must not duplicate checkpoints, observations, artifacts, latest pointers, or analysis packet input.
- Materialized EvidencePacket snapshots must represent the exact evidence selected for analysis.
- Stored EvidencePackets must satisfy `evidence-packet.schema.json`.
- Signed URLs must be generated only for run-owned image artifacts and must not leak stale URLs.
- Artifact content paths/keys must stay behind the content-store boundary.
- Large artifact/payload paths must avoid unbounded heap and packet size growth.

## Failure Scenarios Checked

- Duplicate callback event IDs.
- Duplicate checkpoint keys and artifact IDs.
- Late evidence after first analysis materialization.
- Unknown observation type/source crossing into strict EvidencePacket schema.
- Large S3 artifact content download.
- Oversized checkpoint/artifact callback payloads.
- Duplicate runner-supplied observation IDs.
- Signed URL generator failure.

## Findings

### CRITICAL

None.

### HIGH

1. EvidencePacket snapshots become stale after first materialization.

Evidence:

- `EvidenceService.materializeRunEvidencePacketSnapshot()` assembles fresh current artifacts/checkpoints/observations and calls `upsertRunSnapshot()`: `apps/api-server/src/main/java/com/wedge/evidence/application/EvidenceService.java:171-187`.
- `EvidencePacketMapper.xml` conflicts on `(run_id, schema_version)` but does not refresh `packet_jsonb`, counts, or timestamp; it effectively returns the existing row: `apps/api-server/src/main/resources/mapper/evidence/EvidencePacketMapper.xml:25-37`.
- `AnalysisRequestService` creates a new analysis job and references the returned evidence packet id: `apps/api-server/src/main/java/com/wedge/analysis/application/AnalysisRequestService.java:64-72`.
- The public analysis endpoint is repeatable: `apps/api-server/src/main/java/com/wedge/analysis/api/AnalysisController.java:24`.

Failure scenario:

First analysis materializes a packet with one checkpoint. A late checkpoint/artifact callback adds evidence, then a second analysis request materializes again. The mapper returns the stale first snapshot, so Analyzer evaluates old evidence.

Fix direction:

Choose one explicit model. Either insert immutable snapshots per analysis request or update `packet_jsonb`, counts, and timestamps on conflict. Add a regression test that materializes twice after evidence changes and proves the second analysis sees the new packet.

2. Runner observations can produce EvidencePackets that violate the EvidencePacket contract.

Evidence:

- Runner checkpoint `observations` are arbitrary objects in callback schema: `packages/contracts/internal/runner-callback.schema.json:379`.
- Persistence accepts arbitrary `type` and `source`: `apps/api-server/src/main/java/com/wedge/evidence/application/CheckpointPersistenceService.java:176`.
- Assembler emits persisted observation values directly: `apps/api-server/src/main/java/com/wedge/evidence/application/EvidencePacketAssembler.java:125`.
- EvidencePacket schema restricts observation `type` and `source` enums: `packages/contracts/schemas/evidence-packet.schema.json:267`, `:325`.

Failure scenario:

Runner sends a new observation type/source before the EvidencePacket contract is updated. Spring stores it and produces an EvidencePacket that Analyzer schema validation or source/type handling rejects.

Fix direction:

Validate/normalize observation type and source at ingestion against shared contract enums. Unknown values should be rejected or mapped to a documented fallback after contract update.

### MEDIUM

1. Large S3 artifacts are loaded fully into heap.

Evidence:

- `S3ArtifactContentStore.load()` calls `getObjectAsBytes()` and wraps a `byte[]`: `apps/api-server/src/main/java/com/wedge/evidence/infrastructure/S3ArtifactContentStore.java:44`.
- Public content route serves any run artifact content through this path: `apps/api-server/src/main/java/com/wedge/run/api/RunController.java:203`.

Failure scenario:

A large HAR/trace/DOM artifact download loads the whole object into API server memory, causing GC pressure or OOM.

Fix direction:

Stream S3 objects with `getObject()` and `InputStreamResource`, use presigned GET URLs for large artifacts, and enforce size/content-type limits.

2. Evidence packet assembly and callback payloads are unbounded.

Evidence:

- Checkpoint callback arrays use `@Size(min = 1)` but no max: `apps/api-server/src/main/java/com/wedge/run/api/internal/runner/dto/RunnerCheckpointsRequest.java:8`.
- Signature filter reads request bodies into memory: `apps/api-server/src/main/java/com/wedge/common/security/InternalServiceTokenFilter.java:75`.
- Packet assembly loads all artifacts/checkpoints/observations: `apps/api-server/src/main/java/com/wedge/evidence/application/EvidenceService.java:160-166`.
- Mapper queries such as observation load are unbounded: `apps/api-server/src/main/resources/mapper/evidence/ObservationMapper.xml:25`.

Failure scenario:

A buggy runner posts very large checkpoint state/observations, or a long run accumulates many rows. API memory, DB JSONB, and Analyzer payload size spike.

Fix direction:

Add schema-level `maxItems`/`maxLength`, DTO `@Size(max=...)`, request limits, and packet-size policy before snapshot storage.

3. Duplicate runner-supplied observation IDs can roll back otherwise valid checkpoints.

Evidence:

- Supplied observation id is used directly: `apps/api-server/src/main/java/com/wedge/evidence/application/CheckpointPersistenceService.java:176`.
- `ObservationMapper.insert()` has no conflict handling: `apps/api-server/src/main/resources/mapper/evidence/ObservationMapper.xml:46`.
- DDL expects `UNIQUE (run_id, observation_key)`: `docs/wedge_schema.sql:359`.

Failure scenario:

Two checkpoints send `observation_id: "obs_cta"` for repeated CTA observations. The second insert violates uniqueness, rolls back the callback transaction, and can retry forever.

Fix direction:

Namespace supplied observation IDs by checkpoint key, reject duplicates clearly, or generate server-owned observation keys while preserving runner IDs separately.

4. Signed URL decoration masks generator failures and can skip later valid artifacts.

Evidence:

- Attempt count increments before `addSignedUrl()`: `apps/api-server/src/main/java/com/wedge/evidence/application/EvidencePacketSignedUrlDecorator.java:90`.
- `addSignedUrl()` catches `RuntimeException` and only logs: `apps/api-server/src/main/java/com/wedge/evidence/application/EvidencePacketSignedUrlDecorator.java:108`.
- Current test codifies skipping the second artifact after first presign failure: `apps/api-server/src/test/java/com/wedge/evidence/application/EvidencePacketSignedUrlDecoratorTest.java:76`.

Failure scenario:

With `maxSignedUrlCount=1`, the first screenshot presign fails transiently and the second would succeed. The packet returns no signed URL, reducing Analyzer visual evidence without surfacing a hard failure.

Fix direction:

Count successful signed URLs instead of attempts, or include explicit partial-signing diagnostics if best-effort behavior is intentional.

5. Artifact idempotency is global by artifact id, not run-scoped.

Evidence:

- `ArtifactPersistenceService` skips existing artifact by `artifactId` alone: `apps/api-server/src/main/java/com/wedge/evidence/application/ArtifactPersistenceService.java:26`.
- `RunnerCallbackService` updates the current run’s latest artifact pointer from callback payload: `apps/api-server/src/main/java/com/wedge/run/application/RunnerCallbackService.java:121-125`.
- `test_run.latest_artifact_id` has no scope check in schema: `docs/wedge_schema.sql:207-210`.
- `RunMapper.updateLatestArtifact` writes the pointer directly: `apps/api-server/src/main/resources/mapper/run/RunMapper.xml:271`.

Failure scenario:

A duplicate artifact id from another run is treated as a successful no-op, yet the target run can still point at that artifact id as latest.

Fix direction:

Treat duplicate artifact ids from another run as conflicts and scope pointer updates to run-owned artifacts.

### LOW

None beyond the medium items.

## Query Risks

- Whole-run `findByRunId` queries feed summary and packet assembly without pagination or size guards.
- `findLatestScreenshotByRunIdAndStage` uses `jsonb_array_elements_text` over checkpoint artifact refs; acceptable for small runs, risky if checkpoint/ref counts grow.
- No packet byte-size guard before `packet_jsonb` storage.

## Transaction / Concurrency Risks

- Snapshot upsert semantics are the largest correctness risk because analysis input can be stale.
- Callback idempotency is envelope-level; it assumes `X-Event-Id` uniqueness per consumer. 확인 필요: runner guarantees uniqueness across runs and retries.
- Some content writer flows write object content before metadata persistence, which can leave orphaned objects if DB insert fails.

## Contract Boundary Risks

- `runner-callback.schema.json` is looser than `evidence-packet.schema.json` for observation type/source.
- EvidencePacket assembly exposes `bucket` and `key`, which can harden physical storage layout into a downstream contract: `apps/api-server/src/main/java/com/wedge/evidence/application/EvidencePacketAssembler.java:242-247`.
- Runner architecture says bucket/key should stay hidden behind `ArtifactStore`: `docs/wedge_runner_architecture.md:378-380`.
- Assembler uses API DTO URL construction, coupling packet assembly to REST route shape: `apps/api-server/src/main/java/com/wedge/evidence/application/EvidencePacketAssembler.java:239`, `apps/api-server/src/main/java/com/wedge/evidence/api/dto/ArtifactResponse.java:45`.

## DDD / Responsibility Issues

- Evidence aggregate invariants are split across `RunnerCallbackService`, mappers, DB constraints, and packet assembly.
- `Artifact`, `Checkpoint`, and `Observation` are mutable data holders; services/SQL own invariants.
- There is no single owner for “this analysis job points to exactly this evidence snapshot.”

## Test Gaps

- Second materialization after evidence changes.
- Schema validation of assembled EvidencePacket.
- Duplicate supplied `observation_id` across checkpoints.
- Large payload/content streaming.
- Signed URL failure observability.
- Artifact id reuse across runs.

## Refactor Candidates

- Replace snapshot upsert with immutable snapshot creation or true refresh semantics.
- Add shared contract enum normalization for observation type/source.
- Introduce artifact content streaming abstraction for S3.
- Add bounded packet assembly policy for max checkpoints, observations, artifacts, and JSON bytes.
- Define artifact-ref integrity policy before analysis materialization.

## Architect Lane

Architectural Status: `BLOCK`.

The storage/application split is directionally sound, but the EvidencePacket snapshot boundary has a blocking invariant gap: repeated materialization for the same run/schema can return stale evidence while new analysis jobs reference it.

Strongest counterargument:

The design is pragmatic for MVP: callbacks are internal, ids are UUIDs, envelope idempotency exists, and normal UI flow may request analysis once per completed run. The stale snapshot path may be rare.

Synthesis:

Keep the current service split and content-store adapter boundary. Tighten only reproducibility invariants: snapshot semantics, artifact-ref resolution, and physical storage leakage.

## Confidence

High for stale snapshot and observation contract findings. Medium for runner event uniqueness and Analyzer dependence on signed URLs.

## Verification Notes

- Subagent reported focused Gradle test attempts were blocked by build/test output filesystem issues after main compilation.
- No source files were edited.
