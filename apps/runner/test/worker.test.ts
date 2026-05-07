import assert from "node:assert/strict";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerAgentWorker } from "../src/worker/agent-worker.ts";
import { registerWorker } from "../src/worker/index.ts";
import {
  cloneMessage,
  createRunnerTestConfig,
  createSettledResult,
  createSimulatedPageSnapshot,
  createSimulatedSession,
  createStubCallbackClient,
  loadAgentExampleMessage,
  loadExampleMessage
} from "./support.ts";
import type { Artifact, ArtifactDraft, RunnerFailedPayload, StepEvent } from "../src/shared/contracts.ts";

test("[Worker lifecycle] accepted callback 실패 시 session을 닫고 failed callback을 보낸다", async () => {
  const message = await loadExampleMessage();
  let closed = false;
  let failedPayload: RunnerFailedPayload | null = null;

  const worker = registerWorker({
    config: createRunnerTestConfig({
      artifactsRoot: join(tmpdir(), "runner-test-artifacts"),
      callbackLogFile: join(tmpdir(), "runner-test-callbacks.jsonl")
    }),
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
      config: createRunnerTestConfig({
        artifactsRoot: join(tmpdir(), "runner-test-artifacts"),
        callbackLogFile: join(tmpdir(), "runner-test-callbacks.jsonl")
      }),
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
        sendFailed: async (_runId, payload) => {
          failedPayload = payload;
        }
      }),
      capturePipeline: {
        collectCheckpoint: async () => {
          throw new Error("checkpoint collection should not be called on timeout");
        }
      },
      artifactStore: {
        persistArtifacts: async () => []
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
  assert.deepEqual(capturedFailedPayload.summary, {
    completedStepCount: 0,
    failedStepCount: 1,
    stopped: false
  });
  assert.ok(
    stepEvents.some(
      (event) =>
        event.eventType === "STEP_FAILED" &&
        event.stepKey === "step_001_timeout" &&
        event.payload.failureCode === "RUNNER_TIMEOUT"
    )
  );
  assert.ok(
    capturedLogs.some(
      (line) =>
        line.includes("\"event\":\"run_failed\"") &&
        line.includes(`"runId":"${message.payload.runId}"`) &&
        line.includes("\"failedStepKey\":\"step_001_timeout\"") &&
        line.includes("\"failureCode\":\"RUNNER_TIMEOUT\"")
    )
  );
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
    config: createRunnerTestConfig({
      artifactsRoot: join(tmpdir(), "runner-test-artifacts"),
      callbackLogFile: join(tmpdir(), "runner-test-callbacks.jsonl")
    }),
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

test("[Agent Worker] AgentTask로 CTA 후보를 관찰해 클릭한다", async () => {
  const message = await loadAgentExampleMessage();
  const task = message.payload.agentTask;
  task.goal = "무료로 시작하기 CTA를 찾아 진입한다";
  task.budget.max_steps = 3;
  task.budget.max_same_page_attempts = 0;
  task.artifact_policy = {
    capture_screenshots: false,
    capture_dom_snapshots: false,
    capture_ax_tree: false,
    capture_trace: true
  };

  const executedActions: string[] = [];
  const persistedArtifacts: ArtifactDraft[] = [];
  const artifactCallbacks: Artifact[] = [];
  let currentUrl = task.start_url;
  let loaded = false;
  let closed = false;

  const worker = registerAgentWorker({
    config: createRunnerTestConfig({
      artifactsRoot: join(tmpdir(), "runner-test-agent-artifacts"),
      callbackLogFile: join(tmpdir(), "runner-test-agent-callbacks.jsonl")
    }),
    browserFactory: {
      kind: "simulated-playwright",
      createSession: async ({ plan }) =>
        createSimulatedSession(plan, {
          execute: async (action) => {
            executedActions.push(action.type);
            if (action.type === "goto") {
              loaded = true;
              currentUrl = task.start_url;
            }
            if (action.type === "click") {
              currentUrl = "https://example.com/signup";
            }
            return {
              actionType: action.type,
              targetSummary: action.target && typeof action.target === "object" && "selector" in action.target
                ? String(action.target.selector)
                : null,
              stopRequested: false,
              details: {
                currentUrl
              }
            };
          },
          settle: async () => createSettledResult(),
          snapshot: () => createSimulatedPageSnapshot(plan, {
            currentUrl,
            finalUrl: currentUrl,
            interactiveComponents: loaded && currentUrl === task.start_url
              ? [
                {
                  text: "무료로 시작하기",
                  selector: "#start-free",
                  role: "link",
                  tag: "a",
                  clickable: true,
                  clicked_in_scenario: false,
                  is_cta_candidate: true,
                  is_primary_like: true,
                  bounds: {
                    x: 10,
                    y: 10,
                    width: 120,
                    height: 40,
                    unit: "css_px"
                  }
                }
              ]
              : []
          }),
          close: async () => {
            closed = true;
          }
        })
    },
    callbackClient: createStubCallbackClient({
      sendArtifacts: async (_runId, payload) => {
        artifactCallbacks.push(...payload.artifacts);
      }
    }),
    capturePipeline: {
      collectCheckpoint: async () => {
        throw new Error("checkpoint collection should not run when capture_screenshots is false");
      }
    },
    artifactStore: {
      persistArtifacts: async ({ artifacts }) => {
        persistedArtifacts.push(...artifacts);
        return artifacts.map((artifact) => ({
          artifactId: artifact.artifactId,
          artifactType: artifact.artifactType,
          bucket: "local-runner",
          key: `runs/${task.run_id}/${artifact.stepKey}/${artifact.artifactId}-${artifact.artifactType.toLowerCase()}.${artifact.fileExtension}`,
          mimeType: artifact.mimeType,
          sizeBytes: artifact.content.length,
          sha256: "trace-sha",
          createdAt: "2026-05-07T00:00:00.000Z",
          stepKey: artifact.stepKey
        }));
      }
    }
  });

  const result = await worker.handleMessage(message);

  assert.deepEqual(executedActions, ["goto", "click"]);
  assert.equal(result.summary.completedStepCount, 2);
  assert.equal(result.summary.stopped, true);
  assert.equal(result.trace.outcome.status, "SUCCESS");
  assert.equal(result.trace.turns.length, 2);
  assert.equal(result.trace.turns[0].preDecisionVerification.phase, "pre_decision");
  assert.equal(result.trace.turns[1].decision?.action.type, "click");
  assert.equal(result.trace.turns[1].policy?.allowed, true);
  assert.equal(result.trace.turns[1].postActionVerification?.satisfied, true);
  assert.equal(persistedArtifacts.length, 1);
  assert.equal(persistedArtifacts[0].artifactType, "TRACE");
  assert.equal(persistedArtifacts[0].stepKey, "agent_trace");
  assert.match(persistedArtifacts[0].content, /"outcome"/);
  assert.equal(result.traceArtifact?.artifactType, "TRACE");
  assert.equal(artifactCallbacks.length, 1);
  assert.equal(artifactCallbacks[0].artifactType, "TRACE");
  assert.equal(closed, true);
});

test("[Agent Worker] 이미 목표 상태면 새 decision 전에 중단한다", async () => {
  const message = await loadAgentExampleMessage();
  const task = message.payload.agentTask;
  task.goal = "checkout 진입 여부를 확인한다";
  task.budget.max_steps = 3;

  const executedActions: string[] = [];
  const stepEvents: StepEvent[] = [];
  let closed = false;

  const worker = registerAgentWorker({
    config: createRunnerTestConfig({
      artifactsRoot: join(tmpdir(), "runner-test-agent-preverify-artifacts"),
      callbackLogFile: join(tmpdir(), "runner-test-agent-preverify-callbacks.jsonl")
    }),
    browserFactory: {
      kind: "simulated-playwright",
      createSession: async ({ plan }) =>
        createSimulatedSession(plan, {
          execute: async (action) => {
            executedActions.push(action.type);
            throw new Error("agent should stop before requesting an action");
          },
          settle: async () => createSettledResult(),
          snapshot: () => createSimulatedPageSnapshot(plan, {
            currentUrl: "https://example.com/checkout",
            finalUrl: "https://example.com/checkout",
            title: "Checkout"
          }),
          close: async () => {
            closed = true;
          }
        })
    },
    callbackClient: createStubCallbackClient({
      sendStepEvents: async (_runId, payload) => {
        stepEvents.push(...payload.events);
      }
    }),
    capturePipeline: {
      collectCheckpoint: async () => {
        throw new Error("checkpoint collection should not run when pre-decision verification succeeds");
      }
    },
    artifactStore: {
      persistArtifacts: async () => []
    }
  });

  const result = await worker.handleMessage(message);

  assert.deepEqual(executedActions, []);
  assert.equal(result.summary.completedStepCount, 0);
  assert.equal(result.summary.stopped, true);
  assert.equal(result.trace.outcome.status, "SUCCESS");
  assert.equal(result.trace.turns.length, 1);
  assert.equal(result.trace.turns[0].preDecisionVerification.satisfied, true);
  assert.ok(stepEvents.some((event) => event.payload.event === "PRE_DECISION_VERIFIED"));
  assert.equal(closed, true);
});
