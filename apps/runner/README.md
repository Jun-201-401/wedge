# Runner

Node.js runner scaffold for browser execution, capture, artifact storage, and internal callback delivery.

Current state:

- Consumes a local `run.execute.request` JSON envelope.
- Executes a contract-shaped `ScenarioPlan` through a simulated Playwright session.
- Emits accepted, step event, checkpoint, artifact, finished, and failed callbacks to a local JSONL log.
- Writes local artifacts under `.runner-artifacts/`.

This is a runner skeleton, not the final production integration. The `browser/playwright` adapter is intentionally simulated so the orchestration layer can be built and tested before real Playwright and queue wiring are added.

Working commands:

- `npm run start -- --message-file examples/run-execute.request.json`
- `npm test`
