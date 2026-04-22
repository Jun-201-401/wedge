import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { replayCallbackOutbox, startCallbackOutboxReplayWorker } from "../src/callback/replay.ts";
import { appendCallbackOutboxRecord, readCallbackOutboxRecords } from "../src/callback/outbox.ts";
import { createRunnerApp } from "../src/app.ts";
import { sleep } from "../src/shared/utils.ts";
import { createRunnerTestConfig } from "./support.ts";

test("replayCallbackOutbox delivers pending records and clears outbox", async () => {
  const artifactsRoot = await mkdtemp(join(tmpdir(), "wedge-runner-replay-success-"));
  const callbackOutboxFile = join(artifactsRoot, "callback-outbox.jsonl");
  let requestCount = 0;

  const server = createServer((_request, response) => {
    requestCount += 1;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ accepted: true }));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const config = createRunnerTestConfig({
      callbackMode: "http",
      callbackBaseUrl: `http://127.0.0.1:${address.port}`,
      callbackOutboxFile,
      callbackRetryDelaysMs: [1, 1]
    });

    await appendCallbackOutboxRecord(config, {
      callbackType: "accepted",
      runId: "run-1",
      payload: {
        workerId: "worker-1",
        acceptedAt: "2026-04-21T00:00:00.000Z",
        browserSessionId: "session-1"
      },
      attempts: 3,
      errorMessage: "failed before"
    });

    const summary = await replayCallbackOutbox(config);

    assert.equal(summary.processedCount, 1);
    assert.equal(summary.deliveredCount, 1);
    assert.equal(summary.remainingCount, 0);
    assert.equal(summary.skipped, false);
    assert.equal(requestCount, 1);
    await assert.rejects(() => readFile(callbackOutboxFile, "utf8"), /ENOENT/);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
    await rm(artifactsRoot, { recursive: true, force: true });
  }
});

test("replayCallbackOutbox retains failing records and updates attempts", async () => {
  const artifactsRoot = await mkdtemp(join(tmpdir(), "wedge-runner-replay-fail-"));
  const callbackOutboxFile = join(artifactsRoot, "callback-outbox.jsonl");
  const server = createServer((_request, response) => {
    response.writeHead(503, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "still failing" }));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const config = createRunnerTestConfig({
      callbackMode: "http",
      callbackBaseUrl: `http://127.0.0.1:${address.port}`,
      callbackOutboxFile,
      callbackRetryDelaysMs: [1, 1]
    });

    await appendCallbackOutboxRecord(config, {
      callbackType: "finished",
      runId: "run-1",
      payload: {
        workerId: "worker-1",
        executionFinishedAt: "2026-04-21T00:00:00.000Z",
        summary: {
          completedStepCount: 1,
          failedStepCount: 0,
          stopped: false
        }
      },
      attempts: 3,
      errorMessage: "old failure"
    });

    const summary = await replayCallbackOutbox(config);
    const retained = await readFile(callbackOutboxFile, "utf8");

    assert.equal(summary.processedCount, 1);
    assert.equal(summary.deliveredCount, 0);
    assert.equal(summary.remainingCount, 1);
    assert.equal(summary.skipped, false);
    assert.match(retained, /"callbackType":"finished"/);
    assert.match(retained, /"attempts":6/);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
    await rm(artifactsRoot, { recursive: true, force: true });
  }
});

test("replayCallbackOutbox skips when active lock exists", async () => {
  const artifactsRoot = await mkdtemp(join(tmpdir(), "wedge-runner-replay-lock-skip-"));
  const callbackOutboxFile = join(artifactsRoot, "callback-outbox.jsonl");
  const callbackOutboxLockFile = join(artifactsRoot, "callback-outbox.lock");
  let requestCount = 0;

  const server = createServer((_request, response) => {
    requestCount += 1;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ accepted: true }));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const config = createRunnerTestConfig({
      callbackMode: "http",
      callbackBaseUrl: `http://127.0.0.1:${address.port}`,
      callbackOutboxFile,
      callbackOutboxLockFile,
      callbackRetryDelaysMs: [1, 1],
      callbackOutboxLockStaleMs: 60_000
    });

    await appendCallbackOutboxRecord(config, {
      callbackType: "accepted",
      runId: "run-1",
      payload: {
        workerId: "worker-1",
        acceptedAt: "2026-04-21T00:00:00.000Z",
        browserSessionId: "session-1"
      },
      attempts: 3,
      errorMessage: "failed before"
    });

    await writeFile(
      callbackOutboxLockFile,
      JSON.stringify({
        workerId: "other-worker",
        acquiredAt: new Date().toISOString()
      }),
      "utf8"
    );

    const summary = await replayCallbackOutbox(config);

    assert.equal(summary.skipped, true);
    assert.equal(summary.processedCount, 0);
    assert.equal(requestCount, 0);
    const retained = await readFile(callbackOutboxFile, "utf8");
    assert.match(retained, /"callbackType":"accepted"/);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
    await rm(artifactsRoot, { recursive: true, force: true });
  }
});

test("replayCallbackOutbox recovers stale lock and proceeds", async () => {
  const artifactsRoot = await mkdtemp(join(tmpdir(), "wedge-runner-replay-lock-stale-"));
  const callbackOutboxFile = join(artifactsRoot, "callback-outbox.jsonl");
  const callbackOutboxLockFile = join(artifactsRoot, "callback-outbox.lock");
  let requestCount = 0;

  const server = createServer((_request, response) => {
    requestCount += 1;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ accepted: true }));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const config = createRunnerTestConfig({
      callbackMode: "http",
      callbackBaseUrl: `http://127.0.0.1:${address.port}`,
      callbackOutboxFile,
      callbackOutboxLockFile,
      callbackRetryDelaysMs: [1, 1],
      callbackOutboxLockStaleMs: 1
    });

    await appendCallbackOutboxRecord(config, {
      callbackType: "accepted",
      runId: "run-1",
      payload: {
        workerId: "worker-1",
        acceptedAt: "2026-04-21T00:00:00.000Z",
        browserSessionId: "session-1"
      },
      attempts: 3,
      errorMessage: "failed before"
    });

    await writeFile(
      callbackOutboxLockFile,
      JSON.stringify({
        workerId: "stale-worker",
        acquiredAt: "2000-01-01T00:00:00.000Z"
      }),
      "utf8"
    );

    const summary = await replayCallbackOutbox(config);

    assert.equal(summary.skipped, false);
    assert.equal(summary.deliveredCount, 1);
    assert.equal(requestCount, 1);
    await assert.rejects(() => readFile(callbackOutboxFile, "utf8"), /ENOENT/);
    await assert.rejects(() => readFile(callbackOutboxLockFile, "utf8"), /ENOENT/);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
    await rm(artifactsRoot, { recursive: true, force: true });
  }
});

test("callback outbox prunes expired and excess records", async () => {
  const artifactsRoot = await mkdtemp(join(tmpdir(), "wedge-runner-callback-prune-"));
  const callbackOutboxFile = join(artifactsRoot, "callback-outbox.jsonl");

  try {
    const config = createRunnerTestConfig({
      callbackOutboxFile,
      callbackOutboxRetentionMs: 60_000,
      callbackOutboxMaxRecords: 2
    });

    await writeFile(
      callbackOutboxFile,
      [
        JSON.stringify({
          callbackType: "accepted",
          runId: "run-old",
          failedAt: "2000-01-01T00:00:00.000Z",
          payload: {},
          attempts: 1,
          retryDelaysMs: [1],
          errorMessage: "old"
        }),
        JSON.stringify({
          callbackType: "accepted",
          runId: "run-2",
          failedAt: new Date().toISOString(),
          payload: {},
          attempts: 1,
          retryDelaysMs: [1],
          errorMessage: "recent-2"
        }),
        JSON.stringify({
          callbackType: "accepted",
          runId: "run-3",
          failedAt: new Date().toISOString(),
          payload: {},
          attempts: 1,
          retryDelaysMs: [1],
          errorMessage: "recent-3"
        }),
        JSON.stringify({
          callbackType: "accepted",
          runId: "run-4",
          failedAt: new Date().toISOString(),
          payload: {},
          attempts: 1,
          retryDelaysMs: [1],
          errorMessage: "recent-4"
        })
      ].join("\n") + "\n",
      "utf8"
    );

    const records = await readCallbackOutboxRecords(config);

    assert.deepEqual(records.map((record) => record.runId), ["run-3", "run-4"]);
  } finally {
    await rm(artifactsRoot, { recursive: true, force: true });
  }
});

test("callback outbox replay worker drains pending records on interval", async () => {
  const artifactsRoot = await mkdtemp(join(tmpdir(), "wedge-runner-replay-worker-"));
  const callbackOutboxFile = join(artifactsRoot, "callback-outbox.jsonl");
  let requestCount = 0;
  const server = createServer((_request, response) => {
    requestCount += 1;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ accepted: true }));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const app = createRunnerApp({
      artifactsRoot,
      callbackMode: "http",
      callbackBaseUrl: `http://127.0.0.1:${address.port}`,
      callbackOutboxFile,
      callbackRetryDelaysMs: [1, 1],
      callbackOutboxReplayIntervalMs: 10
    });

    await appendCallbackOutboxRecord(app.config, {
      callbackType: "accepted",
      runId: "run-1",
      payload: {
        workerId: "worker-1",
        acceptedAt: "2026-04-21T00:00:00.000Z",
        browserSessionId: "session-1"
      },
      attempts: 3,
      errorMessage: "failed before"
    });

    const worker = await app.startCallbackOutboxReplayWorker();
    await sleep(80);
    await worker.close();

    assert.ok(requestCount >= 1);
    await assert.rejects(() => readFile(callbackOutboxFile, "utf8"), /ENOENT/);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
    await rm(artifactsRoot, { recursive: true, force: true });
  }
});

test("callback replay emits structured operational logs", async () => {
  const artifactsRoot = await mkdtemp(join(tmpdir(), "wedge-runner-callback-log-"));
  const callbackOutboxFile = join(artifactsRoot, "callback-outbox.jsonl");
  const captured: string[] = [];
  const originalLog = console.log;
  console.log = (message?: unknown, ...optional: unknown[]) => {
    captured.push(String(message));
    if (optional.length > 0) {
      captured.push(optional.map(String).join(" "));
    }
  };

  try {
    const config = createRunnerTestConfig({
      callbackOutboxFile,
      callbackMode: "file"
    });

    await appendCallbackOutboxRecord(config, {
      callbackType: "accepted",
      runId: "run-1",
      payload: {
        workerId: "worker-1",
        acceptedAt: "2026-04-21T00:00:00.000Z",
        browserSessionId: "session-1"
      },
      attempts: 1,
      errorMessage: "failed before"
    });

    await replayCallbackOutbox(config);

    assert.ok(
      captured.some((line) => line.includes("\"component\":\"callback-outbox\"") && line.includes("\"event\":\"replay_completed\""))
    );
  } finally {
    console.log = originalLog;
    await rm(artifactsRoot, { recursive: true, force: true });
  }
});

test("callback outbox worker emits low-frequency idle heartbeat logs", async () => {
  const artifactsRoot = await mkdtemp(join(tmpdir(), "wedge-runner-callback-heartbeat-"));
  const callbackOutboxFile = join(artifactsRoot, "callback-outbox.jsonl");
  const captured: string[] = [];
  const originalLog = console.log;
  console.log = (message?: unknown, ...optional: unknown[]) => {
    captured.push(String(message));
    if (optional.length > 0) {
      captured.push(optional.map(String).join(" "));
    }
  };

  try {
    const app = createRunnerApp({
      artifactsRoot,
      callbackOutboxFile,
      callbackOutboxReplayIntervalMs: 10,
      callbackOutboxHeartbeatIntervalMs: 25
    });

    const worker = await app.startCallbackOutboxReplayWorker();
    await sleep(80);
    await worker.close();

    assert.ok(
      captured.some((line) => line.includes("\"component\":\"callback-outbox\"") && line.includes("\"event\":\"worker_idle_heartbeat\""))
    );
  } finally {
    console.log = originalLog;
    await rm(artifactsRoot, { recursive: true, force: true });
  }
});
