import type { BrowserPageSnapshot } from "../browser/playwright/index.ts";
import type { AgentDecision } from "./planner.ts";

export type AgentVerificationOutcome =
  | "CONTINUE"
  | "SUCCESS"
  | "BLOCKED_LOGIN"
  | "BLOCKED_CAPTCHA"
  | "POLICY_BLOCKED"
  | "EXHAUSTED";

export interface AgentVerificationResult {
  satisfied: boolean;
  terminal: boolean;
  outcome: AgentVerificationOutcome;
  reason: string;
  confidence: number;
  phase: "pre_decision" | "post_action";
}

const SUCCESS_URL_PATTERN = /signup|register|join|contact|pricing|checkout|start|demo|apply|inquiry|consult|회원|가입|문의|가격|결제|신청|상담/i;
const CHECKOUT_ENTRY_PATTERN = /checkout|payment|billing|shipping|order|결제|배송|주문/i;
const LOGIN_WALL_PATTERN = /login|log in|sign in|signin|account login|로그인|계정 로그인/i;
const CAPTCHA_PATTERN = /captcha|recaptcha|hcaptcha|bot detection|robot check|verify you are human|비정상|자동화|로봇|보안문자|캡차/i;
const FINAL_COMMIT_PATTERN = /pay now|place order|complete order|submit order|confirm purchase|결제하기|주문하기|구매하기|최종 결제|결제 완료/i;

export function verifyGoal(input: {
  goal: string;
  startUrl: string;
  previousUrl: string;
  snapshot: BrowserPageSnapshot;
  phase?: "pre_decision" | "post_action";
  decision?: AgentDecision;
}): AgentVerificationResult {
  const phase = input.phase ?? "post_action";
  const finalUrl = input.snapshot.finalUrl;
  const title = input.snapshot.title;
  const goalText = input.goal.toLowerCase();
  const urlChanged = finalUrl !== input.previousUrl && finalUrl !== input.startUrl;
  const pageText = createPageSignalText(input.snapshot);
  const goalKeywordMatched = goalKeywords(goalText).some((keyword) =>
    finalUrl.toLowerCase().includes(keyword) || title.toLowerCase().includes(keyword)
  );

  if (phase === "pre_decision") {
    const blocker = verifyPreDecisionBlocker(pageText);
    if (blocker) {
      return blocker;
    }

    const riskyCommit = verifyPreDecisionFinalCommit(pageText);
    if (riskyCommit) {
      return riskyCommit;
    }
  }

  if (phase === "pre_decision" && isGoalLikeDestination({ goalText, finalUrl, title, pageText, startUrl: input.startUrl, goalKeywordMatched })) {
    return {
      satisfied: true,
      terminal: true,
      outcome: "SUCCESS",
      reason: "The current page already appears to satisfy the agent goal before a new decision.",
      confidence: goalKeywordMatched ? 0.8 : 0.65,
      phase
    };
  }

  if (input.decision?.action.type === "click" && (goalKeywordMatched || (urlChanged && SUCCESS_URL_PATTERN.test(finalUrl)))) {
    return {
      satisfied: true,
      terminal: true,
      outcome: "SUCCESS",
      reason: "A CTA click moved the browser to a goal-like destination.",
      confidence: goalKeywordMatched ? 0.8 : 0.65,
      phase
    };
  }

  if (input.decision?.kind === "finish") {
    return {
      satisfied: false,
      terminal: true,
      outcome: "EXHAUSTED",
      reason: input.decision.reason,
      confidence: input.decision.confidence,
      phase
    };
  }

  return {
    satisfied: false,
    terminal: false,
    outcome: "CONTINUE",
    reason: "Goal has not been satisfied yet.",
    confidence: 0.5,
    phase
  };
}

function verifyPreDecisionBlocker(pageText: string): AgentVerificationResult | null {
  if (CAPTCHA_PATTERN.test(pageText)) {
    return {
      satisfied: false,
      terminal: true,
      outcome: "BLOCKED_CAPTCHA",
      reason: "The current page appears to be blocked by CAPTCHA or bot detection.",
      confidence: 0.85,
      phase: "pre_decision"
    };
  }

  if (LOGIN_WALL_PATTERN.test(pageText)) {
    return {
      satisfied: false,
      terminal: true,
      outcome: "BLOCKED_LOGIN",
      reason: "The current page appears to require login before the agent can continue.",
      confidence: 0.75,
      phase: "pre_decision"
    };
  }

  return null;
}

function verifyPreDecisionFinalCommit(pageText: string): AgentVerificationResult | null {
  if (!FINAL_COMMIT_PATTERN.test(pageText)) {
    return null;
  }

  return {
    satisfied: false,
    terminal: true,
    outcome: "POLICY_BLOCKED",
    reason: "A final payment or order commit action is visible, so the agent must stop before a new decision.",
    confidence: 0.82,
    phase: "pre_decision"
  };
}

function isGoalLikeDestination(input: {
  goalText: string;
  finalUrl: string;
  title: string;
  pageText: string;
  startUrl: string;
  goalKeywordMatched: boolean;
}): boolean {
  if (input.finalUrl === input.startUrl) {
    return false;
  }

  if (input.goalKeywordMatched || SUCCESS_URL_PATTERN.test(input.finalUrl)) {
    return true;
  }

  const checkoutGoal = /checkout|payment|cart|order|결제|주문|장바구니|카트/.test(input.goalText);
  return checkoutGoal && (
    CHECKOUT_ENTRY_PATTERN.test(input.finalUrl) ||
    CHECKOUT_ENTRY_PATTERN.test(input.title)
  );
}

function createPageSignalText(snapshot: BrowserPageSnapshot): string {
  return [
    snapshot.finalUrl,
    snapshot.title,
    ...snapshot.interactiveComponents.flatMap((component) => [
      component.text,
      component.role ?? "",
      component.selector ?? "",
      component.tag
    ]),
    ...snapshot.consoleErrors,
    ...snapshot.networkErrors
  ].join(" ");
}

function goalKeywords(goal: string): string[] {
  const keywords = ["signup", "register", "join", "contact", "pricing", "checkout", "demo"];
  if (goal.includes("회원") || goal.includes("가입")) {
    keywords.push("signup", "register", "join", "회원", "가입");
  }
  if (goal.includes("문의") || goal.includes("상담")) {
    keywords.push("contact", "inquiry", "consult", "문의", "상담");
  }
  if (goal.includes("가격") || goal.includes("요금")) {
    keywords.push("pricing", "price", "가격", "요금");
  }
  return [...new Set(keywords)];
}
