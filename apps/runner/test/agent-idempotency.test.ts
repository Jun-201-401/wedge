import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { persistAgentIdempotencyResult, readAgentIdempotencyResult } from "../src/worker/agent-idempotency.ts";
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
