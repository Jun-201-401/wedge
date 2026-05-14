import assert from "node:assert/strict";
import test from "node:test";
import { createCapturePipeline } from "../src/capture/index.ts";
import { createMinimalPlan, createSettledResult, createSimulatedPageSnapshot } from "./support.ts";

test("[capture] keyboard focus state observation preserves focus order and modal trap candidates", async () => {
  const plan = createMinimalPlan();
  const step = {
    step_id: "step_003_modal",
    stage: "CTA" as const,
    description: "모달 포커스 확인",
    action: {
      type: "click" as const,
      target: {
        selector: "#open-modal"
      }
    },
    settle_strategy: {
      type: "none" as const,
      timeout_ms: 0
    },
    checkpoint: true
  };
  const pageSnapshot = createSimulatedPageSnapshot(plan, {
    keyboardFocusState: {
      sampled: true,
      tab_stop_count: 2,
      modal_open: true,
      keyboard_trap_candidate: true,
      reason: "repeated_focus:#close",
      focus_order: [
        {
          order: 1,
          selector: "#close",
          text: "닫기",
          role: "button",
          visible_focus: true,
          inside_modal: true,
          bounds: {
            x: 480,
            y: 200,
            width: 80,
            height: 40,
            unit: "css_px"
          }
        },
        {
          order: 2,
          selector: "#confirm",
          text: "확인",
          role: "button",
          visible_focus: true,
          inside_modal: true,
          bounds: {
            x: 580,
            y: 200,
            width: 80,
            height: 40,
            unit: "css_px"
          }
        }
      ]
    }
  });

  const collection = await createCapturePipeline().collectCheckpoint({
    step,
    stepOrder: 3,
    plan,
    pageSnapshot,
    settleResult: createSettledResult()
  });

  const observation = collection.checkpoint.observations.find((candidate) => candidate.type === "keyboard_focus_state");
  const stateFocus = collection.checkpoint.state.keyboard_focus_state as {
    keyboard_trap_candidate: boolean;
  };
  const observedFocus = observation?.focus_state as {
    modal_open: boolean;
    focus_order: Array<{
      visible_focus: boolean;
    }>;
  } | undefined;

  assert.ok(observation);
  assert.ok(observedFocus);
  assert.equal(stateFocus.keyboard_trap_candidate, true);
  assert.equal(observedFocus.modal_open, true);
  assert.equal(observedFocus.focus_order.length, 2);
  assert.equal(observedFocus.focus_order[0].visible_focus, true);
});
