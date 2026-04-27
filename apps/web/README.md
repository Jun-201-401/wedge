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
