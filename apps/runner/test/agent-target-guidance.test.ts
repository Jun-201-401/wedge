import assert from "node:assert/strict";
import test from "node:test";
import { applyTargetGuidanceToDecision, decideNextAction, decisionSatisfiesTargetGuidance } from "../src/agent/planner.ts";
import { createInitialAgentState } from "../src/agent/state.ts";
import { createSimulatedPageSnapshot } from "./support.ts";
import type { AgentDecisionInput } from "../src/agent/planner.ts";
import type { ScenarioPlan } from "../src/shared/contracts.ts";

const plan: ScenarioPlan = {
  schema_version: "0.5",
  plan_id: "target-guidance-test",
  scenario_type: "custom_compiled",
  goal: "랜딩 전환 버튼 점검",
  start_url: "https://example.com",
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
  },
  steps: []
};

test("[Agent Target Guidance] recommendation target beats unrelated purchase CTA", () => {
  const state = createInitialAgentState();
  state.started = true;
  const input: AgentDecisionInput = {
    runId: "run-target-guidance",
    goal: "랜딩 전환 버튼 점검",
    startUrl: plan.start_url,
    state,
    maxScrolls: 0,
    targetGuidance: {
      mode: "PREFER_THEN_FAIL",
      preferred_scenario_type: "LANDING_CTA",
      preferred_target: {
        text: "회원가입",
        href_contains: "/signup"
      }
    },
    observation: {
      snapshot: createSimulatedPageSnapshot(plan, {
        interactiveComponents: [
          {
            text: "떡 구매하기",
            selector: "#buy-rice-cake",
            href: "https://example.com/products/rice-cake",
            role: "link",
            tag: "a",
            clickable: true,
            clicked_in_scenario: false,
            is_cta_candidate: true,
            is_primary_like: true,
            bounds: { x: 10, y: 10, width: 150, height: 40, unit: "css_px" }
          },
          {
            text: "회원가입",
            selector: "#signup",
            href: "https://example.com/signup",
            role: "link",
            tag: "a",
            clickable: true,
            clicked_in_scenario: false,
            is_cta_candidate: true,
            is_primary_like: false,
            bounds: { x: 180, y: 10, width: 100, height: 40, unit: "css_px" }
          }
        ]
      })
    }
  };

  const decision = decideNextAction(input);

  assert.equal(decision.action.type, "click");
  assert.equal(decision.targetKey, "#signup");
  assert.deepEqual(decision.action.target, {
    selector: "#signup",
    role: "link",
    text: "회원가입",
    url: "https://example.com/signup"
  });
});

test("[Agent Target Guidance] strict recommendation target blocks off-target LLM click", () => {
  const state = createInitialAgentState();
  state.started = true;
  const input: AgentDecisionInput = {
    runId: "run-target-guidance-llm",
    goal: "랜딩 전환 버튼 점검",
    startUrl: plan.start_url,
    state,
    maxScrolls: 0,
    targetGuidance: {
      mode: "PREFER_THEN_FAIL",
      preferred_target: {
        text: "회원가입",
        href_contains: "/signup"
      }
    },
    observation: {
      snapshot: createSimulatedPageSnapshot(plan, {
        interactiveComponents: [
          {
            text: "떡 구매하기",
            selector: "#buy-rice-cake",
            href: "https://example.com/products/rice-cake",
            role: "link",
            tag: "a",
            clickable: true,
            clicked_in_scenario: false,
            is_cta_candidate: true,
            is_primary_like: true,
            bounds: { x: 10, y: 10, width: 150, height: 40, unit: "css_px" }
          }
        ]
      })
    }
  };

  const offTargetDecision = {
    kind: "act" as const,
    description: "Click purchase",
    reason: "model selected purchase",
    confidence: 0.9,
    action: {
      type: "click" as const,
      target: { selector: "#buy-rice-cake", text: "떡 구매하기" }
    },
    settleStrategy: { type: "fixed_short" as const, timeout_ms: 500 },
    stage: "CTA" as const,
    targetKey: "#buy-rice-cake"
  };

  const decision = applyTargetGuidanceToDecision(offTargetDecision, input);

  assert.equal(decision.kind, "act");
  assert.equal(decision.action.type, "goto");
  assert.deepEqual(decision.action.target, {
    url: "https://example.com/signup"
  });
});

test("[Agent Target Guidance] URL recommendation opens the recommended entrypoint directly", () => {
  const state = createInitialAgentState();
  state.started = true;
  const input: AgentDecisionInput = {
    runId: "run-target-guidance-url",
    goal: "장바구니 진입 흐름 점검",
    startUrl: plan.start_url,
    state,
    maxScrolls: 0,
    targetGuidance: {
      mode: "PREFER_THEN_FAIL",
      preferred_target: {
        url: "https://example.com/order/cart"
      }
    },
    observation: {
      snapshot: createSimulatedPageSnapshot(plan, {
        finalUrl: "https://example.com/",
        interactiveComponents: [
          {
            text: "떡 구매하기",
            selector: "#buy-rice-cake",
            href: "https://example.com/products/rice-cake",
            role: "link",
            tag: "a",
            clickable: true,
            clicked_in_scenario: false,
            is_cta_candidate: true,
            is_primary_like: true,
            bounds: { x: 10, y: 10, width: 150, height: 40, unit: "css_px" }
          }
        ]
      })
    }
  };

  const decision = decideNextAction(input);

  assert.equal(decision.action.type, "goto");
  assert.deepEqual(decision.action.target, {
    url: "https://example.com/order/cart"
  });
  assert.equal(decisionSatisfiesTargetGuidance(decision, input.targetGuidance), true);
});

test("[Agent Target Guidance] href recommendation opens the recommended entrypoint directly instead of replaying a same-role link", () => {
  const state = createInitialAgentState();
  state.started = true;
  const input: AgentDecisionInput = {
    runId: "run-target-guidance-href",
    goal: "랜딩 전환 버튼 점검",
    startUrl: "https://www.mgdj.co.kr/",
    state,
    maxScrolls: 2,
    targetGuidance: {
      mode: "PREFER_THEN_FAIL",
      preferred_target: {
        role: "link",
        text: "회원가입",
        selector: "a[href=\"../member/join_method.php\"]",
        href_contains: "/member/join_method.php"
      }
    },
    observation: {
      snapshot: createSimulatedPageSnapshot(plan, {
        finalUrl: "https://www.mgdj.co.kr/",
        interactiveComponents: [
          {
            text: "",
            selector: "a[href=\"/goods/goods_list.php?cateCd=001\"]",
            href: "https://www.mgdj.co.kr/goods/goods_list.php?cateCd=001",
            role: "link",
            tag: "a",
            clickable: true,
            clicked_in_scenario: false,
            is_cta_candidate: true,
            is_primary_like: true,
            bounds: { x: 10, y: 10, width: 150, height: 40, unit: "css_px" }
          }
        ]
      })
    }
  };

  const sameRoleOffTargetReplayDecision = {
    kind: "act" as const,
    description: "Replay old purchase category",
    reason: "stale replay selected a product category link",
    confidence: 0.74,
    action: {
      type: "click" as const,
      target: {
        url: "https://www.mgdj.co.kr/goods/goods_list.php?cateCd=001",
        role: "link",
        selector: "a[href=\"/goods/goods_list.php?cateCd=001\"]"
      }
    },
    settleStrategy: { type: "fixed_short" as const, timeout_ms: 500 },
    stage: "CTA" as const,
    targetKey: "a[href=\"/goods/goods_list.php?cateCd=001\"]"
  };

  const decision = applyTargetGuidanceToDecision(sameRoleOffTargetReplayDecision, input);

  assert.equal(decision.action.type, "goto");
  assert.deepEqual(decision.action.target, {
    url: "https://www.mgdj.co.kr/member/join_method.php"
  });
});

test("[Agent Target Guidance] after the recommended target is satisfied, later flow actions are allowed", () => {
  const state = createInitialAgentState();
  state.started = true;
  state.targetGuidanceSatisfied = true;
  const input: AgentDecisionInput = {
    runId: "run-target-guidance-continued-flow",
    goal: "랜딩 전환 버튼 점검",
    startUrl: plan.start_url,
    state,
    maxScrolls: 0,
    targetGuidance: {
      mode: "PREFER_THEN_FAIL",
      preferred_target: {
        text: "1:1문의게시판"
      }
    },
    observation: {
      snapshot: createSimulatedPageSnapshot(plan, {
        finalUrl: "https://example.com/qna",
        interactiveComponents: [
          {
            text: "문의 작성",
            selector: "#write-inquiry",
            href: "https://example.com/qna/new",
            role: "link",
            tag: "a",
            clickable: true,
            clicked_in_scenario: false,
            is_cta_candidate: true,
            is_primary_like: true,
            bounds: { x: 10, y: 10, width: 150, height: 40, unit: "css_px" }
          }
        ]
      })
    }
  };

  const offTargetContinuationDecision = {
    kind: "act" as const,
    description: "Continue inquiry flow",
    reason: "model continues after entering the recommended board",
    confidence: 0.82,
    action: {
      type: "click" as const,
      target: { selector: "#write-inquiry", text: "문의 작성" }
    },
    settleStrategy: { type: "fixed_short" as const, timeout_ms: 500 },
    stage: "CTA" as const,
    targetKey: "#write-inquiry"
  };

  const decision = applyTargetGuidanceToDecision(offTargetContinuationDecision, input);

  assert.equal(decision.action.type, "click");
  assert.equal(decision.targetKey, "#write-inquiry");
});
