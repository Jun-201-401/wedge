import assert from "node:assert/strict";
import test from "node:test";
import { createCheckpointRequest } from "../src/scenario/executor/checkpoint-payloads.ts";
import type { Artifact, Checkpoint } from "../src/shared/contracts.ts";

test("[checkpoint payload] Runner evidence fields survive checkpoint callback packaging", () => {
  const checkpoint: Omit<Checkpoint, "artifactRefs"> = {
    checkpointId: "checkpoint-evidence-preservation",
    stepKey: "step_001_submit",
    stage: "COMMIT",
    trigger: {
      stepOrder: 1,
      actionType: "click",
      description: "주문 제출"
    },
    settle: {
      strategy: "network_idle",
      durationMs: 314,
      status: "settled"
    },
    state: {
      flow_step_count: 3,
      repeated_generic_link_grouping: [
        {
          link_text: "Learn more",
          occurrence_count: 2,
          container_heading: "Plans",
          nearby_text: ["Starter", "Pro"],
          selectors: ["#starter a", "#pro a"]
        }
      ],
      checkout_context: {
        flow_subtype: "payment",
        final_submit_relation: {
          related: true,
          relation_type: "same_form",
          summary_selector: "#summary",
          submit_selector: "#pay"
        }
      }
    },
    observations: [
      {
        observation_id: "step_001_submit.obs_form_field",
        type: "form_field",
        stage: "INPUT",
        source: ["dom"],
        field_key: "email",
        visible_required_marker: "*",
        visible_optional_marker: null,
        group_level_required_state: "required",
        submit_required_error: "이메일을 입력하세요",
        input_format_hint: "type: email"
      },
      {
        observation_id: "step_001_submit.obs_accordion_state",
        type: "accordion_state",
        stage: "VALUE",
        source: ["dom"],
        accordions: [
          {
            trigger_text: "배송 정보",
            panel_selector: "#shipping",
            panel_relationship: "aria_controls",
            expanded: false,
            hidden_panel_has_required_info: true
          }
        ]
      }
    ],
    deltas: [
      {
        type: "last_action",
        action: "click",
        target: "#pay"
      }
    ]
  };
  const artifacts: Artifact[] = [
    {
      artifactId: "artifact-screenshot",
      artifactType: "SCREENSHOT",
      bucket: "runner",
      key: "runs/run_001/artifact-screenshot.png",
      mimeType: "image/png",
      sizeBytes: 128,
      sha256: "sha256",
      createdAt: "2026-05-14T00:00:00.000Z",
      stepKey: "step_001_submit"
    }
  ];

  const request = createCheckpointRequest(checkpoint, artifacts);
  const packaged = request.checkpoints[0];

  assert.deepEqual(packaged.state.repeated_generic_link_grouping, checkpoint.state.repeated_generic_link_grouping);
  assert.deepEqual(packaged.state.checkout_context, checkpoint.state.checkout_context);
  assert.equal(packaged.observations[0].visible_required_marker, "*");
  assert.equal(packaged.observations[0].submit_required_error, "이메일을 입력하세요");
  assert.equal((packaged.observations[1].accordions as Record<string, unknown>[])[0].hidden_panel_has_required_info, true);
  assert.deepEqual(packaged.artifactRefs, ["artifact-screenshot"]);
});
