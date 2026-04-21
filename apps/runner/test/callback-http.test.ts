import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCallbackClient } from "../src/callback/index.ts";
import { createRunnerTestConfig } from "./support.ts";

test("createCallbackClient keeps file callback mode behavior", async () => {
  const artifactsRoot = await mkdtemp(join(tmpdir(), "wedge-runner-callback-file-"));
  const callbackLogFile = join(artifactsRoot, "callbacks.jsonl");

  try {
    const callbackClient = createCallbackClient(
      createRunnerTestConfig({
        callbackLogFile,
        callbackMode: "file"
      })
    );

    await callbackClient.sendAccepted("run-1", {
      workerId: "worker-1",
      acceptedAt: "2026-04-21T00:00:00.000Z",
      browserSessionId: "session-1"
    });

    const callbackLog = await readFile(callbackLogFile, "utf8");
    assert.match(callbackLog, /"callbackType":"accepted"/);
    assert.match(callbackLog, /"browserSessionId":"session-1"/);
  } finally {
    await rm(artifactsRoot, { recursive: true, force: true });
  }
});

test("createCallbackClient sends runner callbacks over HTTP with expected headers", async () => {
  const received: Array<{ method: string; url: string; headers: Record<string, string | string[] | undefined>; body: string }> = [];
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      received.push({
        method: request.method ?? "",
        url: request.url ?? "",
        headers: request.headers,
        body
      });

      response.writeHead(200, {
        "content-type": "application/json"
      });
      response.end(JSON.stringify({ accepted: true }));
    });
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

    const callbackClient = createCallbackClient(
      createRunnerTestConfig({
        callbackMode: "http",
        callbackBaseUrl: `http://127.0.0.1:${address.port}`,
        callbackAuthToken: "internal-token",
        callbackSignatureSecret: "secret-key"
      })
    );

    await callbackClient.sendAccepted("run-1", {
      workerId: "worker-1",
      acceptedAt: "2026-04-21T00:00:00.000Z",
      browserSessionId: "session-1"
    });

    assert.equal(received.length, 1);
    assert.equal(received[0]?.method, "POST");
    assert.equal(received[0]?.url, "/internal/runner/runs/run-1/accepted");
    assert.equal(received[0]?.headers["x-worker-id"], "runner-test-worker");
    assert.equal(received[0]?.headers.authorization, "Bearer internal-token");
    assert.ok(typeof received[0]?.headers["x-event-id"] === "string");
    assert.ok(typeof received[0]?.headers["x-signature"] === "string");
    assert.match(received[0]?.body ?? "", /"browserSessionId":"session-1"/);
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
  }
});

test("HTTP callback mode throws on non-2xx responses", async () => {
  const server = createServer((_request, response) => {
    response.writeHead(409, {
      "content-type": "application/json"
    });
    response.end(JSON.stringify({ error: "conflict" }));
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

    const callbackClient = createCallbackClient(
      createRunnerTestConfig({
        callbackMode: "http",
        callbackBaseUrl: `http://127.0.0.1:${address.port}`
      })
    );

    await assert.rejects(
      () =>
        callbackClient.sendFinished("run-1", {
          workerId: "worker-1",
          executionFinishedAt: "2026-04-21T00:00:00.000Z",
          summary: {
            completedStepCount: 1,
            failedStepCount: 0,
            stopped: false
          }
        }),
      /runner callback finished failed with status 409/
    );
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
  }
});
