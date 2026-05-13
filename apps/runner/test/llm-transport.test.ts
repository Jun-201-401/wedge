import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { register } from "prom-client";
import { createFetchLlmDecisionTransport } from "../src/agent/llm-transport.ts";

test("[Runner metrics] LLM transport 성공/실패 호출 수와 latency를 기록한다", async () => {
  const server = createServer((request, response) => {
    if (request.url === "/success") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ decision: { kind: "finish" } }));
      return;
    }

    response.writeHead(502, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "upstream unavailable" }));
  });
  await listen(server);

  try {
    const origin = serverOrigin(server);
    const transport = createFetchLlmDecisionTransport();

    await transport.complete({
      endpoint: `${origin}/success`,
      model: "metrics-test-success-model",
      timeoutMs: 1_000,
      payload: { input: "safe fixture" }
    });

    await assert.rejects(
      () => transport.complete({
        endpoint: `${origin}/failure`,
        model: "metrics-test-error-model",
        timeoutMs: 1_000,
        payload: { input: "safe fixture" }
      }),
      /LLM decision request failed with status 502/
    );

    assert.equal(
      await metricValue("wedge_ai_gms_requests_total", {
        service: "runner",
        feature: "agent_decision",
        model: "metrics-test-success-model",
        status: "success",
        error_type: "none"
      }),
      1
    );
    assert.equal(
      await metricValue("wedge_ai_gms_requests_total", {
        service: "runner",
        feature: "agent_decision",
        model: "metrics-test-error-model",
        status: "error",
        error_type: "http_error"
      }),
      1
    );
    assert.equal(
      await metricValue("wedge_ai_gms_request_duration_seconds_count", {
        service: "runner",
        feature: "agent_decision",
        model: "metrics-test-success-model",
        status: "success",
        error_type: "none"
      }),
      1
    );
  } finally {
    await closeServer(server);
  }
});

async function metricValue(name: string, labels: Record<string, string>): Promise<number | undefined> {
  const metrics = await register.getMetricsAsJSON();
  for (const metric of metrics) {
    for (const value of metric.values) {
      const valueName = "metricName" in value && typeof value.metricName === "string"
        ? value.metricName
        : metric.name;
      if (valueName !== name) {
        continue;
      }
      if (Object.entries(labels).every(([key, expected]) => value.labels[key] === expected)) {
        return value.value;
      }
    }
  }
  return undefined;
}

async function listen(server: Server): Promise<void> {
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
}

function serverOrigin(server: Server): string {
  const address = server.address() as AddressInfo | null;
  if (!address) {
    throw new Error("test server must be listening");
  }
  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(server: Server): Promise<void> {
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
