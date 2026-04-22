import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseRunExecuteMessage } from "../src/messaging/index.ts";
import { cloneMessage, exampleMessageFile, loadExampleMessage } from "./support.ts";

test("parseRunExecuteMessage validates run.execute.request envelope", async () => {
  const rawMessage = await readFile(exampleMessageFile, "utf8");
  const message = parseRunExecuteMessage(rawMessage);

  assert.equal(message.messageType, "run.execute.request");
  assert.equal(message.payload.scenarioPlan.steps.length, 4);
});

test("parseRunExecuteMessage rejects ScenarioPlan missing required fields", async () => {
  const invalidMessage = cloneMessage(await loadExampleMessage()) as unknown as {
    payload: {
      scenarioPlan: Record<string, unknown>;
    };
  };

  delete invalidMessage.payload.scenarioPlan.start_url;

  assert.throws(
    () => parseRunExecuteMessage(JSON.stringify(invalidMessage)),
    /scenarioPlan\.start_url is required/
  );
});

test("parseRunExecuteMessage rejects startUrl mismatch between envelope and scenarioPlan", async () => {
  const invalidMessage = cloneMessage(await loadExampleMessage());
  invalidMessage.payload.startUrl = "https://example.com/pricing";

  assert.throws(
    () => parseRunExecuteMessage(JSON.stringify(invalidMessage)),
    /runner payload\.startUrl must match scenarioPlan\.start_url/
  );
});

test("parseRunExecuteMessage rejects goal mismatch between envelope and scenarioPlan", async () => {
  const invalidMessage = cloneMessage(await loadExampleMessage());
  invalidMessage.payload.goal = "다른 목표";

  assert.throws(
    () => parseRunExecuteMessage(JSON.stringify(invalidMessage)),
    /runner payload\.goal must match scenarioPlan\.goal/
  );
});

test("parseRunExecuteMessage rejects devicePreset mismatch between envelope and scenarioPlan", async () => {
  const invalidMessage = cloneMessage(await loadExampleMessage());
  invalidMessage.payload.devicePreset = "mobile";

  assert.throws(
    () => parseRunExecuteMessage(JSON.stringify(invalidMessage)),
    /runner payload\.devicePreset must match scenarioPlan\.environment\.device/
  );
});

test("parseRunExecuteMessage requires scenarioTemplateVersionId", async () => {
  const invalidMessage = cloneMessage(await loadExampleMessage()) as unknown as {
    payload: Record<string, unknown>;
  };
  delete invalidMessage.payload.scenarioTemplateVersionId;

  assert.throws(
    () => parseRunExecuteMessage(JSON.stringify(invalidMessage)),
    /runner payload\.scenarioTemplateVersionId is required/
  );
});

test("parseRunExecuteMessage rejects unsupported action types", async () => {
  const invalidMessage = cloneMessage(await loadExampleMessage());
  invalidMessage.payload.scenarioPlan.steps[0]!.action.type = "drag" as never;

  assert.throws(
    () => parseRunExecuteMessage(JSON.stringify(invalidMessage)),
    /scenario step step_001_goto action\.type is unsupported/
  );
});

test("parseRunExecuteMessage rejects unsupported settle strategy types", async () => {
  const invalidMessage = cloneMessage(await loadExampleMessage());
  invalidMessage.payload.scenarioPlan.steps[0]!.settle_strategy.type = "long_poll" as never;

  assert.throws(
    () => parseRunExecuteMessage(JSON.stringify(invalidMessage)),
    /scenario step step_001_goto settle_strategy\.type is unsupported/
  );
});
