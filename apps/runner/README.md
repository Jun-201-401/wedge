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
- `npm run start -- --message-file examples/run-execute.mvp-landing-cta.request.json`
- `npm run start -- --message-file examples/run-execute.mvp-signup-form.request.json`
- `npm run start -- --message-file examples/run-execute.mvp-pricing-checkout.request.json`
- `npm run start -- --message-file examples/discovery-execute.request.json`
- `npm test`

MVP `run-execute.mvp-*.request.json` files are contract-shaped runner message samples for the three MVP scenario templates. They use `https://example.com` as a placeholder `startUrl`; replace `payload.startUrl`, `payload.scenarioPlan.start_url`, and any URL-specific targets before running them against a real product site.

`discovery-execute.request.json` runs the lightweight Runner Discovery collector and writes its `SiteDiscoveryResult` to `.runner-artifacts/discoveries/{discoveryId}/site-discovery-result.json`.

Discovery can also run from RabbitMQ when `--consume-mq` is enabled. The runner consumes both `run.execute.request` and `discovery.execute.request`; set `RUNNER_MQ_QUEUE_DISCOVERY_EXECUTE` to override the discovery queue name. When `RUNNER_CALLBACK_BASE_URL` is configured, discovery accepted/finished/failed callbacks are sent to `/internal/runner/discoveries/{discoveryId}/...`.

For a reproducible discovery smoke against a real URL, run from the repo root:

```bash
WEDGE_DISCOVERY_SMOKE_TARGET_URL=https://example.com \
WEDGE_DISCOVERY_SMOKE_EXPECTED_FLOWS=LANDING_CTA \
node infra/scripts/real-discovery-smoke.mjs
```

If `WEDGE_DISCOVERY_SMOKE_TARGET_URL` is omitted, the script starts a local fixture site and expects the four MVP flow types.

## Prototype API callback mode

Set `RUNNER_CALLBACK_BASE_URL` to send callbacks to the API instead of the local JSONL log:

```bash
cd apps/runner
RUNNER_CALLBACK_BASE_URL=http://localhost:8080 \
RUNNER_CALLBACK_AUTH_TOKEN=<INTERNAL_SERVICE_TOKEN> \
RUNNER_CALLBACK_SIGNATURE_SECRET=<INTERNAL_RUNNER_CALLBACK_SIGNATURE_SECRET> \
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
- `RUNNER_CALLBACK_SIGNATURE_SECRET` must match `wedge.internal.runner-callback-signature-secret`; the runner sends `X-Signature: hmac-sha256=<digest>` over the raw JSON callback body.
- `RUNNER_ARTIFACTS_ROOT` points at the mounted `.runner-artifacts` volume so API artifact content URLs can resolve local files.

Run `node infra/scripts/seed-real-run-smoke.mjs` once to create the local smoke project/scenario rows, then run `node infra/scripts/real-run-e2e-smoke.mjs` from the repository root after the API and runner are both up to verify create/start/MQ/callback/evidence packet behavior.

To verify the failure branch, run the same script with an unreachable target and expected terminal status:

```bash
WEDGE_SMOKE_TARGET_URL=http://127.0.0.1:9/ \
WEDGE_SMOKE_EXPECTED_STATUS=FAILED \
node infra/scripts/real-run-e2e-smoke.mjs
```

If a WSL setup cannot route from the runner container to the host API server, stop the compose runner and run a local MQ consumer from `apps/runner` with `RUNNER_CALLBACK_BASE_URL=http://localhost:8080`.

## MinIO / S3-compatible artifact storage

The runner defaults to local filesystem artifacts for fast local smoke tests. To upload artifacts to MinIO or S3 instead, switch the artifact storage mode and provide S3-compatible credentials:

```bash
RUNNER_ARTIFACT_STORAGE=s3 \
RUNNER_ARTIFACT_BUCKET=wedge-artifacts \
RUNNER_ARTIFACT_S3_ENDPOINT=http://localhost:9000 \
RUNNER_ARTIFACT_S3_REGION=us-east-1 \
RUNNER_ARTIFACT_S3_ACCESS_KEY_ID=<MINIO_ROOT_USER> \
RUNNER_ARTIFACT_S3_SECRET_ACCESS_KEY=<MINIO_ROOT_PASSWORD> \
RUNNER_ARTIFACT_S3_FORCE_PATH_STYLE=true \
npm run start -- --message-file examples/run-execute.request.json
```

For `compose.dev.yaml`, keep the default `RUNNER_ARTIFACT_STORAGE=filesystem` unless the API server is also configured to read artifacts from MinIO. To test MinIO end-to-end locally, add these values to your local `.env`:

```bash
RUNNER_ARTIFACT_STORAGE=s3
RUNNER_ARTIFACT_BUCKET=wedge-artifacts
RUNNER_ARTIFACT_S3_ENDPOINT=http://minio:9000
RUNNER_ARTIFACT_S3_REGION=us-east-1
RUNNER_ARTIFACT_S3_ACCESS_KEY_ID=<MINIO_ROOT_USER>
RUNNER_ARTIFACT_S3_SECRET_ACCESS_KEY=<MINIO_ROOT_PASSWORD>
RUNNER_ARTIFACT_S3_FORCE_PATH_STYLE=true

WEDGE_ARTIFACT_STORAGE=s3
WEDGE_ARTIFACT_BUCKET=wedge-artifacts
WEDGE_ARTIFACT_S3_ENDPOINT=http://localhost:9000
WEDGE_ARTIFACT_S3_REGION=us-east-1
WEDGE_ARTIFACT_S3_ACCESS_KEY_ID=<MINIO_ROOT_USER>
WEDGE_ARTIFACT_S3_SECRET_ACCESS_KEY=<MINIO_ROOT_PASSWORD>
WEDGE_ARTIFACT_S3_FORCE_PATH_STYLE=true
```

The runner still sends only artifact metadata (`bucket`, `key`, size, hash) through callbacks. The API server uses that metadata to serve `/api/runs/{runId}/artifacts/{artifactId}/content` from either local files or S3/MinIO, depending on `WEDGE_ARTIFACT_STORAGE`.
