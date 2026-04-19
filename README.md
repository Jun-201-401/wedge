# Wedge

Wedge is organized as a monorepo around four service applications and a shared contracts package.

## Structure

- `apps/api-server`: Spring Boot API server, orchestration, auth, WebSocket, MCP
- `apps/runner`: Node.js + Playwright browser runner
- `apps/analyzer`: FastAPI analysis service
- `apps/web`: React frontend
- `packages/contracts`: machine-readable shared API, MQ, WebSocket, internal callback, and MCP contracts
- `docs`: human-readable architecture, delivery, frontend, and DDL/reference documents
- `infra`: docker, terraform, and helper scripts

## Current Status

This repository currently contains the product architecture baseline, shared contracts, and monorepo scaffold.
Implementation should start from `docs/README.md`, then use `docs/AI_CONTEXT_GUIDE.md` to choose task-specific references.
