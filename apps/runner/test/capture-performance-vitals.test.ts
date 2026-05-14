import assert from "node:assert/strict";
import test from "node:test";
import { createCapturePipeline } from "../src/capture/index.ts";
import { createMinimalPlan, createSettledResult, createSimulatedPageSnapshot } from "./support.ts";

test("[capture] performance capture emits Web Vitals JSON artifact and metric observation", async () => {
  const plan = {
    ...createMinimalPlan(),
    artifact_policy: {
      capture_performance: true
    }
  };
  const step = {
    step_id: "step_001_perf",
    stage: "FIRST_VIEW" as const,
    description: "성능 메트릭 수집",
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
    performanceSummary: {
      navigation_type: "navigate",
      time_origin: 1_700_000_000_000,
      dom_content_loaded_ms: 240,
      load_event_ms: 480,
      first_contentful_paint_ms: 310,
      largest_contentful_paint_ms: 720,
      cumulative_layout_shift: 0.03,
      interaction_to_next_paint_ms: 44,
      render_blocking_resource_count: 2,
      long_task_count: 1,
      web_vitals_source: "simulated",
      resource_count: 6,
      transfer_size_bytes: 1_024,
      encoded_body_size_bytes: 900,
      decoded_body_size_bytes: 1_800
    }
  });

  const collection = await createCapturePipeline().collectCheckpoint({
    step,
    stepOrder: 1,
    plan,
    pageSnapshot,
    settleResult: createSettledResult()
  });

  const performanceArtifact = collection.artifacts.find((artifact) => artifact.fileExtension === "web-vitals.json");
  const observation = collection.checkpoint.observations.find((candidate) => candidate.type === "performance_metric");

  assert.ok(performanceArtifact);
  assert.equal(performanceArtifact.artifactType, "OTHER");
  assert.ok(performanceArtifact.content.includes("\"largest_contentful_paint_ms\": 720"));
  assert.ok(observation);
  assert.equal(observation.web_vitals_artifact_id, performanceArtifact.artifactId);
  assert.deepEqual(observation.summary, pageSnapshot.performanceSummary);
});
