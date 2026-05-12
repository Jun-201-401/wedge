import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseAgentExecuteMessage, parseDiscoveryExecuteMessage, parseRunExecuteMessage } from "../src/messaging/index.ts";
import { agentExampleMessageFile, cloneAgentMessage, cloneMessage, exampleMessageFile, loadAgentExampleMessage, loadExampleMessage } from "./support.ts";

test("[MQ 계약] 정상 run.execute.request envelope를 파싱한다", async () => {
  const rawMessage = await readFile(exampleMessageFile, "utf8");
  const message = parseRunExecuteMessage(rawMessage);

  assert.equal(message.messageType, "run.execute.request");
  assert.equal(message.payload.scenarioPlan.steps.length, 4);
});


test("[MQ 계약] 정상 agent.execute.request envelope를 파싱한다", async () => {
  const rawMessage = await readFile(agentExampleMessageFile, "utf8");
  const message = parseAgentExecuteMessage(rawMessage);

  assert.equal(message.messageType, "agent.execute.request");
  assert.equal(message.payload.agentTask.goal_type, "CHECKOUT_ENTRY_VERIFICATION");
  assert.equal(message.payload.agentTask.budget.max_steps, 8);
});

test("[MQ 계약] agent.execute.request는 AgentTask가 없으면 거부한다", async () => {
  const message = cloneAgentMessage(await loadAgentExampleMessage()) as unknown as {
    payload: Record<string, unknown>;
  };
  delete message.payload.agentTask;

  assert.throws(
    () => parseAgentExecuteMessage(JSON.stringify(message)),
    /agent payload\.agentTask must be an object/
  );
});

test("[MQ 계약] agent optional policy object의 타입이 다르면 거부한다", async () => {
  const message = cloneAgentMessage(await loadAgentExampleMessage());
  message.payload.agentTask.artifact_policy = {
    capture_trace: "not-a-boolean" as never
  };

  assert.throws(
    () => parseAgentExecuteMessage(JSON.stringify(message)),
    /agentTask\.artifact_policy\.capture_trace must be boolean/
  );
});

test("[MQ 계약] agent screenshot_mode는 지원 값만 허용한다", async () => {
  const message = cloneAgentMessage(await loadAgentExampleMessage());
  message.payload.agentTask.artifact_policy = {
    screenshot_mode: "auto"
  };

  assert.doesNotThrow(() => parseAgentExecuteMessage(JSON.stringify(message)));

  message.payload.agentTask.artifact_policy.screenshot_mode = "tall_png" as never;

  assert.throws(
    () => parseAgentExecuteMessage(JSON.stringify(message)),
    /agentTask\.artifact_policy\.screenshot_mode is invalid/
  );
});

test("[MQ 계약] run artifactPolicy screenshotMode는 지원 값만 허용한다", async () => {
  const message = cloneMessage(await loadExampleMessage());
  message.payload.artifactPolicy = {
    screenshotMode: "auto"
  };

  assert.doesNotThrow(() => parseRunExecuteMessage(JSON.stringify(message)));

  message.payload.artifactPolicy.screenshotMode = "tall_png" as never;

  assert.throws(
    () => parseRunExecuteMessage(JSON.stringify(message)),
    /runner payload\.artifactPolicy\.screenshotMode is invalid/
  );
});

test("[MQ 계약] agent optional budget object의 범위가 다르면 거부한다", async () => {
  const message = cloneAgentMessage(await loadAgentExampleMessage());
  message.payload.agentTask.observation_budget = {
    max_candidates: 0
  };

  assert.throws(
    () => parseAgentExecuteMessage(JSON.stringify(message)),
    /agentTask\.observation_budget\.max_candidates must be an integer between 1 and 500/
  );
});

test("[MQ 계약] agent product_selection_policy의 필수 mode가 없으면 거부한다", async () => {
  const message = cloneAgentMessage(await loadAgentExampleMessage());
  message.payload.agentTask.product_selection_policy = {
    allow_quantity_change: false
  } as never;

  assert.throws(
    () => parseAgentExecuteMessage(JSON.stringify(message)),
    /agentTask\.product_selection_policy\.mode is invalid/
  );
});

test("[MQ 계약] run.execute.request는 scenarioPlan이 없으면 거부한다", async () => {
  const message = cloneMessage(await loadExampleMessage()) as unknown as {
    payload: Record<string, unknown>;
  };
  delete message.payload.scenarioPlan;

  assert.throws(
    () => parseRunExecuteMessage(JSON.stringify(message)),
    /scenarioPlan must be an object/
  );
});

test("[MQ 계약] ScenarioPlan 필수 필드가 빠지면 run.execute.request를 거부한다", async () => {
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

test("[MQ 계약] envelope startUrl과 scenarioPlan start_url이 다르면 거부한다", async () => {
  const invalidMessage = cloneMessage(await loadExampleMessage());
  invalidMessage.payload.startUrl = "https://example.com/pricing";

  assert.throws(
    () => parseRunExecuteMessage(JSON.stringify(invalidMessage)),
    /runner payload\.startUrl must match scenarioPlan\.start_url/
  );
});

test("[MQ 계약] envelope goal과 scenarioPlan goal이 다르면 거부한다", async () => {
  const invalidMessage = cloneMessage(await loadExampleMessage());
  invalidMessage.payload.goal = "다른 목표";

  assert.throws(
    () => parseRunExecuteMessage(JSON.stringify(invalidMessage)),
    /runner payload\.goal must match scenarioPlan\.goal/
  );
});

test("[MQ 계약] envelope devicePreset과 scenarioPlan environment.device가 다르면 거부한다", async () => {
  const invalidMessage = cloneMessage(await loadExampleMessage());
  invalidMessage.payload.devicePreset = "mobile";

  assert.throws(
    () => parseRunExecuteMessage(JSON.stringify(invalidMessage)),
    /runner payload\.devicePreset must match scenarioPlan\.environment\.device/
  );
});

test("[MQ 계약] scenarioTemplateVersionId가 없으면 run.execute.request를 거부한다", async () => {
  const invalidMessage = cloneMessage(await loadExampleMessage()) as unknown as {
    payload: Record<string, unknown>;
  };
  delete invalidMessage.payload.scenarioTemplateVersionId;

  assert.throws(
    () => parseRunExecuteMessage(JSON.stringify(invalidMessage)),
    /runner payload\.scenarioTemplateVersionId is required/
  );
});

test("[MQ 계약] runner가 지원하지 않는 action type은 거부한다", async () => {
  const invalidMessage = cloneMessage(await loadExampleMessage());
  invalidMessage.payload.scenarioPlan.steps[0]!.action.type = "drag" as never;

  assert.throws(
    () => parseRunExecuteMessage(JSON.stringify(invalidMessage)),
    /scenario step step_001_goto action\.type is unsupported/
  );
});

test("[MQ 계약] runner가 지원하지 않는 settle strategy는 거부한다", async () => {
  const invalidMessage = cloneMessage(await loadExampleMessage());
  invalidMessage.payload.scenarioPlan.steps[0]!.settle_strategy.type = "long_poll" as never;

  assert.throws(
    () => parseRunExecuteMessage(JSON.stringify(invalidMessage)),
    /scenario step step_001_goto settle_strategy\.type is unsupported/
  );
});

test("[MQ 계약] 정상 discovery.execute.request envelope를 파싱한다", () => {
  const message = parseDiscoveryExecuteMessage(JSON.stringify(createDiscoveryExecuteMessage()));

  assert.equal(message.messageType, "discovery.execute.request");
  assert.equal(message.payload.url, "https://example.com");
  assert.equal(message.payload.maxScrollCount, 2);
});

test("[MQ 계약] discovery payload 범위 값이 유효하지 않으면 거부한다", () => {
  const invalidMessage = createDiscoveryExecuteMessage();
  invalidMessage.payload.maxDurationMs = 500;

  assert.throws(
    () => parseDiscoveryExecuteMessage(JSON.stringify(invalidMessage)),
    /discovery payload\.maxDurationMs must be >= 1000/
  );
});

function createDiscoveryExecuteMessage() {
  return {
    messageId: "20000000-0000-4000-8000-000000000001",
    messageType: "discovery.execute.request",
    schemaVersion: "0.5",
    createdAt: "2026-04-30T00:00:00.000Z",
    producer: "api-server",
    correlationId: "20000000-0000-4000-8000-000000000002",
    idempotencyKey: "discovery:20000000-0000-4000-8000-000000000001",
    payload: {
      discoveryId: "20000000-0000-4000-8000-000000000011",
      projectId: "8f06dca8-9c4d-4f20-b1a8-1d5ee40a9923",
      triggerSource: "WEB",
      url: "https://example.com",
      devicePreset: "desktop",
      viewport: {
        width: 1440,
        height: 900
      },
      maxDurationMs: 5_000,
      maxScrollCount: 2
    }
  };
}
