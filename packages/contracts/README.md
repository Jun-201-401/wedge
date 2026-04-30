# Contracts

Canonical machine-readable contracts belong here. Human-readable design rationale lives in `../../docs`; implementation fixtures and schema contracts stay in this package so services can validate against the same source of truth.

## Directory roles

- `openapi/`: REST API contract for public `/api` endpoints and internal callback surfaces.
- `schemas/`: JSON Schema contracts for domain payloads such as ScenarioPlan, SiteDiscoveryResult, EvidencePacket, RuleRegistry, JudgeResult, and SemanticClassification.
- `examples/`: sample payloads that should conform to schemas and can be reused as fixtures/mock data.
- `mq/`: RabbitMQ canonical message envelope plus thin task-specific payload entrypoints.
- `websocket/`: live event envelope and event variant schemas.
- `internal/`: internal runner/analyzer callback payload schemas.
- `mcp/`: MCP tool metadata contract.
- `enums/`: shared lifecycle enums.
- `types/`: TypeScript mirrors of canonical contracts for app consumption; keep them aligned with the JSON Schema/OpenAPI sources above.

## Files

- `openapi/wedge_openapi.yaml`: public REST and internal callback OpenAPI draft
- `schemas/scenario-plan.schema.json`: executable browser scenario plan contract
- `schemas/site-discovery-result.schema.json`: Site Discovery / Preflight result and recommendation contract
- `schemas/evidence-packet.schema.json`: checkpoint-centered evidence packet contract
- `schemas/rule-registry.schema.json`: rule registry contract for analyzer criteria
- `schemas/judge-result.schema.json`: analyzer/judge output contract
- `schemas/semantic-classification.schema.json`: label-only semantic normalization request/response contract for provider adapters
- `examples/sample-scenario-plan-signup.json`: legacy signup ScenarioPlan fixture
- `examples/sample-scenario-plan-landing-cta.json`: MVP landing CTA ScenarioPlan fixture
- `examples/sample-scenario-plan-signup-form.json`: MVP signup form ScenarioPlan fixture
- `examples/sample-scenario-plan-pricing-checkout.json`: MVP pricing checkout ScenarioPlan fixture
- `examples/sample-site-discovery-result.json`: SiteDiscoveryResult fixture
- `examples/sample-evidence-packet.json`: EvidencePacket fixture
- `examples/sample-run-artifacts-response.json`: prototype REST fixture for `GET /api/runs/{runId}/artifacts`
- `examples/sample-run-evidence-packet-response.json`: prototype REST fixture for `GET /api/runs/{runId}/evidence-packet`
- `examples/sample-judge-result.json`: JudgeResult fixture
- `examples/sample-semantic-classification-request.json`: SemanticClassification provider request fixture
- `examples/sample-semantic-classification-response.json`: SemanticClassification provider response fixture
- `examples/sample-analyzer-completed.json`: analyzer completed callback example consuming settle observations
- `examples/sample-runner-checkpoints.json`: runner callback checkpoint example including settle observation subtypes
- `mq/messages.schema.json`: RabbitMQ common envelope and message type contract; this is the canonical MQ source
- `mq/run.execute.request.schema.json`: thin `$ref` entrypoint to `messages.schema.json#/$defs/RunExecutePayload`
- `mq/analysis.request.schema.json`: thin `$ref` entrypoint to `messages.schema.json#/$defs/AnalysisRequestPayload`
- `mq/report.export.request.schema.json`: thin `$ref` entrypoint to `messages.schema.json#/$defs/ReportExportRequestPayload`
- `websocket/events.schema.json`: live event envelope and event variants
- `internal/runner-callback.schema.json`: runner callback payload definitions
- `internal/analyzer-callback.schema.json`: analyzer callback payload definitions
- `mcp/tools.schema.json`: MCP tool metadata contract
- `enums/run-status.json`: shared lifecycle enums
- `types/runner.ts`: TypeScript mirror for ScenarioPlan, MQ run request, and runner callback payloads

## Notes

- These files are document-aligned drafts, not finalized compatibility promises.
- Treat `mq/messages.schema.json` as the only canonical MQ envelope; task-specific MQ files must not duplicate envelope fields.
- Keep public API shape in sync with `openapi/wedge_openapi.yaml`.
- Keep queue, callback, and websocket payload changes centralized here before app-specific changes.
- Treat schema/OpenAPI files as canonical and keep `types/` as a convenience mirror, not a competing source of truth.
- Keep lightweight drift checks around high-risk mirrors (for example the runner contract mirror) in app/package verification so type literals do not silently diverge from canonical schemas.
- Use `examples/` as fixtures for tests and UI mocks; do not treat them as canonical schema definitions.
- Keep file paths versionless and canonical. Payload-level `schema_version` fields may still exist for compatibility checks.
- Use `docs/AI_CONTEXT_GUIDE.md` to choose the smallest useful context set for Codex/AI implementation tasks.
