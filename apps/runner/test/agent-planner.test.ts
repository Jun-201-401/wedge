import assert from "node:assert/strict";
import test from "node:test";
import { decideNextAction } from "../src/agent/planner.ts";
import { createInitialAgentState } from "../src/agent/state.ts";
import type { InteractiveComponentObservationItem } from "../src/shared/contracts.ts";
import { createMinimalPlan, createSimulatedPageSnapshot } from "./support.ts";

test("[Agent Planner] checkout 목표에서는 일반 CTA보다 장바구니 담기를 우선 클릭한다", () => {
  const state = createInitialAgentState();
  state.started = true;

  const decision = decideNextAction({
    runId: "00000000-0000-4000-8000-000000000501",
    goal: "checkout 진입 여부를 확인한다",
    startUrl: "https://example.com/product",
    state,
    maxScrolls: 0,
    observation: {
      snapshot: createSimulatedPageSnapshot(createMinimalPlan(), {
        interactiveComponents: [
          component({
            text: "Learn more",
            selector: "#learn-more",
            is_primary_like: true
          }),
          component({
            text: "장바구니 담기",
            selector: "#add-to-cart",
            is_primary_like: false
          })
        ]
      })
    }
  });

  assert.equal(decision.action.type, "click");
  assert.deepEqual(decision.action.target, {
    selector: "#add-to-cart",
    role: "button",
    text: "장바구니 담기"
  });
  assert.match(decision.replayHint?.candidate_fingerprint ?? "", /^candidate:[a-f0-9]{16}$/);
  assert.match(decision.metadata?.decisionId ?? "", /^[0-9a-f-]{36}$/);
  assert.equal(decision.metadata?.decisionSource, "heuristic");
  assert.equal(decision.metadata?.model, undefined);
  assert.deepEqual(decision.replayHint?.locator_recipe[0], {
    strategy: "selector",
    selector: "#add-to-cart",
    confidence: 0.9
  });
  assert.match(decision.reason, /cart/);
});

test("[Agent Planner] checkout 목표에서는 cart 다음 checkout 후보를 순서대로 고른다", () => {
  const state = createInitialAgentState();
  state.started = true;
  state.clickedTargetKeys.add("#add-to-cart");

  const cartDecision = decideNextAction({
    runId: "00000000-0000-4000-8000-000000000502",
    goal: "Find checkout entry",
    startUrl: "https://example.com/product",
    state,
    maxScrolls: 0,
    observation: {
      snapshot: createSimulatedPageSnapshot(createMinimalPlan(), {
        interactiveComponents: [
          component({
            text: "장바구니",
            selector: "#cart"
          }),
          component({
            text: "계속 쇼핑",
            selector: "#continue"
          })
        ]
      })
    }
  });

  assert.deepEqual(cartDecision.action.target, {
    selector: "#cart",
    role: "button",
    text: "장바구니"
  });

  state.clickedTargetKeys.add("#cart");
  const checkoutDecision = decideNextAction({
    runId: "00000000-0000-4000-8000-000000000503",
    goal: "Find checkout entry",
    startUrl: "https://example.com/product",
    state,
    maxScrolls: 0,
    observation: {
      snapshot: createSimulatedPageSnapshot(createMinimalPlan(), {
        interactiveComponents: [
          component({
            text: "Checkout",
            selector: "#checkout"
          }),
          component({
            text: "Remove item",
            selector: "#remove"
          })
        ]
      })
    }
  });

  assert.deepEqual(checkoutDecision.action.target, {
    selector: "#checkout",
    role: "button",
    text: "Checkout"
  });
  assert.equal(checkoutDecision.stage, "COMMIT");
});

test("[Agent Planner] checkout 목표에서는 상품 Q&A/리뷰/배송 안내 링크를 구매 후보에서 제외한다", () => {
  const state = createInitialAgentState();
  state.started = true;

  const decision = decideNextAction({
    runId: "00000000-0000-4000-8000-000000000512",
    goal: "CHECKOUT_ENTRY_VERIFICATION",
    startUrl: "https://example.com/product",
    state,
    maxScrolls: 0,
    observation: {
      snapshot: createSimulatedPageSnapshot(createMinimalPlan(), {
        interactiveComponents: [
          component({
            text: "상품문의 전체보기",
            selector: "a.btn_qna_more",
            href: "/board/list.php?bdId=goodsqa",
            role: "link",
            tag: "a"
          }),
          component({
            text: "[지역별 금액별 배송비용 참조_클릭]",
            selector: "#shipping-fee",
            href: "/main/html.php?htmid=proc/outside2.html",
            role: "link",
            tag: "a"
          }),
          component({
            text: "최근본 이전 상품",
            selector: "button.bnt_scroll_prev"
          }),
          component({
            text: "장바구니",
            selector: "#cart"
          })
        ]
      })
    }
  });

  assert.equal(decision.action.type, "click");
  assert.deepEqual(decision.action.target, {
    selector: "#cart",
    role: "button",
    text: "장바구니"
  });
});

test("[Agent Planner] consent dialog에서는 backdrop 대신 동의 버튼을 우선 클릭한다", () => {
  const state = createInitialAgentState();
  state.started = true;

  const decision = decideNextAction({
    runId: "00000000-0000-4000-8000-000000000504",
    goal: "지도 첫 화면을 분석한다",
    startUrl: "https://example.com/explore",
    state,
    maxScrolls: 0,
    observation: {
      snapshot: createSimulatedPageSnapshot(createMinimalPlan(), {
        interactiveComponents: [
          component({
            text: "나중에 결정",
            selector: "button.absolute",
            label_text: "나중에 결정",
            accessible_name: "나중에 결정",
            visible_text: null,
            container_role: "dialog",
            container_heading: "익명 사용 통계 수집",
            nearby_text: ["서비스 개선을 위해 페이지 방문·기능 사용 기록을 익명으로 수집합니다."],
            is_primary_like: true,
            bounds: {
              x: 0,
              y: 0,
              width: 1440,
              height: 900,
              unit: "css_px"
            },
            visibility: {
              area_px: 1_296_000,
              visible: true,
              above_fold: true,
              in_viewport: true,
              viewport_coverage_ratio: 1
            }
          }),
          component({
            text: "동의",
            selector: "button.w-full",
            container_role: "dialog",
            container_heading: "익명 사용 통계 수집",
            nearby_text: ["서비스 개선을 위해 페이지 방문·기능 사용 기록을 익명으로 수집합니다."],
            bounds: {
              x: 552,
              y: 502,
              width: 336,
              height: 40,
              unit: "css_px"
            }
          })
        ]
      })
    }
  });

  assert.equal(decision.action.type, "click");
  assert.deepEqual(decision.action.target, {
    selector: "button.w-full",
    role: "button",
    text: "동의"
  });
  assert.equal(decision.stage, "FIRST_VIEW");
  assert.match(decision.reason, /consent|analytics/i);
});

test("[Agent Planner] notice layer popup에서는 일반 CTA보다 닫기 버튼을 우선 클릭한다", () => {
  const state = createInitialAgentState();
  state.started = true;

  const decision = decideNextAction({
    runId: "00000000-0000-4000-8000-000000000505",
    goal: "첫 화면 상품 탐색 흐름을 분석한다",
    startUrl: "https://example.com",
    state,
    maxScrolls: 0,
    observation: {
      snapshot: createSimulatedPageSnapshot(createMinimalPlan(), {
        interactiveComponents: [
          component({
            text: "대표 상품 보기",
            selector: "#hero-cta",
            is_primary_like: true,
            bounds: {
              x: 400,
              y: 300,
              width: 320,
              height: 80,
              unit: "css_px"
            }
          }),
          component({
            text: "닫기",
            selector: "button.close",
            container_role: "popup",
            container_heading: null,
            nearby_text: ["오늘 하루 보이지 않음"],
            is_cta_candidate: false,
            bounds: {
              x: 701,
              y: 228,
              width: 18,
              height: 18,
              unit: "css_px"
            }
          })
        ]
      })
    }
  });

  assert.equal(decision.action.type, "click");
  assert.deepEqual(decision.action.target, {
    selector: "button.close",
    role: "button",
    text: "닫기"
  });
  assert.equal(decision.stage, "FIRST_VIEW");
  assert.match(decision.reason, /popup/i);
});

test("[Agent Planner] 가입/리드 목표에서는 상품 카테고리보다 가입/폼 진입점을 우선 클릭한다", () => {
  const state = createInitialAgentState();
  state.started = true;

  const decision = decideNextAction({
    runId: "00000000-0000-4000-8000-000000000506",
    goal: "SIGNUP_LEAD_FORM_VERIFICATION",
    startUrl: "https://example.com",
    state,
    maxScrolls: 0,
    observation: {
      snapshot: createSimulatedPageSnapshot(createMinimalPlan(), {
        interactiveComponents: [
          component({
            text: "답례떡",
            selector: 'a[href="/goods/goods_list.php?cateCd=001"]',
            href: "/goods/goods_list.php?cateCd=001",
            is_primary_like: true
          }),
          component({
            text: "회원가입",
            selector: 'a[href="/member/join"]',
            href: "/member/join"
          })
        ]
      })
    }
  });

  assert.equal(decision.action.type, "click");
  assert.deepEqual(decision.action.target, {
    selector: 'a[href="/member/join"]',
    role: "button",
    text: "회원가입",
    url: "/member/join"
  });
  assert.match(decision.reason, /Signup|lead-form/i);
});

test("[Agent Planner] 가입/리드 목표에서는 의미 없는 상품 링크를 CTA fallback으로 클릭하지 않는다", () => {
  const state = createInitialAgentState();
  state.started = true;

  const decision = decideNextAction({
    runId: "00000000-0000-4000-8000-000000000507",
    goal: "가입 또는 리드 입력 양식까지 이동하며 입력 부담을 확인합니다.",
    startUrl: "https://example.com",
    state,
    maxScrolls: 0,
    observation: {
      snapshot: createSimulatedPageSnapshot(createMinimalPlan(), {
        interactiveComponents: [
          component({
            text: "답례떡",
            selector: 'a[href="/goods/goods_list.php?cateCd=001"]',
            href: "/goods/goods_list.php?cateCd=001",
            is_primary_like: true
          })
        ]
      })
    }
  });

  assert.equal(decision.kind, "finish");
  assert.equal(decision.action.type, "checkpoint");
  assert.equal(decision.targetKey, null);
});

test("[Agent Planner] 문의 목표에서는 상품 CTA보다 문의 진입점을 우선 클릭한다", () => {
  const state = createInitialAgentState();
  state.started = true;

  const decision = decideNextAction({
    runId: "00000000-0000-4000-8000-000000000508",
    goal: "CONTACT_FLOW_VERIFICATION",
    startUrl: "https://example.com",
    state,
    maxScrolls: 0,
    observation: {
      snapshot: createSimulatedPageSnapshot(createMinimalPlan(), {
        interactiveComponents: [
          component({
            text: "상품 보기",
            selector: "#products",
            is_primary_like: true
          }),
          component({
            text: "문의하기",
            selector: "#contact"
          })
        ]
      })
    }
  });

  assert.equal(decision.action.type, "click");
  assert.deepEqual(decision.action.target, {
    selector: "#contact",
    role: "button",
    text: "문의하기"
  });
  assert.match(decision.reason, /Contact-flow/i);
});

test("[Agent Planner] 문의 목표에서는 텍스트가 약한 고정 상담 버튼도 후보 텍스트로 인식한다", () => {
  const state = createInitialAgentState();
  state.started = true;

  const decision = decideNextAction({
    runId: "00000000-0000-4000-8000-000000000509",
    goal: "CONTACT_FLOW_VERIFICATION",
    startUrl: "https://example.com",
    state,
    maxScrolls: 0,
    observation: {
      snapshot: createSimulatedPageSnapshot(createMinimalPlan(), {
        interactiveComponents: [
          component({
            text: "문의하기",
            selector: "#contact"
          }),
          component({
            text: "",
            visible_text: null,
            accessible_name: "카카오톡 상담",
            selector: ".floating-kakao",
            href: "https://pf.kakao.com/example",
            role: "link",
            tag: "a",
            layout: {
              center_x: 1320,
              center_y: 720,
              viewport_position: "inside",
              css_position: "fixed",
              z_index: "100",
              is_fixed: true,
              is_sticky: false,
              overlay_candidate: false
            }
          })
        ]
      })
    }
  });

  assert.equal(decision.action.type, "click");
  assert.deepEqual(decision.action.target, {
    selector: ".floating-kakao",
    role: "link",
    url: "https://pf.kakao.com/example"
  });
  assert.match(decision.reason, /Contact-flow/i);
});

test("[Agent Planner] 랜딩 전환 점검 목표에서는 스크롤보다 전환 CTA를 먼저 클릭한다", () => {
  const state = createInitialAgentState();
  state.started = true;

  const decision = decideNextAction({
    runId: "00000000-0000-4000-8000-000000000510",
    goal: "랜딩 전환 버튼 점검",
    startUrl: "https://example.com",
    state,
    maxScrolls: 2,
    observation: {
      snapshot: createSimulatedPageSnapshot(createMinimalPlan(), {
        interactiveComponents: [
          component({
            text: "무료상담 받기",
            selector: "#free-consult",
            is_primary_like: true
          })
        ]
      })
    }
  });

  assert.equal(decision.action.type, "click");
  assert.deepEqual(decision.action.target, {
    selector: "#free-consult",
    role: "button",
    text: "무료상담 받기"
  });
  assert.match(decision.reason, /Landing conversion/i);
});

test("[Agent Planner] 주변 텍스트의 상담 문맥도 문의 진입점 판단에 사용한다", () => {
  const state = createInitialAgentState();
  state.started = true;

  const decision = decideNextAction({
    runId: "00000000-0000-4000-8000-000000000511",
    goal: "CONTACT_FLOW_VERIFICATION",
    startUrl: "https://example.com",
    state,
    maxScrolls: 0,
    observation: {
      snapshot: createSimulatedPageSnapshot(createMinimalPlan(), {
        interactiveComponents: [
          component({
            text: "바로가기",
            selector: "#hero-link",
            container_heading: "카카오톡 빠른상담",
            nearby_text: ["궁금한 점은 톡상담으로 문의해 주세요."]
          })
        ]
      })
    }
  });

  assert.equal(decision.action.type, "click");
  assert.deepEqual(decision.action.target, {
    selector: "#hero-link",
    role: "button",
    text: "바로가기"
  });
  assert.match(decision.reason, /Contact-flow/i);
});

function component(overrides: Partial<InteractiveComponentObservationItem>): InteractiveComponentObservationItem {
  return {
    text: "Button",
    selector: "#button",
    role: "button",
    tag: "button",
    clickable: true,
    clicked_in_scenario: false,
    is_cta_candidate: true,
    is_primary_like: false,
    bounds: {
      x: 0,
      y: 0,
      width: 100,
      height: 40,
      unit: "css_px"
    },
    ...overrides
  };
}
