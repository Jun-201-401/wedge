import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRunnerApp } from "../src/app.ts";
import { loadExampleMessage } from "./support.ts";

interface ReceivedCallbackRequest {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

test("[앱 실행] 예제 run.execute 메시지를 처리하고 accepted/checkpoints/finished callback 로그를 남긴다", async () => {
  const artifactsRoot = await mkdtemp(join(tmpdir(), "wedge-runner-artifacts-"));
  const callbackLogFile = join(artifactsRoot, "callbacks.jsonl");
  const app = createRunnerApp({
    workerId: "runner-test-worker",
    artifactsRoot,
    callbackLogFile,
    simulatedDelayCapMs: 1
  });

  const result = await app.processMessageFile(join("examples", "run-execute.request.json"));
  const callbackLog = await readFile(callbackLogFile, "utf8");

  assert.equal(result.summary.completedStepCount, 4);
  assert.equal(result.summary.failedStepCount, 0);
  assert.match(callbackLog, /"callbackType":"accepted"/);
  assert.match(callbackLog, /"callbackType":"finished"/);
  assert.match(callbackLog, /"callbackType":"checkpoints"/);
});

test("[앱 실행] HTTP callback 설정 시 API로 artifact/checkpoint/finished evidence callback을 전송한다", async () => {
  const artifactsRoot = await mkdtemp(join(tmpdir(), "wedge-runner-api-callbacks-"));
  const callbackServer = await createCallbackCaptureServer();

  try {
    const app = createRunnerApp({
      workerId: "runner-test-worker",
      artifactsRoot,
      callbackBaseUrl: callbackServer.baseUrl,
      simulatedDelayCapMs: 1
    });

    const result = await app.processMessageFile(join("examples", "run-execute.request.json"));
    const receivedUrls = callbackServer.received.map((request) => request.url);
    const artifactCallback = findCallback(callbackServer.received, "artifacts");
    const checkpointCallback = findCallback(callbackServer.received, "checkpoints");
    const finishedCallback = findCallback(callbackServer.received, "finished");
    const artifactFiles = await readdir(artifactsRoot, {
      recursive: true
    });

    assert.equal(app.config.callbackMode, "http");
    assert.equal(result.summary.completedStepCount, 4);
    assert.ok(receivedUrls.some((url) => url.endsWith("/accepted")));
    assert.ok(receivedUrls.some((url) => url.endsWith("/step-events")));
    assert.ok(artifactCallback);
    assert.ok(checkpointCallback);
    assert.ok(finishedCallback);
    assert.equal(artifactCallback?.method, "POST");
    assert.equal(artifactCallback?.headers["x-worker-id"], "runner-test-worker");
    assert.match(artifactCallback?.body ?? "", /"artifacts":\[/);
    assert.match(artifactCallback?.body ?? "", /"artifactType":"SCREENSHOT"/);
    assert.match(checkpointCallback?.body ?? "", /"checkpoints":\[/);
    assert.match(checkpointCallback?.body ?? "", /"artifactRefs":\[/);
    assert.match(finishedCallback?.body ?? "", /"completedStepCount":4/);
    assert.ok(artifactFiles.some((path) => String(path).endsWith("-screenshot.svg")));
  } finally {
    await callbackServer.close();
    await rm(artifactsRoot, {
      recursive: true,
      force: true
    });
  }
});

async function createCallbackCaptureServer(): Promise<{
  baseUrl: string;
  received: ReceivedCallbackRequest[];
  close: () => Promise<void>;
}> {
  const received: ReceivedCallbackRequest[] = [];
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
      response.end(JSON.stringify({ ok: true }));
    });
  });

  await listenOnLocalhost(server);
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    received,
    close: () => closeServer(server)
  };
}

function findCallback(received: ReceivedCallbackRequest[], callbackType: string): ReceivedCallbackRequest | undefined {
  return received.find((request) => request.url.endsWith(`/${callbackType}`));
}

function listenOnLocalhost(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

test("[안전 중단] stop_when 조건이 맞으면 이후 step을 실행하지 않고 중단 상태로 종료한다", async () => {
  const artifactsRoot = await mkdtemp(join(tmpdir(), "wedge-runner-stop-artifacts-"));
  const callbackLogFile = join(artifactsRoot, "callbacks.jsonl");
  const app = createRunnerApp({
    workerId: "runner-test-worker",
    artifactsRoot,
    callbackLogFile,
    simulatedDelayCapMs: 1
  });
  const message = await loadExampleMessage();

  message.payload.scenarioPlan.steps = [
    {
      step_id: "step_001_stop",
      stage: "CTA",
      description: "stop when current url matches landing page",
      action: {
        type: "stop_when"
      },
      settle_strategy: {
        type: "none",
        timeout_ms: 0
      },
      checkpoint: false,
      stop_condition: {
        url_includes: "example.com"
      }
    },
    {
      step_id: "step_002_fill_email",
      stage: "INPUT",
      description: "should not run",
      action: {
        type: "fill",
        target: {
          label: "Email"
        },
        value: "blocked@example.com"
      },
      settle_strategy: {
        type: "fixed_short",
        timeout_ms: 1
      },
      checkpoint: false
    }
  ];

  const result = await app.processMessage(message);
  const callbackLog = await readFile(callbackLogFile, "utf8");

  assert.equal(result.summary.completedStepCount, 1);
  assert.equal(result.summary.stopped, true);
  assert.doesNotMatch(callbackLog, /step_002_fill_email/);
});

test("[안전 정책] synthetic input이 금지되면 fill 액션을 실패 처리하고 failed callback을 남긴다", async () => {
  const artifactsRoot = await mkdtemp(join(tmpdir(), "wedge-runner-safety-artifacts-"));
  const callbackLogFile = join(artifactsRoot, "callbacks.jsonl");
  const app = createRunnerApp({
    workerId: "runner-test-worker",
    artifactsRoot,
    callbackLogFile,
    simulatedDelayCapMs: 1
  });
  const message = await loadExampleMessage();

  message.payload.scenarioPlan.steps = [
    {
      step_id: "step_001_fill_email",
      stage: "INPUT",
      description: "fill email once",
      action: {
        type: "fill",
        target: {
          label: "Email"
        },
        value: "blocked@example.com"
      },
      settle_strategy: {
        type: "fixed_short",
        timeout_ms: 1
      },
      checkpoint: false
    }
  ];
  message.payload.scenarioPlan.safety.use_synthetic_inputs = false;

  await assert.rejects(
    () => app.processMessage(message),
    /Scenario safety forbids synthetic fill actions/
  );

  const callbackLog = await readFile(callbackLogFile, "utf8");
  assert.match(callbackLog, /"callbackType":"accepted"/);
  assert.match(callbackLog, /"callbackType":"failed"/);
  assert.doesNotMatch(callbackLog, /"callbackType":"finished"/);
});
