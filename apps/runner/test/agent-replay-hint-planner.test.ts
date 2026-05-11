import assert from "node:assert/strict";
import test from "node:test";
import { replayHintAgentPlanner } from "../src/agent/replay-hint-planner.ts";
import { createInitialAgentState } from "../src/agent/state.ts";
import { createMinimalPlan, createSimulatedPageSnapshot } from "./support.ts";

test("[Agent Planner] non-goto replay hint는 bootstrap 이후 먼저 시도한다", () => {
  const plan = createMinimalPlan();
  const observation = {
    snapshot: createSimulatedPageSnapshot(plan, {
      interactiveComponents: [
        {
          text: "Fallback CTA",
          selector: "#fallback",
          role: "button",
          tag: "button",
          clickable: true,
          clicked_in_scenario: false,
          is_cta_candidate: true,
          is_primary_like: true,
          bounds: {
            x: 1,
            y: 1,
            width: 100,
            height: 40,
            unit: "css_px"
          }
        }
      ]
    })
  };
  const state = createInitialAgentState();
  const replayHints = {
    source_plan_id: "agent-trace-replay-1",
    steps: [
      {
        description: "Use prior checkout CTA",
        action: {
          type: "click" as const,
          target: {
            selector: "#hinted-checkout"
          }
        },
        target_key: "#hinted-checkout",
        confidence: 0.91
      }
    ]
  };

  const bootstrapDecision = replayHintAgentPlanner.decideNextAction({
    runId: "run-replay-hint-test",
    goal: "checkout entry",
    startUrl: plan.start_url,
    state,
    observation,
    maxScrolls: 1,
    replayHints
  });
  assert.equal(bootstrapDecision.action.type, "goto");

  state.started = true;
  state.turns.push({
    turn: 1,
    actionType: "goto",
    targetKey: plan.start_url,
    finalUrl: plan.start_url,
    goalSatisfied: false
  });

  const replayDecision = replayHintAgentPlanner.decideNextAction({
    runId: "run-replay-hint-test",
    goal: "checkout entry",
    startUrl: plan.start_url,
    state,
    observation,
    maxScrolls: 1,
    replayHints
  });

  assert.equal(replayDecision.action.type, "click");
  assert.deepEqual(replayDecision.action.target, { selector: "#hinted-checkout" });
  assert.equal(replayDecision.targetKey, "#hinted-checkout");
  assert.equal(replayDecision.confidence, 0.91);
  assert.equal(replayDecision.settleStrategy.type, "fixed_short");
  assert.match(replayDecision.reason, /Replay hint/);
  assert.equal(replayDecision.metadata?.decisionSource, "replay_hint");
});

test("[Agent Planner] replay hint가 소진되면 rule-based planner로 fallback한다", () => {
  const plan = createMinimalPlan();
  const state = createInitialAgentState();
  state.started = true;
  state.turns.push({
    turn: 1,
    actionType: "goto",
    targetKey: plan.start_url,
    finalUrl: plan.start_url,
    goalSatisfied: false
  });
  state.turns.push({
    turn: 2,
    actionType: "click",
    targetKey: "#hinted-checkout",
    finalUrl: plan.start_url,
    goalSatisfied: false
  });

  const decision = replayHintAgentPlanner.decideNextAction({
    runId: "run-replay-hint-test",
    goal: "checkout entry",
    startUrl: plan.start_url,
    state,
    observation: {
      snapshot: createSimulatedPageSnapshot(plan, {
        interactiveComponents: [
          {
            text: "Fallback CTA",
            selector: "#fallback",
            role: "button",
            tag: "button",
            clickable: true,
            clicked_in_scenario: false,
            is_cta_candidate: true,
            is_primary_like: true,
            bounds: {
              x: 1,
              y: 1,
              width: 100,
              height: 40,
              unit: "css_px"
            }
          }
        ]
      })
    },
    maxScrolls: 1,
    replayHints: {
      steps: [
        {
          action: {
            type: "click",
            target: {
              selector: "#hinted-checkout"
            }
          },
          target_key: "#hinted-checkout"
        }
      ]
    }
  });

  assert.equal(decision.action.type, "click");
  assert.deepEqual(decision.action.target, {
    selector: "#fallback",
    role: "button",
    text: "Fallback CTA"
  });
});
