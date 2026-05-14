import assert from "node:assert/strict";
import test from "node:test";
import { createCapturePipeline } from "../src/capture/index.ts";
import { createMinimalPlan, createSettledResult, createSimulatedPageSnapshot } from "./support.ts";

test("[capture] text_block_metrics observation preserves static copy layout metrics", async () => {
  const plan = createMinimalPlan();
  const step = {
    step_id: "step_001_first_view",
    stage: "FIRST_VIEW" as const,
    description: "첫 화면 확인",
    action: {
      type: "checkpoint" as const
    },
    settle_strategy: {
      type: "none" as const,
      timeout_ms: 0
    },
    checkpoint: true
  };
  const pageSnapshot = createSimulatedPageSnapshot(plan, {
    visibleTextBlocks: [
      {
        text: "팀을 위한 명확한 온보딩",
        tag: "h1",
        role: "heading",
        is_heading: true,
        line_count: 2,
        line_width_px: 280,
        block_width_px: 560,
        font_size_px: 32,
        line_height_px: 40,
        text_align: "center",
        nearby_cta_ref: {
          text: "무료로 시작하기",
          selector: "#start",
          distance_px: 24
        },
        cta_distance_px: 24,
        mobile_line_break_segments: ["팀을 위한", "명확한 온보딩"],
        bounds: {
          x: 100,
          y: 80,
          width: 560,
          height: 80,
          unit: "css_px"
        },
        visibility: {
          visible: true,
          in_viewport: true,
          above_fold: true,
          area_px: 44_800,
          viewport_coverage_ratio: 1
        }
      }
    ]
  });

  const collection = await createCapturePipeline().collectCheckpoint({
    step,
    stepOrder: 1,
    plan,
    pageSnapshot,
    settleResult: createSettledResult()
  });

  const observation = collection.checkpoint.observations.find((candidate) => candidate.type === "text_block_metrics");
  const blocks = observation?.blocks as Array<Record<string, unknown>> | undefined;

  assert.ok(observation);
  assert.equal(observation.stage, "FIRST_VIEW");
  assert.deepEqual(observation.viewport, plan.environment.viewport);
  assert.ok(blocks);
  assert.equal(blocks[0].line_count, 2);
  assert.equal(blocks[0].font_size_px, 32);
  assert.deepEqual(blocks[0].nearby_cta_ref, pageSnapshot.visibleTextBlocks[0].nearby_cta_ref);
  assert.deepEqual(blocks[0].mobile_line_break_segments, ["팀을 위한", "명확한 온보딩"]);
});
