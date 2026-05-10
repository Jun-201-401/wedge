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
  assert.deepEqual(result.plan.steps.map((step) => step.action.type), ["click"]);
  assert.equal(result.skippedUnsafeActionCount, 0);

  await assertReplaySucceeds(result.plan);
});

test("[Agent Export] 정책 차단/unsafe action은 replay plan에서 제외한다", async () => {
  const message = await loadAgentExampleMessage();
  const task = message.payload.agentTask;
  const trace = JSON.parse(
    await readFile(resolve(repoRoot, "packages/contracts/examples/sample-agent-trace-checkout-entry.json"), "utf8")
  ) as AgentTrace;

  const safeDecision = trace.decisions[0] as Record<string, any>;
  trace.decisions.push({
    ...safeDecision,
    decision_id: "unsafe-decision-1",
    action: {
      tool: "click",
      target_key: "#pay-now",
      target: {
        selector: "#pay-now",
        text: "결제 완료"
      },
      value: null,
      options: {}
    },
    reason: "unsafe final payment action"
  });
  trace.events.push({
    schema_version: "0.1",
    event_id: "evt-unsafe-completed",
    task_id: trace.task_id,
    attempt_id: trace.attempt_id,
    run_id: trace.run_id,
    step_index: 2,
    event_type: "AGENT_ACTION_COMPLETED",
    occurred_at: "2026-05-06T00:00:05.000Z",
    payload: {
      decision_id: "unsafe-decision-1"
    }
  });

  const result = exportAgentTraceToScenarioPlan({ task, trace });

  assert.ok(result);
  assert.deepEqual(result.plan.steps.map((step) => step.action.target), [{ selector: "#checkout" }]);
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
  assert.equal(result.summary.completedStepCount, 1);
}
