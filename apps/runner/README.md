# Runner

Node.js runner scaffold for browser execution, capture, artifact storage, and callback delivery.

Current state:

- Consumes a local `run.execute.request` JSON envelope.
- Executes a contract-shaped `ScenarioPlan` through a simulated Playwright session.
- Emits accepted, step event, artifact, checkpoint, finished, and failed callbacks to JSONL or the API server.
- Writes local artifacts under `.runner-artifacts/`.

Simulated browser mode is the default so callback delivery, artifact persistence, and evidence packet wiring can be exercised before full browser hardening.

Working commands:

- `npm run start -- --message-file examples/run-execute.request.json`
- `npm test`

## Prototype API callback mode

Set `RUNNER_CALLBACK_BASE_URL` to send callbacks to the API instead of the local JSONL log:

```bash
cd apps/runner
RUNNER_CALLBACK_BASE_URL=http://localhost:8080 \
RUNNER_CALLBACK_AUTH_TOKEN=<INTERNAL_SERVICE_TOKEN> \
RUNNER_ARTIFACTS_ROOT=.runner-artifacts \
npm run start -- --message-file examples/run-execute.request.json
```

Emitted API callbacks:

- `POST /internal/runner/runs/{runId}/accepted`
- `POST /internal/runner/runs/{runId}/step-events`
- `POST /internal/runner/runs/{runId}/artifacts`
- `POST /internal/runner/runs/{runId}/checkpoints`
- `POST /internal/runner/runs/{runId}/finished`
- `POST /internal/runner/runs/{runId}/failed` on execution failure

Artifacts are written under `.runner-artifacts/{runId}/{stepKey}/...`; callback payloads send the stored artifact metadata and checkpoint `artifactRefs` so the API evidence packet can be assembled.

## Dev E2E smoke wiring

`compose.dev.yaml` runs the runner as an MQ consumer and now passes the callback settings needed for real run smoke checks:

- `RUNNER_CALLBACK_BASE_URL` defaults to `http://host.docker.internal:8080` so the runner container can call the API server running on the host.
- `RUNNER_CALLBACK_AUTH_TOKEN` reuses `INTERNAL_SERVICE_TOKEN`; it must match `wedge.internal.service-token` in the API server.
- `RUNNER_ARTIFACTS_ROOT` points at the mounted `.runner-artifacts` volume so API artifact content URLs can resolve local files.

Run `node infra/scripts/real-run-e2e-smoke.mjs` from the repository root after the API and runner are both up to verify create/start/MQ/callback/evidence packet behavior.
