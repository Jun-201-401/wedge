import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPlaywrightSessionFactory } from "../src/browser/playwright/index.ts";
import { createArtifactStore } from "../src/storage/index.ts";
import { createRunnerTestConfig, loadExampleMessage } from "./support.ts";

test("simulated playwright goto uses object target url when provided", async () => {
  const message = await loadExampleMessage();
  const browserFactory = createPlaywrightSessionFactory(
    createRunnerTestConfig({
      artifactsRoot: join(tmpdir(), "runner-test-artifacts"),
      callbackLogFile: join(tmpdir(), "runner-test-callbacks.jsonl")
    })
  );
  const session = await browserFactory.createSession({
    runId: message.payload.runId,
    plan: message.payload.scenarioPlan
  });

  await session.execute(
    {
      type: "goto",
      target: {
        url: "https://example.com/signup"
      }
    },
    {
      step_id: "step_goto_object_target",
      stage: "FIRST_VIEW",
      description: "goto object target url",
      action: {
        type: "goto",
        target: {
          url: "https://example.com/signup"
        }
      },
      settle_strategy: {
        type: "none",
        timeout_ms: 0
      },
      checkpoint: false
    }
  );

  assert.equal(session.snapshot().finalUrl, "https://example.com/signup");
  await session.close();
});

test("createArtifactStore uses forward slash keys for artifact metadata", async () => {
  const artifactsRoot = await mkdtemp(join(tmpdir(), "wedge-runner-storage-"));
  const artifactStore = createArtifactStore(
    createRunnerTestConfig({
      artifactsRoot,
      callbackLogFile: join(artifactsRoot, "callbacks.jsonl")
    })
  );

  const [artifact] = await artifactStore.persistArtifacts({
    runId: "run-1",
    artifacts: [
      {
        artifactId: "artifact-1",
        artifactType: "SCREENSHOT",
        stepKey: "step:key/with spaces",
        mimeType: "text/plain",
        fileExtension: "txt",
        content: "hello"
      }
    ]
  });

  assert.equal(artifact.key, "run-1/step-key-with-spaces/artifact-1-screenshot.txt");
  assert.equal(artifact.key.includes("\\"), false);
});

test("simulated playwright stop_when does not stop without matching condition", async () => {
  const message = await loadExampleMessage();
  const browserFactory = createPlaywrightSessionFactory(
    createRunnerTestConfig({
      artifactsRoot: join(tmpdir(), "runner-test-artifacts"),
      callbackLogFile: join(tmpdir(), "runner-test-callbacks.jsonl")
    })
  );
  const session = await browserFactory.createSession({
    runId: message.payload.runId,
    plan: message.payload.scenarioPlan
  });

  const noConditionResult = await session.execute(
    {
      type: "stop_when"
    },
    {
      step_id: "step_stop_when_no_condition",
      stage: "CTA",
      description: "stop_when without condition",
      action: {
        type: "stop_when"
      },
      settle_strategy: {
        type: "none",
        timeout_ms: 0
      },
      checkpoint: false
    }
  );

  const nonMatchingConditionResult = await session.execute(
    {
      type: "stop_when"
    },
    {
      step_id: "step_stop_when_non_match",
      stage: "CTA",
      description: "stop_when with non matching url",
      action: {
        type: "stop_when"
      },
      settle_strategy: {
        type: "none",
        timeout_ms: 0
      },
      checkpoint: false,
      stop_condition: {
        url_includes: "/checkout"
      }
    }
  );

  assert.equal(noConditionResult.stopRequested, false);
  assert.equal(nonMatchingConditionResult.stopRequested, false);
  await session.close();
});
