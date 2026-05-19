import { randomUUID } from "node:crypto";
import type { AgentObservation } from "./observation.ts";
import type { AgentExecutionState } from "./state.ts";
import type {
  InteractiveComponentObservationItem,
  ScenarioAction,
  ScenarioStage,
  SettleStrategy
} from "../shared/contracts.ts";
import {
  candidateText,
  replayHintFromComponent,
  targetFromComponent,
  targetKey,
  type AgentReplayTargetHint
} from "./component-target.ts";
import { plannerSemantics } from "./semantics.ts";

export type AgentDecisionKind = "act" | "checkpoint" | "finish";
export type AgentDecisionSource = "heuristic" | "llm" | "replay_hint";

export interface AgentDecisionPromptMetadata {
  payloadShapeVersion: string;
  candidateCount: number;
  redacted: boolean;
  rawPromptStored: false;
  rawCandidateSelectorsIncluded: false;
  rawCandidateHrefsIncluded: false;
}

export interface AgentDecisionMetadata {
  decisionId: string;
  decisionSource: AgentDecisionSource;
  model?: string;
  promptMetadata?: AgentDecisionPromptMetadata;
}

export interface AgentDecision {
  kind: AgentDecisionKind;
  description: string;
  reason: string;
  confidence: number;
  action: ScenarioAction;
  settleStrategy: SettleStrategy;
  stage: ScenarioStage;
  targetKey: string | null;
  replayHint?: AgentReplayTargetHint;
  metadata?: AgentDecisionMetadata;
}

export interface AgentDecisionInput {
  runId: string;
  goal: string;
  startUrl: string;
  state: AgentExecutionState;
  observation: AgentObservation;
  maxScrolls: number;
  remainingTimeMs?: number;
}

export interface AgentDecisionClient {
  decide: (input: AgentDecisionInput) => Promise<AgentDecision> | AgentDecision;
}

export class HeuristicDecisionClient implements AgentDecisionClient {
  decide(input: AgentDecisionInput): AgentDecision {
    return decideNextAction(input);
  }
}

export function decideNextAction(input: AgentDecisionInput): AgentDecision {
  return withAgentDecisionMetadata(decideNextActionWithoutMetadata(input), {
    decisionSource: "heuristic"
  });
}

export function withAgentDecisionMetadata(
  decision: AgentDecision,
  input: {
    decisionSource: AgentDecisionSource;
    model?: string;
    promptMetadata?: AgentDecisionPromptMetadata;
  }
): AgentDecision {
  if (decision.metadata) {
    return decision;
  }

  return {
    ...decision,
    metadata: {
      decisionId: randomUUID(),
      decisionSource: input.decisionSource,
      model: input.model,
      promptMetadata: input.promptMetadata
    }
  };
}

export function ensureAgentDecisionMetadata(
  decision: AgentDecision,
  fallbackSource: AgentDecisionSource = "heuristic"
): AgentDecision {
  return withAgentDecisionMetadata(decision, {
    decisionSource: fallbackSource
  });
}

function decideNextActionWithoutMetadata(input: AgentDecisionInput): AgentDecision {
  if (!input.state.started) {
    return {
      kind: "act",
      description: "Open the start URL before observing the service flow.",
      reason: "Agent mode begins by loading the provided service URL.",
      confidence: 1,
      action: {
        type: "goto",
        target: {
          url: input.startUrl
        }
      },
      settleStrategy: {
        type: "network_idle",
        timeout_ms: 1_000
      },
      stage: "FIRST_VIEW",
      targetKey: input.startUrl
    };
  }

  const candidate = selectActionCandidate(input);
  if (candidate) {
    return componentToDecision(candidate);
  }

  if (input.state.scrollCount < input.maxScrolls) {
    return {
      kind: "act",
      description: "Scroll to discover additional UX entrypoints.",
      reason: "No untried CTA-like component is visible, so the agent expands the search area.",
      confidence: 0.55,
      action: {
        type: "scroll",
        value: 700
      },
      settleStrategy: {
        type: "fixed_short",
        timeout_ms: 250
      },
      stage: "VALUE",
      targetKey: "scroll:700"
    };
  }

  return {
    kind: "finish",
    description: "Stop after exhausting visible and scroll-discovered entrypoints.",
    reason: "The agent could not find an actionable untried CTA candidate within the turn budget.",
    confidence: 0.4,
    action: {
      type: "checkpoint"
    },
    settleStrategy: {
      type: "none",
      timeout_ms: 0
    },
    stage: "COMMIT",
    targetKey: null
  };
}

interface ActionCandidate {
  component: InteractiveComponentObservationItem;
  reason: string;
  confidence: number;
  stage: ScenarioStage;
}

const CHECKOUT_ACTION_RULES: Array<{
  pattern: RegExp;
  reason: string;
  confidence: number;
  stage: ScenarioStage;
}> = [
  {
    pattern: plannerSemantics.addToCart,
    reason: "Checkout verification should add an obvious product to the cart before looking for checkout.",
    confidence: 0.82,
    stage: "CTA"
  },
  {
    pattern: plannerSemantics.cartNavigation,
    reason: "Checkout verification should inspect the cart after a cart-related entrypoint appears.",
    confidence: 0.78,
    stage: "CTA"
  },
  {
    pattern: plannerSemantics.checkoutNavigation,
    reason: "Checkout verification found a checkout or payment-entry navigation candidate.",
    confidence: 0.84,
    stage: "COMMIT"
  }
];

function selectActionCandidate(input: AgentDecisionInput): ActionCandidate | undefined {
  const untriedComponents = input.observation.snapshot.interactiveComponents.filter((component) =>
    component.clickable && !component.shadow_root && !input.state.clickedTargetKeys.has(targetKey(component))
  );

  const consentAction = selectConsentAction(untriedComponents, input.observation.snapshot.viewport);
  if (consentAction) {
    return consentAction;
  }

  const noticePopupAction = selectNoticePopupDismissAction(untriedComponents);
  if (noticePopupAction) {
    return noticePopupAction;
  }

  const cookieAction = selectCookieAction(untriedComponents);
  if (cookieAction) {
    return cookieAction;
  }

  const goalSpecificAction = selectGoalSpecificAction(input.goal, untriedComponents);
  if (goalSpecificAction) {
    return goalSpecificAction;
  }

  if (requiresGoalSpecificEntrypoint(input.goal)) {
    return undefined;
  }

  return selectPrimaryAction(untriedComponents);
}

function selectConsentAction(
  components: InteractiveComponentObservationItem[],
  viewport: AgentDecisionInput["observation"]["snapshot"]["viewport"]
): ActionCandidate | undefined {
  const component = components.find((candidate) => {
    const actionText = candidateText(candidate);
    const contextText = consentContextText(candidate);
    return !isDialogBackdropLike(candidate, viewport) &&
      isConsentModalCandidate(candidate, contextText) &&
      plannerSemantics.consentAccept.test(actionText) &&
      !plannerSemantics.consentDeferOrReject.test(actionText) &&
      !isMarketingOnlyConsent(contextText);
  });

  return component
    ? {
        component,
        reason: "A consent or analytics dialog is blocking the page, so the agent accepts the non-sensitive service consent before continuing.",
        confidence: 0.8,
        stage: "FIRST_VIEW"
      }
    : undefined;
}

function selectNoticePopupDismissAction(components: InteractiveComponentObservationItem[]): ActionCandidate | undefined {
  const component = components.find((candidate) => {
    const actionText = candidateText(candidate);
    const contextText = popupContextText(candidate);
    return isPopupContained(candidate) &&
      plannerSemantics.popupDismiss.test(actionText) &&
      !plannerSemantics.consentAccept.test(actionText) &&
      plannerSemantics.popupContext.test(contextText);
  });

  return component
    ? {
        component,
        reason: "A notice or layer popup is blocking the page, so the agent dismisses it before selecting page CTAs.",
        confidence: 0.78,
        stage: "FIRST_VIEW"
      }
    : undefined;
}

function selectCookieAction(components: InteractiveComponentObservationItem[]): ActionCandidate | undefined {
  const component = components.find((candidate) => {
    const text = candidateText(candidate);
    return plannerSemantics.cookieAccept.test(text) && plannerSemantics.cookieContext.test(text);
  });

  return component
    ? {
        component,
        reason: "Cookie or privacy banner action is blocking the page, so the agent clears it first.",
        confidence: 0.76,
        stage: "FIRST_VIEW"
      }
    : undefined;
}

function selectCheckoutAction(components: InteractiveComponentObservationItem[]): ActionCandidate | undefined {
  for (const rule of CHECKOUT_ACTION_RULES) {
    const component = components.find((candidate) => rule.pattern.test(candidateText(candidate)));
    if (component) {
      return {
        component,
        reason: rule.reason,
        confidence: rule.confidence,
        stage: rule.stage
      };
    }
  }

  return undefined;
}

function selectGoalSpecificAction(goal: string, components: InteractiveComponentObservationItem[]): ActionCandidate | undefined {
  if (plannerSemantics.checkoutGoal.test(goal)) {
    return selectCheckoutAction(components);
  }

  if (plannerSemantics.signupLeadGoal.test(goal)) {
    return selectSemanticEntrypoint(components, plannerSemantics.signupLeadEntrypoint, {
      reason: "Signup or lead-form verification should only follow a visible signup, application, or form entrypoint.",
      confidence: 0.8,
      stage: "CTA"
    });
  }

  if (plannerSemantics.contactGoal.test(goal)) {
    return selectSemanticEntrypoint(components, plannerSemantics.contactEntrypoint, {
      reason: "Contact-flow verification should only follow a visible inquiry, consultation, demo, or support entrypoint.",
      confidence: 0.8,
      stage: "CTA"
    });
  }

  if (plannerSemantics.landingConversionGoal.test(goal)) {
    return selectSemanticEntrypoint(components, plannerSemantics.landingConversionEntrypoint, {
      reason: "Landing conversion verification should follow a visible high-intent CTA before continuing to scroll.",
      confidence: 0.78,
      stage: "CTA"
    });
  }

  if (plannerSemantics.pricingGoal.test(goal)) {
    return selectSemanticEntrypoint(components, plannerSemantics.pricingEntrypoint, {
      reason: "Pricing-flow verification should only follow a visible pricing, plan, quote, or estimate entrypoint.",
      confidence: 0.8,
      stage: "CTA"
    });
  }

  return undefined;
}

function selectSemanticEntrypoint(
  components: InteractiveComponentObservationItem[],
  pattern: RegExp,
  decision: Omit<ActionCandidate, "component">
): ActionCandidate | undefined {
  const component = components
    .filter((candidate) => pattern.test(candidateText(candidate)))
    .sort((left, right) => entrypointPriority(right) - entrypointPriority(left))[0];
  return component ? { component, ...decision } : undefined;
}

function requiresGoalSpecificEntrypoint(goal: string): boolean {
  return plannerSemantics.signupLeadGoal.test(goal) ||
    plannerSemantics.contactGoal.test(goal) ||
    plannerSemantics.pricingGoal.test(goal);
}

function selectPrimaryAction(components: InteractiveComponentObservationItem[]): ActionCandidate | undefined {
  const actionableComponents = components.filter((component) => !isDialogBackdropLike(component));
  const candidates = actionableComponents.length > 0 ? actionableComponents : components;
  const component = candidates
    .filter((candidate) => candidate.is_primary_like || candidate.is_cta_candidate)
    .sort((left, right) => entrypointPriority(right) - entrypointPriority(left))[0] ?? candidates[0];

  if (!component) {
    return undefined;
  }

  return {
    component,
    reason: component.is_primary_like
      ? "The component is the primary-like CTA candidate in the current viewport."
      : "The component matches CTA-like copy or interaction semantics.",
    confidence: component.is_primary_like ? 0.82 : 0.68,
    stage: "CTA"
  };
}

function entrypointPriority(component: InteractiveComponentObservationItem): number {
  const text = candidateText(component);
  const selector = component.selector ?? "";
  const href = component.href ?? "";

  return (component.layout?.is_fixed ? 45 : 0) +
    (component.layout?.is_sticky ? 35 : 0) +
    (/fixed|sticky|floating|float|quick|channel|talk|kakao|chat|consult|contact|tel|call|상담|문의|카카오|카톡|톡|전화/i.test(`${selector} ${href}`) ? 30 : 0) +
    (/^tel:|^mailto:/i.test(href) ? 30 : 0) +
    (component.is_primary_like ? 18 : 0) +
    (component.is_cta_candidate ? 14 : 0) +
    (component.role === "button" || component.tag === "button" ? 8 : 0) +
    (component.visibility?.above_fold ? 7 : 0) +
    (component.visibility?.in_viewport ? 5 : 0) +
    (plannerSemantics.contactEntrypoint.test(text) ? 4 : 0);
}

function componentToDecision(candidate: ActionCandidate): AgentDecision {
  const label = candidate.component.text || candidate.component.selector || candidate.component.role || candidate.component.tag;
  return {
    kind: "act",
    description: `Click candidate: ${label}`,
    reason: candidate.reason,
    confidence: candidate.confidence,
    action: {
      type: "click",
      target: targetFromComponent(candidate.component)
    },
    settleStrategy: {
      type: "fixed_short",
      timeout_ms: 500
    },
    stage: candidate.stage,
    targetKey: targetKey(candidate.component),
    replayHint: replayHintFromComponent(candidate.component)
  };
}

function isConsentModalCandidate(component: InteractiveComponentObservationItem, contextText: string): boolean {
  return isModalContained(component) && plannerSemantics.consentContext.test(contextText);
}

function isPopupContained(component: InteractiveComponentObservationItem): boolean {
  const role = component.container_role?.toLowerCase() ?? "";
  const selector = component.selector ?? "";
  return isModalContained(component) ||
    role === "popup" ||
    role === "notice" ||
    /popup|pop|layer|notice|modal|dialog|sys_pop/i.test(selector);
}

function isModalContained(component: InteractiveComponentObservationItem): boolean {
  const role = component.container_role?.toLowerCase() ?? "";
  return role === "dialog" || role === "modal" || role.includes("dialog") || role.includes("modal") || role === "popup";
}

function isMarketingOnlyConsent(contextText: string): boolean {
  return plannerSemantics.marketingConsentContext.test(contextText) &&
    !/analytics|tracking|telemetry|usage|statistics|통계|사용 기록|서비스 개선|개인정보|privacy|cookie|쿠키/i.test(contextText);
}

function consentContextText(component: InteractiveComponentObservationItem): string {
  return [
    candidateText(component),
    component.container_role ?? "",
    component.container_heading ?? "",
    ...(component.nearby_text ?? [])
  ].join(" ");
}

function popupContextText(component: InteractiveComponentObservationItem): string {
  return [
    consentContextText(component),
    component.selector ?? ""
  ].join(" ");
}

function isDialogBackdropLike(
  component: InteractiveComponentObservationItem,
  viewport?: AgentDecisionInput["observation"]["snapshot"]["viewport"]
): boolean {
  if (!isModalContained(component)) {
    return false;
  }

  const viewportArea = Math.max(1, (viewport?.width ?? 0) * (viewport?.height ?? 0));
  const componentArea = component.bounds.width * component.bounds.height;
  const viewportCoverage = component.visibility?.viewport_coverage_ratio ??
    (viewportArea > 1 ? componentArea / viewportArea : 0);
  const text = candidateText(component);
  const selector = component.selector ?? "";

  return viewportCoverage >= 0.75 &&
    !component.visible_text &&
    (plannerSemantics.consentDeferOrReject.test(text) || /backdrop|overlay|inset-0|absolute|fixed/i.test(selector));
}
