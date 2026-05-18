# Packet 05 - scenario-authoring-flow

## Scope

Read-only review of ScenarioAuthoring job create/fetch/confirm, internal runner callbacks, provider result persistence, and contract alignment.

## Flow Map

`POST /api/scenario-authoring-jobs` -> `ScenarioAuthoringJobController.createJob` -> project access check -> source discovery lookup -> persisted recommendation selection -> `scenario_authoring_job` inserted as `QUEUED` -> `scenario-authoring.execute.request` outbox message appended -> after-commit dispatch.

Runner callbacks enter `/internal/runner/scenario-authoring-jobs/{authoringJobId}/{accepted|finished|failed}`. `accepted` moves to `RUNNING`; `finished` stores provider trace, candidates, validation, provenance and sets `SUCCEEDED` or `FAILED`; `failed` stores failure payload and sets `FAILED`.

`GET` loads job by id and checks project membership. `confirm` selects a candidate by `candidate_id`, checks validation flags, and stores `confirmed_candidate_id`; it does not materialize a run.

## Files Reviewed

- `apps/api-server/src/main/java/com/wedge/scenarioauthoring/**`
- `apps/api-server/src/main/resources/mapper/scenarioauthoring/ScenarioAuthoringJobMapper.xml`
- `apps/api-server/src/test/java/com/wedge/scenarioauthoring/**`
- `packages/contracts/schemas/scenario-authoring.schema.json`
- `packages/contracts/schemas/scenario-plan.schema.json`
- `packages/contracts/examples/sample-scenario-authoring-job.json`
- `packages/contracts/examples/sample-scenario-authoring-result.json`
- `packages/contracts/openapi/wedge_openapi.yaml`
- relevant docs and DDL sections

## Invariants Expected

- Authoring starts only from an accessible project and discovery in that project.
- Client-supplied recommendation fields must not override persisted discovery recommendations.
- Idempotency should replay the same create request, not alias different requests.
- Provider policy accepted by API, OpenAPI, examples, MQ payloads, and runner must match.
- Runner callback order/idempotency must preserve monotonic state.
- `SUCCEEDED` jobs must contain candidates satisfying ScenarioAuthoringCandidate and embedded ScenarioPlan contracts.
- Confirmation must only select valid, unexpired, successful candidates.
- Confirm does not imply run materialization unless a run is actually created.

## Failure Scenarios Checked

- Cross-project discovery supplied to create.
- Forged recommendation URL/evidence in request body.
- Unsupported provider policy/scenario type.
- Low/no-evidence recommendation.
- Duplicate idempotency key.
- Runner accepted/finished/failed callback ordering.
- Confirmation of missing, invalid, already-confirmed, expired, or non-`SUCCEEDED` candidates.
- Contract drift between Java DTOs, OpenAPI, JSON schemas, examples, and docs.
- Outbox retry behavior for scenario-authoring execute messages.

## Findings

### CRITICAL

None.

### HIGH

1. Spring trusts provider-supplied validation booleans instead of validating candidates and embedded ScenarioPlan.

Evidence:

- `finished` callback success is based on non-empty candidates plus top-level validation flags: `apps/api-server/src/main/java/com/wedge/scenarioauthoring/application/ScenarioAuthoringCallbackService.java:60-62`.
- Service persists candidates without validating each candidate or embedded `scenario_plan`: `apps/api-server/src/main/java/com/wedge/scenarioauthoring/application/ScenarioAuthoringCallbackService.java:66`.
- Confirmation checks candidate id and nested validation flags: `apps/api-server/src/main/java/com/wedge/scenarioauthoring/application/ScenarioAuthoringJobService.java:98`, `:312`.
- Contract requires each candidate to include `candidate_id`, `scenario_plan`, `confidence`, `rationale`, `evidence_refs`, and `validation`: `packages/contracts/schemas/scenario-authoring.schema.json:382`.
- Embedded `scenario_plan` must satisfy `scenario-plan.schema.json`: `packages/contracts/schemas/scenario-authoring.schema.json:396`; docs state the same at `docs/04_domain_payload_contracts.md:109`.
- Spring already has `ScenarioPlanValidator`: `apps/api-server/src/main/java/com/wedge/run/application/ScenarioPlanValidator.java:38`.

Failure scenario:

A buggy or compromised provider posts `validation.schema_valid=true` with a candidate missing a valid `scenario_plan`. Job becomes `SUCCEEDED`, confirmation succeeds, and later run materialization receives a non-executable candidate.

Fix direction:

Make Spring the validation authority. Validate callback payloads server-side before `SUCCEEDED`, validate every candidate and embedded ScenarioPlan, require unique candidate ids, and persist failed validation details if invalid.

### MEDIUM

1. Create idempotency does not compare the new request to the original request.

Evidence:

- Existing idempotency lookup returns the first job by `(project_id, created_by, idempotency_key)`: `apps/api-server/src/main/java/com/wedge/scenarioauthoring/application/ScenarioAuthoringJobService.java:61-65`.
- There is no request hash or canonical request comparison before replay.

Failure scenario:

Client reuses `Idempotency-Key` for a different `sourceDiscoveryId`, goal, recommendation, or provider policy. API returns the old job as if the new request succeeded.

Fix direction:

Store a request hash or canonical request fields and return `409` on same-key/different-body replay.

2. Authoring input can include schema-invalid discovery URLs.

Evidence:

- `buildInput` uses persisted discovery input/final URL directly: `apps/api-server/src/main/java/com/wedge/scenarioauthoring/application/ScenarioAuthoringJobService.java:172-173`.
- A test currently locks in blank URL acceptance: `apps/api-server/src/test/java/com/wedge/scenarioauthoring/application/ScenarioAuthoringJobServiceTest.java:281`.
- SiteDiscoveryResult schema requires URI strings: `packages/contracts/schemas/site-discovery-result.schema.json:23`.

Failure scenario:

Queued authoring execute payload has empty `input_url`/`final_url`; runner validates MQ payload and rejects/dead-letters a job already accepted by the API.

Fix direction:

Reject authoring creation when discovery lacks a usable URL, or derive a valid start URL from persisted recommendation and schema-test the MQ payload.

3. Terminal callbacks are allowed while job is still `QUEUED`.

Evidence:

- `completeFromRunner` and `failFromRunner` accept `QUEUED` jobs: `apps/api-server/src/main/resources/mapper/scenarioauthoring/ScenarioAuthoringJobMapper.xml:92`.

Failure scenario:

Runner sends `finished` before `accepted`; job jumps to `SUCCEEDED`, and a later accepted callback conflicts. If intentional, this resilience rule is undocumented and untested.

Fix direction:

Require `RUNNING` for terminal callbacks, or document `QUEUED -> terminal` as allowed and add tests for early terminal and late accepted callbacks.

4. Runner callback HMAC verification is fail-open when signature secret is blank.

Evidence:

- `InternalServiceTokenFilter` accepts any non-empty signature when `wedge.internal.runner-callback-signature-secret` is blank: `apps/api-server/src/main/java/com/wedge/common/security/InternalServiceTokenFilter.java:128`.
- ScenarioAuthoring runner callback controller requires `X-Signature`, but the filter can skip actual verification.

Failure scenario:

Environment with internal bearer token but no signature secret accepts forged scenario-authoring `finished` callbacks.

Fix direction:

Fail closed outside local/dev profiles, or make missing signature secret a startup error for deployments exposing `/internal/runner/**`.

5. Runner-as-provider boundary conflicts with baseline docs.

Evidence:

- API-server publishes `scenario-authoring.execute.request`: `apps/api-server/src/main/java/com/wedge/scenarioauthoring/application/ScenarioAuthoringExecuteRequestMessageFactory.java:12`, `:25`.
- Runner consumes and compiles rule-based candidates: `apps/runner/src/app.ts:185`, `apps/runner/src/authoring/index.ts:35`, `apps/runner/src/authoring/rule-based-provider.ts:25`.
- Baseline docs say Runner does not participate in ScenarioAuthoring: `docs/01_architecture_and_project_structure.md:186-187`, `docs/04_domain_payload_contracts.md:111-112`.
- MQ contract now says Runner owns compilation: `packages/contracts/mq/scenario-authoring.execute.request.schema.json:5`.

Failure scenario:

Future providers expand with an unclear boundary: Runner becomes both browser executor and authoring provider, while docs/contracts disagree on ownership.

Fix direction:

Make an explicit decision. Either document “Runner-hosted authoring compiler, no browser control” as the MVP boundary or move provider execution out of Runner.

### LOW

1. Provider examples/docs are stale relative to RULE_BASED-only API skeleton.

Evidence:

- Sample still advertises `CODEX`, `CLAUDE_CODE`, `INTERNAL_LLM`, `RULE_BASED`: `packages/contracts/examples/sample-scenario-authoring-job.json:137`.
- API rejects any order other than `[RULE_BASED]`: `apps/api-server/src/main/java/com/wedge/scenarioauthoring/application/ScenarioAuthoringJobService.java:285`.
- OpenAPI has been narrowed: `packages/contracts/openapi/wedge_openapi.yaml:3605`.

Failure scenario:

Client/runner developer copies sample and receives validation failure.

Fix direction:

Update examples/docs or mark multi-provider samples as future/non-runtime fixtures.

## Query Risks

- `findById`, `findByIdempotencyKey`, and status updates are index-friendly.
- `ScenarioRecommendationMapper.findByDiscoveryId` sorts by `confidence DESC, created_at ASC`; existing index is only `(discovery_id, recommendation_level)`. Fine for small recommendation sets, not ideal for large accumulated recommendations.

## Transaction / Concurrency Risks

- Create inserts job and outbox in one transaction; after-commit dispatch and scheduled retry exist.
- Confirm uses atomic `confirmed_candidate_id IS NULL` update, guarding different-candidate races.
- Callback idempotency uses `processed_message` by `(consumer_name, event_id)`; acceptable only if runner event ids are globally unique.

## Contract Boundary Risks

- REST DTOs are camelCase while domain payload schemas are snake_case; OpenAPI documents camelCase API fields. Consumers must not treat domain schema as REST schema.
- Confirmation stores selected candidate only; `materialized_run_id` remains null. This matches OpenAPI but leaves run materialization for a later path.
- Provider policy contract/examples/docs are partially ahead of implementation.

## DDD / Responsibility Issues

- `ScenarioAuthoringJobService` owns project/discovery validation, recommendation selection, provider policy, idempotency, outbox, input assembly, confirm, and JSON parsing in one service.
- It imports both `DiscoveryService` and discovery infrastructure mapper directly, leaking discovery persistence into scenario authoring: `apps/api-server/src/main/java/com/wedge/scenarioauthoring/application/ScenarioAuthoringJobService.java:9`, `:12`.
- Status enum includes `CREATED`, `CANCELED`, `EXPIRED`, but create starts at `QUEUED` and only callback/confirm transitions are implemented.

## Test Gaps

- `ScenarioAuthoringCallbackService` and callback controller accepted/finished/failed tests.
- Malformed candidates, invalid embedded ScenarioPlan, duplicate candidate ids, false-positive validation.
- Idempotency-key reuse with different request body.
- Callback ordering: finished before accepted, duplicate terminal event, accepted after terminal.
- Outbox dispatcher retry/mark-failed/mark-published tests.

## Refactor Candidates

- Introduce `ScenarioAuthoringPayloadValidator` for contract/schema validation before persistence.
- Store canonical create-request hash alongside `idempotency_key`.
- Extract status transition rules into a small helper.
- Introduce a Discovery recommendation query port to avoid direct infrastructure dependency.
- Align docs/examples with RULE_BASED-only MVP or explicitly mark future provider examples.

## Architect Lane

Architectural Status: `WATCH`.

The flow is serviceable for RULE_BASED MVP: Spring owns job state, create is idempotent/outboxed, callbacks mutate lifecycle, and confirm is separate from run execution. Main watch items are Runner/provider boundary drift and Spring trusting provider validation.

Strongest counterargument:

Keeping RULE_BASED authoring inside Runner is pragmatic because Runner already owns TypeScript contract mirrors, MQ consumption, callback clients, and ScenarioPlan validation helpers. Current Runner authoring compiles JSON and sends callbacks; it does not execute browser actions.

Synthesis:

Keep current RULE_BASED flow temporarily, but document the boundary as “Runner-hosted authoring compiler, no browser control, no DB reads, callback-only result submission.” Move validation authority into Spring and treat provider validation as advisory.

## Confidence

High for callback validation, idempotency, and contract drift findings. Medium for callback ordering because `QUEUED -> terminal` may be intentional but is not documented/tested.

## Verification Notes

- Subagent reported `gradle test --tests 'com.wedge.scenarioauthoring.*'` passed after rebuilding main classes.
- No source files were edited.
