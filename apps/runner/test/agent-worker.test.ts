import assert from "node:assert/strict";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createAgentRuntimePlan, executeAgentRun, type AgentDecisionClient } from "../src/agent/index.ts";
import { createAgentWorkerHarness, createCheckoutHeuristicComponents } from "./agent-support.ts";
import { registerAgentWorker } from "../src/worker/agent-worker.ts";
import type { AgentRunnerExecutionResult } from "../src/worker/agent-worker.ts";
import type { AgentIdempotencyStore } from "../src/worker/agent-idempotency.ts";
import {
  cloneMessage,
  createRunnerTestConfig,
  createSettledResult,
  createSimulatedPageSnapshot,
  createSimulatedSession,
  createStubCallbackClient,
  loadAgentExampleMessage
} from "./support.ts";
import type { AgentEvent, AgentTraceCallbackPayload, Artifact, ArtifactDraft, StepEvent } from "../src/shared/contracts.ts";

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
  assert.equal(result.summary.stopped, false);
  assert.equal(result.trace.outcome.status, "SUCCESS");
  assert.equal(result.trace.turns.length, 2);
  assert.equal(result.trace.turns[0].preDecisionVerification.phase, "pre_decision");
  assert.equal(result.trace.turns[1].decision?.action.type, "click");
  assert.equal(result.trace.turns[1].decision?.metadata?.decisionSource, "heuristic");
  assert.match(result.trace.turns[1].decision?.metadata?.decisionId ?? "", /^[0-9a-f-]{36}$/);
  assert.equal(result.trace.turns[1].policy?.allowed, true);
  assert.equal(result.trace.turns[1].postActionVerification?.satisfied, true);
  assert.equal(persistedArtifacts.length, 2);
  const traceArtifactDraft = persistedArtifacts.find((artifact) => artifact.stepKey === "agent_trace");
  const scenarioPlanExportDraft = persistedArtifacts.find((artifact) => artifact.stepKey === "agent_scenario_plan_export");
  assert.equal(traceArtifactDraft?.artifactType, "TRACE");
  assert.match(traceArtifactDraft?.content ?? "", /"outcome"/);
  assert.match(traceArtifactDraft?.content ?? "", /"decisionSource": "heuristic"/);
  assert.match(traceArtifactDraft?.content ?? "", /"decisionId":/);
  assert.doesNotMatch(traceArtifactDraft?.content ?? "", /rawPrompt|messages|outputSchema/);
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
  assert.equal(result.summary.stopped, false);
  assert.equal(result.trace.outcome.status, "SUCCESS");
  assert.equal(result.trace.turns.length, 1);
  assert.equal(result.trace.turns[0].preDecisionVerification.satisfied, true);
  assert.equal(agentEvents.some((event) => event.eventType === "PRE_DECISION_VERIFIED"), true);
  assert.equal(closed, true);
});

test("[Agent Worker] checkpoint decision은 browser action으로 실행하지 않는다", async () => {
  const message = await loadAgentExampleMessage();
  const task = message.payload.agentTask;
  task.goal = "현재 페이지를 검증하되 브라우저 액션은 실행하지 않는다";
  task.budget.max_steps = 1;
  task.artifact_policy = {
    capture_screenshots: false,
    capture_dom_snapshots: false,
    capture_ax_tree: false,
    capture_trace: false
  };

  const runtimePlan = createAgentRuntimePlan(task);
  const executedActions: string[] = [];
  const agentEvents: AgentEvent[] = [];
  const decisionClient: AgentDecisionClient = {
    decide: () => ({
      kind: "checkpoint",
      description: "Test checkpoint without browser action.",
      reason: "LLM requested checkpoint before continuing.",
      confidence: 0.7,
      action: {
        type: "checkpoint"
      },
      settleStrategy: {
        type: "none",
        timeout_ms: 0
      },
      stage: "CTA",
      targetKey: null
    })
  };

  const result = await executeAgentRun({
    runId: task.run_id,
    task,
    runtimePlan,
    session: createSimulatedSession(runtimePlan, {
      execute: async (action) => {
        executedActions.push(action.type);
        throw new Error("checkpoint decision should not execute a browser action");
      },
      settle: async () => createSettledResult(),
      snapshot: () => createSimulatedPageSnapshot(runtimePlan, {
        finalUrl: task.start_url,
        interactiveComponents: [
          {
            text: "Proceed to checkout",
            selector: "#real-checkout",
            role: "link",
            tag: "a",
            clickable: true,
            clicked_in_scenario: false,
            is_cta_candidate: true,
            is_primary_like: true,
            bounds: {
              x: 0,
              y: 0,
              width: 100,
              height: 40,
              unit: "css_px"
            }
          }
        ]
      })
    }),
    callbackClient: createStubCallbackClient({
      sendAgentEvents: async (_runId, payload) => {
        agentEvents.push(...payload.events);
      }
    }),
    capturePipeline: {
      collectCheckpoint: async () => {
        throw new Error("checkpoint decision should not collect scenario checkpoint artifacts");
      }
    },
    artifactStore: {
      persistArtifacts: async () => []
    },
    decisionClient
  });

  assert.deepEqual(executedActions, []);
  assert.equal(result.summary.completedStepCount, 0);
  assert.equal(result.trace.turns[0].decision?.kind, "checkpoint");
  assert.equal(result.trace.turns[0].actionResult?.completed, false);
  assert.equal(result.trace.outcome.status, "EXHAUSTED");
  assert.equal(agentEvents.some((event) => event.eventType === "ACTION_COMPLETED"), false);
  assert.equal(agentEvents.some((event) => event.eventType === "GOAL_VERIFIED"), true);
});

test("[Agent Worker] max_duration_ms를 넘긴 decision은 action 전에 EXHAUSTED로 종료한다", async () => {
  const message = await loadAgentExampleMessage();
  const task = message.payload.agentTask;
  task.budget.max_steps = 5;
  task.budget.max_duration_ms = 5;
  task.artifact_policy = {
    capture_screenshots: false,
    capture_dom_snapshots: false,
    capture_ax_tree: false,
    capture_trace: false
  };

  const runtimePlan = createAgentRuntimePlan(task);
  const executedActions: string[] = [];
  const decisionClient: AgentDecisionClient = {
    decide: async () => {
      await delay(50);
      return {
        kind: "act",
        description: "Late decision",
        reason: "This decision should exceed the duration budget.",
        confidence: 0.1,
        action: {
          type: "click",
          target: {
            selector: "#checkout"
          }
        },
        settleStrategy: {
          type: "fixed_short",
          timeout_ms: 1
        },
        stage: "CTA",
        targetKey: "#checkout"
      };
    }
  };

  const result = await executeAgentRun({
    runId: task.run_id,
    task,
    runtimePlan,
    session: createSimulatedSession(runtimePlan, {
      execute: async (action) => {
        executedActions.push(action.type);
        throw new Error("action should not run after duration budget exhaustion");
      },
      settle: async () => createSettledResult(),
      snapshot: () => createSimulatedPageSnapshot(runtimePlan)
    }),
    callbackClient: createStubCallbackClient(),
    capturePipeline: {
      collectCheckpoint: async () => {
        throw new Error("checkpoint collection should not run after duration budget exhaustion");
      }
    },
    artifactStore: {
      persistArtifacts: async () => []
    },
    decisionClient
  });

  assert.deepEqual(executedActions, []);
  assert.equal(result.summary.completedStepCount, 0);
  assert.equal(result.summary.stopped, false);
  assert.equal(result.trace.outcome.status, "EXHAUSTED");
  assert.match(result.trace.outcome.reason, /max_duration_ms/);
});

test("[Agent Worker] max_duration_ms를 넘긴 in-flight action은 반환 전 정리한다", async () => {
  const message = await loadAgentExampleMessage();
  const task = message.payload.agentTask;
  task.budget.max_steps = 1;
  task.budget.max_duration_ms = 20;
  task.artifact_policy = {
    capture_screenshots: false,
    capture_dom_snapshots: false,
    capture_ax_tree: false,
    capture_trace: false
  };

  const runtimePlan = createAgentRuntimePlan(task);
  let actionFinished = false;
  const decisionClient: AgentDecisionClient = {
    decide: () => ({
      kind: "act",
      description: "Click slow target.",
      reason: "Exercise action duration budget.",
      confidence: 0.8,
      action: {
        type: "click",
        target: {
          selector: "#slow-checkout"
        }
      },
      settleStrategy: {
        type: "fixed_short",
        timeout_ms: 1
      },
      stage: "CTA",
      targetKey: "#slow-checkout"
    })
  };

  const result = await executeAgentRun({
    runId: task.run_id,
    task,
    runtimePlan,
    session: createSimulatedSession(runtimePlan, {
      execute: async (action) => {
        await delay(50);
        actionFinished = true;
        return {
          actionType: action.type,
          targetSummary: "#slow-checkout",
          stopRequested: false,
          details: {}
        };
      },
      settle: async () => createSettledResult(),
      snapshot: () => createSimulatedPageSnapshot(runtimePlan)
    }),
    callbackClient: createStubCallbackClient(),
    capturePipeline: {
      collectCheckpoint: async () => {
        throw new Error("checkpoint collection should not run after duration budget exhaustion");
      }
    },
    artifactStore: {
      persistArtifacts: async () => []
    },
    decisionClient
  });

  assert.equal(actionFinished, true);
  assert.equal(result.summary.completedStepCount, 0);
  assert.equal(result.summary.stopped, false);
  assert.equal(result.trace.outcome.status, "EXHAUSTED");
  assert.match(result.trace.outcome.reason, /max_duration_ms/);

  actionFinished = false;
  await delay(20);
  assert.equal(actionFinished, false);
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

test("[Agent Worker] 주입된 idempotency store로 worker 인스턴스 간 중복 실행을 막는다", async () => {
  const message = await loadAgentExampleMessage();
  const task = message.payload.agentTask;
  task.goal = "checkout 진입 여부를 확인한다";
  task.idempotency_key = "agent-idempotency-shared-store";
  const sharedStore = createInMemoryAgentIdempotencyStore();
  const artifactsRoot = join(tmpdir(), `runner-test-agent-idempotency-shared-${Date.now()}`);

  let firstCreateSessionCount = 0;
  const firstWorker = registerAgentWorker({
    config: createRunnerTestConfig({
      artifactsRoot,
      callbackLogFile: join(artifactsRoot, "first-shared-callbacks.jsonl"),
      agentIdempotencyStoreEnabled: true
    }),
    browserFactory: {
      kind: "simulated-playwright",
      createSession: async ({ plan }) => {
        firstCreateSessionCount += 1;

        return createSimulatedSession(plan, {
          execute: async () => {
            throw new Error("shared idempotency store test should stop before action");
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
    },
    agentIdempotencyStore: sharedStore
  });

  const firstResult = await firstWorker.handleMessage(message);
  assert.equal(firstCreateSessionCount, 1);
  assert.equal(firstResult.trace.outcome.status, "SUCCESS");

  const secondWorker = registerAgentWorker({
    config: createRunnerTestConfig({
      artifactsRoot: join(artifactsRoot, "second"),
      callbackLogFile: join(artifactsRoot, "second-shared-callbacks.jsonl"),
      agentIdempotencyStoreEnabled: true
    }),
    browserFactory: {
      kind: "simulated-playwright",
      createSession: async () => {
        throw new Error("shared idempotency store should prevent a new browser session");
      }
    },
    callbackClient: createStubCallbackClient(),
    capturePipeline: {
      collectCheckpoint: async () => {
        throw new Error("checkpoint collection should not run for shared-store duplicate");
      }
    },
    artifactStore: {
      persistArtifacts: async () => []
    },
    agentIdempotencyStore: sharedStore
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

  const worker = createAgentWorkerHarness({
    name: "checkout-heuristic",
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
    }
  });

  const result = await worker.handleMessage(message);

  assert.deepEqual(executedTargets, [null, "#add-to-cart", "#cart", "#checkout"]);
  assert.equal(result.trace.outcome.status, "SUCCESS");
  assert.equal(result.trace.turns.at(-1)?.postActionVerification?.satisfied, true);
});

function createInMemoryAgentIdempotencyStore(): AgentIdempotencyStore {
  const records = new Map<string, AgentRunnerExecutionResult>();

  return {
    read: async (idempotencyKey) => records.get(idempotencyKey) ?? null,
    persist: async (idempotencyKey, result) => {
      records.set(idempotencyKey, result);
    }
  };
}
