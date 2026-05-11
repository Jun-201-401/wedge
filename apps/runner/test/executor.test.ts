import assert from "node:assert/strict";
import test from "node:test";
import type { BrowserPageSnapshot, BrowserSettleResult } from "../src/browser/playwright/index.ts";
import { createCapturePipeline } from "../src/capture/index.ts";
import { createDeliverySummary, mergeDeliveryIssues, resolveDeliveryStatus } from "../src/delivery/index.ts";
import { executeScenario, ScenarioExecutionError } from "../src/scenario/executor/index.ts";
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

test("[증거 전달] checkpoint step은 artifact 저장/콜백을 먼저 보낸 뒤 checkpoint callback을 보낸다", async () => {
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

test("[증거 전달] step-event callback 실패는 실행 실패로 보지 않고 best-effort 이슈로 기록한다", async () => {
  const plan = createMinimalPlan();
  const step: ScenarioStep = {
    step_id: "step_001_fill_email",
    stage: "INPUT",
    description: "best effort step event",
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
    checkpoint: false
  };

  const result = await executeScenarioStep({
    runId: "run-1",
    stepOrder: 1,
    step,
    plan,
    session: createSimulatedSession(plan, {
      execute: async () => ({
        actionType: step.action.type,
        targetSummary: "label=Email",
        stopRequested: false,
        details: {}
      }),
      settle: async () => createSettledResult({ strategy: "fixed_short", durationMs: 1 })
    }),
    callbackClient: createStubCallbackClient({
      sendStepEvents: async () => {
        throw new Error("step event unavailable");
      }
    }),
    capturePipeline: {
      collectCheckpoint: async () => {
        throw new Error("checkpoint collection should not be called");
      }
    },
    artifactStore: {
      persistArtifacts: async () => []
    }
  });

  assert.equal(result.stopRequested, false);
  assert.equal(result.deliveryIssues.length, 3);
  assert.ok(result.deliveryIssues.every((issue) => issue.scope === "step-events"));
});

test("[증거 전달] artifact 저장과 checkpoint callback이 실패해도 실행 요약은 degraded 상태로 끝낸다", async () => {
  const plan = createMinimalPlan();
  plan.steps = [
    {
      step_id: "step_001_checkpoint",
      stage: "INPUT",
      description: "checkpoint with degraded delivery",
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
    }
  ];

  const result = await executeScenario({
    runId: "run-1",
    plan,
    session: createSimulatedSession(plan, {
      execute: async () => ({
        actionType: "fill",
        targetSummary: "label=Email",
        stopRequested: false,
        details: {}
      }),
      settle: async () => createSettledResult({ strategy: "fixed_short", durationMs: 1 })
    }),
    callbackClient: createStubCallbackClient({
      sendCheckpoints: async () => {
        throw new Error("checkpoint callback unavailable");
      }
    }),
    capturePipeline: {
      collectCheckpoint: async () => ({
        checkpoint: {
          checkpointId: "checkpoint-1",
          stepKey: "step_001_checkpoint",
          stage: "INPUT",
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
        artifacts: [
          {
            artifactId: "artifact-1",
            artifactType: "SCREENSHOT",
            stepKey: "step_001_checkpoint",
            mimeType: "text/plain",
            fileExtension: "txt",
            content: "hello"
          }
        ]
      })
    },
    artifactStore: {
      persistArtifacts: async () => {
        throw new Error("artifact storage unavailable");
      }
    }
  });

  assert.equal(result.summary.completedStepCount, 1);
  assert.equal(result.delivery.status, "DELIVERY_PARTIAL");
  assert.deepEqual(result.delivery.issues.map((issue) => issue.scope), [
    "artifact-storage",
    "checkpoints-callback"
  ]);
});

test("[실패 요약] step 실행 실패 시 STEP_FAILED 이벤트와 부분 요약을 남긴다", async () => {
  const plan = createMinimalPlan();
  plan.steps = [
    {
      step_id: "step_001_done",
      stage: "INPUT",
      description: "completed before failure",
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
      checkpoint: false
    },
    {
      step_id: "step_002_fail",
      stage: "CTA",
      description: "fails on click",
      action: {
        type: "click",
        target: {
          selector: "#submit"
        }
      },
      settle_strategy: {
        type: "fixed_short",
        timeout_ms: 1
      },
      checkpoint: false
    }
  ];
  const emittedEventTypes: string[] = [];

  try {
    await executeScenario({
      runId: "run-1",
      plan,
      session: createSimulatedSession(plan, {
        execute: async (action, step) => {
          if (step.step_id === "step_002_fail") {
            throw new Error("browser click failed");
          }

          return {
            actionType: action.type,
            targetSummary: "label=Email",
            stopRequested: false,
            details: {}
          };
        },
        settle: async () => createSettledResult({ strategy: "fixed_short", durationMs: 1 })
      }),
      callbackClient: createStubCallbackClient({
        sendStepEvents: async (_runId, payload) => {
          emittedEventTypes.push(...payload.events.map((event) => event.eventType));
        }
      }),
      capturePipeline: {
        collectCheckpoint: async () => {
          throw new Error("checkpoint collection should not be called");
        }
      },
      artifactStore: {
        persistArtifacts: async () => []
      }
    });
    assert.fail("executeScenario should throw on a failed scenario step");
  } catch (error) {
    assert.ok(error instanceof ScenarioExecutionError);
    assert.deepEqual(error.summary, {
      completedStepCount: 1,
      failedStepCount: 1,
      stopped: false
    });
    assert.equal(error.failedStepKey, "step_002_fail");
    assert.equal(error.failedStepOrder, 2);
  }

  assert.ok(emittedEventTypes.includes("STEP_FAILED"));
});

test("[증거 payload] checkpoint callback payload는 artifact 원본 metadata와 artifactRefs를 보존한다", () => {
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

test("[증거 전달] scenario 실행 중 발견 depth context를 checkpoint 간 유지한다", async () => {
  const plan = createMinimalPlan();
  plan.steps = [
    {
      step_id: "step_discover_products",
      stage: "VALUE",
      description: "상품 목록 확인",
      action: {
        type: "checkpoint"
      },
      settle_strategy: {
        type: "none",
        timeout_ms: 0
      },
      checkpoint: true
    },
    {
      step_id: "step_filter_products",
      stage: "VALUE",
      description: "필터 적용",
      action: {
        type: "click",
        target: {
          selector: "button.filter"
        }
      },
      settle_strategy: {
        type: "url_change",
        timeout_ms: 500
      },
      checkpoint: true
    }
  ];

  const productCards = [
    {
      element_text: "Runner Shoes ₩12,000",
      clicked_selector: "a.product-card",
      visible_price: "₩12,000",
      visible_product_image: true,
      bbox: {
        x: 80,
        y: 180,
        width: 260,
        height: 320,
        unit: "css_px" as const
      }
    }
  ];
  const snapshots = [
    createSimulatedPageSnapshot(plan),
    createSimulatedPageSnapshot(plan, {
      finalUrl: "https://example.com/products",
      productCards
    }),
    createSimulatedPageSnapshot(plan, {
      finalUrl: "https://example.com/products",
      productCards
    }),
    createSimulatedPageSnapshot(plan, {
      finalUrl: "https://example.com/products?filter=runner",
      selectedFilters: [
        {
          key: "tag",
          value: "runner",
          selector: "button.filter"
        }
      ],
      productCards
    })
  ];
  let snapshotIndex = 0;
  const checkpointPayloads: Array<{ checkpoints: Array<{ observations: Record<string, unknown>[] }> }> = [];

  await executeScenario({
    runId: "run-depth-1",
    plan,
    session: createSimulatedSession(plan, {
      execute: async (action) => ({
        actionType: action.type,
        targetSummary: action.type === "click" ? "selector=button.filter" : null,
        stopRequested: false,
        details: action.type === "click"
          ? {
              clickedText: "필터",
              clickedSelector: "button.filter"
            }
          : {}
      }),
      settle: async (strategy) => createSettledResult({ strategy: strategy.type, status: "settled" }),
      snapshot: () => snapshots[Math.min(snapshotIndex++, snapshots.length - 1)],
      captureArtifacts: async () => ({})
    }),
    callbackClient: createStubCallbackClient({
      sendCheckpoints: async (_runId, payload) => {
        checkpointPayloads.push(payload);
      }
    }),
    capturePipeline: createCapturePipeline(),
    artifactStore: {
      persistArtifacts: async () => []
    }
  });

  const depthObservations = checkpointPayloads.flatMap((payload) =>
    payload.checkpoints.flatMap((checkpoint) =>
      checkpoint.observations.filter((observation) => observation.type === "depth_from_discovery")
    )
  );

  assert.equal(depthObservations.length, 2);
  assert.equal(depthObservations[0]?.depth_from_discovery, 0);
  assert.equal(depthObservations[1]?.discovery_step_key, "step_discover_products");
  assert.equal(depthObservations[1]?.depth_from_discovery, 1);
  assert.equal(depthObservations[1]?.intent_candidate, "filter_changed");
});

test("[수집 pipeline] response/item_count settle 결과를 observation으로 구조화한다", async () => {
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

  const responseTimeoutCollection = await capturePipeline.collectCheckpoint({
    step: {
      step_id: "step_response_timeout",
      stage: "INPUT",
      description: "wait for email validation response but time out",
      action: {
        type: "fill",
        target: {
          label: "Email"
        },
        value: "slow@example.com"
      },
      settle_strategy: {
        type: "response",
        timeout_ms: 120,
        url_includes: "/api/signup/validate-email"
      },
      checkpoint: true
    },
    stepOrder: 3,
    plan,
    pageSnapshot,
    settleResult: createSettledResult({
      strategy: "response",
      durationMs: 120,
      status: "timeout",
      targetSummary: "url=/api/signup/validate-email",
      details: {
        method: "POST",
        status: 200,
        urlIncludes: "/api/signup/validate-email",
        timeoutMs: 120
      }
    })
  });

  const itemCountTimeoutCollection = await capturePipeline.collectCheckpoint({
    step: {
      step_id: "step_item_count_timeout",
      stage: "VALUE",
      description: "wait for benefit items to grow but time out",
      action: {
        type: "click",
        target: {
          selector: "#signup-benefits-toggle"
        }
      },
      settle_strategy: {
        type: "item_count_change",
        timeout_ms: 120,
        target: {
          selector: "#signup-benefits li"
        },
        expected_count: 4
      },
      checkpoint: true
    },
    stepOrder: 4,
    plan,
    pageSnapshot,
    settleResult: createSettledResult({
      strategy: "item_count_change",
      durationMs: 120,
      status: "timeout",
      targetSummary: "selector=#signup-benefits li",
      details: {
        baselineCount: 1,
        currentCount: 1,
        expectedCount: 4,
        countDelta: 3,
        timeoutMs: 120
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

  assert.ok(
    responseTimeoutCollection.checkpoint.observations.some(
      (observation) =>
        observation.type === "settle_response" &&
        observation.settle_status === "timeout" &&
        observation.status_code === 200 &&
        observation.url_includes === "/api/signup/validate-email"
    )
  );

  assert.ok(
    itemCountTimeoutCollection.checkpoint.observations.some(
      (observation) =>
        observation.type === "settle_item_count_change" &&
        observation.settle_status === "timeout" &&
        observation.baseline_count === 1 &&
        observation.current_count === 1 &&
        observation.expected_count === 4 &&
        observation.count_delta === 3
    )
  );
});

test("[수집 pipeline] page snapshot만 있어도 fallback screenshot/DOM/console artifact를 만든다", async () => {
  const capturePipeline = createCapturePipeline();
  const plan = createMinimalPlan();
  const pageSnapshot: BrowserPageSnapshot = createSimulatedPageSnapshot(plan, {
    title: "Signup",
    finalUrl: "https://example.com/signup",
    fields: {
      Email: "test@example.com"
    },
    consoleErrors: ["ReferenceError: missingVar"],
    lastAction: {
      type: "click",
      target: "role=button[name=Continue]",
      at: "2026-04-21T00:00:00.000Z"
    }
  });

  const collection = await capturePipeline.collectCheckpoint({
    step: {
      step_id: "step_capture_fallback",
      stage: "CTA",
      description: "capture fallback artifacts",
      action: {
        type: "click",
        target: {
          text: "Continue"
        }
      },
      settle_strategy: {
        type: "none",
        timeout_ms: 0
      },
      checkpoint: true
    },
    stepOrder: 3,
    plan,
    pageSnapshot,
    settleResult: createSettledResult()
  });

  const screenshotArtifact = collection.artifacts.find((artifact) => artifact.artifactType === "SCREENSHOT");
  const domArtifact = collection.artifacts.find((artifact) => artifact.artifactType === "DOM_SNAPSHOT");
  const consoleArtifact = collection.artifacts.find((artifact) => artifact.artifactType === "CONSOLE_LOG");

  assert.equal(screenshotArtifact?.mimeType, "image/svg+xml");
  assert.equal(screenshotArtifact?.fileExtension, "svg");
  assert.match(screenshotArtifact?.content ?? "", /Step 3/);
  assert.match(screenshotArtifact?.content ?? "", /Signup/);

  assert.equal(domArtifact?.mimeType, "text/html");
  assert.equal(domArtifact?.fileExtension, "html");
  assert.match(domArtifact?.content ?? "", /test@example\.com/);

  assert.equal(consoleArtifact?.mimeType, "application/json");
  assert.match(consoleArtifact?.content ?? "", /ReferenceError: missingVar/);
  assert.ok(
    collection.checkpoint.observations.some(
      (observation) =>
        observation.type === "console_error" &&
        observation.message === "ReferenceError: missingVar"
    )
  );
  assert.ok(
    collection.checkpoint.observations.some(
      (observation) =>
        observation.type === "cta_candidate" &&
        observation.target === "role=button[name=Continue]"
    )
  );
});

test("[수집 pipeline] CTA 분석용 interactive_components observation을 checkpoint에 포함한다", async () => {
  const capturePipeline = createCapturePipeline();
  const plan = createMinimalPlan();
  const pageSnapshot: BrowserPageSnapshot = createSimulatedPageSnapshot(plan, {
    interactiveComponents: [
      {
        text: "무료로 시작하기",
        selector: "a.hero-start",
        role: "link",
        tag: "a",
        clickable: true,
        clicked_in_scenario: true,
        is_cta_candidate: true,
        is_primary_like: true,
        bounds: {
          x: 520,
          y: 360,
          width: 220,
          height: 56,
          unit: "css_px"
        }
      }
    ]
  });

  const collection = await capturePipeline.collectCheckpoint({
    step: {
      step_id: "step_capture_interactive_components",
      stage: "CTA",
      description: "capture CTA interactive components",
      action: {
        type: "checkpoint"
      },
      settle_strategy: {
        type: "none",
        timeout_ms: 0
      },
      checkpoint: true
    },
    stepOrder: 4,
    plan,
    pageSnapshot,
    settleResult: createSettledResult()
  });

  const observation = collection.checkpoint.observations.find(
    (candidate) => candidate.type === "interactive_components"
  );

  assert.deepEqual(observation, {
    observation_id: "step_capture_interactive_components.obs_interactive_components",
    type: "interactive_components",
    stage: "CTA",
    source: ["dom", "layout", "screenshot"],
    confidence: 0.82,
    primary_like_component_count: 1,
    components: [
      {
        text: "무료로 시작하기",
        selector: "a.hero-start",
        role: "link",
        tag: "a",
        clickable: true,
        clicked_in_scenario: true,
        is_cta_candidate: true,
        is_primary_like: true,
        bounds: {
          x: 520,
          y: 360,
          width: 220,
          height: 56,
          unit: "css_px"
        }
      }
    ]
  });
});

test("[수집 pipeline] Journey raw signal은 click 전후 상태와 artifact/bbox 근거를 observation으로 남긴다", async () => {
  const capturePipeline = createCapturePipeline();
  const plan = createMinimalPlan();
  const beforeSnapshot = createSimulatedPageSnapshot(plan, {
    title: "Landing",
    finalUrl: "https://example.com",
    breadcrumb: ["Home"],
    cartCount: 0,
    domSignature: "before-dom"
  });
  const afterSnapshot = createSimulatedPageSnapshot(plan, {
    title: "Product",
    finalUrl: "https://example.com/products/sku-1",
    breadcrumb: ["Home", "Products", "SKU 1"],
    cartCount: 1,
    toastTexts: ["장바구니에 담았습니다"],
    visiblePrices: ["₩12,000"],
    productImages: [
      {
        src: "https://example.com/sku-1.png",
        alt: "SKU 1",
        bounds: {
          x: 100,
          y: 140,
          width: 320,
          height: 240,
          unit: "css_px"
        }
      }
    ],
    productCards: [
      {
        element_text: "SKU 1 ₩12,000 장바구니 담기",
        clicked_selector: "button.add-cart",
        visible_price: "₩12,000",
        visible_product_image: true,
        bbox: {
          x: 480,
          y: 600,
          width: 260,
          height: 180,
          unit: "css_px"
        }
      }
    ],
    networkEvents: [
      {
        method: "POST",
        url: "https://example.com/api/cart",
        status: 200,
        failed: false
      }
    ],
    domSignature: "after-dom"
  });

  const collection = await capturePipeline.collectCheckpoint({
    step: {
      step_id: "step_click_cart",
      stage: "CTA",
      description: "add item to cart",
      action: {
        type: "click",
        target: {
          selector: "button.add-cart"
        }
      },
      settle_strategy: {
        type: "response",
        timeout_ms: 500,
        url_includes: "/api/cart"
      },
      checkpoint: true
    },
    stepOrder: 2,
    plan,
    beforeSnapshot,
    pageSnapshot: afterSnapshot,
    actionResult: {
      actionType: "click",
      targetSummary: "selector=button.add-cart",
      stopRequested: false,
      details: {
        clickedText: "장바구니 담기",
        clickedSelector: "button.add-cart",
        elementRole: "button",
        ariaLabel: "장바구니 담기",
        bbox: {
          x: 520,
          y: 640,
          width: 180,
          height: 48,
          unit: "css_px"
        }
      }
    },
    settleResult: createSettledResult({
      strategy: "response",
      status: "settled",
      durationMs: 180,
      targetSummary: "url=/api/cart",
      details: {
        matchedUrl: "https://example.com/api/cart",
        method: "POST",
        status: 200,
        urlIncludes: "/api/cart"
      }
    })
  });

  const observation = collection.checkpoint.observations.find(
    (candidate) => candidate.type === "journey_action_raw"
  );
  const goalActionResult = collection.checkpoint.observations.find(
    (candidate) => candidate.type === "goal_action_result"
  );

  assert.ok(observation);
  assert.equal(observation.clicked_text, "장바구니 담기");
  assert.equal(observation.clicked_selector, "button.add-cart");
  assert.equal(observation.url_before, "https://example.com");
  assert.equal(observation.url_after, "https://example.com/products/sku-1");
  assert.equal(observation.title_before, "Landing");
  assert.equal(observation.title_after, "Product");
  assert.equal(observation.cart_count_before, 0);
  assert.equal(observation.cart_count_after, 1);
  assert.equal(observation.dom_changed, true);
  assert.equal(observation.settle_status, "settled");
  assert.equal(observation.add_to_cart_like_button, true);
  assert.equal(typeof observation.screenshot_artifact_id, "string");
  assert.deepEqual(observation.matched_product_card, {
    element_text: "SKU 1 ₩12,000 장바구니 담기",
    clicked_selector: "button.add-cart",
    visible_price: "₩12,000",
    visible_product_image: true,
    bbox: {
      x: 480,
      y: 600,
      width: 260,
      height: 180,
      unit: "css_px"
    },
    match_reason: "selector_exact",
    match_confidence: 0.94
  });
  assert.deepEqual(observation.bbox, {
    x: 520,
    y: 640,
    width: 180,
    height: 48,
    unit: "css_px"
  });
  assert.ok(Array.isArray(observation.network_result));

  assert.ok(goalActionResult);
  assert.equal(goalActionResult.clicked_text, "장바구니 담기");
  assert.equal(goalActionResult.goal_action_like, true);
  assert.deepEqual(goalActionResult.success_evidence, [
    "cart_count_increased",
    "toast_present",
    "network_success",
    "url_changed",
    "dom_changed"
  ]);
  assert.deepEqual(goalActionResult.result, {
    action_attempted: true,
    add_to_cart_like_button: true,
    cart_count_delta: 1,
    toast_present: true,
    url_changed: true,
    dom_changed: true,
    network_success: true,
    settle_status: "settled"
  });
  assert.ok(goalActionResult.matched_product_card && typeof goalActionResult.matched_product_card === "object");
  assert.equal(
    (goalActionResult.matched_product_card as { match_reason?: unknown }).match_reason,
    "selector_exact"
  );
});

test("[수집 pipeline] 카테고리/필터/검색 변화는 category_filter_signal observation으로 남긴다", async () => {
  const capturePipeline = createCapturePipeline();
  const plan = createMinimalPlan();
  const beforeSnapshot = createSimulatedPageSnapshot(plan, {
    finalUrl: "https://example.com/products",
    breadcrumb: ["Home", "Products"],
    selectedFilters: [],
    searchQuery: null
  });
  const afterSnapshot = createSimulatedPageSnapshot(plan, {
    finalUrl: "https://example.com/products?category=shoes&q=runner",
    breadcrumb: ["Home", "Products", "Shoes"],
    selectedFilters: [
      {
        key: "category",
        value: "Shoes",
        selector: "input[name=\"category\"]"
      }
    ],
    searchQuery: "runner"
  });

  const collection = await capturePipeline.collectCheckpoint({
    step: {
      step_id: "step_filter_search",
      stage: "VALUE",
      description: "카테고리와 검색어 적용",
      action: {
        type: "click",
        target: {
          selector: "button.apply-filter"
        }
      },
      settle_strategy: {
        type: "url_change",
        timeout_ms: 500
      },
      checkpoint: true
    },
    stepOrder: 3,
    plan,
    beforeSnapshot,
    pageSnapshot: afterSnapshot,
    actionResult: {
      actionType: "click",
      targetSummary: "selector=button.apply-filter",
      stopRequested: false,
      details: {
        clickedText: "필터 적용",
        clickedSelector: "button.apply-filter"
      }
    },
    settleResult: createSettledResult({
      strategy: "url_change",
      status: "settled",
      durationMs: 120
    })
  });

  const observation = collection.checkpoint.observations.find(
    (candidate) => candidate.type === "category_filter_signal"
  );

  assert.ok(observation);
  assert.equal(observation.clicked_text, "필터 적용");
  assert.equal(observation.url_before, "https://example.com/products");
  assert.equal(observation.url_after, "https://example.com/products?category=shoes&q=runner");
  assert.deepEqual(observation.breadcrumb_before, ["Home", "Products"]);
  assert.deepEqual(observation.breadcrumb_after, ["Home", "Products", "Shoes"]);
  assert.deepEqual(observation.selected_filter_before, []);
  assert.deepEqual(observation.selected_filter_after, [
    {
      key: "category",
      value: "Shoes",
      selector: "input[name=\"category\"]"
    }
  ]);
  assert.equal(observation.search_query_before, null);
  assert.equal(observation.search_query_after, "runner");
  assert.equal(observation.filter_changed, true);
  assert.equal(observation.search_submitted, true);
  assert.equal(observation.category_url_changed, true);
});

test("[수집 pipeline] 상품 발견 이후 depth_from_discovery를 누적 관찰값으로 남긴다", async () => {
  const capturePipeline = createCapturePipeline();
  const journeyDepthContext = {};
  const plan = createMinimalPlan();
  const productListSnapshot = createSimulatedPageSnapshot(plan, {
    finalUrl: "https://example.com/products",
    title: "Products",
    productCards: [
      {
        element_text: "Runner Shoes ₩12,000",
        clicked_selector: "a.product-card[href='/products/runner-shoes']",
        visible_price: "₩12,000",
        visible_product_image: true,
        bbox: {
          x: 80,
          y: 180,
          width: 260,
          height: 320,
          unit: "css_px"
        }
      }
    ]
  });

  const discoveryCollection = await capturePipeline.collectCheckpoint({
    step: {
      step_id: "step_discover_products",
      stage: "VALUE",
      description: "상품 목록 확인",
      action: {
        type: "checkpoint"
      },
      settle_strategy: {
        type: "none",
        timeout_ms: 0
      },
      checkpoint: true
    },
    stepOrder: 1,
    plan,
    pageSnapshot: productListSnapshot,
    settleResult: createSettledResult(),
    journeyDepthContext
  });

  const discoveryObservation = discoveryCollection.checkpoint.observations.find(
    (candidate) => candidate.type === "depth_from_discovery"
  );
  assert.ok(discoveryObservation);
  assert.equal(discoveryObservation.discovery_step_order, 1);
  assert.equal(discoveryObservation.depth_from_discovery, 0);
  assert.equal(discoveryObservation.intent_candidate, "product_discovery");
  assert.equal(discoveryObservation.is_detour_candidate, false);
  assert.equal(discoveryObservation.current_product_card_count, 1);

  const beforeFilterSnapshot = createSimulatedPageSnapshot(plan, {
    finalUrl: "https://example.com/products",
    breadcrumb: ["Home", "Products"],
    productCards: productListSnapshot.productCards
  });
  const afterFilterSnapshot = createSimulatedPageSnapshot(plan, {
    finalUrl: "https://example.com/products?filter=size-270",
    breadcrumb: ["Home", "Products"],
    selectedFilters: [
      {
        key: "size",
        value: "270",
        selector: "input[name='size'][value='270']"
      }
    ],
    productCards: productListSnapshot.productCards
  });

  const filterCollection = await capturePipeline.collectCheckpoint({
    step: {
      step_id: "step_filter_products",
      stage: "VALUE",
      description: "사이즈 필터 적용",
      action: {
        type: "click",
        target: {
          selector: "input[name='size'][value='270']"
        }
      },
      settle_strategy: {
        type: "url_change",
        timeout_ms: 500
      },
      checkpoint: true
    },
    stepOrder: 2,
    plan,
    beforeSnapshot: beforeFilterSnapshot,
    pageSnapshot: afterFilterSnapshot,
    actionResult: {
      actionType: "click",
      targetSummary: "selector=input[name='size'][value='270']",
      stopRequested: false,
      details: {
        clickedText: "270",
        clickedSelector: "input[name='size'][value='270']"
      }
    },
    settleResult: createSettledResult({
      strategy: "url_change",
      status: "settled",
      durationMs: 100
    }),
    journeyDepthContext
  });

  const filterDepthObservation = filterCollection.checkpoint.observations.find(
    (candidate) => candidate.type === "depth_from_discovery"
  );
  assert.ok(filterDepthObservation);
  assert.equal(filterDepthObservation.discovery_step_key, "step_discover_products");
  assert.equal(filterDepthObservation.depth_from_discovery, 1);
  assert.equal(filterDepthObservation.intent_candidate, "filter_changed");
  assert.equal(filterDepthObservation.filter_changed, true);
  assert.equal(filterDepthObservation.is_detour_candidate, false);
});

test("[전달 정책] optional delivery 이슈를 병합하고 finished callback 실패는 fatal로 분류한다", () => {
  const merged = mergeDeliveryIssues(
    [
      {
        scope: "step-events",
        stepKey: "step_1",
        message: "step event failed"
      }
    ],
    undefined,
    [
      {
        scope: "finished-callback",
        message: "finished callback failed"
      }
    ]
  );

  assert.deepEqual(merged.map((issue) => issue.scope), ["step-events", "finished-callback"]);
  assert.equal(resolveDeliveryStatus([]), "DELIVERY_COMPLETE");
  assert.equal(resolveDeliveryStatus(merged), "DELIVERY_FAILED");
  assert.deepEqual(createDeliverySummary(merged), {
    status: "DELIVERY_FAILED",
    issues: merged
  });
});
