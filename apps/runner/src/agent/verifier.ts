import type { BrowserPageSnapshot } from "../browser/playwright/index.ts";
import type { AgentDecision } from "./planner.ts";

export interface AgentVerificationResult {
  satisfied: boolean;
  reason: string;
  confidence: number;
}

const SUCCESS_URL_PATTERN = /signup|register|join|contact|pricing|checkout|start|demo|apply|inquiry|consult|회원|가입|문의|가격|결제|신청|상담/i;

export function verifyGoal(input: {
  goal: string;
  startUrl: string;
  previousUrl: string;
  snapshot: BrowserPageSnapshot;
  decision: AgentDecision;
}): AgentVerificationResult {
  const finalUrl = input.snapshot.finalUrl;
  const title = input.snapshot.title;
  const goalText = input.goal.toLowerCase();
  const urlChanged = finalUrl !== input.previousUrl && finalUrl !== input.startUrl;
  const goalKeywordMatched = goalKeywords(goalText).some((keyword) =>
    finalUrl.toLowerCase().includes(keyword) || title.toLowerCase().includes(keyword)
  );

  if (input.decision.action.type === "click" && (goalKeywordMatched || (urlChanged && SUCCESS_URL_PATTERN.test(finalUrl)))) {
    return {
      satisfied: true,
      reason: "A CTA click moved the browser to a goal-like destination.",
      confidence: goalKeywordMatched ? 0.8 : 0.65
    };
  }

  if (input.decision.kind === "finish") {
    return {
      satisfied: false,
      reason: input.decision.reason,
      confidence: input.decision.confidence
    };
  }

  return {
    satisfied: false,
    reason: "Goal has not been satisfied yet.",
    confidence: 0.5
  };
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
