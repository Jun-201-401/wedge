#!/usr/bin/env node
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const repoRoot = resolve(import.meta.dirname, "../..");
const runnerDir = join(repoRoot, "apps/runner");
const artifactsRoot = process.env.WEDGE_DISCOVERY_SMOKE_ARTIFACTS_ROOT
  ? resolve(process.env.WEDGE_DISCOVERY_SMOKE_ARTIFACTS_ROOT)
  : await mkdtemp(join(tmpdir(), "wedge-discovery-smoke-artifacts-"));
const workRoot = await mkdtemp(join(tmpdir(), "wedge-discovery-smoke-"));
let fixtureServer;

try {
  const targetUrl = process.env.WEDGE_DISCOVERY_SMOKE_TARGET_URL ?? await startFixtureSite();
  const discoveryId = process.env.WEDGE_DISCOVERY_SMOKE_DISCOVERY_ID ?? "30000000-0000-4000-8000-000000000099";
  const messageFile = join(workRoot, "discovery-execute.request.json");
  await writeFile(messageFile, JSON.stringify(createDiscoveryMessage(discoveryId, targetUrl), null, 2), "utf8");

  await runRunner(messageFile);

  const resultFile = join(artifactsRoot, "discoveries", discoveryId, "site-discovery-result.json");
  const result = JSON.parse(await readFile(resultFile, "utf8"));
  const expectedFlows = (process.env.WEDGE_DISCOVERY_SMOKE_EXPECTED_FLOWS ?? "LANDING_CTA,SIGNUP_LEAD_FORM,PRICING,PURCHASE_CHECKOUT")
    .split(",")
    .map((flow) => flow.trim())
    .filter(Boolean);
  const missingExpected = expectedFlows.filter((flow) => !result.detected_flow_types?.includes(flow));
  if (missingExpected.length > 0) {
    throw new Error(`Discovery smoke missing expected flow(s): ${missingExpected.join(", ")}`);
  }

  console.log(JSON.stringify({
    ok: true,
    targetUrl,
    discoveryId,
    resultFile,
    detectedFlowTypes: result.detected_flow_types,
    recommendationCount: result.scenario_recommendations?.length ?? 0
  }, null, 2));
} finally {
  if (fixtureServer) {
    await new Promise((resolveClose) => fixtureServer.close(resolveClose));
  }
  await rm(workRoot, { recursive: true, force: true });
  if (!process.env.WEDGE_DISCOVERY_SMOKE_ARTIFACTS_ROOT) {
    await rm(artifactsRoot, { recursive: true, force: true });
  }
}

async function startFixtureSite() {
  fixtureServer = createServer((request, response) => {
    const url = request.url ?? "/";
    response.setHeader("content-type", "text/html; charset=utf-8");
    if (url.includes("checkout")) {
      response.end(`<!doctype html><html><body><form id="payment-method"><input name="card-number" placeholder="Card number" /></form></body></html>`);
      return;
    }
    response.end(`<!doctype html>
<html lang="en">
  <head><title>Wedge Discovery Smoke Fixture</title></head>
  <body>
    <header><a id="hero-cta" href="#signup-form">Start free</a></header>
    <main>
      <section><h1>Find conversion risks before launch</h1></section>
      <section id="signup-form"><form><input type="email" name="email" placeholder="Work email" /></form></section>
      <section id="pricing" data-testid="pricing"><h2>Pricing plans</h2><a href="/checkout" class="plan-cta">Choose Starter</a></section>
    </main>
  </body>
</html>`);
  });

  await new Promise((resolveListen, reject) => {
    fixtureServer.once("error", reject);
    fixtureServer.listen(0, "127.0.0.1", () => {
      fixtureServer.off("error", reject);
      resolveListen();
    });
  });
  const address = fixtureServer.address();
  if (!address || typeof address === "string") {
    throw new Error("Unable to start discovery smoke fixture server");
  }
  return `http://127.0.0.1:${address.port}/`;
}

function createDiscoveryMessage(discoveryId, targetUrl) {
  return {
    messageId: "30000000-0000-4000-8000-000000000001",
    messageType: "discovery.execute.request",
    schemaVersion: "0.5",
    createdAt: new Date().toISOString(),
    producer: "real-discovery-smoke",
    correlationId: discoveryId,
    idempotencyKey: `discovery:${discoveryId}`,
    payload: {
      discoveryId,
      projectId: process.env.WEDGE_DISCOVERY_SMOKE_PROJECT_ID ?? "8f06dca8-9c4d-4f20-b1a8-1d5ee40a9923",
      triggerSource: "WEB",
      url: targetUrl,
      devicePreset: process.env.WEDGE_DISCOVERY_SMOKE_DEVICE ?? "desktop",
      viewport: {
        width: Number(process.env.WEDGE_DISCOVERY_SMOKE_VIEWPORT_WIDTH ?? 1440),
        height: Number(process.env.WEDGE_DISCOVERY_SMOKE_VIEWPORT_HEIGHT ?? 900)
      },
      maxDurationMs: Number(process.env.WEDGE_DISCOVERY_SMOKE_MAX_DURATION_MS ?? 10000),
      maxScrollCount: Number(process.env.WEDGE_DISCOVERY_SMOKE_MAX_SCROLL_COUNT ?? 2)
    }
  };
}

async function runRunner(messageFile) {
  const child = spawn("npm", ["run", "start", "--", "--message-file", messageFile], {
    cwd: runnerDir,
    env: {
      ...process.env,
      RUNNER_ARTIFACTS_ROOT: artifactsRoot,
      RUNNER_BROWSER_MODE: process.env.RUNNER_BROWSER_MODE ?? "playwright",
      RUNNER_BROWSER_HEADLESS: process.env.RUNNER_BROWSER_HEADLESS ?? "true"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });

  const code = await new Promise((resolveExit) => child.once("exit", resolveExit));
  if (code !== 0) {
    throw new Error(`Runner discovery smoke failed with code ${code}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`);
  }
}
