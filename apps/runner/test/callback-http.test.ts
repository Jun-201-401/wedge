import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCallbackClient } from "../src/callback/index.ts";
import { createRunnerTestConfig } from "./support.ts";

test("[콜백:file] callback base URL이 없으면 기존 JSONL 파일 callback 모드를 유지한다", async () => {
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

test("[콜백:file] 실패 결과도 JSONL 파일 callback으로 기록한다", async () => {
  const artifactsRoot = await mkdtemp(join(tmpdir(), "wedge-runner-callback-file-failed-"));
  const callbackLogFile = join(artifactsRoot, "callbacks.jsonl");

  try {
    const callbackClient = createCallbackClient(
      createRunnerTestConfig({
        callbackLogFile,
        callbackMode: "file"
      })
    );

    await callbackClient.sendFailed("run-2", {
      workerId: "worker-2",
      failedAt: "2026-04-21T00:00:00.000Z",
      failureCode: "RUNNER_FAILED",
      failureMessage: "callback failed",
      resultCompleteness: "FINAL"
    });

    const callbackLog = await readFile(callbackLogFile, "utf8");
    assert.match(callbackLog, /"callbackType":"failed"/);
    assert.match(callbackLog, /"failureCode":"RUNNER_FAILED"/);
  } finally {
    await rm(artifactsRoot, { recursive: true, force: true });
  }
});

test("[콜백:http] runner callback을 HTTP로 보내고 worker/event/signature 헤더를 포함한다", async () => {
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
    assert.equal(
      received[0]?.headers["x-signature"],
      `hmac-sha256=${createHmac("sha256", "secret-key").update(received[0]?.body ?? "").digest("hex")}`
    );
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

test("[콜백:http] control-state 조회로 STOP_REQUESTED 신호를 읽는다", async () => {
  const received: Array<{ method: string; url: string; headers: Record<string, string | string[] | undefined> }> = [];
  const server = createServer((request, response) => {
    received.push({
      method: request.method ?? "",
      url: request.url ?? "",
      headers: request.headers
    });

    response.writeHead(200, {
      "content-type": "application/json"
    });
    response.end(JSON.stringify({
      data: {
        runId: "run-1",
        status: "STOP_REQUESTED",
        stopRequested: true,
        resultCompleteness: "PARTIAL"
      }
    }));
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
        callbackAuthToken: "internal-token"
      })
    );

    const controlState = await callbackClient.readRunControlState?.("run-1");

    assert.deepEqual(controlState, {
      runId: "run-1",
      status: "STOP_REQUESTED",
      stopRequested: true,
      resultCompleteness: "PARTIAL"
    });
    assert.equal(received[0]?.method, "GET");
    assert.equal(received[0]?.url, "/internal/runner/runs/run-1/control-state");
    assert.equal(received[0]?.headers["x-worker-id"], "runner-test-worker");
    assert.equal(received[0]?.headers.authorization, "Bearer internal-token");
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

test("createCallbackClient sends discovery callbacks to discovery endpoint", async () => {
  const received: Array<{ url: string; headers: Record<string, string | string[] | undefined>; body: string }> = [];
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      received.push({ url: request.url ?? "", headers: request.headers, body });
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
        callbackBaseUrl: `http://127.0.0.1:${address.port}`
      })
    );

    await callbackClient.sendDiscoveryFinished!("discovery-1", {
      eventId: "event-1",
      workerId: "worker-1",
      finishedAt: "2026-04-21T00:00:00.000Z",
      finalUrl: "https://example.com",
      summary: {
        detectedFlowTypes: ["LANDING_CTA"],
        missingFlowTypes: ["PRICING"],
        primaryCtaCount: 1,
        formCandidateCount: 0,
        pricingEntrypointCount: 0,
        checkoutEntrypointCount: 0,
        scenarioRecommendations: []
      }
    });

    assert.equal(received.length, 1);
    assert.equal(received[0]?.url, "/internal/runner/discoveries/discovery-1/finished");
    assert.equal(received[0]?.headers["x-event-id"], "event-1");
    assert.match(received[0]?.body ?? "", /"finalUrl":"https:\/\/example.com"/);
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

test("[콜백:http] agent callbacks use dedicated run endpoints", async () => {
  const received: Array<{ url: string; body: string }> = [];
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      received.push({ url: request.url ?? "", body });
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
        callbackBaseUrl: `http://127.0.0.1:${address.port}`
      })
    );

    await callbackClient.sendAgentEvents("run-1", {
      events: [
        {
          eventId: "00000000-0000-4000-8000-000000000001",
          taskId: "task-1",
          attemptId: "attempt-1",
          turn: 1,
          eventType: "DECISION_MADE",
          occurredAt: "2026-05-07T00:00:00.000Z",
          payload: { actionType: "click" }
        }
      ]
    });

    await callbackClient.sendAgentTrace("run-1", {
      taskId: "task-1",
      attemptId: "attempt-1",
      occurredAt: "2026-05-07T00:00:01.000Z",
      trace: { outcome: { status: "SUCCESS" } }
    });

    assert.deepEqual(received.map((request) => request.url), [
      "/internal/runner/runs/run-1/agent-events",
      "/internal/runner/runs/run-1/agent-traces"
    ]);
    assert.match(received[0]?.body ?? "", /"eventType":"DECISION_MADE"/);
    assert.match(received[1]?.body ?? "", /"attemptId":"attempt-1"/);
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

test("[콜백:http] 비정상 HTTP 응답은 callback 실패로 처리하고 outbox에 남긴다", async () => {
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
    const artifactsRoot = await mkdtemp(join(tmpdir(), "wedge-runner-callback-http-fail-"));
    const callbackOutboxFile = join(artifactsRoot, "callback-outbox.jsonl");

    const callbackClient = createCallbackClient(
      createRunnerTestConfig({
        callbackMode: "http",
        callbackBaseUrl: `http://127.0.0.1:${address.port}`,
        callbackOutboxFile,
        callbackRetryDelaysMs: [1, 1]
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
      /runner callback finished failed after 3 attempts: runner callback finished failed with status 409/
    );

    const outboxLog = await readFile(callbackOutboxFile, "utf8");
    assert.match(outboxLog, /"callbackType":"finished"/);
    assert.match(outboxLog, /"attempts":3/);
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

test("[콜백:http] 일시 실패 후 재시도에 성공하면 outbox를 남기지 않는다", async () => {
  let requestCount = 0;
  const artifactsRoot = await mkdtemp(join(tmpdir(), "wedge-runner-callback-http-retry-"));
  const callbackOutboxFile = join(artifactsRoot, "callback-outbox.jsonl");
  const server = createServer((_request, response) => {
    requestCount += 1;

    if (requestCount < 3) {
      response.writeHead(503, {
        "content-type": "application/json"
      });
      response.end(JSON.stringify({ error: "try again" }));
      return;
    }

    response.writeHead(200, {
      "content-type": "application/json"
    });
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

    const callbackClient = createCallbackClient(
      createRunnerTestConfig({
        callbackMode: "http",
        callbackBaseUrl: `http://127.0.0.1:${address.port}`,
        callbackOutboxFile,
        callbackRetryDelaysMs: [1, 1]
      })
    );

    await callbackClient.sendAccepted("run-1", {
      workerId: "worker-1",
      acceptedAt: "2026-04-21T00:00:00.000Z",
      browserSessionId: "session-1"
    });

    assert.equal(requestCount, 3);
    await assert.rejects(async () => access(callbackOutboxFile), /ENOENT/);
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

test("[콜백:http] 재시도 로그는 attempt마다가 아니라 집계 이벤트로 남긴다", async () => {
  let requestCount = 0;
  const artifactsRoot = await mkdtemp(join(tmpdir(), "wedge-runner-callback-http-logs-"));
  const callbackOutboxFile = join(artifactsRoot, "callback-outbox.jsonl");
  const captured: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (message?: unknown, ...optional: unknown[]) => {
    captured.push(String(message));
    if (optional.length > 0) {
      captured.push(optional.map(String).join(" "));
    }
  };
  console.error = (message?: unknown, ...optional: unknown[]) => {
    captured.push(String(message));
    if (optional.length > 0) {
      captured.push(optional.map(String).join(" "));
    }
  };

  const server = createServer((_request, response) => {
    requestCount += 1;

    if (requestCount < 3) {
      response.writeHead(503, {
        "content-type": "application/json"
      });
      response.end(JSON.stringify({ error: "retry" }));
      return;
    }

    response.writeHead(200, {
      "content-type": "application/json"
    });
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

    const callbackClient = createCallbackClient(
      createRunnerTestConfig({
        callbackMode: "http",
        callbackBaseUrl: `http://127.0.0.1:${address.port}`,
        callbackOutboxFile,
        callbackRetryDelaysMs: [1, 1]
      })
    );

    await callbackClient.sendAccepted("run-1", {
      workerId: "worker-1",
      acceptedAt: "2026-04-21T00:00:00.000Z",
      browserSessionId: "session-1"
    });

    assert.ok(captured.some((line) => line.includes("\"event\":\"retry_sequence_recovered\"")));
    assert.ok(!captured.some((line) => line.includes("\"event\":\"retry_attempt_failed\"")));
  } finally {
    console.log = originalLog;
    console.error = originalError;
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
