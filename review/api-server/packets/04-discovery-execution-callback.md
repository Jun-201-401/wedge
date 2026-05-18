# Packet 04 - discovery-execution-callback

## Scope

Read-only review of discovery create, execution outbox, runner callbacks, checkpoint/recommendation persistence, and contract alignment.

## Flow Map

`POST /api/discoveries` -> `DiscoveryController.createDiscovery` -> `DiscoveryService.createDiscovery` -> URL validation/project access/idempotency lookup -> `site_discovery` insert -> outbox append -> `DiscoveryExecuteOutboxDispatcher` publishes `discovery.execute.request`.

Runner callbacks enter `/internal/runner/discoveries/{discoveryId}` -> `DiscoveryCallbackService` -> status updates through `SiteDiscoveryMapper`, checkpoint persistence through `CheckpointPersistenceService`, recommendations through `ScenarioRecommendationMapper`.

## Files Reviewed

- `apps/api-server/src/main/java/com/wedge/discovery/**`
- `apps/api-server/src/main/resources/mapper/discovery/*.xml`
- `apps/api-server/src/main/resources/mapper/evidence/CheckpointMapper.xml`
- `apps/api-server/src/test/java/com/wedge/discovery/**/*.java`
- `packages/contracts/schemas/site-discovery-result.schema.json`
- `packages/contracts/internal/runner-callback.schema.json`
- `packages/contracts/mq/messages.schema.json`
- `packages/contracts/openapi/wedge_openapi.yaml`
- relevant docs `docs/01` through `docs/04`

## Invariants Expected

- Discovery create is project-authorized and idempotent by `(projectId, userId, Idempotency-Key)`.
- URL validation prevents SSRF at the actual fetch boundary, not only at API request time.
- Outbox publish is retryable and does not publish before DB commit.
- Callback auth, event id, and worker id are consistently enforced.
- Callback replay and checkpoint persistence are idempotent under at-least-once delivery.
- Terminal callbacks cannot leave recommendations or evidence in an order-dependent inconsistent state.
- Machine-readable contracts match implemented routes and payloads.

## Failure Scenarios Checked

- Reused create idempotency key with same/different payload.
- Concurrent create insert race on idempotency key.
- Duplicate callback `X-Event-Id`.
- Late or out-of-order accepted/checkpoint/finished/failed callbacks.
- Recommendation delete/replace on finished.
- Discovery callback payload drift between Java DTOs, OpenAPI, and JSON schemas.
- Mapper uniqueness and ordering behavior.

## Findings

### CRITICAL

None.

### HIGH

1. URL validation happens at API create time but not at Runner fetch time, leaving a DNS rebinding gap.

Evidence:

- API-side validator resolves and checks the host: `apps/api-server/src/main/java/com/wedge/discovery/application/DiscoveryUrlValidator.java:57`.
- Execute message later sends only the original URL: `apps/api-server/src/main/java/com/wedge/discovery/application/DiscoveryExecuteRequestMessageFactory.java:29`.

Failure scenario:

An attacker submits `https://rebind.example`; API validation passes while DNS resolves public. Later, Runner resolves the same host to `127.0.0.1` or cloud metadata and navigates.

Fix direction:

Enforce private/reserved-address validation at the Runner/browser fetch boundary, or pass a validated resolution policy/IP pin and block redirects/re-resolves to private ranges.

2. Discovery checkpoint duplicate handling is inconsistent with run checkpoints.

Evidence:

- Discovery checkpoint insert lacks `ON CONFLICT (discovery_id, checkpoint_key) DO NOTHING`: `apps/api-server/src/main/resources/mapper/evidence/CheckpointMapper.xml:90`.
- Run checkpoint insert has conflict-ignore behavior: `apps/api-server/src/main/resources/mapper/evidence/CheckpointMapper.xml:75`, `:87`.
- DB uniqueness exists for discovery checkpoints: `infra/db/migrations/V20260424__add_runner_evidence_tables.sql:58`.
- Service logic expects zero-row insert to resolve existing checkpoint: `apps/api-server/src/main/java/com/wedge/evidence/application/CheckpointPersistenceService.java:86`.

Failure scenario:

The same discovery checkpoint is delivered with a new `X-Event-Id`. Instead of returning an idempotent duplicate ack, the mapper throws duplicate-key and the callback can retry/fail.

Fix direction:

Add conflict-ignore behavior to `insertDiscovery` or catch duplicate-key and re-read existing checkpoint. Add mapper/integration tests.

### MEDIUM

1. Discovery checkpoints can mutate evidence after terminal discovery state.

Evidence:

- `DiscoveryCallbackService` checkpoint path persists for any existing discovery state: `apps/api-server/src/main/java/com/wedge/discovery/application/DiscoveryCallbackService.java:77`.
- Terminal transition SQL protects finished/failed status but not late checkpoint writes.

Failure scenario:

`finished` commits first, then a delayed checkpoint with a fresh event id persists evidence after terminal state, changing what later authoring/reports see.

Fix direction:

Define the ordering rule explicitly. Reject terminal-state checkpoints, or persist them as late evidence with a visible status and tests.

2. Discovery internal callback routes are missing from OpenAPI.

Evidence:

- Routes are implemented: `apps/api-server/src/main/java/com/wedge/discovery/api/internal/runner/DiscoveryRunnerCallbackController.java:36`.
- Docs describe them: `docs/03_api_reference.md:592`.
- OpenAPI includes runner run callback paths but not discovery callback paths: `packages/contracts/openapi/wedge_openapi.yaml:1525`, `:2801`.

Failure scenario:

Generated internal clients cannot call discovery callbacks from the OpenAPI contract even though production code requires them.

Fix direction:

Add `/internal/runner/discoveries/{discoveryId}/accepted|checkpoints|finished|failed` to OpenAPI, referencing existing runner-callback payload schemas.

3. `CUSTOM_GUIDED` recommendation support drifts from canonical SiteDiscoveryResult schema.

Evidence:

- Java callback/DB allow `CUSTOM_GUIDED`: `apps/api-server/src/main/java/com/wedge/discovery/api/internal/runner/dto/DiscoveryRecommendationRequest.java:14`.
- `site-discovery-result.schema.json` uses `flow_type` for `scenario_recommendation.scenario_type` and excludes `CUSTOM_GUIDED`: `packages/contracts/schemas/site-discovery-result.schema.json:113`.

Failure scenario:

Runner submits `CUSTOM_GUIDED`; API persists it, but canonical SiteDiscoveryResult or authoring input validation rejects it.

Fix direction:

Either add `CUSTOM_GUIDED` to the schema enum or split recommendation scenario types from detected flow types.

4. Callback event id scope is implicit.

Evidence:

- Discovery callback schemas require non-empty `eventId`, but not global uniqueness: `packages/contracts/internal/runner-callback.schema.json:652`.
- `processed_message` is global by `(consumer_name, message_id)`, not scoped by discovery id: `docs/wedge_schema.sql:531`.
- `DiscoveryCallbackService` uses separate consumer names per callback type: `apps/api-server/src/main/java/com/wedge/discovery/application/DiscoveryCallbackService.java:32`, `:48`, `:86`, `:112`.

Failure scenario:

Two discoveries receive callbacks with the same event id under the same consumer name; one can be treated as duplicate even though it belongs to a different discovery.

Fix direction:

Make event-id uniqueness explicit in contracts or scope processed messages by aggregate id.

5. Discovery callback artifacts are required by contract but dropped.

Evidence:

- `DiscoveryCheckpointRequest` carries `artifacts`: `apps/api-server/src/main/java/com/wedge/discovery/api/internal/runner/dto/DiscoveryCheckpointRequest.java:13`.
- Contract requires artifacts: `packages/contracts/internal/runner-callback.schema.json:691`.
- Controller conversion passes checkpoint and observations, not artifacts: `apps/api-server/src/main/java/com/wedge/discovery/api/internal/runner/DiscoveryRunnerCallbackController.java:121`.
- Discovery artifact storage exists in schema: `docs/wedge_schema.sql:300`.

Failure scenario:

Runner sends discovery artifacts, but Spring drops them; later discovery/authoring lacks artifact-backed evidence despite contract requiring it.

Fix direction:

Persist discovery artifacts through the evidence artifact service or remove/deprecate them from the callback contract.

### LOW

1. Failed discovery response fields are implemented but missing from OpenAPI.

Evidence:

- Java `DiscoveryResponse` includes `failureCode` and `failureMessage`: `apps/api-server/src/main/java/com/wedge/discovery/api/dto/DiscoveryResponse.java:19`.
- OpenAPI `DiscoveryResponse` omits them: `packages/contracts/openapi/wedge_openapi.yaml:3560`.

Failure scenario:

Generated clients do not model useful failed-discovery detail.

Fix direction:

Add nullable `failureCode` and `failureMessage` to OpenAPI.

## Query Risks

- `ScenarioRecommendationMapper.xml` sorts by `confidence DESC, created_at ASC`, while the migration index is `(discovery_id, recommendation_level)`. Fine for small lists; add `(discovery_id, confidence DESC, created_at ASC, id)` if recommendation volume grows.
- Idempotency lookup aligns with the unique partial index for `(project_id, created_by, idempotency_key)`.

## Transaction / Concurrency Risks

- Discovery create outbox append and after-commit dispatch are directionally sound.
- Duplicate status callbacks are guarded by `processed_message`.
- Checkpoint idempotency still fails at mapper level for duplicate checkpoint keys with new event ids.
- Terminal discovery status is guarded for `finished`/`failed`, but late checkpoint persistence is not.

## Contract Boundary Risks

- OpenAPI missing discovery internal callback routes.
- Java/DB/OpenAPI/status enum drift: OpenAPI exposes `EXPIRED`; Java/SQL expose `CREATED`/`CANCELED` shapes.
- `CUSTOM_GUIDED` mismatch between Java/DB and SiteDiscoveryResult.
- REST failure fields missing from OpenAPI.

## DDD / Responsibility Issues

- `SiteDiscovery` is a mutable data holder; lifecycle invariants live in service plus SQL predicates.
- Callback controller does adapter transformation and silently drops contract fields.
- Existing DDD-lite shape is acceptable; bigger aggregate refactor is not needed before tightening contracts/idempotency.

## Test Gaps

- Duplicate discovery checkpoint persistence mapper/integration test.
- Discovery callback security/header/body mismatch tests.
- OpenAPI/contract test for discovery callback route presence.
- Late checkpoint after completed/failed discovery.
- Java discovery recommendation serialization against SiteDiscoveryResult schema.

## Refactor Candidates

- Share run/discovery checkpoint insert idempotency behavior.
- Centralize discovery scenario enum mapping across DTOs, DB checks, OpenAPI, and JSON schemas.
- Add focused discovery outbox dispatcher tests.
- Scope callback idempotency by aggregate id or formalize global event id format.

## Architect Lane

Architectural Status: `WATCH`.

The flow is directionally sound: public API creates `QUEUED`, outbox dispatch is after commit, and callback service owns runner lifecycle/recommendation write-back. Watch items are hidden idempotency assumptions, artifact loss at callback boundary, and contract drift.

Strongest counterargument:

The current implementation is pragmatic DDD-lite. Lifecycle rules are localized in callback service and SQL predicates, outbox is transactionally separated, and tests cover create idempotency plus duplicate callback events.

Synthesis:

Keep architecture. Tighten existing boundaries: event id scope, discovery checkpoint idempotency, artifact contract ownership, and enum/OpenAPI alignment.

## Confidence

High for scoped code and contract findings. Subagent reported `gradle test --tests 'com.wedge.discovery.*'` passed.

## Verification Notes

- No source files were edited.
