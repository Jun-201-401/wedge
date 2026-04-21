import assert from "node:assert/strict";
import test from "node:test";
import type { BrowserPageSnapshot, BrowserSettleResult } from "../src/browser/playwright/index.ts";
import { createCapturePipeline } from "../src/capture/index.ts";
import { createArtifactBatch, createCheckpointRequest } from "../src/scenario/executor/checkpoint-payloads.ts";
import { executeScenarioStep } from "../src/scenario/executor/step-executor.ts";
import {
  createMinimalPlan,
  createSettledResult,
  createSimulatedPageSnapshot,
  createSimulatedSession,
  createStubCallbackClient
} from "./support.ts";
import type { Artifact, ArtifactDraft, Checkpoint, ScenarioStep } from "../src/shared/contracts.ts";

test("executeScenarioStep emits artifacts before checkpoints for checkpoint steps", async () => {
  const events: string[] = [];
  const plan = createMinimalPlan();
  const step: ScenarioStep = {
    step_id: "step_001_checkpoint",
    stage: "INPUT",
    description: "checkpoint ordering",
    action: {
      type: "fill",
      target: {
        label: "Email"
      },
      value: "test@example.com"
    },
    settle_strategy: {
      type: "fixed_short",
      timeout_ms: 1
    },
    checkpoint: true
  };
  const pageSnapshot: BrowserPageSnapshot = createSimulatedPageSnapshot(plan);
  const settleResult: BrowserSettleResult = createSettledResult({
    strategy: "fixed_short",
    durationMs: 1
  });
  const checkpointSettle: Checkpoint["settle"] = {
    strategy: settleResult.strategy,
    durationMs: settleResult.durationMs,
    status: settleResult.status
  };
  const artifactDrafts: ArtifactDraft[] = [
    {
      artifactId: "artifact-1",
      artifactType: "SCREENSHOT",
      stepKey: step.step_id,
      mimeType: "text/plain",
      fileExtension: "txt",
      content: "hello"
    }
  ];

  await executeScenarioStep({
    runId: "run-1",
    stepOrder: 1,
    step,
    plan,
    session: createSimulatedSession(plan, {
      execute: async () => ({
        actionType: step.action.type,
        targetSummary: "label=Email",
        stopRequested: false,
        details: {
          value: "test@example.com"
        }
      }),
      settle: async () =>
        createSettledResult({
          strategy: settleResult.strategy,
          durationMs: settleResult.durationMs
        }),
      snapshot: () => pageSnapshot,
      close: async () => {}
    }),
    callbackClient: createStubCallbackClient({
      sendStepEvents: async () => {
        events.push("step-events");
      },
      sendArtifacts: async () => {
        events.push("artifacts");
      },
      sendCheckpoints: async () => {
        events.push("checkpoints");
      }
    }),
    capturePipeline: {
      collectCheckpoint: async () => {
        events.push("collect-checkpoint");

        return {
          checkpoint: {
            checkpointId: "checkpoint-1",
            stepKey: step.step_id,
            stage: step.stage,
            trigger: {},
            settle: checkpointSettle,
            state: {},
            observations: [],
            deltas: []
          },
          artifacts: artifactDrafts
        };
      }
    },
    artifactStore: {
      persistArtifacts: async () => {
        events.push("persist-artifacts");

        return [
          {
            artifactId: "artifact-1",
            artifactType: "SCREENSHOT",
            bucket: "local-runner",
            key: "run-1/step_001_checkpoint/artifact-1-screenshot.txt",
            mimeType: "text/plain",
            sizeBytes: 5,
            sha256: "abc",
            createdAt: new Date().toISOString(),
            stepKey: step.step_id
          }
        ];
      }
    }
  });

  assert.deepEqual(events, [
    "step-events",
    "step-events",
    "collect-checkpoint",
    "persist-artifacts",
    "artifacts",
    "checkpoints",
    "step-events"
  ]);
});

test("checkpoint payload helpers preserve artifact payloads and artifactRefs", () => {
  const artifacts: Artifact[] = [
    {
      artifactId: "artifact-1",
      artifactType: "SCREENSHOT",
      bucket: "local-runner",
      key: "run-1/step_001_checkpoint/artifact-1-screenshot.txt",
      mimeType: "text/plain",
      sizeBytes: 5,
      sha256: "abc",
      createdAt: "2026-04-20T00:00:00.000Z",
      stepKey: "step_001_checkpoint"
    }
  ];
  const checkpoint: Omit<Checkpoint, "artifactRefs"> = {
    checkpointId: "checkpoint-1",
    stepKey: "step_001_checkpoint",
    stage: "INPUT",
    trigger: {
      stepOrder: 1
    },
    settle: {
      strategy: "fixed_short",
      durationMs: 1,
      status: "settled"
    },
    state: {
      url: "https://example.com"
    },
    observations: [],
    deltas: []
  };

  assert.deepEqual(createArtifactBatch(artifacts), {
    artifacts
  });
  assert.deepEqual(createCheckpointRequest(checkpoint, artifacts), {
    checkpoints: [
      {
        ...checkpoint,
        artifactRefs: ["artifact-1"]
      }
    ]
  });
});

test("capture pipeline records structured response and item-count settle observations", async () => {
  const capturePipeline = createCapturePipeline();
  const plan = createMinimalPlan();
  const pageSnapshot: BrowserPageSnapshot = createSimulatedPageSnapshot(plan, {
    finalUrl: "https://example.com/signup"
  });

  const responseCollection = await capturePipeline.collectCheckpoint({
    step: {
      step_id: "step_response",
      stage: "INPUT",
      description: "wait for email validation response",
      action: {
        type: "fill",
        target: {
          label: "Email"
        },
        value: "test@example.com"
      },
      settle_strategy: {
        type: "response",
        timeout_ms: 2_000,
        url_includes: "/api/signup/validate-email"
      },
      checkpoint: true
    },
    stepOrder: 1,
    plan,
    pageSnapshot,
    settleResult: createSettledResult({
      strategy: "response",
      durationMs: 220,
      status: "settled",
      targetSummary: "url=/api/signup/validate-email",
      details: {
        matchedUrl: "https://example.com/api/signup/validate-email",
        method: "POST",
        status: 200,
        urlIncludes: "/api/signup/validate-email"
      }
    })
  });

  const itemCountCollection = await capturePipeline.collectCheckpoint({
    step: {
      step_id: "step_item_count",
      stage: "VALUE",
      description: "wait for benefit items to expand",
      action: {
        type: "click",
        target: {
          selector: "#signup-benefits-toggle"
        }
      },
      settle_strategy: {
        type: "item_count_change",
        timeout_ms: 2_000,
        target: {
          selector: "#signup-benefits li"
        },
        expected_count: 3
      },
      checkpoint: true
    },
    stepOrder: 2,
    plan,
    pageSnapshot,
    settleResult: createSettledResult({
      strategy: "item_count_change",
      durationMs: 180,
      status: "settled",
      targetSummary: "selector=#signup-benefits li",
      details: {
        baselineCount: 1,
        currentCount: 3,
        expectedCount: 3,
        countDelta: 2
      }
    })
  });

  assert.ok(
    responseCollection.checkpoint.observations.some(
      (observation) =>
        observation.type === "settle_response" &&
        observation.method === "POST" &&
        observation.status_code === 200 &&
        observation.matched_url === "https://example.com/api/signup/validate-email"
    )
  );

  assert.ok(
    itemCountCollection.checkpoint.observations.some(
      (observation) =>
        observation.type === "settle_item_count_change" &&
        observation.baseline_count === 1 &&
        observation.current_count === 3 &&
        observation.expected_count === 3 &&
        observation.count_delta === 2
    )
  );
});
