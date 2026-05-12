import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  parseAgentExecuteMessage,
  parseDiscoveryExecuteMessage,
  parseRunExecuteMessage,
  parseScenarioAuthoringExecuteMessage
} from "../src/messaging/index.ts";
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

test("[MQ 계약] 정상 scenario-authoring.execute.request envelope를 파싱한다", () => {
  const message = parseScenarioAuthoringExecuteMessage(JSON.stringify(createScenarioAuthoringExecuteMessage()));

  assert.equal(message.messageType, "scenario-authoring.execute.request");
  assert.equal(message.payload.authoringJobId, "40000000-0000-4000-8000-000000000001");
  assert.equal(message.payload.input.selected_recommendation?.scenario_type, "LANDING_CTA");
});

test("[MQ 계약] scenario-authoring input이 없으면 거부한다", () => {
  const invalidMessage = createScenarioAuthoringExecuteMessage() as unknown as {
    payload: Record<string, unknown>;
  };
  delete invalidMessage.payload.input;

  assert.throws(
    () => parseScenarioAuthoringExecuteMessage(JSON.stringify(invalidMessage)),
    /scenario authoring payload\.input must be an object/
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

function createScenarioAuthoringExecuteMessage() {
  return {
    messageId: "40000000-0000-4000-8000-000000000010",
    messageType: "scenario-authoring.execute.request",
    schemaVersion: "0.5",
    createdAt: "2026-05-12T00:00:00.000Z",
    producer: "api-server",
    correlationId: "40000000-0000-4000-8000-000000000011",
    idempotencyKey: "scenario-authoring:40000000-0000-4000-8000-000000000001",
    payload: {
      authoringJobId: "40000000-0000-4000-8000-000000000001",
      projectId: "40000000-0000-4000-8000-000000000002",
      sourceDiscoveryId: "40000000-0000-4000-8000-000000000003",
      requestedGoal: "랜딩 CTA 진입점을 검증한다",
      input: {
        site_discovery_result: {
          schema_version: "0.5",
          discovery_id: "40000000-0000-4000-8000-000000000003",
          input_url: "https://example.com",
          final_url: "https://example.com",
          environment: {
            device: "desktop",
            viewport: {
              width: 1440,
              height: 900
            },
            locale: "ko-KR",
            timezone: "Asia/Seoul"
          },
          checkpoints: [],
          detected_flow_types: ["LANDING_CTA"],
          missing_flow_types: [],
          scenario_recommendations: []
        },
        requested_goal: "랜딩 CTA 진입점을 검증한다",
        preferred_scenario_type: "LANDING_CTA",
        selected_recommendation: {
          recommendation_id: "rec-1",
          scenario_type: "LANDING_CTA",
          recommendation_level: "HIGH",
          confidence: 0.88,
          evidence_refs: ["cp_001.cta_001"],
          suggested_start_url: "https://example.com",
          suggested_target: {
            role: "link",
            text: "시작하기"
          }
        },
        constraints: {},
        environment: {
          device: "desktop",
          viewport: {
            width: 1440,
            height: 900
          },
          locale: "ko-KR",
          timezone: "Asia/Seoul",
          auth_state: "anonymous"
        },
        safety: {
          allow_external_navigation: false,
          allow_payment_commit: false,
          allow_destructive_action: false,
          use_synthetic_inputs: true,
          stop_before_real_payment: true
        }
      },
      providerPolicy: {
        allowed_provider_types: ["RULE_BASED"],
        provider_order: ["RULE_BASED"],
        timeout_ms: 30000,
        fallback_allowed: true,
        approval_required: true,
        max_attempts: 1
      }
    }
  };
}
