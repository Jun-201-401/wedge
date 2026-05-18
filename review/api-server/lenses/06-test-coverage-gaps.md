# Lens 06 - test-coverage-gaps

## Scope

Read-only review of `review/api-server/packets/*.md` and existing `apps/api-server/src/test` coverage.

## Summary

Test health: `NEEDS ATTENTION`.

Existing tests cover many happy paths and same-envelope duplicate callbacks. The important missing coverage is cross-aggregate authorization, stale/currentness, contract-schema validation, different-event replay, and operational failure modes.

## P0 Gaps

1. `/api/runs/{runId}/agent/start` must enforce project access.

- Covered: `RunControllerTest` covers several run access checks.
- Missing: forbidden/cross-project test for `/agent/start`; current test only verifies queueing.
- Target: `apps/api-server/src/test/java/com/wedge/run/api/RunControllerTest.java`, `RunController.startAgentRun`, `RunService.startAgentRun`.

2. Analyzer terminal callbacks must reject nonexistent job, wrong stored `runId`, and terminal conflicts.

- Covered: same `analysisJobId` and same `X-Event-Id` duplicate paths.
- Missing: stored ownership validation, unrequested job, completed-then-failed, failed-then-completed, ignored run update row count.
- Target: `AnalyzerCallbackServiceTest.java`, `JudgeResultPersistenceServiceTest.java`, `AnalysisJobMapper.xml`, `RunMapper.xml`.

3. JudgeResult and Analyzer callback payloads must be contract-valid before `COMPLETED`/`READY`.

- Covered: some minimal map handling and issue-stage checks.
- Missing: schema-required `summary`, `decision_map`, `criterion_id`, `severity`, `confidence`, `evidence_refs`, `rule_registry_id`.
- Target: `JudgeResultPersistenceServiceTest.java`, `ReportGenerationServiceTest.java`, `packages/contracts/schemas/judge-result.schema.json`.

4. EvidencePacket snapshot must not be stale after evidence changes.

- Covered: one snapshot write.
- Missing: second materialization after new checkpoint/artifact and new analysis request.
- Target: `EvidenceServiceTest.java`, `EvidencePacketMapper.xml`, `AnalysisRequestServiceTest.java`.

5. Outbox publish reliability must distinguish broker failure from success.

- Covered: dispatcher marks failed when publisher throws.
- Missing: unroutable/negative confirm, poison payload, max-attempt exhaustion.
- Target: `RunExecuteOutboxDispatcherTest.java`, `AnalysisRequestOutboxDispatcherTest.java`, discovery/scenario dispatcher tests, `OutboxMessagePersistenceAdapter`.

## P1 Gaps

1. DLQ settlement must exist for discovery, scenario-authoring, and analysis queues.

- Covered: run/agent DLQ handling.
- Missing: discovery/scenario/analysis DLQ listener behavior.
- Target: `RunnerExecutionDeadLetterListenerTest.java`, `RunnerMqConfigTest.java`, `AnalysisMqConfig`, new domain DLQ listeners.

2. Runner step and item idempotency must reject stale/different-event replay.

- Covered: normal started/completed flow and some late terminal handling.
- Missing: `STEP_COMPLETED` then delayed `STEP_STARTED`, duplicate item event id under different envelope id, duplicate agent timeline rows.
- Target: `RunnerCallbackServiceTest.java`, `RunnerCallbackLifecycleScenarioTest.java`, `RunPersistenceAdapterTest.java`.

3. Discovery SSRF must be enforced at the fetch boundary.

- Covered: API-side URL validation.
- Missing: execute message IP pin/policy, redirect policy, Runner-side revalidation.
- Target: `DiscoveryServiceTest.java`, `DiscoveryExecuteRequestMessageFactory`, runner fetch tests.

4. Discovery callback duplicate checkpoint with new `X-Event-Id` must be idempotent.

- Covered: duplicate same envelope event id.
- Missing: same discovery checkpoint key under different event id; late checkpoint after terminal.
- Target: `DiscoveryCallbackServiceTest.java`, `CheckpointPersistenceServiceTest.java`, `CheckpointMapper.xml`.

5. Shared report artifact access must be report-reference-scoped or explicitly run-wide.

- Covered: active share token returns a run image artifact.
- Missing: denial for same-run image not referenced by report.
- Target: `ReportShareServiceTest.java`, `ReportDetailQueryServiceTest.java`, `EvidenceService.getRunImageArtifactContent`.

6. Report export must reject stale report when latest analysis differs.

- Covered: report generation latest failed/generatable states.
- Missing: export old report while newer latest analysis has no report.
- Target: `ReportExportServiceTest.java`, `ReportGenerationServiceTest.java`.

7. Archived projects and default membership regrant need access-boundary tests.

- Covered: project creation/reuse basics.
- Missing: archived project denied; default membership is not restored/upgraded.
- Target: `DefaultProjectServiceTest.java`, `ProjectBootstrapServiceTest.java`, `ProjectAccessMapper.xml`.

## P2 Gaps

1. OpenAPI/JSON-schema drift should be executable.

- Covered: OpenAPI resource/controller smoke tests.
- Missing: schema-vs-DTO route coverage for runner agent trace, discovery callbacks, preview image enum, MCP decision tools, MQ idempotency fields.
- Target: `OpenApiContractResourceTest.java`, `OpenApiContractControllerTest.java`, runner/report/MCP DTO tests, `packages/contracts/**`.

## Highest-Value First

1. Add `RunControllerTest.agentStartRejectsInaccessibleRunProject`.
2. Add `JudgeResultPersistenceServiceTest` cases for wrong run, nonexistent job, completed-then-failed, and failed-then-completed.
3. Add `EvidenceServiceTest` for fresh materialization after evidence changes.
4. Add outbox tests for negative publish, poison payload, and retry exhaustion.
5. Add contract-schema tests for JudgeResult, EvidencePacket, runner callbacks, report preview enum, and MQ envelopes.

