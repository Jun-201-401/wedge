import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createRunnerApp } from "../src/app.ts";
import { readDiscoveryExecuteMessage } from "../src/messaging/index.ts";
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

test("createRunnerApp processes discovery message files and writes SiteDiscoveryResult", async () => {
  const artifactsRoot = await mkdtemp(join(tmpdir(), "wedge-runner-discovery-entrypoint-artifacts-"));
  const fixtureRoot = await mkdtemp(join(tmpdir(), "wedge-runner-discovery-entrypoint-site-"));

  try {
    const fixturePath = join(fixtureRoot, "index.html");
    await writeFile(fixturePath, createDiscoveryFixtureHtml(), "utf8");

    const messageFile = join(fixtureRoot, "discovery-execute.request.json");
    await writeFile(messageFile, JSON.stringify(createDiscoveryExecuteMessage(pathToFileURL(fixturePath).toString())), "utf8");

    const app = createRunnerApp({
      workerId: "runner-test-worker",
      artifactsRoot,
      browserHeadless: true,
      browserLaunchTimeoutMs: 30_000,
      browserNavigationTimeoutMs: 30_000
    });

    const result = await app.processInputMessageFile(messageFile);

    assert.equal(result.kind, "discovery");
    assert.equal(result.discovery.discoveryId, "30000000-0000-4000-8000-000000000011");
    assert.match(result.discovery.resultFile, /site-discovery-result\.json$/);

    const persisted = JSON.parse(await readFile(result.discovery.resultFile, "utf8")) as {
      checkpoints?: Array<{ artifact_refs?: string[] }>;
      detected_flow_types?: string[];
      scenario_recommendations?: Array<{ scenario_type?: string; suggested_target?: Record<string, unknown> | null }>;
    };

    assert.equal(persisted.checkpoints?.[0]?.artifact_refs?.length, 2);
    assert.ok(persisted.detected_flow_types?.includes("LANDING_CTA"));
    assert.ok(persisted.detected_flow_types?.includes("SIGNUP_LEAD_FORM"));
    assert.ok(persisted.detected_flow_types?.includes("PRICING"));
    assert.ok(persisted.detected_flow_types?.includes("PURCHASE_CHECKOUT"));
    assert.ok(
      persisted.scenario_recommendations?.some(
        (recommendation) => recommendation.scenario_type === "LANDING_CTA" && recommendation.suggested_target
      )
    );
  } finally {
    await rm(artifactsRoot, {
      recursive: true,
      force: true
    });
    await rm(fixtureRoot, {
      recursive: true,
      force: true
    });
  }
});

test("createRunnerApp reuses discovery idempotencyKey terminal result", async () => {
  const artifactsRoot = await mkdtemp(join(tmpdir(), "wedge-runner-discovery-idempotency-"));

  try {
    const app = createRunnerApp({
      artifactsRoot,
      simulatedDelayCapMs: 1
    });
    const message = await readDiscoveryExecuteMessage("examples/discovery-execute.request.json");
    message.idempotencyKey = "discovery-idempotency-smoke";

    const first = await app.processDiscoveryMessage(message);
    const second = await app.processDiscoveryMessage(message);

    assert.equal(second.discoveryId, first.discoveryId);
    assert.equal(second.resultFile, first.resultFile);
    assert.deepEqual(second.result, first.result);
  } finally {
    await rm(artifactsRoot, {
      recursive: true,
      force: true
    });
  }
});

test("createRunnerApp sends discovery accepted, checkpoint, and finished callbacks in order", async () => {
  const artifactsRoot = await mkdtemp(join(tmpdir(), "wedge-runner-discovery-callback-artifacts-"));
  const fixtureRoot = await mkdtemp(join(tmpdir(), "wedge-runner-discovery-callback-site-"));
  const callbackServer = await createCallbackCaptureServer();

  try {
    const fixturePath = join(fixtureRoot, "index.html");
    const fixtureUrl = pathToFileURL(fixturePath).toString();
    await writeFile(fixturePath, createDiscoveryFixtureHtml(), "utf8");

    const messageFile = join(fixtureRoot, "discovery-execute.request.json");
    await writeFile(messageFile, JSON.stringify(createDiscoveryExecuteMessage(fixtureUrl)), "utf8");

    const app = createRunnerApp({
      workerId: "runner-test-worker",
      artifactsRoot,
      callbackBaseUrl: callbackServer.baseUrl,
      browserHeadless: true,
      browserLaunchTimeoutMs: 30_000,
      browserNavigationTimeoutMs: 30_000
    });

    const result = await app.processInputMessageFile(messageFile);

    assert.equal(result.kind, "discovery");
    assert.deepEqual(callbackServer.received.map((request) => request.url), [
      "/internal/runner/discoveries/30000000-0000-4000-8000-000000000011/accepted",
      "/internal/runner/discoveries/30000000-0000-4000-8000-000000000011/checkpoints",
      "/internal/runner/discoveries/30000000-0000-4000-8000-000000000011/finished"
    ]);

    const checkpointCallback = callbackServer.received[1];
    assert.equal(checkpointCallback?.method, "POST");
    assert.equal(checkpointCallback?.headers["x-worker-id"], "runner-test-worker");

    const checkpointBody = JSON.parse(checkpointCallback?.body ?? "{}") as {
      eventId?: string;
      workerId?: string;
      checkpoint?: {
        checkpointId?: string;
        stepKey?: string;
        stage?: string;
        trigger?: Record<string, unknown>;
        settle?: Record<string, unknown>;
        state?: Record<string, unknown>;
        observations?: Array<Record<string, unknown>>;
        deltas?: Array<Record<string, unknown>>;
        artifactRefs?: string[];
      };
      artifacts?: Array<Record<string, unknown>>;
      observations?: Array<Record<string, unknown>>;
    };

    assert.equal(typeof checkpointBody.eventId, "string");
    assert.equal(checkpointBody.workerId, "runner-test-worker");
    assert.equal(checkpointBody.checkpoint?.checkpointId, "cp_001");
    assert.equal(checkpointBody.checkpoint?.stepKey, "discovery_cp_001");
    assert.equal(checkpointBody.checkpoint?.stage, "FIRST_VIEW");
    assert.deepEqual(checkpointBody.checkpoint?.trigger, {
      type: "discovery",
      source: "site_discovery",
      inputUrl: fixtureUrl
    });
    assert.equal(checkpointBody.checkpoint?.settle?.strategy, "domcontentloaded");
    assert.equal(checkpointBody.checkpoint?.settle?.durationMs, 0);
    assert.equal(checkpointBody.checkpoint?.settle?.status, "settled");
    assert.equal((checkpointBody.checkpoint?.state?.page as { title?: string } | undefined)?.title, "Discovery Entrypoint Fixture");
    assert.ok(checkpointBody.checkpoint?.observations?.some((observation) => observation.type === "cta_candidate"));
    assert.deepEqual(checkpointBody.checkpoint?.deltas, []);
    assert.equal(checkpointBody.checkpoint?.artifactRefs?.length, 2);
    assert.equal(checkpointBody.artifacts?.length, 2);
    assert.deepEqual(
      checkpointBody.checkpoint?.artifactRefs,
      checkpointBody.artifacts?.map((artifact) => artifact.artifactId)
    );
    assert.deepEqual(checkpointBody.artifacts?.map((artifact) => artifact.artifactType), ["SCREENSHOT", "DOM_SNAPSHOT"]);
    assert.deepEqual(checkpointBody.observations, []);

    const artifactFiles = await readdir(artifactsRoot, {
      recursive: true
    });
    assert.ok(artifactFiles.some((path) => String(path).endsWith("-screenshot.png")));
    assert.ok(artifactFiles.some((path) => String(path).endsWith("-dom_snapshot.html")));
  } finally {
    await callbackServer.close();
    await rm(artifactsRoot, {
      recursive: true,
      force: true
    });
    await rm(fixtureRoot, {
      recursive: true,
      force: true
    });
  }
});

test("createRunnerApp sends prototype evidence callbacks to API when callback base URL is configured", async () => {
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


test("[MQ 검증 실패] runId를 가진 invalid run.execute 메시지는 failed callback을 남긴다", async () => {
  const artifactsRoot = await mkdtemp(join(tmpdir(), "wedge-runner-validation-failed-"));
  const callbackServer = await createCallbackCaptureServer();

  try {
    const app = createRunnerApp({
      workerId: "runner-test-worker",
      artifactsRoot,
      callbackBaseUrl: callbackServer.baseUrl,
      callbackRetryDelaysMs: []
    });

    const invalidRawMessage = JSON.stringify({
      messageId: "validation-failure-message",
      messageType: "run.execute.request",
      schemaVersion: "0.5",
      createdAt: "2026-05-13T00:00:00.000Z",
      producer: "api-server",
      payload: {
        runId: "dd5f9c57-84e2-4ea6-b0c3-27b7f8a5b3e2",
        projectId: "8f06dca8-9c4d-4f20-b1a8-1d5ee40a9923",
        startUrl: "https://example.com",
        goal: "landing CTA check",
        devicePreset: "desktop",
        scenarioTemplateVersionId: "4a2a8b8f-1b43-4922-ac57-2866f4a6e941"
      }
    });

    await assert.rejects(() => app.processRawMessage(invalidRawMessage), /scenarioPlan must be an object/);

    const failedCallback = findCallback(callbackServer.received, "failed");
    assert.ok(failedCallback);
    assert.equal(failedCallback.method, "POST");
    assert.equal(failedCallback.url, "/internal/runner/runs/dd5f9c57-84e2-4ea6-b0c3-27b7f8a5b3e2/failed");

    const body = JSON.parse(failedCallback.body) as {
      workerId?: string;
      failureCode?: string;
      failureMessage?: string;
      resultCompleteness?: string;
    };
    assert.equal(body.workerId, "runner-test-worker");
    assert.equal(body.failureCode, "RUNNER_MESSAGE_VALIDATION_FAILED");
    assert.match(body.failureMessage ?? "", /scenarioPlan must be an object/);
    assert.equal(body.resultCompleteness, "NONE");
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
      response.end(JSON.stringify(
        request.url?.endsWith("/control-state")
          ? { data: { runId: "dd5f9c57-84e2-4ea6-b0c3-27b7f8a5b3e2", status: "RUNNING", stopRequested: false } }
          : { ok: true }
      ));
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

function createDiscoveryExecuteMessage(url: string) {
  return {
    messageId: "30000000-0000-4000-8000-000000000001",
    messageType: "discovery.execute.request",
    schemaVersion: "0.5",
    createdAt: "2026-04-30T00:00:00.000Z",
    producer: "api-server",
    correlationId: "30000000-0000-4000-8000-000000000002",
    idempotencyKey: "discovery:30000000-0000-4000-8000-000000000001",
    payload: {
      discoveryId: "30000000-0000-4000-8000-000000000011",
      projectId: "8f06dca8-9c4d-4f20-b1a8-1d5ee40a9923",
      triggerSource: "WEB",
      url,
      devicePreset: "desktop",
      viewport: {
        width: 1440,
        height: 900
      },
      maxDurationMs: 5_000,
      maxScrollCount: 1
    }
  };
}

function createDiscoveryFixtureHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head><title>Discovery Entrypoint Fixture</title></head>
  <body>
    <header>
      <a class="primary-cta" href="/signup">Start free</a>
    </header>
    <main>
      <section id="signup-form">
        <form>
          <input type="email" name="email" placeholder="Work email" />
        </form>
      </section>
      <section id="pricing" class="pricing-plans">
        <h2>Pricing plans</h2>
        <a class="plan-cta" href="checkout.html">Choose Starter</a>
      </section>
    </main>
  </body>
</html>`;
}

test("createRunnerApp stops after stop_when step requests stop", async () => {
  const artifactsRoot = await mkdtemp(join(tmpdir(), "wedge-runner-stop-artifacts-"));
  const callbackLogFile = join(artifactsRoot, "callbacks.jsonl");
  const app = createRunnerApp({
    workerId: "runner-test-worker",
    artifactsRoot,
    callbackLogFile,
    simulatedDelayCapMs: 1
  });
  const message = await loadExampleMessage();

  message.payload.scenarioPlan!.steps = [
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

test("[안전 정책] synthetic input이 금지되면 사용자 실패 대신 stopped finished callback을 남긴다", async () => {
  const artifactsRoot = await mkdtemp(join(tmpdir(), "wedge-runner-safety-artifacts-"));
  const callbackLogFile = join(artifactsRoot, "callbacks.jsonl");
  const app = createRunnerApp({
    workerId: "runner-test-worker",
    artifactsRoot,
    callbackLogFile,
    simulatedDelayCapMs: 1
  });
  const message = await loadExampleMessage();

  message.payload.scenarioPlan!.steps = [
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
  message.payload.scenarioPlan!.safety.use_synthetic_inputs = false;

  const result = await app.processMessage(message);

  const callbackLog = await readFile(callbackLogFile, "utf8");
  const callbackRecords = callbackLog.trim().split("\n").map((line) => JSON.parse(line));
  const finishedCallback = callbackRecords.find((record) => record.callbackType === "finished");
  const blockedStepEvent = callbackRecords.find(
    (record) =>
      record.callbackType === "step-events" &&
      record.payload.events.some((event: { eventType: string }) => event.eventType === "STEP_BLOCKED")
  );
  const blockedEvent = blockedStepEvent?.payload.events.find(
    (event: { eventType: string }) => event.eventType === "STEP_BLOCKED"
  );

  assert.equal(result.summary.completedStepCount, 0);
  assert.equal(result.summary.failedStepCount, 0);
  assert.equal(result.summary.stopped, true);
  assert.match(callbackLog, /"callbackType":"accepted"/);
  assert.match(callbackLog, /"callbackType":"finished"/);
  assert.doesNotMatch(callbackLog, /"callbackType":"failed"/);
  assert.equal(finishedCallback?.payload.summary.completedStepCount, 0);
  assert.equal(finishedCallback?.payload.summary.failedStepCount, 0);
  assert.equal(finishedCallback?.payload.summary.stopped, true);
  assert.equal(finishedCallback?.payload.summary.collectorStatus.screenshot.status, "success");
  assert.equal(blockedEvent?.payload.reasonCode, "POLICY_SYNTHETIC_INPUT_BLOCKED");
  assert.equal(blockedEvent?.payload.safetyCode, "SYNTHETIC_INPUT_BLOCKED");
  assert.equal(blockedEvent?.payload.riskClass, "SYNTHETIC_INPUT");
});
