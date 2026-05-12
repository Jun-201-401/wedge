import assert from "node:assert/strict";
import { createHmac, createHash } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import test from "node:test";
import {
  persistMessageIdempotencyResult,
  readMessageIdempotencyResult
} from "../src/runtime/message-idempotency.ts";
import type { RunnerExecutionResult } from "../src/worker/index.ts";
import { createRunnerTestConfig } from "./support.ts";

test("[Message Idempotency] API store는 key hash로 run terminal result를 저장하고 조회한다", async () => {
  const idempotencyKey = "api-shared-run-message-key";
  const expectedKeyHash = createHash("sha256").update(idempotencyKey).digest("hex");
  const signatureSecret = "runner-signature-secret";
  const result = createRunResult();
  const requests: Array<{ method: string; path: string; body: string; signature: string | undefined }> = [];
  let storedResult: RunnerExecutionResult | null = null;
  const server = createServer(async (request, response) => {
    const body = await readRequestBody(request);
    requests.push({
      method: request.method ?? "",
      path: request.url ?? "",
      body,
      signature: request.headers["x-signature"]?.toString()
    });

    assert.equal(request.headers.authorization, "Bearer internal-token");
    assert.equal(request.headers["x-worker-id"], "runner-test-worker");
    assert.equal(request.url, `/internal/runner/message-idempotency/run/${expectedKeyHash}`);
    assert.equal(request.headers["x-signature"], signatureFor(body, signatureSecret));

    if (request.method === "GET") {
      sendJson(response, {
        data: storedResult
          ? recordResponse("run", expectedKeyHash, storedResult)
          : { scope: "run", idempotencyKeyHash: expectedKeyHash, found: false }
      });
      return;
    }

    if (request.method === "PUT") {
      const payload = JSON.parse(body) as { runId: string; result: RunnerExecutionResult };
      assert.equal(payload.runId, result.runId);
      storedResult = payload.result;
      sendJson(response, {
        data: recordResponse("run", expectedKeyHash, storedResult)
      });
      return;
    }

    response.statusCode = 405;
    response.end();
  });

  await listen(server);

  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const config = createRunnerTestConfig({
      callbackBaseUrl: `http://127.0.0.1:${address.port}`,
      callbackAuthToken: "internal-token",
      callbackSignatureSecret: signatureSecret,
      callbackTimeoutMs: 1_000,
      messageIdempotencyStoreMode: "api"
    });

    assert.equal(await readMessageIdempotencyResult(config, "run", idempotencyKey), null);
    await persistMessageIdempotencyResult(config, "run", idempotencyKey, result);
    const replayed = await readMessageIdempotencyResult<RunnerExecutionResult>(config, "run", idempotencyKey);

    assert.ok(replayed);
    assert.equal(replayed.runId, result.runId);
    assert.equal(replayed.delivery.status, "DELIVERY_COMPLETE");
    assert.deepEqual(requests.map((request) => request.method), ["GET", "PUT", "GET"]);
  } finally {
    await closeServer(server);
  }
});

function createRunResult(): RunnerExecutionResult {
  return {
    runId: "00000000-0000-4000-8000-000000000123",
    workerId: "runner-test-worker",
    browserSessionId: "session-1",
    summary: {
      completedStepCount: 1,
      failedStepCount: 0,
      stopped: false
    },
    delivery: {
      status: "DELIVERY_COMPLETE",
      issues: []
    }
  };
}

function recordResponse(scope: string, idempotencyKeyHash: string, result: RunnerExecutionResult): Record<string, unknown> {
  return {
    scope,
    idempotencyKeyHash,
    found: true,
    runId: result.runId,
    result,
    completedAt: new Date().toISOString()
  };
}

function signatureFor(body: string, secret: string): string {
  return `hmac-sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf8");
}

function sendJson(response: ServerResponse, body: unknown): void {
  response.statusCode = 200;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(body));
}

async function listen(server: ReturnType<typeof createServer>): Promise<void> {
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
}

async function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
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
