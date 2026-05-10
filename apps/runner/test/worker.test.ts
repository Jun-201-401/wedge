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
import type { AgentTrace, ArtifactBatch, RunnerFailedPayload, StepEvent } from "../src/shared/contracts.ts";

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
  const traceArtifactContents: string[] = [];
  const replayPlanArtifactContents: string[] = [];
  const artifactCallbacks: ArtifactBatch[] = [];
  const agentEventCallbacks: AgentTrace["events"][] = [];
  const agentTraceCallbacks: AgentTrace[] = [];
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
        artifactCallbacks.push(payload);
      },
      sendAgentEvents: async (_runId, payload) => {
        agentEventCallbacks.push(payload.events);
      },
      sendAgentTrace: async (_runId, payload) => {
        agentTraceCallbacks.push(payload.trace);
      }
    }),
    capturePipeline: {
      collectCheckpoint: async () => {
        throw new Error("checkpoint collection should not run when capture_screenshots is false");
      }
    },
    artifactStore: {
      persistArtifacts: async ({ runId, artifacts }) =>
        artifacts.map((artifact) => {
          if (artifact.artifactType === "TRACE") {
            traceArtifactContents.push(artifact.content);
          }
          if (artifact.stepKey === "agent_replay_plan") {
            replayPlanArtifactContents.push(artifact.content);
          }
          return {
            artifactId: artifact.artifactId,
            artifactType: artifact.artifactType,
            bucket: "local-runner",
            key: `runs/${runId}/${artifact.stepKey}/${artifact.artifactId}.${artifact.fileExtension}`,
            mimeType: artifact.mimeType,
            width: artifact.width,
            height: artifact.height,
            sizeBytes: artifact.content.length,
            sha256: "test-sha256",
            createdAt: new Date(0).toISOString(),
            stepKey: artifact.stepKey
          };
        })
    }
  });

  const result = await worker.handleMessage(message);

  assert.deepEqual(executedActions, ["goto", "click"]);
  assert.equal(result.summary.completedStepCount, 2);
  assert.equal(result.summary.stopped, true);
  assert.equal(traceArtifactContents.length, 1);
  assert.equal(replayPlanArtifactContents.length, 1);
  const replayPlan = JSON.parse(replayPlanArtifactContents[0]);
  assert.equal(replayPlan.scenario_type, "custom_compiled");
  assert.deepEqual(replayPlan.steps.map((step: any) => step.action.type), ["goto", "click"]);
  const trace = JSON.parse(traceArtifactContents[0]) as AgentTrace;
  assert.equal(trace.run_id, task.run_id);
  assert.equal(trace.task_id, task.task_id);
  assert.equal(trace.final_outcome, "SUCCESS_CHECKOUT_ENTRY_REACHED");
  assert.ok(trace.observations.length >= 2);
  assert.ok(trace.decisions.length >= 2);
  assert.ok(trace.verification_results.length >= 1);
  assert.ok(trace.events.some((event) => event.event_type === "AGENT_OBSERVATION_CAPTURED"));
  assert.ok(trace.events.some((event) => event.event_type === "AGENT_DECISION_RECEIVED"));
  assert.ok(trace.events.some((event) => event.event_type === "AGENT_ACTION_COMPLETED"));
  assert.ok(trace.events.some((event) => event.event_type === "AGENT_VERIFICATION_COMPLETED"));
  assert.ok(trace.events.some((event) => event.event_type === "AGENT_STOPPED"));
  assert.equal(agentEventCallbacks.length, 1);
  assert.equal(agentEventCallbacks[0]?.length, trace.events.length);
  assert.equal(agentTraceCallbacks.length, 1);
  assert.equal(agentTraceCallbacks[0]?.trace_id, trace.trace_id);
  assert.ok(artifactCallbacks.some((batch) => batch.artifacts.some((artifact) => artifact.artifactType === "TRACE")));
  assert.ok(artifactCallbacks.some((batch) => batch.artifacts.some((artifact) => artifact.stepKey === "agent_replay_plan")));
  assert.equal(closed, true);
});

test("[Agent Worker] replay hint 실행 실패 시 rule-based 탐색으로 fallback한다", async () => {
  const message = await loadAgentExampleMessage();
  const task = message.payload.agentTask;
  task.goal = "무료로 시작하기 CTA를 찾아 진입한다";
  task.budget.max_steps = 4;
  task.budget.max_same_page_attempts = 0;
  task.artifact_policy = {
    capture_screenshots: false,
    capture_dom_snapshots: false,
    capture_ax_tree: false,
    capture_trace: true
  };
  task.replay_hints = {
    source_plan_id: "agent-trace-replay-stale",
    steps: [
      {
        description: "Stale checkout CTA selector",
        action: {
          type: "click",
          target: {
            selector: "#stale-checkout"
          }
        },
        target_key: "#stale-checkout"
      }
    ]
  };

  const executedTargets: string[] = [];
  const traceArtifactContents: string[] = [];
  let currentUrl = task.start_url;
  let loaded = false;

  const worker = registerAgentWorker({
    config: createRunnerTestConfig({
      artifactsRoot: join(tmpdir(), "runner-test-agent-replay-fallback-artifacts"),
      callbackLogFile: join(tmpdir(), "runner-test-agent-replay-fallback-callbacks.jsonl")
    }),
    browserFactory: {
      kind: "simulated-playwright",
      createSession: async ({ plan }) =>
        createSimulatedSession(plan, {
          execute: async (action) => {
            const target = action.target && typeof action.target === "object" && "selector" in action.target
              ? String(action.target.selector)
              : action.type;
            executedTargets.push(`${action.type}:${target}`);
            if (action.type === "goto") {
              loaded = true;
              currentUrl = task.start_url;
            }
            if (action.type === "click" && target === "#stale-checkout") {
              throw new Error("stale replay selector");
            }
            if (action.type === "click" && target === "#start-free") {
              currentUrl = "https://example.com/signup";
            }
            return {
              actionType: action.type,
              targetSummary: target,
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
      persistArtifacts: async ({ runId, artifacts }) =>
        artifacts.map((artifact) => {
          if (artifact.artifactType === "TRACE") {
            traceArtifactContents.push(artifact.content);
          }
          return {
            artifactId: artifact.artifactId,
            artifactType: artifact.artifactType,
            bucket: "local-runner",
            key: `runs/${runId}/${artifact.stepKey}/${artifact.artifactId}.${artifact.fileExtension}`,
            mimeType: artifact.mimeType,
            width: artifact.width,
            height: artifact.height,
            sizeBytes: artifact.content.length,
            sha256: "test-sha256",
            createdAt: new Date(0).toISOString(),
            stepKey: artifact.stepKey
          };
        })
    }
  });

  const result = await worker.handleMessage(message);

  assert.deepEqual(executedTargets, ["goto:goto", "click:#stale-checkout", "click:#start-free"]);
  assert.equal(result.summary.completedStepCount, 2);
  assert.equal(result.summary.stopped, true);
  const trace = JSON.parse(traceArtifactContents[0]) as AgentTrace;
  assert.ok(trace.events.some((event) => event.event_type === "AGENT_ACTION_FAILED"));
  assert.ok(trace.decisions.some((decision) => decision.planner_source === "replay_hint"));
  assert.ok(trace.decisions.some((decision) => decision.planner_source === "rule_based"));
});

test("[Agent Worker] Agent 실행 실패도 TRACE artifact로 남긴다", async () => {
  const message = await loadAgentExampleMessage();
  const task = message.payload.agentTask;
  task.budget.max_steps = 1;
  task.artifact_policy = {
    capture_screenshots: false,
    capture_dom_snapshots: false,
    capture_ax_tree: false,
    capture_trace: true
  };

  const traceArtifactContents: string[] = [];
  const agentTraceCallbacks: AgentTrace[] = [];
  let failedPayload: RunnerFailedPayload | null = null;
  let closed = false;

  const worker = registerAgentWorker({
    config: createRunnerTestConfig({
      artifactsRoot: join(tmpdir(), "runner-test-agent-failure-artifacts"),
      callbackLogFile: join(tmpdir(), "runner-test-agent-failure-callbacks.jsonl")
    }),
    browserFactory: {
      kind: "simulated-playwright",
      createSession: async ({ plan }) =>
        createSimulatedSession(plan, {
          execute: async () => {
            throw new Error("agent action failed");
          },
          settle: async () => createSettledResult(),
          snapshot: () => createSimulatedPageSnapshot(plan),
          close: async () => {
            closed = true;
          }
        })
    },
    callbackClient: createStubCallbackClient({
      sendAgentTrace: async (_runId, payload) => {
        agentTraceCallbacks.push(payload.trace);
      },
      sendFailed: async (_runId, payload) => {
        failedPayload = payload;
      }
    }),
    capturePipeline: {
      collectCheckpoint: async () => {
        throw new Error("checkpoint collection should not run when action fails before checkpoint");
      }
    },
    artifactStore: {
      persistArtifacts: async ({ runId, artifacts }) =>
        artifacts.map((artifact) => {
          if (artifact.artifactType === "TRACE") {
            traceArtifactContents.push(artifact.content);
          }
          return {
            artifactId: artifact.artifactId,
            artifactType: artifact.artifactType,
            bucket: "local-runner",
            key: `runs/${runId}/${artifact.stepKey}/${artifact.artifactId}.${artifact.fileExtension}`,
            mimeType: artifact.mimeType,
            width: artifact.width,
            height: artifact.height,
            sizeBytes: artifact.content.length,
            sha256: "test-sha256",
            createdAt: new Date(0).toISOString(),
            stepKey: artifact.stepKey
          };
        })
    }
  });

  await assert.rejects(() => worker.handleMessage(message), /agent action failed/);
  assert.equal(closed, true);
  if (failedPayload === null) {
    throw new Error("failed payload was not captured");
  }

  assert.equal((failedPayload as RunnerFailedPayload).failureCode, "RUNNER_EXECUTION_FAILED");
  assert.equal(traceArtifactContents.length, 1);
  const trace = JSON.parse(traceArtifactContents[0]) as AgentTrace;
  assert.equal(trace.final_outcome, "FAILED_ACTION_ERROR");
  assert.equal(agentTraceCallbacks.length, 1);
  assert.equal(agentTraceCallbacks[0]?.final_outcome, "FAILED_ACTION_ERROR");
  assert.ok(trace.events.some((event) => event.event_type === "AGENT_ACTION_FAILED"));
  assert.ok(trace.events.some((event) => event.event_type === "AGENT_FAILED"));
});

test("[Agent Worker] 정책 차단은 action 실행 없이 TRACE policy_results에 남긴다", async () => {
  const message = await loadAgentExampleMessage();
  const task = message.payload.agentTask;
  task.budget.max_steps = 3;
  task.budget.max_same_page_attempts = 0;
  task.artifact_policy = {
    capture_screenshots: false,
    capture_dom_snapshots: false,
    capture_ax_tree: false,
    capture_trace: true
  };

  const executedActions: string[] = [];
  const traceArtifactContents: string[] = [];
  const stepEvents: StepEvent[] = [];
  let loaded = false;
  let closed = false;

  const worker = registerAgentWorker({
    config: createRunnerTestConfig({
      artifactsRoot: join(tmpdir(), "runner-test-agent-policy-artifacts"),
      callbackLogFile: join(tmpdir(), "runner-test-agent-policy-callbacks.jsonl")
    }),
    browserFactory: {
      kind: "simulated-playwright",
      createSession: async ({ plan }) =>
        createSimulatedSession(plan, {
          execute: async (action) => {
            executedActions.push(action.type);
            if (action.type === "goto") {
              loaded = true;
            }
            return {
              actionType: action.type,
              targetSummary: null,
              stopRequested: false,
              details: {}
            };
          },
          settle: async () => createSettledResult(),
          snapshot: () => createSimulatedPageSnapshot(plan, {
            currentUrl: task.start_url,
            finalUrl: task.start_url,
            interactiveComponents: loaded
              ? [
                {
                  text: "결제 완료",
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
              : []
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
        throw new Error("checkpoint collection should not run when capture_screenshots is false");
      }
    },
    artifactStore: {
      persistArtifacts: async ({ runId, artifacts }) =>
        artifacts.map((artifact) => {
          if (artifact.artifactType === "TRACE") {
            traceArtifactContents.push(artifact.content);
          }
          return {
            artifactId: artifact.artifactId,
            artifactType: artifact.artifactType,
            bucket: "local-runner",
            key: `runs/${runId}/${artifact.stepKey}/${artifact.artifactId}.${artifact.fileExtension}`,
            mimeType: artifact.mimeType,
            width: artifact.width,
            height: artifact.height,
            sizeBytes: artifact.content.length,
            sha256: "test-sha256",
            createdAt: new Date(0).toISOString(),
            stepKey: artifact.stepKey
          };
        })
    }
  });

  const result = await worker.handleMessage(message);

  assert.deepEqual(executedActions, ["goto"]);
  assert.equal(result.summary.completedStepCount, 1);
  assert.equal(result.summary.stopped, true);
  assert.equal(traceArtifactContents.length, 1);
  const trace = JSON.parse(traceArtifactContents[0]) as AgentTrace;
  assert.equal(trace.final_outcome, "POLICY_BLOCKED_FINAL_PAYMENT_SUBMIT");
  assert.equal(trace.policy_results.length, 2);
  assert.ok(trace.policy_results.some((result) => result.decision === "ALLOW"));
  assert.ok(trace.policy_results.some((result) => result.decision === "BLOCK"));
  assert.ok(trace.events.some((event) => event.event_type === "AGENT_POLICY_BLOCKED"));
  assert.ok(!trace.events.some((event) => event.event_type === "AGENT_ACTION_STARTED" && event.step_index === 2));
  assert.ok(stepEvents.some((event) => event.payload.event === "POLICY_BLOCKED"));
  assert.equal(closed, true);
});
