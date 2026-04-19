---
title: Wedge Frontend Architecture & Stack Decisions
document_type: frontend-architecture
status: current-draft
last_updated: 2026-04-19
intended_use:
  - implementation_reference
  - ai_tasking
  - team_share
related_documents:
  - 00_master_decisions.md
  - 01_architecture_and_project_structure.md
  - 03_api_reference.md
  - ../apps/web/README.md
---

# 1. Purpose

This document records the frontend technology and architecture decisions for `apps/web`.

The goal is to keep the web app maintainable as Wedge grows from the landing page into product surfaces such as run monitoring, evidence viewing, reports, project management, and scenario building.

# 2. Current frontend stack

`apps/web` currently uses:

- React 18
- React DOM 18
- TypeScript
- TSX
- Vite
- `@vitejs/plugin-react`
- `node:test` executed through `tsx`
- plain CSS with explicit app/page/feature boundaries

The current package scripts are:

```bash
npm run dev
npm run build
npm test
npm run typecheck
```

# 3. Current decision summary

## 3.1 Keep the app Vite-based for now

Decision: use Vite + React + TypeScript for `apps/web`.

Rationale:
- The current app is client-heavy and does not yet require server-side rendering.
- The existing landing sample was already Vite-based.
- Vite keeps the scaffold simple while product boundaries are still forming.

Deferred:
- Next.js, Remix-style full-stack routing, or server-side rendering decisions are intentionally deferred until product requirements require them.

## 3.2 Use page + feature boundaries

Decision: page orchestration and feature internals are separated.

Current pattern:

```text
src/
├─ app/
├─ pages/
│  └─ landing/
├─ features/
│  └─ landing-vision/
├─ entities/
├─ shared/
├─ api/
└─ websocket/
```

Rules:
- `pages/*` composes user-facing screens and route-level orchestration.
- `features/*` owns feature-specific components, hooks, logic, and styles.
- `shared/*` is for reusable primitives only after repeated use exists.
- `api/*` owns HTTP client and endpoint wrappers.
- `websocket/*` owns realtime transport adapters.
- Avoid placing feature logic directly in `app/`.

## 3.3 Keep landing code isolated

Decision: the imported design sample from `ref/landingPage` lives as a landing page plus a `landing-vision` feature, not as a monolithic root app.

Current locations:

```text
src/pages/landing/LandingPage.tsx
src/pages/landing/LandingPage.css
src/features/landing-vision/components/
src/features/landing-vision/hooks/
src/features/landing-vision/lib/
src/features/landing-vision/styles/
```

Rules:
- `LandingPage.tsx` may coordinate page-level state and layout.
- Vision demo state machines, timings, and components stay under `features/landing-vision`.
- Do not import files directly from `ref/landingPage` at runtime.
- Do not copy `ref/landingPage/node_modules`, `dist`, `.omx`, or generated artifacts.

## 3.4 Use plain CSS with strict boundaries

Decision: use plain CSS for now; do not introduce Tailwind, CSS Modules, or a UI library yet.

Rationale:
- The current landing page is highly custom and animation-heavy.
- Introducing a styling framework now would add migration cost without a clear product need.

Rules:
- App-wide tokens belong in `src/app/styles/tokens.css`.
- Minimal global reset/base rules belong in `src/app/styles/globals.css`.
- Page-specific styles belong under `src/pages/<page>/`.
- Feature-specific styles belong under `src/features/<feature>/styles/`.
- Class names should remain namespace-like, for example `landing-*`, `vision-*`, `run-*`, or `report-*`.
- Avoid broad element selectors outside `globals.css`.

Deferred:
- CSS Modules may be introduced later if class collision or ownership becomes hard to manage.
- Tailwind may be reconsidered only if the product UI moves toward utility-first composition.

## 3.5 Preserve tested pure logic

Decision: animation timing and state-machine logic should remain testable without a browser.

Current examples:

```text
src/features/landing-vision/lib/heroVision.ts
src/features/landing-vision/lib/visionSequence.ts
test/landing-vision/hero-vision.test.ts
test/landing-vision/vision-sequence.test.ts
```

Rules:
- Keep timing constants and phase/state logic in `lib/`.
- Keep React lifecycle and DOM event wiring in `hooks/` or components.
- Add focused tests for pure logic before changing animation cadence or state transitions.

# 4. Deferred technology choices

The following are not installed yet by design.

## 4.1 Routing

Default future choice: React Router.

Install when there is more than one meaningful route, for example:

```text
/
/app
/runs/:runId
/reports/:reportId
/projects/:projectId
```

Until then, `App` can render `LandingPage` directly.

## 4.2 Server state

Default future choice: TanStack Query.

Install when API-driven product screens need caching, refetching, mutation states, retries, or cache invalidation.

Do not use a general client-state store for server state by default.

## 4.3 Client state

No global client-state library is selected yet.

Use React local state first. Consider a small client-state store only if cross-page client-only state becomes difficult to manage without prop drilling or context overuse.

## 4.4 Forms

No form library is selected yet.

Choose one when scenario builder, project settings, or report configuration forms become complex enough to need validation, touched state, field arrays, or schema integration.

## 4.5 Component testing

Current tests use `node:test` + `tsx` for logic and source-shape regression tests.

Consider Vitest + Testing Library when DOM/component behavior becomes important enough to test outside manual/browser QA.

## 4.6 UI component library

No UI component library is selected yet.

Reconsider when product dashboard surfaces stabilize. The landing page should remain custom and should not force a component library decision.

## 4.7 React major upgrade policy

React 18 is the current runtime baseline.

React major upgrades should happen in a dedicated change with:
- dependency update
- build verification
- typecheck verification
- relevant runtime smoke test
- notes for any changed React behavior

# 5. Implementation rules for agents

When changing `apps/web`:

1. Check this document first.
2. Keep new code inside the smallest page/feature/shared boundary that owns it.
3. Do not add dependencies unless a specific requirement justifies them.
4. Prefer TypeScript/TSX for new source files.
5. Keep pure logic in `lib/` and test it.
6. Run:

```bash
cd apps/web
npm test
npm run build
npm run typecheck
```

7. If dependencies changed, also run:

```bash
npm audit --omit=dev
npm audit
```

# 6. Current known follow-ups

- Add routing when a second route is implemented.
- Add API client modules when Spring API endpoints are wired.
- Consider generated types or client code from `packages/contracts/openapi/wedge_openapi.yaml` once the API contract stabilizes.
- Consider component/browser-level tests when landing interactions become business-critical.
