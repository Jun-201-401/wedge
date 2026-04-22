import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRunnerApp } from "../src/app.ts";
import { loadExampleMessage } from "./support.ts";

test("createRunnerApp executes example scenario and writes callback log", async () => {
  const artifactsRoot = await mkdtemp(join(tmpdir(), "wedge-runner-artifacts-"));
  const callbackLogFile = join(artifactsRoot, "callbacks.jsonl");
  const app = createRunnerApp({
    workerId: "runner-test-worker",
    artifactsRoot,
    callbackLogFile,
    simulatedDelayCapMs: 1
  });

  const result = await app.processMessageFile(join("examples", "run-execute.request.json"));
  const callbackLog = await readFile(callbackLogFile, "utf8");

  assert.equal(result.summary.completedStepCount, 4);
  assert.equal(result.summary.failedStepCount, 0);
  assert.match(callbackLog, /"callbackType":"accepted"/);
  assert.match(callbackLog, /"callbackType":"finished"/);
  assert.match(callbackLog, /"callbackType":"checkpoints"/);
});

test("createRunnerApp stops after stop_when step requests stop", async () => {
  const artifactsRoot = await mkdtemp(join(tmpdir(), "wedge-runner-stop-artifacts-"));
  const callbackLogFile = join(artifactsRoot, "callbacks.jsonl");
  const app = createRunnerApp({
    workerId: "runner-test-worker",
    artifactsRoot,
    callbackLogFile,
    simulatedDelayCapMs: 1
  });
  const message = await loadExampleMessage();

  message.payload.scenarioPlan.steps = [
    {
      step_id: "step_001_stop",
      stage: "CTA",
      description: "stop when current url matches landing page",
      action: {
        type: "stop_when"
      },
      settle_strategy: {
        type: "none",
        timeout_ms: 0
      },
      checkpoint: false,
      stop_condition: {
        url_includes: "example.com"
      }
    },
    {
      step_id: "step_002_fill_email",
      stage: "INPUT",
      description: "should not run",
      action: {
        type: "fill",
        target: {
          label: "Email"
        },
        value: "blocked@example.com"
      },
      settle_strategy: {
        type: "fixed_short",
        timeout_ms: 1
      },
      checkpoint: false
    }
  ];

  const result = await app.processMessage(message);
  const callbackLog = await readFile(callbackLogFile, "utf8");

  assert.equal(result.summary.completedStepCount, 1);
  assert.equal(result.summary.stopped, true);
  assert.doesNotMatch(callbackLog, /step_002_fill_email/);
});

test("createRunnerApp rejects fill actions when synthetic inputs are disabled", async () => {
  const artifactsRoot = await mkdtemp(join(tmpdir(), "wedge-runner-safety-artifacts-"));
  const callbackLogFile = join(artifactsRoot, "callbacks.jsonl");
  const app = createRunnerApp({
    workerId: "runner-test-worker",
    artifactsRoot,
    callbackLogFile,
    simulatedDelayCapMs: 1
  });
  const message = await loadExampleMessage();

  message.payload.scenarioPlan.steps = [
    {
      step_id: "step_001_fill_email",
      stage: "INPUT",
      description: "fill email once",
      action: {
        type: "fill",
        target: {
          label: "Email"
        },
        value: "blocked@example.com"
      },
      settle_strategy: {
        type: "fixed_short",
        timeout_ms: 1
      },
      checkpoint: false
    }
  ];
  message.payload.scenarioPlan.safety.use_synthetic_inputs = false;

  await assert.rejects(
    () => app.processMessage(message),
    /Scenario safety forbids synthetic fill actions/
  );

  const callbackLog = await readFile(callbackLogFile, "utf8");
  assert.match(callbackLog, /"callbackType":"accepted"/);
  assert.match(callbackLog, /"callbackType":"failed"/);
  assert.doesNotMatch(callbackLog, /"callbackType":"finished"/);
});
