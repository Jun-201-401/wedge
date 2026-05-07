import assert from "node:assert/strict";
import test from "node:test";
import { createAgentEventBatch } from "../src/agent/callbacks.ts";
import { redactSensitiveValue } from "../src/agent/redaction.ts";
import { createAgentTraceArtifact, type AgentTrace } from "../src/agent/trace.ts";
import { createAgentScenarioPlanExportArtifact, exportAgentTraceToScenarioPlan } from "../src/agent/trace-export.ts";
import { cloneAgentMessage, loadAgentExampleMessage } from "./support.ts";

test("[Agent Redaction] TRACE artifact는 decision/URL의 민감값을 저장 전에 마스킹한다", () => {
  const trace = createSensitiveTrace();
  const artifact = createAgentTraceArtifact(trace);

  assertRedacted(artifact.content);
  assert.match(artifact.content, /REDACTED_EMAIL/);
  assert.match(artifact.content, /REDACTED_PHONE/);
  assert.match(artifact.content, /REDACTED_CARD/);
  assert.match(artifact.content, /REDACTED_SECRET/);
});

test("[Agent Redaction] ScenarioPlan export는 실행 필드에 redaction이 필요하면 NOT_EXPORTABLE로 남긴다", async () => {
  const message = cloneAgentMessage(await loadAgentExampleMessage());
  const task = message.payload.agentTask;
  task.start_url = "https://example.com/product?email=mvp.tester@example.com&token=start-secret";
  task.goal = "Checkout for mvp.tester@example.com";

  const exportResult = exportAgentTraceToScenarioPlan({
    task,
    trace: createSensitiveTrace(),
    exportedAt: "2026-05-07T00:00:00.000Z"
  });
  const artifact = createAgentScenarioPlanExportArtifact(exportResult);

  assert.equal(exportResult.status, "NOT_EXPORTABLE");
  assert.equal(exportResult.scenario_plan, undefined);
  assertRedacted(artifact.content);
  assert.doesNotMatch(artifact.content, /"scenario_plan"/);
  assert.match(artifact.content, /sensitive replay fields/);
});

test("[Agent Redaction] agent event payload는 callback batch 생성 시 마스킹한다", async () => {
  const message = cloneAgentMessage(await loadAgentExampleMessage());
  const task = message.payload.agentTask;
  const batch = createAgentEventBatch({
    task,
    eventType: "ACTION_COMPLETED",
    payload: {
      finalUrl: "https://checkout.example/session?email=mvp.tester@example.com&token=event-secret",
      decisionReason: "Call 010-1234-5678 with card 4242 4242 4242 4242.",
      nested: {
        token: "object-secret-token"
      }
    },
    turn: 1
  });

  const content = JSON.stringify(batch);
  assertRedacted(content);
  assert.doesNotMatch(content, /object-secret-token/);
  assert.match(content, /REDACTED_SECRET/);
});

test("[Agent Redaction] plain token object key도 민감값으로 마스킹한다", () => {
  const redacted = redactSensitiveValue({
    token: "object-secret-token",
    access_token: "access-secret-token"
  });

  assert.deepEqual(redacted, {
    token: "[REDACTED_SECRET]",
    access_token: "[REDACTED_SECRET]"
  });
});

function createSensitiveTrace(): AgentTrace {
  return {
    schema_version: "0.1",
    task_id: "task-1",
    attempt_id: "attempt-1",
    run_id: "run-1",
    turns: [
      {
        turn: 1,
        observation: {
          finalUrl: "https://example.com/product?email=mvp.tester@example.com&token=raw-token",
          title: "Account 010-1234-5678",
          candidateCount: 1
        },
        preDecisionVerification: {
          satisfied: false,
          terminal: false,
          outcome: "CONTINUE",
          reason: "mvp.tester@example.com can continue",
          confidence: 0.5,
          phase: "pre_decision"
        },
        decision: {
          kind: "act",
          description: "Click checkout for 010-1234-5678",
          reason: "Card 4242 4242 4242 4242 should never be persisted.",
          confidence: 0.9,
          action: {
            type: "click",
            target: {
              selector: "#checkout",
              text: "Checkout mvp.tester@example.com",
              url: "https://checkout.example/session?token=checkout-secret&email=mvp.tester@example.com"
            }
          },
          settleStrategy: {
            type: "fixed_short",
            timeout_ms: 500,
            url_includes: "token=checkout-secret"
          },
          stage: "COMMIT",
          targetKey: "#checkout"
        },
        policy: {
          allowed: true,
          riskClass: "LOW",
          reason: "No sensitive policy block for mvp.tester@example.com."
        },
        actionResult: {
          actionType: "click",
          finalUrl: "https://checkout.example/session?phone=01012345678&token=result-secret",
          completed: true
        },
        postActionVerification: {
          satisfied: true,
          terminal: true,
          outcome: "SUCCESS",
          reason: "Reached checkout for 010-1234-5678.",
          confidence: 0.8,
          phase: "post_action"
        }
      }
    ],
    outcome: {
      status: "SUCCESS",
      reason: "Checkout reached for mvp.tester@example.com."
    }
  };
}

function assertRedacted(content: string): void {
  assert.doesNotMatch(content, /mvp\.tester@example\.com/);
  assert.doesNotMatch(content, /010-?1234-?5678/);
  assert.doesNotMatch(content, /4242 4242 4242 4242/);
  assert.doesNotMatch(content, /raw-token|checkout-secret|result-secret|start-secret/);
}
