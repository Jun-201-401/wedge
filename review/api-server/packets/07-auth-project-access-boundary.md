# Packet 07 - auth-project-access-boundary

## Scope

Read-only review of human authentication, refresh-token storage, project access checks, default project bootstrap, security filters, and run/project authorization boundaries.

## Flow Map

1. `AuthController` accepts signup/login/refresh/logout/me requests.
2. `AuthService` issues access/refresh JWTs and stores refresh state in Redis.
3. `JwtAuthenticationFilter` authenticates human API requests and rebuilds `WedgePrincipal` from active DB user state.
4. Project access checks are enforced through `ProjectAccessService`, with default-project creation/reuse through `ProjectBootstrapService` and `DefaultProjectService`.
5. Human run/discovery/scenario/report flows call project guards before most resource reads or mutations.

## Files Reviewed

- `apps/api-server/src/main/java/com/wedge/auth/**`
- `apps/api-server/src/main/java/com/wedge/project/**`
- `apps/api-server/src/main/java/com/wedge/common/security/*.java`
- `apps/api-server/src/main/java/com/wedge/common/config/SecurityConfig.java`
- `apps/api-server/src/main/resources/mapper/project/*.xml`
- `apps/api-server/src/main/java/com/wedge/run/api/RunController.java`
- `apps/api-server/src/main/java/com/wedge/run/application/RunService.java`
- `packages/contracts/openapi/wedge_openapi.yaml`
- auth/project/security tests and API docs

## Invariants Expected

- JWT claims should identify the user, not grant project membership by themselves.
- Every human resource read or mutation must bind `authenticated userId` to the target project.
- Archived/deleted projects must not satisfy active access checks.
- Default project bootstrap must not silently regrant stronger privileges.
- Refresh-token storage must not persist reusable bearer secrets in plaintext form.
- Public API contracts and security filter path lists must agree.

## Findings

### CRITICAL

None.

### HIGH

1. `POST /api/runs/{runId}/agent/start` is authenticated but not project-authorized.

Evidence:

- `/api/runs/**` is authenticated by `SecurityConfig`: `apps/api-server/src/main/java/com/wedge/common/config/SecurityConfig.java:73`.
- `RunController.startAgentRun` accepts only `runId`, not `Authentication`, and calls `runService.startAgentRun(runId)`: `apps/api-server/src/main/java/com/wedge/run/api/RunController.java:104`, `:109`.
- `RunService.startAgentRun` queues agent execution with only `runId`: `apps/api-server/src/main/java/com/wedge/run/application/RunService.java:155`, `:163`.
- Other run endpoints call `ensureRunAccessible`: `apps/api-server/src/main/java/com/wedge/run/api/RunController.java:242`.

Failure scenario:

A logged-in user can start an agent run for a run UUID from another project because the endpoint validates authentication but skips project membership.

Fix direction:

Mirror `startRun`: fetch the run, check `ProjectAccessService.ensureProjectAccessible(run.projectId(), userId)`, then queue agent execution. Prefer a `RunAccessGuard` or `RunService.startAgentRun(runId, userId)` shape so human entrypoints cannot omit the principal.

2. Contracted project APIs are unreachable or not implemented.

Evidence:

- `docs/03_api_reference.md:193` lists `GET/POST/PATCH /api/projects`.
- OpenAPI marks `/api/projects` and `/api/projects/{projectId}` as `HumanBearer` APIs: `packages/contracts/openapi/wedge_openapi.yaml:203`, `:268`.
- Security config authenticates selected API families, then denies remaining `/api/**`: `apps/api-server/src/main/java/com/wedge/common/config/SecurityConfig.java:70`, `:85`.
- `JwtAuthenticationFilter.HUMAN_JWT_PATHS` omits `/api/projects`: `apps/api-server/src/main/java/com/wedge/common/security/JwtAuthenticationFilter.java:23`.

Failure scenario:

A generated or frontend client follows the contract and calls `GET /api/projects`; the request is not treated as a human JWT API and falls into deny-all.

Fix direction:

Either implement the project controller/service endpoints and add `/api/projects/**` to the security/JWT path lists, or remove the endpoints from contracts and docs until implemented. Add 401/403/200 contract tests.

3. Archived projects still pass active access checks.

Evidence:

- `existsActiveProject` checks `deleted_at IS NULL` but not `status = 'ACTIVE'`: `apps/api-server/src/main/resources/mapper/project/ProjectAccessMapper.xml:4`, `:7-10`.
- The schema defines `project.status` values including `ACTIVE` and `ARCHIVED`: `docs/wedge_schema.sql:52`.
- Run creation relies on `ensureProjectAccessible`: `apps/api-server/src/main/java/com/wedge/run/api/RunController.java:77`.

Failure scenario:

A user who remains a member of an archived project can create runs, discoveries, or scenario authoring jobs against that archived project.

Fix direction:

Add `status = 'ACTIVE'` to active access checks and regression tests for archived projects across run/discovery/scenario-authoring entrypoints.

4. Default project bootstrap can restore or upgrade `OWNER` membership.

Evidence:

- `DefaultProjectService.resolveDefaultProject` finds a project by `created_by` and always calls `ensureDefaultProjectMembership`: `apps/api-server/src/main/java/com/wedge/project/application/DefaultProjectService.java:24`, `:30-31`.
- `ProjectAccessMapper.xml` updates existing membership role to `OWNER` on conflict: `apps/api-server/src/main/resources/mapper/project/ProjectAccessMapper.xml:72`.

Failure scenario:

If a user's role on an old default project is downgraded or removed, any discovery request without `projectId` can silently restore them to `OWNER`.

Fix direction:

Do not mutate role on default-project reuse. Resolve only a project where the user currently has valid membership, use `ON CONFLICT DO NOTHING` for bootstrap membership, or make creator regrant an explicit audited operation.

5. Refresh tokens are stored as reusable bearer secrets.

Evidence:

- `RefreshTokenRepository.save` stores the full refresh JWT: `apps/api-server/src/main/java/com/wedge/auth/infrastructure/RefreshTokenRepository.java:27`.
- `rotateIfMatch` compares/replaces the full token value: `apps/api-server/src/main/java/com/wedge/auth/infrastructure/RefreshTokenRepository.java:32-40`.
- `AuthService` passes the issued refresh token directly to the repository: `apps/api-server/src/main/java/com/wedge/auth/application/AuthService.java:113`.

Failure scenario:

A Redis snapshot/read leak exposes valid refresh bearer tokens until expiry or rotation.

Fix direction:

Store only a keyed digest/hash of the refresh token or JTI, compare digests atomically during rotation, and test that raw refresh token values are never persisted.

### MEDIUM

1. JWT auth masks infrastructure failures as invalid tokens.

Evidence:

- `JwtAuthenticationFilter` catches broad `Exception` around token parsing and DB user lookup, then returns `invalid_token`: `apps/api-server/src/main/java/com/wedge/common/security/JwtAuthenticationFilter.java:61`, `:69-72`.

Failure scenario:

A database/user lookup outage becomes a 401 response. Clients may discard sessions and operators lose the real 5xx signal.

Fix direction:

Catch token parsing/claim exceptions narrowly and let persistence/runtime failures propagate to the global 5xx handler.

2. Human API path authorization is duplicated across security config and JWT filter.

Evidence:

- `SecurityConfig` owns endpoint authorization paths: `apps/api-server/src/main/java/com/wedge/common/config/SecurityConfig.java:70`.
- `JwtAuthenticationFilter` owns a separate `HUMAN_JWT_PATHS` list: `apps/api-server/src/main/java/com/wedge/common/security/JwtAuthenticationFilter.java:23`.

Failure scenario:

New human APIs can be added to one list and omitted from the other, producing authenticated-but-unprincipaled or unreachable endpoints.

Fix direction:

Centralize protected human API matching, or make the JWT filter parse any bearer token opportunistically while `SecurityConfig` owns authorization.

3. Default project bootstrap has two ownership policies.

Evidence:

- Auth bootstrap creates a deterministic personal project: `apps/api-server/src/main/java/com/wedge/project/application/ProjectBootstrapService.java:23`, `:30`.
- Discovery bootstrap can create URL-derived random default projects: `apps/api-server/src/main/java/com/wedge/project/application/DefaultProjectService.java:24`, `:35`.

Failure scenario:

Two different project bootstrap policies drift in naming, ownership, and base-url semantics.

Fix direction:

Choose one owner for default project creation/reuse and route auth/discovery through the same policy.

## Architectural Status

`BLOCK`.

The session/auth model is mostly clean: access tokens carry identity, `JwtAuthenticationFilter` reloads active user state, and project membership is checked from DB rather than trusted from JWT claims. The blocker is authorization ownership drift, especially `POST /api/runs/{runId}/agent/start`, plus project API/path-list inconsistencies that make access boundaries easy to miss.

## Verification Evidence

- Code-reviewer lane ran scoped auth/project/security Gradle tests and reported `BUILD SUCCESSFUL`.
- Static `rg` checks were used for broad catches, path auth patterns, hardcoded secret patterns, and related security markers.
- Architect lane reviewed auth/project/run boundary ownership and marked the packet `BLOCK`.
- No source files were edited.

## Recommendation

REQUEST CHANGES. Fix the agent-start authorization gap, project contract/security mismatch, archived-project access predicate, default membership regrant, and refresh-token storage before treating this boundary as merge-ready.
