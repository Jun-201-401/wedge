import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { exportAgentTraceToScenarioPlan } from "../src/agent/export-plan.ts";
import { executeScenario } from "../src/scenario/executor/index.ts";
import type { AgentTrace, ScenarioPlan } from "../src/shared/contracts.ts";
import {
  createSettledResult,
  createSimulatedPageSnapshot,
  createSimulatedSession,
  createStubCallbackClient,
  loadAgentExampleMessage
} from "./support.ts";

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(currentDir, "../../..");

test("[Agent Export] 성공 AgentTrace를 replay 가능한 ScenarioPlan으로 변환한다", async () => {
  const message = await loadAgentExampleMessage();
  const task = message.payload.agentTask;
  const trace = JSON.parse(
    await readFile(resolve(repoRoot, "packages/contracts/examples/sample-agent-trace-checkout-entry.json"), "utf8")
  ) as AgentTrace;

  const result = exportAgentTraceToScenarioPlan({ task, trace });

  assert.ok(result);
  assert.equal(result.plan.schema_version, "0.5");
  assert.equal(result.plan.scenario_type, "custom_compiled");
  assert.equal(result.plan.start_url, task.start_url);
  assert.equal(result.plan.safety.allow_payment_commit, false);
  assert.equal(result.plan.safety.stop_before_real_payment, true);
  assert.deepEqual(result.plan.steps.map((step) => step.action.type), ["goto", "click"]);
  assert.equal(result.skippedUnsafeActionCount, 0);

  await assertReplaySucceeds(result.plan);
});

test("[Agent Export] 정책 차단/unsafe action은 replay plan에서 제외한다", async () => {
  const message = await loadAgentExampleMessage();
  const task = message.payload.agentTask;
  const trace = JSON.parse(
    await readFile(resolve(repoRoot, "packages/contracts/examples/sample-agent-trace-checkout-entry.json"), "utf8")
  ) as AgentTrace;

  const safeTurn = trace.turns[1] as Record<string, any>;
  trace.turns.push({
    ...safeTurn,
    turn: 3,
    decision: {
      ...safeTurn.decision,
      action: {
        type: "click",
        targetKey: "#pay-now",
        target: {
          selector: "#pay-now",
          text: "결제 완료"
        },
        options: {}
      },
      reason: "unsafe final payment action"
    },
    actionResult: {
      actionType: "click",
      finalUrl: "https://example.com/checkout/payment",
      completed: true
    }
  });

  const result = exportAgentTraceToScenarioPlan({ task, trace });

  assert.ok(result);
  assert.deepEqual(result.plan.steps.map((step) => step.action.target), [
    { url: task.start_url },
    {
      selector: "#add-to-cart",
      role: "button",
      text: "Add to cart"
    }
  ]);
  assert.equal(result.skippedUnsafeActionCount, 1);
});

async function assertReplaySucceeds(plan: ScenarioPlan): Promise<void> {
  const session = createSimulatedSession(plan, {
    execute: async (action) => ({
      actionType: action.type,
      targetSummary: null,
      stopRequested: false,
      details: {}
    }),
    settle: async () => createSettledResult(),
    snapshot: () => createSimulatedPageSnapshot(plan),
    close: async () => {}
  });

  const result = await executeScenario({
    runId: "replay-run-1",
    plan,
    session,
    callbackClient: createStubCallbackClient(),
    capturePipeline: {
      collectCheckpoint: async () => ({
        checkpoint: {
          checkpointId: "checkpoint-1",
          stepKey: "agent_replay_001",
          stage: "CTA",
          trigger: {},
          settle: {
            strategy: "fixed_short",
            durationMs: 1,
            status: "settled"
          },
          state: {},
          observations: [],
          deltas: []
        },
        artifacts: []
      })
    },
    artifactStore: {
      persistArtifacts: async () => []
    }
  });

  assert.equal(result.summary.failedStepCount, 0);
  assert.equal(result.summary.completedStepCount, plan.steps.length);
}
