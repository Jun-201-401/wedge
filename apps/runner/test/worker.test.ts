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
import type { AgentEvent, AgentTraceCallbackPayload, Artifact, ArtifactDraft, InteractiveComponentObservationItem, RunnerFailedPayload, StepEvent } from "../src/shared/contracts.ts";

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
  const agentEvents: AgentEvent[] = [];
  const stepEvents: StepEvent[] = [];
  const agentTraces: AgentTraceCallbackPayload[] = [];
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
      },
      sendAgentEvents: async (_runId, payload) => {
        agentEvents.push(...payload.events);
      },
      sendStepEvents: async (_runId, payload) => {
        stepEvents.push(...payload.events);
      },
      sendAgentTrace: async (_runId, payload) => {
        agentTraces.push(payload);
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
  assert.equal(persistedArtifacts.length, 2);
  const traceArtifactDraft = persistedArtifacts.find((artifact) => artifact.stepKey === "agent_trace");
  const scenarioPlanExportDraft = persistedArtifacts.find((artifact) => artifact.stepKey === "agent_scenario_plan_export");
  assert.equal(traceArtifactDraft?.artifactType, "TRACE");
  assert.match(traceArtifactDraft?.content ?? "", /"outcome"/);
  assert.equal(scenarioPlanExportDraft?.artifactType, "OTHER");
  assert.match(scenarioPlanExportDraft?.content ?? "", /"scenario_plan"/);
  assert.match(scenarioPlanExportDraft?.content ?? "", /"stop_when"/);
  assert.equal(result.traceArtifact?.artifactType, "TRACE");
  assert.equal(result.scenarioPlanExport?.status, "EXPORTED");
  assert.equal(result.scenarioPlanExportArtifact?.artifactType, "OTHER");
  assert.equal(artifactCallbacks.length, 2);
  assert.ok(artifactCallbacks.some((artifact) => artifact.artifactType === "TRACE"));
  assert.ok(artifactCallbacks.some((artifact) => artifact.stepKey === "agent_scenario_plan_export"));
  assert.equal(stepEvents.length, 0);
  assert.ok(agentEvents.some((event) => event.eventType === "PRE_DECISION_VERIFIED"));
  assert.ok(agentEvents.some((event) => event.eventType === "DECISION_MADE"));
  assert.ok(agentEvents.some((event) => event.eventType === "TRACE_PERSISTED"));
  assert.equal(
    agentEvents.find((event) => event.eventType === "TRACE_PERSISTED")?.payload.scenarioPlanExportStatus,
    "EXPORTED"
  );
  assert.equal(agentTraces.length, 1);
  assert.equal(agentTraces[0].taskId, task.task_id);
  assert.equal(agentTraces[0].traceArtifact?.artifactType, "TRACE");
  assert.equal((agentTraces[0].trace as { outcome?: { status?: string } }).outcome?.status, "SUCCESS");
  assert.equal(closed, true);
});

test("[Agent Worker] 이미 목표 상태면 새 decision 전에 중단한다", async () => {
  const message = await loadAgentExampleMessage();
  const task = message.payload.agentTask;
  task.goal = "checkout 진입 여부를 확인한다";
  task.budget.max_steps = 3;

  const executedActions: string[] = [];
  const agentEvents: AgentEvent[] = [];
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
      sendAgentEvents: async (_runId, payload) => {
        agentEvents.push(...payload.events);
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
  assert.equal(agentEvents.some((event) => event.eventType === "PRE_DECISION_VERIFIED"), true);
  assert.equal(closed, true);
});

test("[Agent Worker] 동일 idempotency_key 중복 메시지는 같은 실행 결과를 재사용한다", async () => {
  const message = await loadAgentExampleMessage();
  const task = message.payload.agentTask;
  task.goal = "checkout 진입 여부를 확인한다";
  task.idempotency_key = "agent-idempotency-smoke";

  let createSessionCount = 0;
  let acceptedCount = 0;
  let finishedCount = 0;

  const worker = registerAgentWorker({
    config: createRunnerTestConfig({
      artifactsRoot: join(tmpdir(), "runner-test-agent-idempotency-artifacts"),
      callbackLogFile: join(tmpdir(), "runner-test-agent-idempotency-callbacks.jsonl")
    }),
    browserFactory: {
      kind: "simulated-playwright",
      createSession: async ({ plan }) => {
        createSessionCount += 1;

        return createSimulatedSession(plan, {
          execute: async () => {
            throw new Error("duplicate idempotency test should stop before action");
          },
          settle: async () => createSettledResult(),
          snapshot: () => createSimulatedPageSnapshot(plan, {
            currentUrl: "https://example.com/checkout",
            finalUrl: "https://example.com/checkout",
            title: "Checkout"
          })
        });
      }
    },
    callbackClient: createStubCallbackClient({
      sendAccepted: async () => {
        acceptedCount += 1;
      },
      sendFinished: async () => {
        finishedCount += 1;
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

  const firstResult = await worker.handleMessage(message);
  const duplicateResult = await worker.handleMessage(message);

  assert.equal(firstResult, duplicateResult);
  assert.equal(createSessionCount, 1);
  assert.equal(acceptedCount, 1);
  assert.equal(finishedCount, 1);
  assert.equal(duplicateResult.trace.outcome.status, "SUCCESS");
});

test("[Agent Worker] terminal idempotency record가 있으면 새 worker process도 재실행하지 않는다", async () => {
  const message = await loadAgentExampleMessage();
  const task = message.payload.agentTask;
  task.goal = "checkout 진입 여부를 확인한다";
  task.idempotency_key = "agent-idempotency-cross-process";
  const artifactsRoot = join(tmpdir(), `runner-test-agent-idempotency-cross-${Date.now()}`);

  let firstCreateSessionCount = 0;
  const firstWorker = registerAgentWorker({
    config: createRunnerTestConfig({
      artifactsRoot,
      callbackLogFile: join(artifactsRoot, "first-callbacks.jsonl"),
      agentIdempotencyStoreEnabled: true
    }),
    browserFactory: {
      kind: "simulated-playwright",
      createSession: async ({ plan }) => {
        firstCreateSessionCount += 1;

        return createSimulatedSession(plan, {
          execute: async () => {
            throw new Error("idempotency record test should stop before action");
          },
          settle: async () => createSettledResult(),
          snapshot: () => createSimulatedPageSnapshot(plan, {
            currentUrl: "https://example.com/checkout",
            finalUrl: "https://example.com/checkout",
            title: "Checkout"
          })
        });
      }
    },
    callbackClient: createStubCallbackClient(),
    capturePipeline: {
      collectCheckpoint: async () => {
        throw new Error("checkpoint collection should not run when pre-decision verification succeeds");
      }
    },
    artifactStore: {
      persistArtifacts: async () => []
    }
  });

  const firstResult = await firstWorker.handleMessage(message);
  assert.equal(firstCreateSessionCount, 1);
  assert.equal(firstResult.trace.outcome.status, "SUCCESS");

  const secondWorker = registerAgentWorker({
    config: createRunnerTestConfig({
      artifactsRoot,
      callbackLogFile: join(artifactsRoot, "second-callbacks.jsonl"),
      agentIdempotencyStoreEnabled: true
    }),
    browserFactory: {
      kind: "simulated-playwright",
      createSession: async () => {
        throw new Error("persisted idempotency record should prevent a new browser session");
      }
    },
    callbackClient: createStubCallbackClient(),
    capturePipeline: {
      collectCheckpoint: async () => {
        throw new Error("checkpoint collection should not run for persisted duplicate");
      }
    },
    artifactStore: {
      persistArtifacts: async () => []
    }
  });

  const duplicateResult = await secondWorker.handleMessage(message);
  assert.deepEqual(duplicateResult.summary, firstResult.summary);
  assert.deepEqual(duplicateResult.trace, firstResult.trace);
  assert.deepEqual(duplicateResult.delivery, firstResult.delivery);
  assert.equal(duplicateResult.runId, firstResult.runId);
});

test("[Agent Worker] 로그인 벽을 감지하면 decision 전에 중단한다", async () => {
  const message = await loadAgentExampleMessage();
  const task = message.payload.agentTask;
  task.goal = "checkout 진입 여부를 확인한다";

  const executedActions: string[] = [];
  const agentEvents: AgentEvent[] = [];

  const worker = registerAgentWorker({
    config: createRunnerTestConfig({
      artifactsRoot: join(tmpdir(), "runner-test-agent-login-wall-artifacts"),
      callbackLogFile: join(tmpdir(), "runner-test-agent-login-wall-callbacks.jsonl")
    }),
    browserFactory: {
      kind: "simulated-playwright",
      createSession: async ({ plan }) =>
        createSimulatedSession(plan, {
          execute: async (action) => {
            executedActions.push(action.type);
            throw new Error("agent should stop at login wall before requesting an action");
          },
          settle: async () => createSettledResult(),
          snapshot: () => createSimulatedPageSnapshot(plan, {
            currentUrl: "https://example.com/login",
            finalUrl: "https://example.com/login",
            title: "로그인 필요"
          })
        })
    },
    callbackClient: createStubCallbackClient({
      sendAgentEvents: async (_runId, payload) => {
        agentEvents.push(...payload.events);
      }
    }),
    capturePipeline: {
      collectCheckpoint: async () => {
        throw new Error("checkpoint collection should not run on login wall");
      }
    },
    artifactStore: {
      persistArtifacts: async () => []
    }
  });

  const result = await worker.handleMessage(message);

  assert.deepEqual(executedActions, []);
  assert.equal(result.trace.outcome.status, "BLOCKED");
  assert.equal(result.trace.turns[0].preDecisionVerification.outcome, "BLOCKED_LOGIN");
  assert.equal(
    agentEvents.some((event) => event.eventType === "PRE_DECISION_VERIFIED" && event.payload.outcome === "BLOCKED_LOGIN"),
    true
  );
});

test("[Agent Worker] CAPTCHA를 감지하면 decision 전에 중단한다", async () => {
  const message = await loadAgentExampleMessage();
  const task = message.payload.agentTask;

  const executedActions: string[] = [];

  const worker = registerAgentWorker({
    config: createRunnerTestConfig({
      artifactsRoot: join(tmpdir(), "runner-test-agent-captcha-artifacts"),
      callbackLogFile: join(tmpdir(), "runner-test-agent-captcha-callbacks.jsonl")
    }),
    browserFactory: {
      kind: "simulated-playwright",
      createSession: async ({ plan }) =>
        createSimulatedSession(plan, {
          execute: async (action) => {
            executedActions.push(action.type);
            throw new Error("agent should stop at CAPTCHA before requesting an action");
          },
          settle: async () => createSettledResult(),
          snapshot: () => createSimulatedPageSnapshot(plan, {
            title: "Verify you are human - CAPTCHA"
          })
        })
    },
    callbackClient: createStubCallbackClient(),
    capturePipeline: {
      collectCheckpoint: async () => {
        throw new Error("checkpoint collection should not run on CAPTCHA");
      }
    },
    artifactStore: {
      persistArtifacts: async () => []
    }
  });

  const result = await worker.handleMessage(message);

  assert.deepEqual(executedActions, []);
  assert.equal(result.trace.outcome.status, "BLOCKED");
  assert.equal(result.trace.turns[0].preDecisionVerification.outcome, "BLOCKED_CAPTCHA");
});

test("[Agent Worker] 최종 결제 액션이 보이면 decision 전에 정책 차단한다", async () => {
  const message = await loadAgentExampleMessage();
  const task = message.payload.agentTask;
  task.goal = "checkout 진입 여부를 확인한다";

  const executedActions: string[] = [];

  const worker = registerAgentWorker({
    config: createRunnerTestConfig({
      artifactsRoot: join(tmpdir(), "runner-test-agent-payment-block-artifacts"),
      callbackLogFile: join(tmpdir(), "runner-test-agent-payment-block-callbacks.jsonl")
    }),
    browserFactory: {
      kind: "simulated-playwright",
      createSession: async ({ plan }) =>
        createSimulatedSession(plan, {
          execute: async (action) => {
            executedActions.push(action.type);
            throw new Error("agent should stop before final payment decision");
          },
          settle: async () => createSettledResult(),
          snapshot: () => createSimulatedPageSnapshot(plan, {
            currentUrl: "https://example.com/checkout/payment",
            finalUrl: "https://example.com/checkout/payment",
            title: "결제",
            interactiveComponents: [
              {
                text: "결제하기",
                selector: "#pay-now",
                role: "button",
                tag: "button",
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
          })
        })
    },
    callbackClient: createStubCallbackClient(),
    capturePipeline: {
      collectCheckpoint: async () => {
        throw new Error("checkpoint collection should not run on final payment block");
      }
    },
    artifactStore: {
      persistArtifacts: async () => []
    }
  });

  const result = await worker.handleMessage(message);

  assert.deepEqual(executedActions, []);
  assert.equal(result.trace.outcome.status, "POLICY_BLOCKED");
  assert.equal(result.trace.turns[0].preDecisionVerification.outcome, "POLICY_BLOCKED");
});

test("[Agent Worker] checkout 휴리스틱은 장바구니 담기, 카트, checkout 순서로 진행한다", async () => {
  const message = await loadAgentExampleMessage();
  const task = message.payload.agentTask;
  task.goal = "checkout 진입 여부를 확인한다";
  task.budget.max_steps = 5;
  task.budget.max_same_page_attempts = 0;
  task.artifact_policy = {
    capture_screenshots: false,
    capture_dom_snapshots: false,
    capture_ax_tree: false,
    capture_trace: true
  };

  const executedTargets: Array<string | null> = [];
  let currentUrl = task.start_url;
  let loaded = false;
  let addedToCart = false;

  const worker = registerAgentWorker({
    config: createRunnerTestConfig({
      artifactsRoot: join(tmpdir(), "runner-test-agent-checkout-heuristic-artifacts"),
      callbackLogFile: join(tmpdir(), "runner-test-agent-checkout-heuristic-callbacks.jsonl")
    }),
    browserFactory: {
      kind: "simulated-playwright",
      createSession: async ({ plan }) =>
        createSimulatedSession(plan, {
          execute: async (action) => {
            const selector = action.target && typeof action.target === "object" && "selector" in action.target
              ? String(action.target.selector)
              : null;
            executedTargets.push(selector);

            if (action.type === "goto") {
              loaded = true;
              currentUrl = task.start_url;
            }
            if (selector === "#add-to-cart") {
              addedToCart = true;
            }
            if (selector === "#cart") {
              currentUrl = "https://example.com/cart";
            }
            if (selector === "#checkout") {
              currentUrl = "https://example.com/checkout";
            }

            return {
              actionType: action.type,
              targetSummary: selector,
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
            title: currentUrl.endsWith("/cart") ? "Cart" : "Product",
            interactiveComponents: createCheckoutHeuristicComponents(currentUrl, loaded, addedToCart)
          })
        })
    },
    callbackClient: createStubCallbackClient(),
    capturePipeline: {
      collectCheckpoint: async () => {
        throw new Error("checkpoint collection should not run when capture_screenshots is false");
      }
    },
    artifactStore: {
      persistArtifacts: async () => []
    }
  });

  const result = await worker.handleMessage(message);

  assert.deepEqual(executedTargets, [null, "#add-to-cart", "#cart", "#checkout"]);
  assert.equal(result.trace.outcome.status, "SUCCESS");
  assert.equal(result.trace.turns.at(-1)?.postActionVerification?.satisfied, true);
});

function createCheckoutHeuristicComponents(
  currentUrl: string,
  loaded: boolean,
  addedToCart: boolean
): InteractiveComponentObservationItem[] {
  if (!loaded) {
    return [];
  }

  if (currentUrl.endsWith("/cart")) {
    return [
      workerComponent("Checkout", "#checkout", true),
      workerComponent("Remove item", "#remove", false)
    ];
  }

  if (addedToCart) {
    return [
      workerComponent("장바구니", "#cart", false),
      workerComponent("계속 쇼핑", "#continue", true)
    ];
  }

  return [
    workerComponent("Learn more", "#learn-more", true),
    workerComponent("장바구니 담기", "#add-to-cart", false)
  ];
}

function workerComponent(
  text: string,
  selector: string,
  isPrimaryLike: boolean
): InteractiveComponentObservationItem {
  return {
    text,
    selector,
    role: "button",
    tag: "button",
    clickable: true,
    clicked_in_scenario: false,
    is_cta_candidate: true,
    is_primary_like: isPrimaryLike,
    bounds: {
      x: 10,
      y: 10,
      width: 120,
      height: 40,
      unit: "css_px"
    }
  };
}
