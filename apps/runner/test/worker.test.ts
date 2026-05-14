import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { registerWorker } from "../src/worker/index.ts";
import { resolveFailureResultCompleteness } from "../src/worker/callback-policy.ts";
import {
  createRunnerTestConfig,
  createSettledResult,
  createSimulatedPageSnapshot,
  createSimulatedSession,
  createStubCallbackClient,
  loadExampleMessage
} from "./support.ts";
import type { RunnerFailedPayload, StepEvent } from "../src/shared/contracts.ts";

test("[Worker lifecycle] accepted callback 실패 시 session을 닫고 failed callback을 보낸다", async () => {
  const message = await loadExampleMessage();
  let closed = false;
  let failedPayload: RunnerFailedPayload | null = null;

  const worker = registerWorker({
    config: createRunnerTestConfig(),
    browserFactory: {
      kind: "simulated-playwright",
      createSession: async () =>
        createSimulatedSession(message.payload.scenarioPlan!, {
          execute: async () => {
            throw new Error("execute should not be called when accepted fails");
          },
          settle: async () => createSettledResult(),
          snapshot: () => createSimulatedPageSnapshot(message.payload.scenarioPlan!),
          close: async () => {
            closed = true;
          }
        })
    },
    callbackClient: createStubCallbackClient({
      sendAccepted: async () => {
        throw new Error("accepted callback failed");
      },
      sendFailed: async (_runId, payload) => {
        failedPayload = payload;
      }
    }),
    capturePipeline: {
      collectCheckpoint: async () => {
        throw new Error("checkpoint collection should not be called when accepted fails");
      }
    },
    artifactStore: {
      persistArtifacts: async () => []
    }
  });

  await assert.rejects(() => worker.handleMessage(message), /accepted callback failed/);
  assert.equal(closed, true);
  if (failedPayload === null) {
    throw new Error("failed payload was not captured");
  }

  const capturedFailedPayload = failedPayload as RunnerFailedPayload;
  assert.equal(capturedFailedPayload.resultCompleteness, "NONE");
});

test("[Worker failure policy] PARTIAL은 실제 completed step 또는 failure artifact가 있을 때만 사용한다", () => {
  assert.equal(resolveFailureResultCompleteness({
    accepted: false
  }), "NONE");
  assert.equal(resolveFailureResultCompleteness({
    accepted: true,
    summary: {
      completedStepCount: 0,
      failedStepCount: 1,
      stopped: false
    },
    failureArtifactRefs: []
  }), "NONE");
  assert.equal(resolveFailureResultCompleteness({
    accepted: true,
    summary: {
      completedStepCount: 1,
      failedStepCount: 1,
      stopped: false
    },
    failureArtifactRefs: []
  }), "PARTIAL");
  assert.equal(resolveFailureResultCompleteness({
    accepted: true,
    summary: {
      completedStepCount: 0,
      failedStepCount: 1,
      stopped: false
    },
    lastCheckpointId: "checkpoint-failure",
    failureArtifactRefs: []
  }), "PARTIAL");
  assert.equal(resolveFailureResultCompleteness({
    accepted: true,
    summary: {
      completedStepCount: 0,
      failedStepCount: 1,
      stopped: false
    },
    failureArtifactRefs: ["artifact-failure"]
  }), "PARTIAL");
});

test("[Worker capture policy] run artifactPolicy.captureAxTree를 ScenarioPlan capture 옵션으로 전달한다", async () => {
  const message = await loadExampleMessage();
  message.payload.artifactPolicy = {
    captureAxTree: true,
    screenshotMode: "viewport_stitched"
  };
  message.payload.scenarioPlan!.steps = [
    {
      step_id: "step_001_checkpoint",
      stage: "FIRST_VIEW",
      description: "checkpoint with AX tree",
      action: {
        type: "checkpoint"
      },
      settle_strategy: {
        type: "none",
        timeout_ms: 0
      },
      checkpoint: true
    }
  ];
  const capturedOptions: unknown[] = [];

  const worker = registerWorker({
    config: createRunnerTestConfig(),
    browserFactory: {
      kind: "simulated-playwright",
      createSession: async () =>
        createSimulatedSession(message.payload.scenarioPlan!, {
          snapshot: () => createSimulatedPageSnapshot(message.payload.scenarioPlan!),
          captureArtifacts: async (options) => {
            capturedOptions.push(options);
            return {};
          }
        })
    },
    callbackClient: createStubCallbackClient(),
    capturePipeline: {
      collectCheckpoint: async () => ({
        checkpoint: {
          checkpointId: "checkpoint-1",
          stepKey: "step_001_checkpoint",
          stage: "FIRST_VIEW",
          trigger: {},
          settle: {
            strategy: "none",
            durationMs: 0,
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

  await worker.handleMessage(message);

  assert.deepEqual(capturedOptions, [{ screenshotMode: "viewport_stitched", captureAxTree: true }]);
});

test("[Worker cancellation] STOP_REQUESTED control state면 다음 step 실행 전 stopped로 종료한다", async () => {
  const message = await loadExampleMessage();
  message.payload.scenarioPlan!.steps = [
    {
      step_id: "step_001_should_not_execute",
      stage: "CTA",
      description: "should not execute",
      action: {
        type: "click",
        target: {
          selector: "#submit"
        }
      },
      settle_strategy: {
        type: "none",
        timeout_ms: 0
      },
      checkpoint: false
    }
  ];

  let executed = false;
  let finishedSummary: unknown = null;

  const worker = registerWorker({
    config: createRunnerTestConfig(),
    browserFactory: {
      kind: "simulated-playwright",
      createSession: async () =>
        createSimulatedSession(message.payload.scenarioPlan!, {
          execute: async () => {
            executed = true;
            throw new Error("step should not execute after stop request");
          }
        })
    },
    callbackClient: createStubCallbackClient({
      readRunControlState: async () => ({
        runId: message.payload.runId,
        status: "STOP_REQUESTED",
        stopRequested: true,
        resultCompleteness: "PARTIAL"
      }),
      sendFinished: async (_runId, payload) => {
        finishedSummary = payload.summary;
      }
    }),
    capturePipeline: {
      collectCheckpoint: async () => {
        throw new Error("checkpoint collection should not run after stop request");
      }
    },
    artifactStore: {
      persistArtifacts: async () => []
    }
  });

  const result = await worker.handleMessage(message);

  assert.equal(executed, false);
  assert.equal(result.summary.completedStepCount, 0);
  assert.equal(result.summary.failedStepCount, 0);
  assert.equal(result.summary.stopped, true);
  assert.equal(result.summary.collectorStatus?.screenshot.status, "skipped");
  assert.deepEqual(finishedSummary, result.summary);
});

test("[Worker idempotency] run idempotencyKey terminal result는 재실행 없이 재사용한다", async () => {
  const artifactsRoot = await mkdtemp(join(tmpdir(), "wedge-runner-run-idempotency-"));
  const message = await loadExampleMessage();
  message.idempotencyKey = "run-idempotency-smoke";
  message.payload.scenarioPlan!.steps = [
    {
      step_id: "step_001_checkpoint",
      stage: "FIRST_VIEW",
      description: "checkpoint",
      action: {
        type: "checkpoint"
      },
      settle_strategy: {
        type: "none",
        timeout_ms: 0
      },
      checkpoint: false
    }
  ];
  let sessionCreateCount = 0;
  let acceptedCount = 0;

  try {
    const worker = registerWorker({
      config: createRunnerTestConfig({ artifactsRoot }),
      browserFactory: {
        kind: "simulated-playwright",
        createSession: async () => {
          sessionCreateCount += 1;
          return createSimulatedSession(message.payload.scenarioPlan!);
        }
      },
      callbackClient: createStubCallbackClient({
        sendAccepted: async () => {
          acceptedCount += 1;
        }
      }),
      capturePipeline: {
        collectCheckpoint: async () => {
          throw new Error("checkpoint collection should not be needed");
        }
      },
      artifactStore: {
        persistArtifacts: async () => []
      }
    });

    const first = await worker.handleMessage(message);
    const second = await worker.handleMessage(message);

    assert.deepEqual(second, first);
    assert.equal(sessionCreateCount, 1);
    assert.equal(acceptedCount, 1);
  } finally {
    await rm(artifactsRoot, { recursive: true, force: true });
  }
});

test("[Worker 관측성] step timeout 실패는 timeout code와 runId/stepKey 로그를 남긴다", async () => {
  const message = await loadExampleMessage();
  message.payload.scenarioPlan!.steps = [
    {
      step_id: "step_001_timeout",
      stage: "CTA",
      description: "timeout click",
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

  let failedPayload: RunnerFailedPayload | null = null;
  const stepEvents: StepEvent[] = [];
  const checkpointStatuses: string[] = [];
  const runnerFailureObservations: Record<string, unknown>[] = [];
  const persistedArtifactIds: string[] = [];
  const sentArtifactIds: string[] = [];
  const callbackOrder: string[] = [];
  const capturedLogs: string[] = [];
  const originalError = console.error;
  console.error = (message?: unknown, ...optional: unknown[]) => {
    capturedLogs.push(String(message));
    if (optional.length > 0) {
      capturedLogs.push(optional.map(String).join(" "));
    }
  };

  try {
    const worker = registerWorker({
      config: createRunnerTestConfig(),
      browserFactory: {
        kind: "simulated-playwright",
        createSession: async () =>
          createSimulatedSession(message.payload.scenarioPlan!, {
            execute: async () => {
              const error = new Error("locator click timed out after 100ms");
              error.name = "TimeoutError";
              throw error;
            },
            settle: async () => createSettledResult(),
            snapshot: () => createSimulatedPageSnapshot(message.payload.scenarioPlan!),
            close: async () => {}
          })
      },
      callbackClient: createStubCallbackClient({
        sendStepEvents: async (_runId, payload) => {
          stepEvents.push(...payload.events);
        },
        sendArtifacts: async (_runId, payload) => {
          callbackOrder.push("artifacts");
          sentArtifactIds.push(...payload.artifacts.map((artifact) => artifact.artifactId));
        },
        sendCheckpoints: async (_runId, payload) => {
          callbackOrder.push("checkpoints");
          checkpointStatuses.push(...payload.checkpoints.map((checkpoint) => checkpoint.settle.status));
          runnerFailureObservations.push(
            ...payload.checkpoints.flatMap((checkpoint) =>
              checkpoint.observations.filter((observation) => observation.type === "runner_failure")
            )
          );
        },
        sendFailed: async (_runId, payload) => {
          callbackOrder.push("failed");
          failedPayload = payload;
        }
      }),
      capturePipeline: {
        collectCheckpoint: async ({ step, settleResult }) => ({
          checkpoint: {
            checkpointId: "checkpoint-timeout",
            stepKey: step.step_id,
            stage: step.stage,
            trigger: {},
            settle: { ...settleResult },
            state: {},
            observations: [],
            deltas: []
          },
          artifacts: [
            {
              artifactId: "failure-screenshot",
              artifactType: "SCREENSHOT",
              stepKey: step.step_id,
              mimeType: "image/png",
              fileExtension: "png",
              content: "iVBORw0KGgo=",
              contentEncoding: "base64"
            }
          ]
        })
      },
      artifactStore: {
        persistArtifacts: async ({ artifacts }) => {
          persistedArtifactIds.push(...artifacts.map((artifact) => artifact.artifactId));
          return artifacts.map((artifact) => ({
            artifactId: artifact.artifactId,
            artifactType: artifact.artifactType,
            stepKey: artifact.stepKey,
            bucket: "runner-test",
            key: `memory/${artifact.artifactId}`,
            mimeType: artifact.mimeType,
            sizeBytes: artifact.content.length,
            sha256: "test-sha256",
            createdAt: "2026-05-11T00:00:00.000Z"
          }));
        }
      }
    });

    await assert.rejects(() => worker.handleMessage(message), /timed out after 100ms/);
  } finally {
    console.error = originalError;
  }

  if (failedPayload === null) {
    throw new Error("failed payload was not captured");
  }

  const capturedFailedPayload = failedPayload as RunnerFailedPayload;
  assert.equal(capturedFailedPayload.failureCode, "RUNNER_TIMEOUT");
  assert.equal(capturedFailedPayload.resultCompleteness, "PARTIAL");
  assert.equal(capturedFailedPayload.failedStepKey, "step_001_timeout");
  assert.equal(capturedFailedPayload.failedStepOrder, 1);
  assert.equal(capturedFailedPayload.lastCheckpointId, "checkpoint-timeout");
  assert.deepEqual(capturedFailedPayload.failureArtifactRefs, ["failure-screenshot"]);
  assert.equal(capturedFailedPayload.summary?.completedStepCount, 0);
  assert.equal(capturedFailedPayload.summary?.failedStepCount, 1);
  assert.equal(capturedFailedPayload.summary?.stopped, false);
  assert.equal(capturedFailedPayload.summary?.collectorStatus?.screenshot.status, "success");
  assert.deepEqual(persistedArtifactIds, ["failure-screenshot"]);
  assert.deepEqual(sentArtifactIds, ["failure-screenshot"]);
  assert.deepEqual(checkpointStatuses, ["failed"]);
  assert.deepEqual(callbackOrder, ["artifacts", "checkpoints", "failed"]);
  assert.equal(runnerFailureObservations.length, 1);
  assert.equal(runnerFailureObservations[0].failed_step_key, "step_001_timeout");
  assert.equal(runnerFailureObservations[0].failed_step_order, 1);
  assert.equal(runnerFailureObservations[0].failure_code, "RUNNER_TIMEOUT");
  assert.equal(runnerFailureObservations[0].result_completeness_candidate, "PARTIAL");
  assert.ok(
    stepEvents.some(
      (event) =>
        event.eventType === "STEP_FAILED" &&
        event.stepKey === "step_001_timeout" &&
        event.payload.failureCode === "RUNNER_TIMEOUT" &&
        event.payload.timeoutPhase === "action" &&
        event.payload.timeoutMs === 100 &&
        event.payload.timeoutPolicy === "fail_step_and_run"
    )
  );
  assert.ok(
    capturedLogs.some(
      (line) =>
        line.includes("\"event\":\"run_failed\"") &&
        line.includes(`"runId":"${message.payload.runId}"`) &&
        line.includes("\"failedStepKey\":\"step_001_timeout\"") &&
        line.includes("\"failureCode\":\"RUNNER_TIMEOUT\"") &&
        line.includes("\"timeoutPhase\":\"action\"") &&
        line.includes("\"timeoutMs\":100") &&
        line.includes("\"timeoutPolicy\":\"fail_step_and_run\"")
    )
  );
});

test("[Worker timeout policy] settle timeout은 step 실패로 승격하지 않고 timeout settle status로 계속 진행한다", async () => {
  const message = await loadExampleMessage();
  message.payload.scenarioPlan!.steps = [
    {
      step_id: "step_001_settle_timeout",
      stage: "CTA",
      description: "settle timeout",
      action: {
        type: "click",
        target: {
          selector: "#submit"
        }
      },
      settle_strategy: {
        type: "network_idle",
        timeout_ms: 250
      },
      checkpoint: false
    }
  ];

  const stepEvents: StepEvent[] = [];
  const capturedLogs: string[] = [];
  const originalLog = console.log;
  console.log = (message?: unknown, ...optional: unknown[]) => {
    capturedLogs.push(String(message));
    if (optional.length > 0) {
      capturedLogs.push(optional.map(String).join(" "));
    }
  };

  try {
    const worker = registerWorker({
      config: createRunnerTestConfig(),
      browserFactory: {
        kind: "simulated-playwright",
        createSession: async () =>
          createSimulatedSession(message.payload.scenarioPlan!, {
            settle: async (strategy) =>
              createSettledResult({
                strategy: strategy.type,
                durationMs: 250,
                status: "timeout",
                details: {
                  timeoutMs: strategy.timeout_ms
                }
              })
          })
      },
      callbackClient: createStubCallbackClient({
        sendStepEvents: async (_runId, payload) => {
          stepEvents.push(...payload.events);
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

    const result = await worker.handleMessage(message);

    assert.equal(result.summary.completedStepCount, 1);
    assert.equal(result.summary.failedStepCount, 0);
  } finally {
    console.log = originalLog;
  }

  assert.ok(
    stepEvents.some(
      (event) =>
        event.eventType === "STEP_COMPLETED" &&
        event.stepKey === "step_001_settle_timeout" &&
        (event.payload.settle as { status?: string }).status === "timeout"
    )
  );
  assert.ok(
    capturedLogs.some(
      (line) =>
        line.includes("\"event\":\"step_settle_timeout\"") &&
        line.includes("\"stepKey\":\"step_001_settle_timeout\"") &&
        line.includes("\"timeoutMs\":250") &&
        line.includes("\"timeoutPolicy\":\"continue_with_timeout_settle_status\"")
    )
  );
});

test("[Worker recovery] browser crash는 전용 failure code로 실패하고 증거 캡처 실패를 원인 실패로 덮지 않는다", async () => {
  const message = await loadExampleMessage();
  message.payload.scenarioPlan!.steps = [
    {
      step_id: "step_001_crash",
      stage: "CTA",
      description: "browser crash",
      action: {
        type: "click",
        target: {
          selector: "#submit"
        }
      },
      settle_strategy: {
        type: "none",
        timeout_ms: 0
      },
      checkpoint: false
    }
  ];

  let failedPayload: RunnerFailedPayload | null = null;

  const worker = registerWorker({
    config: createRunnerTestConfig(),
    browserFactory: {
      kind: "simulated-playwright",
      createSession: async () =>
        createSimulatedSession(message.payload.scenarioPlan!, {
          execute: async () => {
            const error = new Error("Target page, context or browser has been closed");
            error.name = "BrowserCrashError";
            throw error;
          },
          snapshot: () => createSimulatedPageSnapshot(message.payload.scenarioPlan!, {
            browserHealth: {
              status: "crashed",
              reason: "page_crash",
              observedAt: "2026-05-11T00:00:00.000Z"
            }
          }),
          captureArtifacts: async () => {
            throw new Error("Target page, context or browser has been closed");
          }
        })
    },
    callbackClient: createStubCallbackClient({
      sendFailed: async (_runId, payload) => {
        failedPayload = payload;
      }
    }),
    capturePipeline: {
      collectCheckpoint: async () => {
        throw new Error("failure capture should degrade before checkpoint collection");
      }
    },
    artifactStore: {
      persistArtifacts: async () => []
    }
  });

  await assert.rejects(() => worker.handleMessage(message), /Target page, context or browser has been closed/);

  if (failedPayload === null) {
    throw new Error("failed payload was not captured");
  }

  assert.equal((failedPayload as RunnerFailedPayload).failureCode, "RUNNER_BROWSER_CRASH");
  assert.equal((failedPayload as RunnerFailedPayload).failureMessage, "Target page, context or browser has been closed");
});

test("[Worker lifecycle] checkpoint callback 실패는 partial delivery로 기록하고 finished는 계속 보낸다", async () => {
  const message = await loadExampleMessage();
  message.payload.scenarioPlan!.steps = [
    {
      step_id: "step_001_checkpoint",
      stage: "FIRST_VIEW",
      description: "checkpoint callback failure",
      action: {
        type: "checkpoint"
      },
      settle_strategy: {
        type: "none",
        timeout_ms: 0
      },
      checkpoint: true
    }
  ];
  let finishedCount = 0;

  const worker = registerWorker({
    config: createRunnerTestConfig(),
    browserFactory: {
      kind: "simulated-playwright",
      createSession: async () => createSimulatedSession(message.payload.scenarioPlan!)
    },
    callbackClient: createStubCallbackClient({
      sendCheckpoints: async () => {
        throw new Error("checkpoint callback unavailable");
      },
      sendFinished: async () => {
        finishedCount += 1;
      }
    }),
    capturePipeline: {
      collectCheckpoint: async ({ step, settleResult }) => ({
        checkpoint: {
          checkpointId: "checkpoint-1",
          stepKey: step.step_id,
          stage: step.stage,
          trigger: {},
          settle: { ...settleResult },
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

  const result = await worker.handleMessage(message);

  assert.equal(result.summary.completedStepCount, 1);
  assert.equal(result.delivery.status, "DELIVERY_PARTIAL");
  assert.deepEqual(result.delivery.issues.map((issue) => issue.scope), ["checkpoints-callback"]);
  assert.deepEqual(result.delivery.issues.map((issue) => issue.impact), ["partial"]);
  assert.equal(finishedCount, 1);
});

test("[Worker lifecycle] 실행 자체가 성공했다면 finished callback 실패만으로 실행 실패로 바꾸지 않는다", async () => {
  const message = await loadExampleMessage();
  message.payload.scenarioPlan!.steps = [
    {
      step_id: "step_001_fill_email",
      stage: "INPUT",
      description: "fill email once",
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
    }
  ];

  const worker = registerWorker({
    config: createRunnerTestConfig(),
    browserFactory: {
      kind: "simulated-playwright",
      createSession: async () =>
        createSimulatedSession(message.payload.scenarioPlan!, {
          execute: async (action) => ({
            actionType: action.type,
            targetSummary: "label=Email",
            stopRequested: false,
            details: {}
          }),
          settle: async () =>
            createSettledResult({
              strategy: "fixed_short",
              durationMs: 1
            }),
          snapshot: () => createSimulatedPageSnapshot(message.payload.scenarioPlan!),
          close: async () => {}
        })
    },
    callbackClient: createStubCallbackClient({
      sendFinished: async () => {
        throw new Error("finished callback failed");
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

  const result = await worker.handleMessage(message);
  assert.equal(result.summary.completedStepCount, 1);
  assert.equal(result.delivery.status, "DELIVERY_FAILED");
  assert.deepEqual(result.delivery.issues.map((issue) => issue.scope), ["finished-callback"]);
});
