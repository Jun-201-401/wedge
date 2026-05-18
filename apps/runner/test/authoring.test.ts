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
  assert.deepEqual(result.candidates[0]?.scenario_plan.steps.map((step) => step.description), [
    "추천된 시작 화면을 열어 첫 화면을 확인한다.",
    "첫 화면에서 핵심 맥락과 주요 진입점을 기록한다.",
    "추천된 진입점으로 다음 화면 이동 가능성을 확인한다.",
    "이동 후 도착 화면의 맥락과 다음 행동을 기록한다."
  ]);
  assert.doesNotMatch(
    result.candidates[0]?.scenario_plan.steps.map((step) => step.description).join("\n") ?? "",
    /Discovery|의사결정/
  );
});

test("Runner ScenarioAuthoring keeps first-view-only goals checkpoint-only", async () => {
  const message = parseScenarioAuthoringExecuteMessage(JSON.stringify(createScenarioAuthoringExecuteMessage({
    requestedGoal: "랜딩 전환 버튼 점검 · 첫 화면만 보기"
  })));
  const config = createRunnerTestConfig();

  const result = await executeScenarioAuthoring({ message, config });
  const steps = result.candidates[0]?.scenario_plan.steps ?? [];

  assert.equal(result.validation.schema_valid, true);
  assert.equal(result.validation.safety_valid, true);
  assert.deepEqual(steps.map((step) => step.action.type), ["goto", "checkpoint", "checkpoint"]);
  assert.equal(steps[2]?.step_id, "step_003_first_view_only_checkpoint");
  assert.notEqual(
    steps.some((step) => step.step_id === "step_003_probe_recommended_target" || step.action.type === "click"),
    true
  );
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

function createScenarioAuthoringExecuteMessage(overrides: { requestedGoal?: string } = {}) {
  const requestedGoal = overrides.requestedGoal ?? "랜딩 CTA 진입점을 검증한다";
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
      requestedGoal,
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
        requested_goal: requestedGoal,
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
