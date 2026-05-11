import assert from "node:assert/strict";
import { createHmac, createHash } from "node:crypto";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createApiAgentIdempotencyStore,
  persistAgentIdempotencyResult,
  readAgentIdempotencyResult
} from "../src/worker/agent-idempotency.ts";
import type { AgentRunnerExecutionResult } from "../src/worker/agent-worker.ts";
import { createRunnerTestConfig } from "./support.ts";

test("[Agent Idempotency] terminal result record는 raw AgentTrace 민감값을 저장하지 않는다", async () => {
  const artifactsRoot = await mkdtemp(join(tmpdir(), "runner-test-agent-idempotency-redaction-"));
  const config = createRunnerTestConfig({
    artifactsRoot,
    agentIdempotencyStoreEnabled: true
  });
  const result = createSensitiveAgentResult();

  await persistAgentIdempotencyResult(config, "sensitive-idempotency-key", result);

  const recordDir = join(artifactsRoot, "agent-idempotency");
  const [recordFile] = await readdir(recordDir);
  assert.ok(recordFile);
  const persistedContent = await readFile(join(recordDir, recordFile), "utf8");
  assert.doesNotMatch(persistedContent, /mvp\.tester@example\.com/);
  assert.doesNotMatch(persistedContent, /raw-secret|result-secret/);
  assert.match(persistedContent, /REDACTED_EMAIL/);
  assert.match(persistedContent, /REDACTED_SECRET/);

  const replayedResult = await readAgentIdempotencyResult(config, "sensitive-idempotency-key");
  assert.ok(replayedResult);
  assert.doesNotMatch(JSON.stringify(replayedResult), /mvp\.tester@example\.com|raw-secret|result-secret/);
  assert.equal(replayedResult.trace.outcome.status, "SUCCESS");
});

test("[Agent Idempotency] API store는 key hash로 terminal result를 저장하고 조회한다", async () => {
  const result = createSensitiveAgentResult();
  const idempotencyKey = "api-shared-idempotency-key";
  const expectedKeyHash = createHash("sha256").update(idempotencyKey).digest("hex");
  const signatureSecret = "runner-signature-secret";
  const requests: Array<{ method: string; path: string; body: string; signature: string | undefined }> = [];
  let storedResult: AgentRunnerExecutionResult | null = null;
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
    assert.equal(request.url, `/internal/runner/agent-idempotency/${expectedKeyHash}`);
    assert.equal(request.headers["x-signature"], signatureFor(body, signatureSecret));

    if (request.method === "GET") {
      sendJson(response, {
        data: storedResult
          ? recordResponse(expectedKeyHash, storedResult)
          : { idempotencyKeyHash: expectedKeyHash, found: false }
      });
      return;
    }

    if (request.method === "PUT") {
      const payload = JSON.parse(body) as { result: AgentRunnerExecutionResult };
      storedResult = payload.result;
      sendJson(response, {
        data: recordResponse(expectedKeyHash, storedResult)
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
    const store = createApiAgentIdempotencyStore(createRunnerTestConfig({
      callbackBaseUrl: `http://127.0.0.1:${address.port}`,
      callbackAuthToken: "internal-token",
      callbackSignatureSecret: signatureSecret,
      callbackTimeoutMs: 1_000
    }));

    assert.equal(await store.read(idempotencyKey), null);
    await store.persist(idempotencyKey, result);
    const replayed = await store.read(idempotencyKey);

    assert.ok(replayed);
    assert.equal(replayed.trace.outcome.status, "SUCCESS");
    assert.equal(replayed.trace.attempt_index, 1);
    assert.doesNotMatch(JSON.stringify(replayed), /mvp\.tester@example\.com|raw-secret|result-secret/);
    assert.deepEqual(requests.map((request) => request.method), ["GET", "PUT", "GET"]);
  } finally {
    await closeServer(server);
  }
});

test("[Agent Idempotency] API store claim은 lease 소유권을 판정한다", async () => {
  const result = createSensitiveAgentResult();
  const idempotencyKey = "api-claim-idempotency-key";
  const expectedKeyHash = createHash("sha256").update(idempotencyKey).digest("hex");
  const signatureSecret = "runner-signature-secret";
  const requests: Array<{ method: string; path: string; body: string }> = [];
  const server = createServer(async (request, response) => {
    const body = await readRequestBody(request);
    requests.push({
      method: request.method ?? "",
      path: request.url ?? "",
      body
    });

    assert.equal(request.headers["x-worker-id"], "runner-test-worker");
    assert.equal(request.headers["x-signature"], signatureFor(body, signatureSecret));

    if (request.method === "POST" && request.url === `/internal/runner/agent-idempotency/${expectedKeyHash}/claim`) {
      const payload = JSON.parse(body) as { leaseTtlMs: number };
      assert.equal(payload.leaseTtlMs, 300_000);
      sendJson(response, {
        data: {
          idempotencyKeyHash: expectedKeyHash,
          found: true,
          status: "CLAIMED",
          runId: result.runId,
          taskId: result.trace.task_id,
          attemptId: result.trace.attempt_id,
          attemptIndex: result.trace.attempt_index,
          claimedBy: "runner-test-worker",
          claimedAt: "2026-05-08T10:00:00+09:00",
          leaseExpiresAt: "2026-05-08T10:05:00+09:00",
          result: null,
          completedAt: null
        }
      });
      return;
    }

    response.statusCode = 404;
    response.end();
  });

  await listen(server);

  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const store = createApiAgentIdempotencyStore(createRunnerTestConfig({
      callbackBaseUrl: `http://127.0.0.1:${address.port}`,
      callbackSignatureSecret: signatureSecret,
      callbackTimeoutMs: 1_000
    }));

    const claim = await store.claim?.(idempotencyKey, {
      runId: result.runId,
      taskId: result.trace.task_id,
      attemptId: result.trace.attempt_id,
      attemptIndex: result.trace.attempt_index
    });

    assert.deepEqual(claim, { status: "CLAIMED" });
    assert.equal(requests[0]?.method, "POST");
    assert.equal(requests[0]?.path, `/internal/runner/agent-idempotency/${expectedKeyHash}/claim`);
  } finally {
    await closeServer(server);
  }
});

test("[Agent Idempotency] API store claim은 다른 worker lease를 in-progress로 반환한다", async () => {
  const result = createSensitiveAgentResult();
  const idempotencyKey = "api-claim-busy-idempotency-key";
  const expectedKeyHash = createHash("sha256").update(idempotencyKey).digest("hex");
  const server = createServer(async (request, response) => {
    await readRequestBody(request);

    if (request.method === "POST" && request.url === `/internal/runner/agent-idempotency/${expectedKeyHash}/claim`) {
      sendJson(response, {
        data: {
          idempotencyKeyHash: expectedKeyHash,
          found: true,
          status: "CLAIMED",
          runId: result.runId,
          taskId: result.trace.task_id,
          attemptId: result.trace.attempt_id,
          attemptIndex: result.trace.attempt_index,
          claimedBy: "runner-other",
          leaseExpiresAt: "2026-05-08T10:05:00+09:00"
        }
      });
      return;
    }

    response.statusCode = 404;
    response.end();
  });

  await listen(server);

  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const store = createApiAgentIdempotencyStore(createRunnerTestConfig({
      callbackBaseUrl: `http://127.0.0.1:${address.port}`,
      callbackTimeoutMs: 1_000
    }));

    const claim = await store.claim?.(idempotencyKey, {
      runId: result.runId,
      taskId: result.trace.task_id,
      attemptId: result.trace.attempt_id,
      attemptIndex: result.trace.attempt_index
    });

    assert.deepEqual(claim, {
      status: "IN_PROGRESS",
      claimedBy: "runner-other",
      leaseExpiresAt: "2026-05-08T10:05:00+09:00"
    });
  } finally {
    await closeServer(server);
  }
});

test("[Agent Idempotency] API store는 owned lease를 renew하고 실패 claim을 release한다", async () => {
  const result = createSensitiveAgentResult();
  const idempotencyKey = "api-renew-release-idempotency-key";
  const expectedKeyHash = createHash("sha256").update(idempotencyKey).digest("hex");
  const requests: Array<{ method: string; path: string; body: string }> = [];
  const server = createServer(async (request, response) => {
    const body = await readRequestBody(request);
    requests.push({
      method: request.method ?? "",
      path: request.url ?? "",
      body
    });

    if (request.method === "POST" && request.url === `/internal/runner/agent-idempotency/${expectedKeyHash}/renew`) {
      const payload = JSON.parse(body) as { leaseTtlMs: number };
      assert.equal(payload.leaseTtlMs, 300_000);
      sendJson(response, {
        data: {
          idempotencyKeyHash: expectedKeyHash,
          found: true,
          status: "CLAIMED",
          runId: result.runId,
          taskId: result.trace.task_id,
          attemptId: result.trace.attempt_id,
          attemptIndex: result.trace.attempt_index,
          claimedBy: "runner-test-worker",
          leaseExpiresAt: "2026-05-08T10:07:00+09:00"
        }
      });
      return;
    }

    if (request.method === "POST" && request.url === `/internal/runner/agent-idempotency/${expectedKeyHash}/release`) {
      const payload = JSON.parse(body) as { leaseTtlMs?: number };
      assert.equal(payload.leaseTtlMs, undefined);
      sendJson(response, {
        data: {
          idempotencyKeyHash: expectedKeyHash,
          found: false,
          status: null,
          runId: null,
          taskId: null,
          attemptId: null,
          attemptIndex: null,
          claimedBy: null,
          claimedAt: null,
          leaseExpiresAt: null,
          result: null,
          completedAt: null
        }
      });
      return;
    }

    response.statusCode = 404;
    response.end();
  });

  await listen(server);

  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const store = createApiAgentIdempotencyStore(createRunnerTestConfig({
      callbackBaseUrl: `http://127.0.0.1:${address.port}`,
      callbackTimeoutMs: 1_000
    }));
    const claimInput = {
      runId: result.runId,
      taskId: result.trace.task_id,
      attemptId: result.trace.attempt_id,
      attemptIndex: result.trace.attempt_index
    };

    const renewal = await store.renew?.(idempotencyKey, claimInput);
    await store.release?.(idempotencyKey, claimInput);

    assert.deepEqual(renewal, { status: "CLAIMED" });
    assert.deepEqual(requests.map((request) => request.path), [
      `/internal/runner/agent-idempotency/${expectedKeyHash}/renew`,
      `/internal/runner/agent-idempotency/${expectedKeyHash}/release`
    ]);
  } finally {
    await closeServer(server);
  }
});

function createSensitiveAgentResult(): AgentRunnerExecutionResult {
  return {
    runId: "00000000-0000-4000-8000-000000000905",
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
    },
    trace: {
      schema_version: "0.1",
      task_id: "task-1",
      attempt_id: "attempt-1",
      attempt_index: 1,
      run_id: "run-1",
      outcome: {
        status: "SUCCESS",
        reason: "Checkout reached for mvp.tester@example.com."
      },
      turns: [
        {
          turn: 1,
          observation: {
            finalUrl: "https://example.com/product?email=mvp.tester@example.com&token=raw-secret",
            title: "Account mvp.tester@example.com",
            candidateCount: 1
          },
          preDecisionVerification: {
            satisfied: false,
            terminal: false,
            outcome: "CONTINUE",
            reason: "Continue for mvp.tester@example.com",
            confidence: 0.5,
            phase: "pre_decision"
          },
          decision: {
            kind: "act",
            description: "Click checkout for mvp.tester@example.com",
            reason: "Use token raw-secret",
            confidence: 0.9,
            action: {
              type: "click",
              target: {
                text: "Checkout mvp.tester@example.com",
                url: "https://checkout.example/session?token=raw-secret"
              }
            },
            settleStrategy: {
              type: "fixed_short",
              timeout_ms: 1,
              url_includes: "token=raw-secret"
            },
            stage: "COMMIT",
            targetKey: "link:Checkout mvp.tester@example.com"
          },
          policy: {
            allowed: true,
            riskClass: "LOW",
            reason: "Allowed for mvp.tester@example.com"
          },
          actionResult: {
            actionType: "click",
            finalUrl: "https://checkout.example/session?token=result-secret",
            completed: true
          },
          postActionVerification: {
            satisfied: true,
            terminal: true,
            outcome: "SUCCESS",
            reason: "Reached checkout for mvp.tester@example.com",
            confidence: 0.8,
            phase: "post_action"
          }
        }
      ]
    }
  };
}

function recordResponse(idempotencyKeyHash: string, result: AgentRunnerExecutionResult): Record<string, unknown> {
  return {
    idempotencyKeyHash,
    found: true,
    status: "COMPLETED",
    runId: result.runId,
    taskId: result.trace.task_id,
    attemptId: result.trace.attempt_id,
    attemptIndex: result.trace.attempt_index,
    claimedBy: "runner-test-worker",
    claimedAt: new Date().toISOString(),
    leaseExpiresAt: new Date(Date.now() + 300_000).toISOString(),
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
