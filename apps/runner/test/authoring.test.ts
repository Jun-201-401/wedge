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

test("Runner ScenarioAuthoring does not auto-click volatile ranked content links", async () => {
  const message = parseScenarioAuthoringExecuteMessage(JSON.stringify(createScenarioAuthoringExecuteMessage({
    suggestedTarget: {
      role: "link",
      text: "1위퇴사 후 아포칼립스로 출근합니다현판포더엠50화 무료",
      selector: "a[href=\"http://series.naver.com/novel/detail.nhn?originalProductId=697342\"]"
    }
  })));
  const config = createRunnerTestConfig();

  const result = await executeScenarioAuthoring({ message, config });
  const steps = result.candidates[0]?.scenario_plan.steps ?? [];

  assert.equal(result.validation.schema_valid, true);
  assert.equal(result.validation.safety_valid, true);
  assert.deepEqual(steps.map((step) => step.action.type), ["goto", "checkpoint", "checkpoint"]);
  assert.equal(steps[2]?.step_id, "step_003_recommended_target_checkpoint");
});

test("Runner ScenarioAuthoring probes checkout entrypoints before payment stop", async () => {
  const message = parseScenarioAuthoringExecuteMessage(JSON.stringify(createScenarioAuthoringExecuteMessage({
    requestedGoal: "구매/결제 흐름 점검 · 입력 양식까지 보기",
    scenarioType: "PURCHASE_CHECKOUT",
    suggestedTarget: { role: "link", text: "구매하기", href_contains: "/checkout" }
  })));
  const config = createRunnerTestConfig();

  const result = await executeScenarioAuthoring({ message, config });
  const steps = result.candidates[0]?.scenario_plan.steps ?? [];

  assert.equal(result.validation.schema_valid, true);
  assert.deepEqual(steps.map((step) => step.step_id), [
    "step_001_goto",
    "step_002_first_view_checkpoint",
    "step_003_probe_checkout_target",
    "step_004_checkout_destination_checkpoint",
    "step_005_stop_before_payment"
  ]);
  assert.equal(steps[2]?.action.type, "click");
  assert.equal(steps[2]?.stage, "CTA");
  assert.equal(steps[3]?.stage, "INPUT");
  assert.equal(steps[4]?.action.type, "stop_when");
  assert.equal(steps[4]?.stop_condition?.condition, "before_payment_commit");
});

test("Runner ScenarioAuthoring probes signup/contact form entrypoints before submit stop", async () => {
  const message = parseScenarioAuthoringExecuteMessage(JSON.stringify(createScenarioAuthoringExecuteMessage({
    requestedGoal: "가입 / 리드 양식 점검 · 입력 양식까지 보기",
    scenarioType: "SIGNUP_LEAD_FORM",
    suggestedTarget: { role: "link", text: "무료 가입", href_contains: "/signup" },
    constraints: { depthId: "form-depth", depthTitle: "입력 양식까지 보기" }
  })));
  const config = createRunnerTestConfig();

  const result = await executeScenarioAuthoring({ message, config });
  const steps = result.candidates[0]?.scenario_plan.steps ?? [];

  assert.equal(result.validation.schema_valid, true);
  assert.deepEqual(steps.map((step) => step.step_id), [
    "step_001_goto",
    "step_002_first_view_checkpoint",
    "step_003_probe_form_target",
    "step_004_form_destination_checkpoint",
    "step_005_stop_before_submit"
  ]);
  assert.equal(steps[2]?.action.type, "click");
  assert.equal(steps[2]?.stage, "INPUT");
  assert.equal(steps[4]?.action.type, "stop_when");
  assert.equal(steps[4]?.stop_condition?.condition, "before_real_submit");
});


test("Runner ScenarioAuthoring creates a semantic scan plan when manual flow has no suggested target", async () => {
  const message = parseScenarioAuthoringExecuteMessage(JSON.stringify(createScenarioAuthoringExecuteMessage({
    requestedGoal: "가입 / 리드 양식 점검 · 입력 양식까지 보기",
    scenarioType: "SIGNUP_LEAD_FORM",
    suggestedTarget: {},
    constraints: { depthId: "form-depth", depthTitle: "입력 양식까지 보기" }
  })));
  const config = createRunnerTestConfig();

  const result = await executeScenarioAuthoring({ message, config });
  const steps = result.candidates[0]?.scenario_plan.steps ?? [];

  assert.equal(result.validation.schema_valid, true);
  assert.deepEqual(steps.map((step) => step.step_id), [
    "step_001_goto",
    "step_002_first_view_checkpoint",
    "step_003_scan_for_form_entrypoint",
    "step_004_form_scan_checkpoint",
    "step_005_stop_before_submit"
  ]);
  assert.equal(steps[2]?.action.type, "scroll");
  assert.equal(steps[3]?.stage, "INPUT");
});

test("Runner ScenarioAuthoring uses constraints.depthId instead of requestedGoal text for first-view-only", async () => {
  const message = parseScenarioAuthoringExecuteMessage(JSON.stringify(createScenarioAuthoringExecuteMessage({
    requestedGoal: "랜딩 CTA 진입점을 검증한다",
    constraints: { depthId: "hero-only", depthTitle: "첫 화면만 보기" }
  })));
  const config = createRunnerTestConfig();

  const result = await executeScenarioAuthoring({ message, config });
  const steps = result.candidates[0]?.scenario_plan.steps ?? [];

  assert.equal(result.validation.schema_valid, true);
  assert.deepEqual(steps.map((step) => step.action.type), ["goto", "checkpoint", "checkpoint"]);
  assert.equal(steps[2]?.step_id, "step_003_first_view_only_checkpoint");
});

test("Runner ScenarioAuthoring uses INTERNAL_LLM provider before rule-based fallback", async () => {
  const message = parseScenarioAuthoringExecuteMessage(JSON.stringify(createScenarioAuthoringExecuteMessage({
    providerOrder: ["INTERNAL_LLM", "RULE_BASED"]
  })));
  const config = createRunnerTestConfig({
    scenarioAuthoringLlmEndpoint: "https://gms.example/v1/chat/completions",
    scenarioAuthoringLlmModel: "gpt-5.2-pro"
  });

  const result = await executeScenarioAuthoring({
    message,
    config,
    llmTransport: {
      async complete(request) {
        assert.equal(request.model, "gpt-5.2-pro");
        return {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  candidate: {
                    candidate_id: "internal_llm_landing_cta_001",
                    confidence: 0.91,
                    rationale: "GMS가 추천 CTA 근거를 기반으로 안전한 점검 경로를 구성했다.",
                    evidence_refs: ["cp_001.cta_001"],
                    scenario_plan: {
                      schema_version: "0.5",
                      plan_id: "llm-plan",
                      scenario_type: "custom_compiled",
                      source_discovery_id: "ignored",
                      goal: "ignored",
                      start_url: "https://attacker.example",
                      environment: {},
                      safety: {},
                      fit_requirements: {},
                      steps: [
                        {
                          step_id: "step_001_goto",
                          stage: "FIRST_VIEW",
                          description: "추천 시작 화면을 연다.",
                          action: { type: "goto", target: "https://example.com" },
                          settle_strategy: { type: "network_idle", timeout_ms: 3000 },
                          checkpoint: true
                        },
                        {
                          step_id: "step_002_first_view_checkpoint",
                          stage: "FIRST_VIEW",
                          description: "첫 화면 핵심 CTA를 기록한다.",
                          action: { type: "checkpoint" },
                          settle_strategy: { type: "none", timeout_ms: 0 },
                          checkpoint: true
                        }
                      ]
                    }
                  }
                })
              }
            }
          ]
        };
      }
    }
  });

  assert.equal(result.candidateCount, 1);
  assert.equal(result.candidates[0]?.candidate_id, "internal_llm_landing_cta_001");
  assert.equal(result.candidates[0]?.scenario_plan.start_url, "https://example.com");
  assert.equal(result.candidates[0]?.scenario_plan.source_discovery_id, "40000000-0000-4000-8000-000000000003");
  assert.equal(result.candidates[0]?.scenario_plan.safety.allow_payment_commit, false);
  assert.equal(result.providerTrace[0]?.provider_type, "INTERNAL_LLM");
  assert.equal(result.providerTrace[0]?.model_or_agent, "gpt-5.2-pro");
  assert.equal(result.providerTrace[0]?.status, "SUCCEEDED");
});

test("Runner ScenarioAuthoring sends Responses API payloads for responses endpoints", async () => {
  const message = parseScenarioAuthoringExecuteMessage(JSON.stringify(createScenarioAuthoringExecuteMessage({
    providerOrder: ["INTERNAL_LLM", "RULE_BASED"]
  })));
  const config = createRunnerTestConfig({
    scenarioAuthoringLlmEndpoint: "https://gms.example/v1/responses",
    scenarioAuthoringLlmModel: "gpt-5.2-pro"
  });

  const result = await executeScenarioAuthoring({
    message,
    config,
    llmTransport: {
      async complete(request) {
        assert.equal(request.endpoint, "https://gms.example/v1/responses");
        assert.equal(request.model, "gpt-5.2-pro");
        assert.equal("response_format" in request.payload, false);
        assert.equal("messages" in request.payload, false);
        assert.equal("temperature" in request.payload, false);
        assert.deepEqual(request.payload.text, { format: { type: "json_object" } });
        assert.ok(Array.isArray(request.payload.input));
        return {
          output: [
            {
              type: "message",
              role: "assistant",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    candidate: {
                      candidate_id: "internal_llm_responses_landing_cta_001",
                      confidence: 0.89,
                      rationale: "Responses API가 안전한 CTA 점검 경로를 구성했다.",
                      evidence_refs: ["cp_001.cta_001"],
                      scenario_plan: {
                        schema_version: "0.5",
                        plan_id: "responses-plan",
                        scenario_type: "custom_compiled",
                        source_discovery_id: "ignored",
                        goal: "ignored",
                        start_url: "https://attacker.example",
                        environment: {},
                        safety: {},
                        fit_requirements: {},
                        steps: [
                          {
                            step_id: "step_001_goto",
                            stage: "FIRST_VIEW",
                            description: "추천 시작 화면을 연다.",
                            action: { type: "goto", target: "https://example.com" },
                            settle_strategy: { type: "network_idle", timeout_ms: 3000 },
                            checkpoint: true
                          },
                          {
                            step_id: "step_002_first_view_checkpoint",
                            stage: "FIRST_VIEW",
                            description: "첫 화면 핵심 CTA를 기록한다.",
                            action: { type: "checkpoint" },
                            settle_strategy: { type: "none", timeout_ms: 0 },
                            checkpoint: true
                          }
                        ]
                      }
                    }
                  })
                }
              ]
            }
          ]
        };
      }
    }
  });

  assert.equal(result.candidateCount, 1);
  assert.equal(result.candidates[0]?.candidate_id, "internal_llm_responses_landing_cta_001");
  assert.equal(result.providerTrace[0]?.provider_type, "INTERNAL_LLM");
  assert.equal(result.providerTrace[0]?.status, "SUCCEEDED");
});

test("Runner ScenarioAuthoring rejects shallow INTERNAL_LLM form-depth plans and falls back to RULE_BASED", async () => {
  const message = parseScenarioAuthoringExecuteMessage(JSON.stringify(createScenarioAuthoringExecuteMessage({
    requestedGoal: "가입 / 리드 양식 점검 · 입력 양식까지 보기",
    providerOrder: ["INTERNAL_LLM", "RULE_BASED"],
    scenarioType: "SIGNUP_LEAD_FORM",
    suggestedTarget: { role: "link", text: "무료 가입", href_contains: "/signup" },
    constraints: { depthId: "form-depth", depthTitle: "입력 양식까지 보기" }
  })));
  const config = createRunnerTestConfig({
    scenarioAuthoringLlmEndpoint: "https://gms.example/v1/responses",
    scenarioAuthoringLlmModel: "gpt-5.2-pro"
  });

  const result = await executeScenarioAuthoring({
    message,
    config,
    llmTransport: {
      async complete() {
        return {
          output_text: JSON.stringify({
            candidate: {
              candidate_id: "internal_llm_shallow_signup_001",
              confidence: 0.9,
              rationale: "Too shallow for form-depth.",
              evidence_refs: ["cp_001.cta_001"],
              scenario_plan: {
                schema_version: "0.5",
                plan_id: "shallow-plan",
                scenario_type: "custom_compiled",
                source_discovery_id: "ignored",
                goal: "ignored",
                start_url: "https://attacker.example",
                environment: {},
                safety: {},
                fit_requirements: {},
                steps: [
                  {
                    step_id: "step_001_goto",
                    stage: "FIRST_VIEW",
                    description: "추천 시작 화면을 연다.",
                    action: { type: "goto", target: "https://example.com" },
                    settle_strategy: { type: "network_idle", timeout_ms: 3000 },
                    checkpoint: true
                  },
                  {
                    step_id: "step_002_first_view_checkpoint",
                    stage: "FIRST_VIEW",
                    description: "첫 화면만 기록한다.",
                    action: { type: "checkpoint" },
                    settle_strategy: { type: "none", timeout_ms: 0 },
                    checkpoint: true
                  }
                ]
              }
            }
          })
        };
      }
    }
  });

  assert.equal(result.candidates[0]?.candidate_id, "rule_based_signup_lead_form_001");
  assert.equal(result.providerTrace[0]?.provider_type, "INTERNAL_LLM");
  assert.equal(result.providerTrace[0]?.status, "FAILED");
  assert.match(result.providerTrace[0]?.fallback_reason ?? "", /depthId=form-depth/);
  assert.equal(result.providerTrace[1]?.provider_type, "RULE_BASED");
  assert.equal(result.providerTrace[1]?.status, "SUCCEEDED");
});

test("Runner ScenarioAuthoring falls back to RULE_BASED when INTERNAL_LLM fails", async () => {
  const message = parseScenarioAuthoringExecuteMessage(JSON.stringify(createScenarioAuthoringExecuteMessage({
    providerOrder: ["INTERNAL_LLM", "RULE_BASED"]
  })));
  const config = createRunnerTestConfig({
    scenarioAuthoringLlmEndpoint: "https://gms.example/v1/chat/completions",
    scenarioAuthoringLlmModel: "gpt-5.2-pro"
  });

  const result = await executeScenarioAuthoring({
    message,
    config,
    llmTransport: {
      async complete() {
        throw new Error("GMS unavailable");
      }
    }
  });

  assert.equal(result.candidates[0]?.candidate_id, "rule_based_landing_cta_001");
  assert.equal(result.providerTrace[0]?.provider_type, "INTERNAL_LLM");
  assert.equal(result.providerTrace[0]?.status, "FAILED");
  assert.match(result.providerTrace[0]?.fallback_reason ?? "", /GMS unavailable/);
  assert.equal(result.providerTrace[1]?.provider_type, "RULE_BASED");
  assert.equal(result.providerTrace[1]?.status, "SUCCEEDED");
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

function createScenarioAuthoringExecuteMessage(overrides: {
  requestedGoal?: string;
  providerOrder?: Array<"INTERNAL_LLM" | "RULE_BASED">;
  scenarioType?: "LANDING_CTA" | "SIGNUP_LEAD_FORM" | "PRICING" | "PURCHASE_CHECKOUT" | "CONTACT" | "CONTENT_ONLY";
  suggestedTarget?: Record<string, unknown>;
  constraints?: Record<string, unknown>;
} = {}) {
  const requestedGoal = overrides.requestedGoal ?? "랜딩 CTA 진입점을 검증한다";
  const providerOrder = overrides.providerOrder ?? ["RULE_BASED"];
  const scenarioType = overrides.scenarioType ?? "LANDING_CTA";
  const suggestedTarget = overrides.suggestedTarget ?? { role: "link", text: "시작하기" };
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
        preferred_scenario_type: scenarioType,
        selected_recommendation: {
          recommendation_id: "rec-1",
          scenario_type: scenarioType,
          recommendation_level: "HIGH",
          confidence: 0.88,
          evidence_refs: ["cp_001.cta_001"],
          suggested_start_url: "https://example.com",
          suggested_target: suggestedTarget
        },
        constraints: overrides.constraints ?? {},
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
        allowed_provider_types: providerOrder,
        provider_order: providerOrder,
        timeout_ms: 30000,
        fallback_allowed: true,
        approval_required: true,
        max_attempts: 1
      }
    }
  };
}
