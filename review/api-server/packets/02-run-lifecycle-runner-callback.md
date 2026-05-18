# Packet 02 - run-lifecycle-runner-callback

## Scope

Read-only review of public run lifecycle, internal runner callbacks, runner message idempotency, and agent idempotency. This packet traces public run commands through outbox dispatch and runner callback state changes.

## Flow Map

- Public lifecycle: `POST /api/runs` creates a run; `POST /api/runs/{runId}/start` and `/agent/start` enqueue runner/agent execution.
- Runner callbacks: `accepted` moves `QUEUED -> STARTING`; step/checkpoint/artifact/agent callbacks promote `STARTING -> RUNNING`; `finished` moves to `COMPLETED` or `STOPPED`; `failed` moves to `FAILED`.
- Duplicate handling: callback envelope `X-Event-Id` is recorded in `processed_message`.
- Runner message idempotency stores first-writer terminal records by `(scope, idempotencyKeyHash)`.
- Agent idempotency claims create `CLAIMED`; expired claims can be stolen; owner can renew/release; terminal result becomes `COMPLETED`.

## Files Reviewed

- `apps/api-server/src/main/java/com/wedge/run/api/RunController.java`
- `apps/api-server/src/main/java/com/wedge/run/api/internal/runner/*.java`
- `apps/api-server/src/main/java/com/wedge/run/api/internal/runner/dto/*.java`
- `apps/api-server/src/main/java/com/wedge/run/application/*.java`
- `apps/api-server/src/main/java/com/wedge/run/infrastructure/*.java`
- `apps/api-server/src/main/resources/mapper/run/*.xml`
- `apps/api-server/src/main/resources/mapper/common/ProcessedMessageMapper.xml`
- `packages/contracts/internal/runner-callback.schema.json`
- `packages/contracts/internal/runner-agent-idempotency.schema.json`
- `packages/contracts/internal/runner-message-idempotency.schema.json`
- `packages/contracts/enums/run-status.json`
- relevant run/security tests and docs

## Invariants Expected

- Public run mutations must enforce project access for the authenticated user.
- Run and step transitions must not regress under duplicate, late, or out-of-order callbacks.
- Envelope `X-Event-Id` and per-item event IDs must make at-least-once callback delivery safe.
- Agent/message idempotency APIs must match machine-readable contracts and claimed identity.
- Internal callback trust boundary must match bearer/signature/header contracts.
- Concurrent checkpoint/artifact callbacks must not fail while resolving/creating agent steps.

## Failure Scenarios Checked

- Cross-project public run start.
- Duplicate callback with same and different envelope ids.
- Late step event after a completed step.
- Finished/failed terminal callback races.
- Concurrent checkpoint/artifact callback creating the same agent step.
- Agent/message idempotency claim/renew/release/complete behavior.
- Runner agent trace contract mismatch.
- Run listing and event pagination query shape.

## Findings

### CRITICAL

None.

### HIGH

1. `/api/runs/{runId}/agent/start` bypasses project access ownership.

Evidence:

- `startRun` checks `ensureRunAccessible`: `apps/api-server/src/main/java/com/wedge/run/api/RunController.java:93-100`.
- `stopRun` checks `ensureRunAccessible`: `apps/api-server/src/main/java/com/wedge/run/api/RunController.java:113-122`.
- `startAgentRun` does not accept `Authentication` and calls `runService.startAgentRun` directly: `apps/api-server/src/main/java/com/wedge/run/api/RunController.java:104-110`.
- Security requires authentication for `/api/runs/**`, but not project membership: `apps/api-server/src/main/java/com/wedge/common/config/SecurityConfig.java:70-82`.
- Controller test exercises `/agent/start` without principal/project access: `apps/api-server/src/test/java/com/wedge/run/api/RunControllerTest.java:294-307`.

Failure scenario:

An authenticated user who knows another project’s `runId` can enqueue agent execution for a run they cannot access.

Fix direction:

Add `Authentication` to `startAgentRun`, call `ensureRunAccessible(runId, authentication)`, and add forbidden/cross-project tests.

2. Runner agent trace callback contract is inconsistent across JSON schema, OpenAPI, and Java DTO.

Evidence:

- JSON schema `AgentTraceRequest` requires only `trace`: `packages/contracts/internal/runner-callback.schema.json:1086`.
- Server DTO requires top-level `taskId`, `attemptId`, and `occurredAt`: `apps/api-server/src/main/java/com/wedge/run/api/internal/runner/dto/RunnerAgentTraceRequest.java:8-12`.
- OpenAPI has conflicting duplicate `RunnerAgentTraceRequest` component shapes: `packages/contracts/openapi/wedge_openapi.yaml:5351-5372`, `:5664-5670`.

Failure scenario:

A runner generated from schema sends `{ "trace": ... }`; Spring rejects it with validation errors, so agent trace persistence fails.

Fix direction:

Choose one canonical shape contract-first. Either update schema/OpenAPI to the top-level callback shape or change DTO/controller to derive identity/timestamps from `trace`.

3. Step events can regress step state because stale-event and step-transition guards are missing.

Evidence:

- `RunnerCallbackService.applyStepEvent()` resolves the step and calls unconditional state update: `apps/api-server/src/main/java/com/wedge/run/application/RunnerCallbackService.java:197-210`.
- `RunMapper.xml` overwrites `test_run_step.status` unconditionally: `apps/api-server/src/main/resources/mapper/run/RunMapper.xml:313-321`.

Failure scenario:

`STEP_COMPLETED` is processed first, then delayed `STEP_STARTED` arrives with a fresh `X-Event-Id` while the run is non-terminal. The step regresses from `PASSED` to `RUNNING` while `finished_at` remains set.

Fix direction:

Enforce step transition ordering and/or `occurredAt` monotonicity before status updates. Add tests for out-of-order `STEP_STARTED` after `STEP_COMPLETED`.

### MEDIUM

1. Per-item runner event IDs are required by contract but are not persisted or deduped for step events.

Evidence:

- Contract requires per-item `eventId`: `packages/contracts/internal/runner-callback.schema.json:49-52`, `:83-90`.
- Controller maps item event IDs into command objects: `apps/api-server/src/main/java/com/wedge/run/api/internal/runner/RunnerCallbackController.java:151-161`.
- `RunnerCallbackService` appends run events without item event id: `apps/api-server/src/main/java/com/wedge/run/application/RunnerCallbackService.java:197-200`.
- `test_run_event` schema has no runner event id uniqueness: `docs/wedge_schema.sql:253-262`.
- Existing tests cover duplicate envelope `X-Event-Id`, not duplicate item IDs: `apps/api-server/src/test/java/com/wedge/run/application/RunnerCallbackServiceTest.java:488-514`.

Failure scenario:

Runner retries the same item events under a different batch `X-Event-Id`; Spring appends duplicate timeline rows and may reapply step state.

Fix direction:

Persist callback item IDs and enforce uniqueness, for example `(run_id, runner_event_id)`, or add a dedicated dedupe table.

2. Agent event rows dedupe, but generic run timeline rows can still duplicate.

Evidence:

- `RunMapper.xml` inserts agent event records with `ON CONFLICT DO NOTHING`: `apps/api-server/src/main/resources/mapper/run/RunMapper.xml:344-367`.
- `RunnerCallbackService` still calls `appendAgentRunEvent` for every submitted item: `apps/api-server/src/main/java/com/wedge/run/application/RunnerCallbackService.java:167-170`, `:214-222`.

Failure scenario:

Same agent event arrives with a new batch `X-Event-Id`; `runner_agent_event` dedupes it, but `test_run_event` receives a duplicate `AGENT_*` timeline row.

Fix direction:

Have `saveAgentEvents` return inserted event ids/counts and append generic run events only for newly inserted agent events.

3. Agent step creation uses read-then-insert and can fail under concurrent callbacks.

Evidence:

- `RunPersistenceAdapter.resolveOrCreateAgentStep` does read then insert: `apps/api-server/src/main/java/com/wedge/run/infrastructure/RunPersistenceAdapter.java:155`.
- `test_run_step` has unique constraints on `(run_id, step_order)` and `(run_id, step_key)`: `docs/wedge_schema.sql:248-249`.

Failure scenario:

Checkpoint and artifact callbacks for `agent_turn_1` arrive concurrently; both miss the row, both insert, and one fails with a unique constraint exception.

Fix direction:

Use atomic upsert/reselect or catch duplicate key and re-read the step.

4. Runner idempotency endpoint header contract is inconsistent with controllers.

Evidence:

- OpenAPI contracts idempotency endpoints with `X-Worker-Id`, `X-Event-Id`, and `X-Signature`: `packages/contracts/openapi/wedge_openapi.yaml:1783`.
- `RunnerMessageIdempotencyController` accepts no headers: `apps/api-server/src/main/java/com/wedge/run/api/internal/runner/RunnerMessageIdempotencyController.java:23-38`.
- `RunnerAgentIdempotencyController` lookup endpoints accept no worker/event/signature: `apps/api-server/src/main/java/com/wedge/run/api/internal/runner/RunnerAgentIdempotencyController.java:28-32`.

Failure scenario:

Internal clients generated from OpenAPI send/expect required headers while Spring accepts missing headers, weakening audit/trust consistency and contract tests.

Fix direction:

Align controllers and OpenAPI. Prefer one shared internal callback/header validation model.

5. Agent idempotency completion is under-constrained.

Evidence:

- Claim/renew/release carry run/task/attempt identity in contract: `packages/contracts/internal/runner-agent-idempotency.schema.json:15-43`, `:96-121`.
- Renew/release SQL matches those fields: `apps/api-server/src/main/resources/mapper/run/AgentIdempotencyMapper.xml:78-100`.
- Completion matches only `idempotency_key_hash`, `status`, and `claimed_by`: `apps/api-server/src/main/resources/mapper/run/AgentIdempotencyMapper.xml:102-112`.

Failure scenario:

The owning worker completes a record without proving it is completing the same run/task/attempt claim, allowing an unrelated result under a reused key/worker context.

Fix direction:

Match completion on run/task/attempt identity just like renew/release, or make completion payload identity explicit and validated.

### LOW

1. Public `Idempotency-Key` headers are accepted but unused.

Evidence:

- Public run endpoints accept idempotency headers: `apps/api-server/src/main/java/com/wedge/run/api/RunController.java:71-78`, `:93-110`.
- Docs advertise idempotency for create/start/agent-start: `docs/03_api_reference.md:35`, `:480-523`.
- `RunService` methods do not receive the key.

Failure scenario:

Client retries `POST /api/runs/{runId}/start` after losing a 202 response and receives a state conflict instead of an idempotent replay.

Fix direction:

Implement public idempotency for run state-changing commands or remove the header from docs/OpenAPI until supported.

## Query Risks

- `RunController` loads all runs when `projectId` is absent, then filters access in Java: `apps/api-server/src/main/java/com/wedge/run/api/RunController.java:65-68`. `RunMapper.xml` has no access join: `apps/api-server/src/main/resources/mapper/run/RunMapper.xml:84-95`.
- Event pagination uses `(occurred_at, id)`, but documented index appears to cover `(run_id, occurred_at DESC)` only: `apps/api-server/src/main/resources/mapper/run/RunMapper.xml:128-155`, `docs/wedge_schema.sql:623`. 확인 필요: workload and index coverage for `stepId`/`eventType` filters.

## Transaction / Concurrency Risks

- `processed_message` participates in the callback transaction; rollback should allow retry.
- Main gaps are stale step event ordering, per-item idempotency, generic timeline duplication, and agent step creation races.
- Terminal evidence policy is unclear: step events are blocked after terminal state, but checkpoints/artifacts can still persist and update latest pointers: `apps/api-server/src/main/java/com/wedge/run/application/RunnerCallbackService.java:84-88`, `:100-126`.

## Contract Boundary Risks

- Agent trace callback contract differs across JSON schema, OpenAPI, and Java DTO.
- Internal idempotency endpoint headers differ between OpenAPI and controllers.
- `InternalServiceTokenFilter` can accept missing HMAC when `wedge.internal.runner-callback-signature-secret` is blank: `apps/api-server/src/main/java/com/wedge/common/security/InternalServiceTokenFilter.java:128-130`. 확인 필요: production configuration should fail closed or be explicit.

## DDD / Responsibility Issues

- `RunService` imports API DTOs and returns API responses from application methods: `apps/api-server/src/main/java/com/wedge/run/application/RunService.java:5-8`.
- `RunPersistenceAdapter` imports API DTOs and constructs response objects directly: `apps/api-server/src/main/java/com/wedge/run/infrastructure/RunPersistenceAdapter.java:8-11`, `:397-417`.
- Public access checks live in the controller helper rather than a command boundary shared by all run mutations, which is why `/agent/start` drifted.

## Test Gaps

- `/api/runs/{runId}/agent/start` project membership enforcement.
- Out-of-order step events.
- Same item event IDs under different batch `X-Event-Id`.
- Generic run timeline dedupe for duplicate agent events.
- Concurrent agent step creation.
- JSON schema/OpenAPI/Java DTO contract tests for runner callbacks.
- Idempotency endpoint header validation tests.

## Refactor Candidates

- Centralize run mutation access checks.
- Introduce durable runner item-event identity.
- Add a step transition policy separate from run transition policy.
- Use atomic upsert/reselect for agent step resolution.
- Separate application command/result objects from API DTOs.

## Architect Lane

Architectural Status: `BLOCK`.

The main run state machine is centralized and directionally sound, but command boundary and idempotency invariants are incomplete:

- `/agent/start` bypasses project ownership checks.
- Public `Idempotency-Key` is contract-shaped but not behavior-shaped.
- Per-item callback ids are not preserved at event granularity.
- Agent idempotency completion does not verify the claimed run/task/attempt identity.

Strongest counterargument:

The core lifecycle has a central transition table and optimistic expected-status updates; outbox dispatch occurs after commit, and internal callback retries use `processed_message`. This prevents many obvious double-transition failures.

Synthesis:

Keep Spring as lifecycle owner and Runner as execution reporter, but close command-boundary gaps before relying on the agent/runner callback surface for production reliability.

## Confidence

High on authorization and contract mismatches. Medium-high on duplicate/stale callback risks because exact runner retry behavior is still 확인 필요.

## Verification Notes

- Subagent reported `gradle compileJava compileTestJava` succeeded.
- Scoped `gradle test --tests 'com.wedge.run.*'` compiled, then failed in Gradle test infrastructure with a `NoSuchFileException` under `build/test-results/test/binary/...`; assertions did not complete.
- No source files were edited.
