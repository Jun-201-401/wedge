# Repository Guidelines

## Structure
Wedge is a monorepo.

- `apps/`: service code (`api-server`, `web`, `runner`, `analyzer`)
- `packages/contracts`: machine-readable shared contracts
- `docs`: human-readable architecture, API spec, and DDL
- `infra`: deployment and environment helpers

Put OpenAPI, MQ, WebSocket, internal callback, MCP, and shared enum definitions in `packages/contracts`, not `docs`.

## Working Rules
Treat this repository as contract-first. Update shared payloads and enums in `packages/contracts` before wiring app-specific code.

Keep service boundaries clear:
- Spring API server uses package-by-domain under `com.wedge`
- Web and runner use small TypeScript modules with lowercase folders
- Analyzer code stays under `apps/analyzer/app`

Prefer small, reviewable diffs. Reuse existing names from the contracts and docs instead of inventing parallel shapes.

## Commands
- `cd apps/api-server && gradle test`: compile and run Spring tests
- `cd apps/api-server && gradle bootRun`: run the API server locally
- `cd apps/analyzer && python3 -m py_compile $(find app -name '*.py' | sort)`: syntax-check analyzer code
- `cd apps/runner && npm test`: placeholder runner test command

Only document commands that actually work in the current scaffold.

## Commits and PRs
Use the project Lore-style commit format: intent-first subject, short rationale, then trailers such as `Constraint:`, `Rejected:`, `Confidence:`, `Scope-risk:`, `Tested:`, and `Not-tested:`.

PRs should include purpose, affected subsystems, contract/doc changes, and verification commands run. Add screenshots only for UI-visible changes.
