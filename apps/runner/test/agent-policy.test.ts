import assert from "node:assert/strict";
import test from "node:test";
import { evaluateAgentPolicy } from "../src/agent/policy.ts";
import type { AgentDecision } from "../src/agent/planner.ts";
import { cloneAgentMessage, loadAgentExampleMessage } from "./support.ts";

test("[Agent Policy] checkout navigation은 정책이 허용하면 통과한다", async () => {
  const message = cloneAgentMessage(await loadAgentExampleMessage());
  const task = message.payload.agentTask;
  const result = evaluateAgentPolicy({
    task,
    currentUrl: task.start_url,
    decision: createClickDecision("Checkout", "#checkout")
  });

  assert.equal(result.riskClass, "CHECKOUT_NAVIGATION");
  assert.equal(result.decision, "ALLOW");
  assert.equal(result.finalOutcome, null);
});

test("[Agent Policy] final payment submit은 기본 정책에서 차단한다", async () => {
  const message = cloneAgentMessage(await loadAgentExampleMessage());
  const task = message.payload.agentTask;
  const result = evaluateAgentPolicy({
    task,
    currentUrl: task.start_url,
    decision: createClickDecision("결제 완료", "#pay-now")
  });

  assert.equal(result.riskClass, "FINAL_PAYMENT_SUBMIT");
  assert.equal(result.decision, "BLOCK");
  assert.equal(result.finalOutcome, "POLICY_BLOCKED_FINAL_PAYMENT_SUBMIT");
});

test("[Agent Policy] 허용되지 않은 외부 navigation은 차단한다", async () => {
  const message = cloneAgentMessage(await loadAgentExampleMessage());
  const task = message.payload.agentTask;
  const result = evaluateAgentPolicy({
    task,
    currentUrl: task.start_url,
    decision: {
      kind: "act",
      description: "Open external URL",
      reason: "test external navigation",
      confidence: 1,
      action: {
        type: "goto",
        target: {
          url: "https://evil.example/checkout"
        }
      },
      settleStrategy: {
        type: "network_idle",
        timeout_ms: 100
      },
      stage: "FIRST_VIEW",
      targetKey: "https://evil.example/checkout"
    }
  });

  assert.equal(result.riskClass, "UNKNOWN_HIGH_RISK");
  assert.equal(result.decision, "BLOCK");
  assert.equal(result.finalOutcome, "POLICY_BLOCKED_EXTERNAL_NAVIGATION");
});

function createClickDecision(text: string, selector: string): AgentDecision {
  return {
    kind: "act",
    description: `Click ${text}`,
    reason: "test decision",
    confidence: 0.9,
    action: {
      type: "click",
      target: {
        text,
        selector
      }
    },
    settleStrategy: {
      type: "fixed_short",
      timeout_ms: 100
    },
    stage: "CTA",
    targetKey: selector
  };
}
