import assert from "node:assert/strict";
import test from "node:test";
import { exportAgentTraceToScenarioPlan } from "../src/agent/trace-export.ts";
import { parseRunExecuteMessage } from "../src/messaging/index.ts";
import type { AgentTrace } from "../src/agent/trace.ts";
import { loadAgentExampleMessage } from "./support.ts";

test("[Agent Trace Export] 성공한 checkout trace를 payment 직전 stop이 포함된 ScenarioPlan 후보로 변환한다", async () => {
  const message = await loadAgentExampleMessage();
  const task = message.payload.agentTask;
  const trace: AgentTrace = {
    schema_version: "0.1",
    task_id: task.task_id,
    attempt_id: task.attempt_id,
    run_id: task.run_id,
    outcome: {
      status: "SUCCESS",
      reason: "Checkout entry reached before payment commit."
    },
    turns: [
      {
        turn: 1,
        observation: {
          finalUrl: task.start_url,
          title: "Product",
          candidateCount: 0
        },
        preDecisionVerification: continueVerification("pre_decision"),
        decision: {
          kind: "act",
          description: "Open product page",
          reason: "start",
          confidence: 1,
          action: {
            type: "goto",
            target: {
              url: task.start_url
            }
          },
          settleStrategy: {
            type: "network_idle",
            timeout_ms: 1000
          },
          stage: "FIRST_VIEW",
          targetKey: task.start_url
        },
        policy: {
          allowed: true,
          riskClass: "LOW",
          reason: "allowed"
        },
        actionResult: {
          actionType: "goto",
          finalUrl: task.start_url,
          completed: true
        },
        postActionVerification: continueVerification("post_action")
      },
      {
        turn: 2,
        observation: {
          finalUrl: task.start_url,
          title: "Product",
          candidateCount: 1
        },
        preDecisionVerification: continueVerification("pre_decision"),
        decision: {
          kind: "act",
          description: "Click checkout CTA",
          reason: "checkout visible",
          confidence: 0.9,
          action: {
            type: "click",
            target: {
              selector: "#checkout",
              text: "Checkout",
              url: "https://example.com/checkout"
            }
          },
          settleStrategy: {
            type: "fixed_short",
            timeout_ms: 500
          },
          stage: "COMMIT",
          targetKey: "#checkout",
          replayHint: {
            candidate_fingerprint: "candidate:checkout1234abcd",
            locator_recipe: [
              {
                strategy: "selector",
                selector: "#checkout",
                confidence: 0.9
              },
              {
                strategy: "role_text",
                role: "link",
                text: "Checkout",
                confidence: 0.78
              }
            ]
          }
        },
        policy: {
          allowed: true,
          riskClass: "CHECKOUT_NAVIGATION",
          reason: "checkout allowed"
        },
        actionResult: {
          actionType: "click",
          finalUrl: "https://example.com/checkout",
          completed: true
        },
        postActionVerification: {
          satisfied: true,
          terminal: true,
          outcome: "SUCCESS",
          reason: "checkout reached",
          confidence: 0.8,
          phase: "post_action"
        }
      }
    ]
  };

  const result = exportAgentTraceToScenarioPlan({ task, trace, exportedAt: "2026-05-07T00:00:00.000Z" });

  assert.equal(result.status, "EXPORTED");
  assert.equal(result.scenario_plan?.scenario_type, "custom_compiled");
  assert.equal(result.scenario_plan?.goal, task.goal);
  assert.equal(result.scenario_plan?.safety.allow_payment_commit, false);
  assert.equal(result.scenario_plan?.steps.length, 4);
  assert.equal(result.scenario_plan?.steps[0].action.type, "goto");
  assert.equal(result.scenario_plan?.steps[1].action.type, "click");
  assert.deepEqual(result.scenario_plan?.steps[1].action.options?.replay_hint, {
    candidate_fingerprint: "candidate:checkout1234abcd",
    locator_recipe: [
      {
        strategy: "selector",
        selector: "#checkout",
        confidence: 0.9
      },
      {
        strategy: "role_text",
        role: "link",
        text: "Checkout",
        confidence: 0.78
      }
    ]
  });
  assert.equal(result.scenario_plan?.steps[1].checkpoint, true);
  assert.equal(result.scenario_plan?.steps[2].action.type, "checkpoint");
  assert.equal(result.scenario_plan?.steps[2].checkpoint, true);
  assert.equal(result.scenario_plan?.steps[3].action.type, "stop_when");
  assert.deepEqual(result.scenario_plan?.steps[3].stop_condition, {
    url_includes: "https://example.com/checkout"
  });
  assert.doesNotThrow(() => parseRunExecuteMessage(JSON.stringify({
    messageId: "00000000-0000-4000-8000-000000000950",
    messageType: "run.execute.request",
    schemaVersion: "0.1",
    createdAt: "2026-05-07T00:00:00.000Z",
    producer: "runner-agent-export-test",
    payload: {
      runId: task.run_id,
      projectId: task.project_id,
      startUrl: task.start_url,
      goal: task.goal,
      devicePreset: task.environment.device,
      scenarioTemplateVersionId: "agent-export-candidate",
      scenarioPlan: result.scenario_plan
    }
  })));
});

test("[Agent Trace Export] login/CAPTCHA 등 BLOCKED trace는 ScenarioPlan 후보로 만들지 않는다", async () => {
  const message = await loadAgentExampleMessage();
  const task = message.payload.agentTask;
  const trace: AgentTrace = {
    schema_version: "0.1",
    task_id: task.task_id,
    attempt_id: task.attempt_id,
    run_id: task.run_id,
    outcome: {
      status: "BLOCKED",
      reason: "The current page appears to require login before the agent can continue."
    },
    turns: [
      {
        turn: 1,
        observation: {
          finalUrl: "https://example.com/login",
          title: "Login",
          candidateCount: 0
        },
        preDecisionVerification: {
          satisfied: false,
          terminal: true,
          outcome: "BLOCKED_LOGIN",
          reason: "login required",
          confidence: 0.75,
          phase: "pre_decision"
        }
      }
    ]
  };

  const result = exportAgentTraceToScenarioPlan({ task, trace });

  assert.equal(result.status, "NOT_EXPORTABLE");
  assert.equal(result.scenario_plan, undefined);
  assert.match(result.reason, /Only successful AgentTrace/);
});

function continueVerification(phase: "pre_decision" | "post_action") {
  return {
    satisfied: false,
    terminal: false,
    outcome: "CONTINUE" as const,
    reason: "continue",
    confidence: 0.5,
    phase
  };
}
