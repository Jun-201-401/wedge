import assert from "node:assert/strict";
import test from "node:test";
import type { AgentDecision } from "../src/agent/planner.ts";
import { verifyGoal } from "../src/agent/verifier.ts";
import type { VisibleTextBlockObservationItem } from "../src/shared/contracts.ts";
import { createMinimalPlan, createSimulatedPageSnapshot } from "./support.ts";

test("[Agent Verifier] 강한 전환 CTA 클릭 후 같은 URL에 구매/옵션 상태가 보이면 성공으로 본다", () => {
  const plan = createMinimalPlan();
  const decision = clickDecision({
    text: "바로 구매",
    selector: "button.btn_add_order",
    reason: "랜딩 전환 CTA로 보이는 바로 구매 버튼을 클릭한다"
  });

  const result = verifyGoal({
    goal: "랜딩 전환 버튼 점검",
    startUrl: "https://www.mgdj.co.kr/",
    previousUrl: "https://www.mgdj.co.kr/goods/goods_view.php?goodsNo=1070",
    phase: "post_action",
    decision,
    snapshot: createSimulatedPageSnapshot(plan, {
      finalUrl: "https://www.mgdj.co.kr/goods/goods_view.php?goodsNo=1070",
      title: "참품 3호 답례떡",
      visibleTextBlocks: [
        textBlock("배송비 (필수) 배송비를 선택해 주세요."),
        textBlock("총 상품금액 5,200원 총 합계금액 5,200원"),
        textBlock("바로 구매 장바구니 찜하기")
      ],
      interactiveComponents: [
        {
          text: "바로 구매",
          selector: "button.btn_add_order",
          role: "button",
          tag: "button",
          clickable: true,
          clicked_in_scenario: false,
          is_cta_candidate: true,
          is_primary_like: true,
          bounds: {
            x: 900,
            y: 700,
            width: 160,
            height: 44,
            unit: "css_px"
          }
        }
      ]
    })
  });

  assert.equal(result.satisfied, true);
  assert.equal(result.terminal, true);
  assert.equal(result.outcome, "SUCCESS");
  assert.match(result.reason, /in-page purchase|conversion state/i);
});

test("[Agent Verifier] 일반 상품/카테고리 링크 클릭은 구매 상태 문구가 있어도 강한 전환 성공으로 보지 않는다", () => {
  const plan = createMinimalPlan();
  const decision = clickDecision({
    text: "답례떡",
    selector: 'a[href="../goods/goods_view.php?goodsNo=1070"]',
    reason: "상품 상세로 이동한다"
  });

  const result = verifyGoal({
    goal: "랜딩 전환 버튼 점검",
    startUrl: "https://www.mgdj.co.kr/",
    previousUrl: "https://www.mgdj.co.kr/goods/goods_list.php?cateCd=001",
    phase: "post_action",
    decision,
    snapshot: createSimulatedPageSnapshot(plan, {
      finalUrl: "https://www.mgdj.co.kr/goods/goods_view.php?goodsNo=1070",
      title: "참품 3호 답례떡",
      visibleTextBlocks: [
        textBlock("판매가 5,200원"),
        textBlock("총 상품금액 5,200원")
      ]
    })
  });

  assert.equal(result.satisfied, false);
  assert.equal(result.terminal, false);
  assert.equal(result.outcome, "CONTINUE");
});

test("[Agent Verifier] 구매 목표에서는 상품 상세의 구매 직전 경계가 보이면 클릭하지 않고 성공으로 멈춘다", () => {
  const plan = createMinimalPlan();

  const result = verifyGoal({
    goal: "CHECKOUT_ENTRY_VERIFICATION",
    startUrl: "https://www.mgdj.co.kr/",
    previousUrl: "https://www.mgdj.co.kr/goods/goods_view.php?goodsNo=1070",
    phase: "pre_decision",
    snapshot: createSimulatedPageSnapshot(plan, {
      finalUrl: "https://www.mgdj.co.kr/goods/goods_view.php?goodsNo=1070",
      title: "상품 상세",
      visiblePrices: ["5,200원"],
      visibleTextBlocks: [
        textBlock("판매가 5,200원"),
        textBlock("배송비 선택 필수"),
        textBlock("총 상품금액 5,200원 총 합계금액 5,200원")
      ],
      interactiveComponents: [
        {
          text: "바로 구매",
          selector: "button.btn_add_order",
          role: "button",
          tag: "button",
          clickable: true,
          clicked_in_scenario: false,
          is_cta_candidate: true,
          is_primary_like: true,
          bounds: {
            x: 900,
            y: 700,
            width: 160,
            height: 44,
            unit: "css_px"
          }
        },
        {
          text: "장바구니",
          selector: "button.btn_add_cart",
          role: "button",
          tag: "button",
          clickable: true,
          clicked_in_scenario: false,
          is_cta_candidate: true,
          is_primary_like: false,
          bounds: {
            x: 720,
            y: 700,
            width: 160,
            height: 44,
            unit: "css_px"
          }
        }
      ]
    })
  });

  assert.equal(result.satisfied, true);
  assert.equal(result.terminal, true);
  assert.equal(result.outcome, "SUCCESS");
  assert.match(result.reason, /purchase boundary|before clicking/i);
});

test("[Agent Verifier] 강한 CTA 클릭이라도 전환 상태 신호가 없으면 계속 탐색한다", () => {
  const plan = createMinimalPlan();
  const decision = clickDecision({
    text: "바로 구매",
    selector: "button.btn_add_order",
    reason: "랜딩 전환 CTA로 보이는 바로 구매 버튼을 클릭한다"
  });

  const result = verifyGoal({
    goal: "랜딩 전환 버튼 점검",
    startUrl: "https://www.mgdj.co.kr/",
    previousUrl: "https://www.mgdj.co.kr/goods/goods_view.php?goodsNo=1070",
    phase: "post_action",
    decision,
    snapshot: createSimulatedPageSnapshot(plan, {
      finalUrl: "https://www.mgdj.co.kr/goods/goods_view.php?goodsNo=1070",
      title: "참품 3호 답례떡",
      visibleTextBlocks: [
        textBlock("상품 상세 이미지"),
        textBlock("원산지 안내")
      ]
    })
  });

  assert.equal(result.satisfied, false);
  assert.equal(result.terminal, false);
  assert.equal(result.outcome, "CONTINUE");
});

function clickDecision(input: {
  text: string;
  selector: string;
  reason: string;
}): AgentDecision {
  return {
    kind: "act",
    description: `Click candidate: ${input.text}`,
    reason: input.reason,
    confidence: 0.8,
    action: {
      type: "click",
      target: {
        selector: input.selector,
        role: "button",
        text: input.text
      }
    },
    settleStrategy: {
      type: "fixed_short",
      timeout_ms: 500
    },
    stage: "CTA",
    targetKey: input.selector
  };
}

function textBlock(text: string): VisibleTextBlockObservationItem {
  return {
    text,
    tag: "div",
    role: null,
    is_heading: false,
    bounds: {
      x: 0,
      y: 0,
      width: 320,
      height: 24,
      unit: "css_px"
    },
    visibility: {
      area_px: 7_680,
      visible: true,
      above_fold: true,
      in_viewport: true,
      viewport_coverage_ratio: 1
    }
  };
}
