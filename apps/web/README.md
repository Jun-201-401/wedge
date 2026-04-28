# Web

React frontend for the Wedge landing page, run monitoring, evidence viewing, reports, and project/scenario management.

## Commands

- `npm run dev`: start the Vite development server
- `npm run build`: build the production bundle
- `npm test`: run landing regression tests
- `npm run typecheck`: run TypeScript diagnostics

## Architecture

See `../../docs/wedge_frontend_architecture.md` for frontend stack and boundary decisions.

## Real run prototype context

For local prototype checks that should create a real API Run instead of falling back to the mock run monitor, set the development run context before starting Vite:

```env
VITE_DEV_PROJECT_ID=<project-uuid>
VITE_DEV_SCENARIO_TEMPLATE_VERSION_ID=<scenario-template-version-uuid>
```

If the API requires authentication, store a valid access token in the browser before starting the run flow:

```js
localStorage.setItem('wedge.accessToken', '<access-token>')
```

With those values present, `/create-analysis` keeps the run context through the flow and the ready step can call `POST /api/runs` with a prototype `scenarioPlan`.

## Real run E2E smoke

Before the first local run, seed the dev database with the stable smoke project and scenario template IDs:

```bash
node infra/scripts/seed-real-run-smoke.mjs
```

Keep the printed IDs in the repository-root `.env`:

```env
WEDGE_SMOKE_PROJECT_ID=8f06dca8-9c4d-4f20-b1a8-1d5ee40a9923
WEDGE_SMOKE_SCENARIO_TEMPLATE_VERSION_ID=5c5f4c77-0c32-4ab3-9841-2b6f6cc07a40
```

After the API server and MQ-backed runner are running, use the repo-level smoke script to verify the full prototype path:

```bash
node infra/scripts/real-run-e2e-smoke.mjs
```

The script signs in or creates a local smoke user, calls `POST /api/runs`, starts the run, waits for the runner callbacks to complete the run, and verifies that `/api/runs/{runId}/evidence-packet` contains persisted checkpoints. It prints the `/runs/{runId}` monitor URL to open in the web app.

For the Docker dev runner, keep `RUNNER_CALLBACK_BASE_URL` pointed at the local API server and set `INTERNAL_SERVICE_TOKEN` to the same value used by the API server.
