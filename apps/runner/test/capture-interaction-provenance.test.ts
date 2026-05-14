import assert from "node:assert/strict";
import test from "node:test";
import { createCapturePipeline } from "../src/capture/index.ts";
import { createMinimalPlan, createSettledResult, createSimulatedPageSnapshot } from "./support.ts";

test("[capture] form and component observations include interaction provenance and visual prominence", async () => {
  const plan = createMinimalPlan();
  const step = {
    step_id: "step_002_fill_email",
    stage: "INPUT" as const,
    description: "이메일 입력",
    action: {
      type: "fill" as const,
      target: {
        label: "Email"
      },
      value: "test@example.com"
    },
    settle_strategy: {
      type: "none" as const,
      timeout_ms: 0
    },
    checkpoint: true
  };
  const pageSnapshot = createSimulatedPageSnapshot(plan, {
    fields: {
      email: "test@example.com"
    },
    interactiveComponents: [
      {
        text: "Email",
        visible_text: "Email",
        accessible_name: "Email",
        selector: "#email",
        role: "textbox",
        input_type: "email",
        label_text: "Email",
        placeholder: "you@example.com",
        name: "email",
        tag: "input",
        clickable: false,
        clicked_in_scenario: false,
        typed_in_scenario: true,
        filled_in_scenario: true,
        selected_in_scenario: false,
        interaction_order: null,
        is_cta_candidate: false,
        is_primary_like: false,
        visual_prominence: {
          score: 12_100,
          rank: 2,
          area_px: 12_000,
          above_fold: true,
          primary_like: false
        },
        is_form_control: true,
        required: true,
        bounds: {
          x: 100,
          y: 200,
          width: 300,
          height: 40,
          unit: "css_px"
        },
        visibility: {
          visible: true,
          in_viewport: true,
          above_fold: true,
          area_px: 12_000,
          viewport_coverage_ratio: 1
        }
      }
    ]
  });

  const collection = await createCapturePipeline().collectCheckpoint({
    step,
    stepOrder: 2,
    plan,
    pageSnapshot,
    settleResult: createSettledResult()
  });

  const formField = collection.checkpoint.observations.find((candidate) => candidate.type === "form_field");
  const interactive = collection.checkpoint.observations.find((candidate) => candidate.type === "interactive_components");
  const components = interactive?.components as Array<Record<string, unknown>> | undefined;

  assert.ok(formField);
  assert.equal(formField.typed_in_scenario, true);
  assert.equal(formField.filled_in_scenario, true);
  assert.equal(formField.interaction_order, 2);
  assert.deepEqual(formField.visual_prominence, pageSnapshot.interactiveComponents[0].visual_prominence);
  assert.ok(components);
  assert.equal(components[0].filled_in_scenario, true);
  assert.equal(components[0].interaction_order, 2);
});
