# Lens 04 - security-authz-internal-callback

## Scope

Cross-packet review of human authorization, project scope, refresh-token storage, internal callback authentication, HMAC, SSRF, MCP service-token scope, and shared report artifact exposure.

## Summary

Recommendation: `REQUEST CHANGES` for production security boundaries.

The repeated pattern is that authorization lives at individual controllers/callback handlers rather than shared command boundaries. Internal service tokens are also treated as broad authority instead of being scoped to aggregate identity, project, or operation.

## Findings

### HIGH - Human run mutation skips project authorization

Evidence:

- `startRun` path checks access: `apps/api-server/src/main/java/com/wedge/run/api/RunController.java:93-100`.
- `startAgentRun` omits `Authentication` and never calls `ensureRunAccessible`: `apps/api-server/src/main/java/com/wedge/run/api/RunController.java:104-110`.
- Security config authenticates `/api/runs/**` but does not provide project authorization: `apps/api-server/src/main/java/com/wedge/common/config/SecurityConfig.java:70-82`.

Failure scenario:

Any authenticated user who learns another project's `runId` can call `/api/runs/{runId}/agent/start` and enqueue agent execution.

Fix direction:

Move run mutation authorization into a run access guard or service command that requires `userId`.

### HIGH - Archived project scope is inconsistently enforced

Evidence:

- `ProjectAccessService` depends on `existsActiveProject`: `apps/api-server/src/main/java/com/wedge/project/application/ProjectAccessService.java:18-24`.
- Mapper checks only `deleted_at IS NULL`: `apps/api-server/src/main/resources/mapper/project/ProjectAccessMapper.xml:4-10`.

Failure scenario:

A member of an archived project can still create runs/discoveries/authoring jobs.

Fix direction:

Require `project.status = 'ACTIVE'` and active membership in the access predicate.

### HIGH - Default project bootstrap can silently regrant `OWNER`

Evidence:

- `DefaultProjectService` always calls `ensureDefaultProjectMembership`: `apps/api-server/src/main/java/com/wedge/project/application/DefaultProjectService.java:24-31`.
- Mapper updates existing membership role to `OWNER` on conflict: `apps/api-server/src/main/resources/mapper/project/ProjectAccessMapper.xml:72-78`.

Failure scenario:

A discovery request without `projectId` can restore or upgrade an old default project membership.

Fix direction:

Do not mutate existing membership on default-project reuse. Use `ON CONFLICT DO NOTHING` or explicit audited regrant.

### HIGH - Internal callback HMAC boundary is uneven and partly fail-open

Evidence:

- HMAC verification is only applied to internal runner callbacks: `apps/api-server/src/main/java/com/wedge/common/security/InternalServiceTokenFilter.java:74-83`, `:116-130`.
- Analyzer controller requires `X-Signature`: `apps/api-server/src/main/java/com/wedge/analysis/api/internal/AnalyzerCallbackController.java:43-50`.
- Analyzer client sends `X-Signature`: `apps/analyzer/app/clients/spring_callback.py:79-90`.
- Runner HMAC returns true when secret is blank: `apps/api-server/src/main/java/com/wedge/common/security/InternalServiceTokenFilter.java:128-130`.

Failure scenario:

Any holder of the internal bearer token can forge analyzer terminal callbacks. Runner callbacks can also pass HMAC when the secret is missing.

Fix direction:

Add analyzer-specific HMAC verification or remove the signature contract. Fail closed for runner HMAC in non-local profiles when the secret is blank.

### HIGH - Internal analysis callbacks can cross run ownership

Evidence:

- Analyzer callback validation checks only path/body id: `apps/api-server/src/main/java/com/wedge/analysis/api/internal/AnalyzerCallbackService.java:53-58`.
- Terminal persistence upserts callback body: `apps/api-server/src/main/java/com/wedge/analysis/application/JudgeResultPersistenceService.java:94-101`.
- Mapper can rewrite `analysis_job.run_id`: `apps/api-server/src/main/resources/mapper/analysis/AnalysisJobMapper.xml:64-76`.

Failure scenario:

A terminal callback with valid `analysisJobId` but wrong `runId` can persist projections for the wrong run.

Fix direction:

Load the stored job, verify run ownership/current job state, and never rewrite job ownership from callback payload.

### HIGH - Discovery SSRF protection is only API-time

Evidence:

- API validator resolves and blocks private/reserved IPs: `apps/api-server/src/main/java/com/wedge/discovery/application/DiscoveryUrlValidator.java:54-64`.
- Execute message sends the original target URL to Runner: `apps/api-server/src/main/java/com/wedge/discovery/application/DiscoveryExecuteRequestMessageFactory.java:25-30`.

Failure scenario:

`https://rebind.example` resolves public during API validation, then resolves to localhost or metadata IP when Runner navigates.

Fix direction:

Enforce private/reserved IP blocking at Runner/browser fetch time, including redirects and re-resolution, or pass an IP pin/policy to Runner.

### HIGH - MCP service token grants broad run read/bind ability

Evidence:

- MCP requests get a shared `mcp-client` principal: `apps/api-server/src/main/java/com/wedge/common/security/InternalServiceTokenFilter.java:85-90`.
- MCP run query delegates to `RunService.getRun`: `apps/api-server/src/main/java/com/wedge/mcp/application/McpRunQueryService.java:17-19`.
- Decision session registration stores a supplied run id without project/scope checks: `apps/api-server/src/main/java/com/wedge/mcp/gateway/application/McpDecisionSessionService.java:16-29`.

Failure scenario:

Any MCP client with the shared service token can read guessed run ids or register itself as decision host for a run.

Fix direction:

Replace shared authority with MCP client identity, scoped authorization, and run/project/session ownership checks.

### HIGH - Refresh tokens are stored as reusable bearer secrets

Evidence:

- Full refresh JWT is stored and compared in Redis: `apps/api-server/src/main/java/com/wedge/auth/infrastructure/RefreshTokenRepository.java:27-40`.
- `AuthService` passes the raw refresh token into storage: `apps/api-server/src/main/java/com/wedge/auth/application/AuthService.java:110-120`.

Failure scenario:

Redis snapshot/read leakage exposes live refresh JWTs until expiry or rotation.

Fix direction:

Store keyed digest/JTI only and compare digests atomically on rotation.

### MEDIUM - Shared report token grants run-image-wide artifact access

Evidence:

- Shared report routes are public token routes: `apps/api-server/src/main/java/com/wedge/common/config/SecurityConfig.java:65-69`.
- Shared artifact access resolves token then delegates by run id/artifact id: `apps/api-server/src/main/java/com/wedge/report/application/ReportShareService.java:89-94`.
- Evidence service allows any image artifact in that run: `apps/api-server/src/main/java/com/wedge/evidence/application/EvidenceService.java:210-217`.

Failure scenario:

A valid share token plus any known image artifact UUID from the same run can fetch an artifact not referenced by the shared report.

Fix direction:

Restrict artifact reads to ids present in the shared report read model, or explicitly document/test run-wide image access.

## Cross-Cutting Security Test Gaps

- Endpoint matrix: auth required, project membership required, archived project denied.
- Internal callback matrix: bearer missing/invalid, signature missing/invalid, wrong worker, wrong aggregate/run/project.
- SSRF tests at actual fetch boundary.
- MCP scope tests for `wedge.read` and `wedge.decide`.
- Token storage tests proving no plaintext refresh-token persistence.

