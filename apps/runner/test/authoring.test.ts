import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { executeScenarioAuthoring } from "../src/authoring/index.ts";
import { createRunnerApp } from "../src/app.ts";
import { parseScenarioAuthoringExecuteMessage } from "../src/messaging/index.ts";
import { createRunnerTestConfig } from "./support.ts";

test("Runner ScenarioAuthoring compiles Discovery recommendation into custom ScenarioPlan", async () => {
  const message = parseScenarioAuthoringExecuteMessage(JSON.stringify(createScenarioAuthoringExecuteMessage()));
  const config = createRunnerTestConfig();

  const result = await executeScenarioAuthoring({ message, config });

  assert.equal(result.authoringJobId, "40000000-0000-4000-8000-000000000001");
  assert.equal(result.candidateCount, 1);
  assert.equal(result.validation.schema_valid, true);
  assert.equal(result.validation.safety_valid, true);
  assert.equal(result.candidates[0]?.scenario_plan.scenario_type, "custom_compiled");
  assert.equal(result.candidates[0]?.scenario_plan.source_discovery_id, "40000000-0000-4000-8000-000000000003");
  assert.equal(result.candidates[0]?.scenario_plan.steps[2]?.action.type, "click");
});

test("createRunnerApp processes scenario-authoring message files and sends callbacks", async () => {
  const artifactsRoot = await mkdtemp(join(tmpdir(), "wedge-runner-authoring-artifacts-"));
  const callbackLogFile = join(artifactsRoot, "callbacks.jsonl");
  const messageFile = join(artifactsRoot, "scenario-authoring.execute.request.json");

  try {
    await writeFile(messageFile, JSON.stringify(createScenarioAuthoringExecuteMessage()), "utf8");
    const app = createRunnerApp({
      workerId: "runner-test-worker",
      artifactsRoot,
      callbackLogFile,
      callbackMode: "file"
    });

    const result = await app.processInputMessageFile(messageFile);
    const callbackLog = await readFile(callbackLogFile, "utf8");

    assert.equal(result.kind, "scenario-authoring");
    assert.equal(result.authoring.candidateCount, 1);
    assert.match(callbackLog, /"callbackType":"scenario-authoring-accepted"/);
    assert.match(callbackLog, /"callbackType":"scenario-authoring-finished"/);
    assert.match(callbackLog, /"candidate_id":"rule_based_landing_cta_001"/);
  } finally {
    await rm(artifactsRoot, { recursive: true, force: true });
  }
});

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
            viewport: { width: 1440, height: 900 },
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
          suggested_target: { role: "link", text: "시작하기" }
        },
        constraints: {},
        environment: {
          device: "desktop",
          viewport: { width: 1440, height: 900 },
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
