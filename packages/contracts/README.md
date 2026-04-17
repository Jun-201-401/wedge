# Contracts

Canonical machine-readable contracts belong here.

## Files

- `openapi/wedge_openapi.yaml`: public REST and internal callback OpenAPI draft
- `mq/run.execute.request.schema.json`: runner execution queue payload
- `mq/analysis.request.schema.json`: analyzer queue payload
- `mq/report.export.request.schema.json`: report export queue payload
- `websocket/events.schema.json`: live event envelope and event variants
- `internal/runner-callback.schema.json`: runner callback payload definitions
- `internal/analyzer-callback.schema.json`: analyzer callback payload definitions
- `mcp/tools.schema.json`: MCP tool metadata contract
- `enums/run-status.json`: shared lifecycle enums

## Notes

- These files are document-aligned drafts, not finalized compatibility promises.
- Keep public API shape in sync with `openapi/wedge_openapi.yaml`.
- Keep queue, callback, and websocket payload changes centralized here before app-specific changes.
