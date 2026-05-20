import { randomUUID } from "node:crypto";
import type { AgentObservation } from "./observation.ts";
import type { AgentExecutionState } from "./state.ts";
import type {
  AgentTargetGuidance,
  InteractiveComponentObservationItem,
  ScenarioAction,
  ScenarioStage,
  SettleStrategy,
  TargetDescriptorMap
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
  targetGuidance?: AgentTargetGuidance;
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

  const directTargetUrlDecision = selectTargetGuidanceDirectUrlDecision(input);
  if (directTargetUrlDecision) {
    return directTargetUrlDecision;
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
    pattern: plannerSemantics.checkoutNavigation,
    reason: "Checkout verification found a checkout or payment-entry navigation candidate.",
    confidence: 0.84,
    stage: "COMMIT"
  },
  {
    pattern: plannerSemantics.productBrowse,
    reason: "Checkout verification should enter a product list or product detail before using cart-only navigation.",
    confidence: 0.8,
    stage: "CTA"
  },
  {
    pattern: plannerSemantics.cartNavigation,
    reason: "Checkout verification should inspect the cart only when no product browsing entrypoint is available.",
    confidence: 0.62,
    stage: "CTA"
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

  const guidedAction = selectTargetGuidanceAction(input);
  if (guidedAction) {
    return guidedAction;
  }

  if (requiresPendingPreferredTarget(input)) {
    return undefined;
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

export function applyTargetGuidanceToDecision(decision: AgentDecision, input: AgentDecisionInput): AgentDecision {
  if (!requiresPendingPreferredTarget(input) || !input.state.started) {
    return decision;
  }

  const preferredTarget = input.targetGuidance?.preferred_target;
  if (!preferredTarget || decision.action.type === "scroll") {
    return decision;
  }

  if (decision.action.type === "goto" && targetDescriptorMatches(preferredTarget, decision.action.target)) {
    return decision;
  }

  if (decision.action.type !== "click") {
    return input.state.scrollCount < input.maxScrolls
      ? scrollForGuidedTarget(decision)
      : finishMissingGuidedTarget(decision);
  }

  const selectedComponent = decision.targetKey
    ? input.observation.snapshot.interactiveComponents.find((component) => targetKey(component) === decision.targetKey)
    : undefined;
  if (selectedComponent && isPageChromeAction(selectedComponent)) {
    return decision;
  }

  if (targetDescriptorMatches(preferredTarget, decision.action.target)) {
    return decision;
  }

  const guidedAction = selectTargetGuidanceAction(input);
  if (guidedAction) {
    const guidedDecision = componentToDecision(guidedAction);
    return {
      ...guidedDecision,
      reason: `${guidedDecision.reason} The previous decision did not match the recommendation card target, so target guidance overrode it.`,
      confidence: Math.max(guidedDecision.confidence, Math.min(decision.confidence, 0.86))
    };
  }

  const directTargetUrlDecision = selectTargetGuidanceDirectUrlDecision(input);
  if (directTargetUrlDecision) {
    return directTargetUrlDecision;
  }

  if (input.state.scrollCount < input.maxScrolls) {
    return scrollForGuidedTarget(decision);
  }

  return finishMissingGuidedTarget(decision);
}

function scrollForGuidedTarget(decision: AgentDecision): AgentDecision {
  return {
    kind: "act",
    description: "Scroll to find the recommendation card target.",
    reason: "The recommendation card selected a specific entrypoint, and no visible candidate matches it yet.",
    confidence: 0.6,
    action: {
      type: "scroll",
      value: 700
    },
    settleStrategy: {
      type: "fixed_short",
      timeout_ms: 250
    },
    stage: "VALUE",
    targetKey: "scroll:700",
    metadata: decision.metadata
  };
}

function finishMissingGuidedTarget(decision: AgentDecision): AgentDecision {
  return {
    kind: "finish",
    description: "Stop because the recommendation card target was not found.",
    reason: "The recommendation card selected a specific entrypoint, but the agent could not find a matching visible target and will not click an unrelated CTA.",
    confidence: 0.72,
    action: {
      type: "checkpoint"
    },
    settleStrategy: {
      type: "none",
      timeout_ms: 0
    },
    stage: "CTA",
    targetKey: null,
    metadata: decision.metadata
  };
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
    const component = components.find((candidate) => {
      const text = candidateText(candidate);
      return rule.pattern.test(text) && !plannerSemantics.checkoutNonEntrypoint.test(text);
    });
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

function selectTargetGuidanceAction(input: AgentDecisionInput): ActionCandidate | undefined {
  if (!requiresPendingPreferredTarget(input)) {
    return undefined;
  }

  const preferredTarget = input.targetGuidance?.preferred_target;
  if (!preferredTarget) {
    return undefined;
  }

  const component = input.observation.snapshot.interactiveComponents
    .filter((candidate) =>
      candidate.clickable &&
      !candidate.shadow_root &&
      !input.state.clickedTargetKeys.has(targetKey(candidate)) &&
      targetMatchesComponent(preferredTarget, candidate)
    )
    .sort((left, right) => targetMatchPriority(preferredTarget, right) - targetMatchPriority(preferredTarget, left))[0];

  return component
    ? {
        component,
        reason: "The recommendation card exposed this entrypoint, so the agent follows that target instead of choosing a different CTA.",
        confidence: 0.9,
        stage: "CTA"
      }
    : undefined;
}

function requiresPendingPreferredTarget(input: AgentDecisionInput): boolean {
  return input.targetGuidance?.mode === "PREFER_THEN_FAIL" &&
    Boolean(input.targetGuidance.preferred_target) &&
    !input.state.targetGuidanceSatisfied &&
    !currentUrlSatisfiesTargetGuidance(input);
}

export function decisionSatisfiesTargetGuidance(
  decision: AgentDecision,
  targetGuidance?: AgentTargetGuidance
): boolean {
  const preferredTarget = targetGuidance?.preferred_target;
  if (!preferredTarget || (decision.action.type !== "click" && decision.action.type !== "goto")) {
    return false;
  }

  return targetDescriptorMatches(preferredTarget, decision.action.target);
}

function targetMatchesComponent(target: TargetDescriptorMap, component: InteractiveComponentObservationItem): boolean {
  const componentValues = componentSearchValues(component);
  if (typeof target.selector === "string" && target.selector && component.selector === target.selector) {
    return true;
  }
  if (typeof target.href_contains === "string" && target.href_contains && typeof component.href === "string" && component.href.includes(target.href_contains)) {
    return true;
  }
  if (typeof target.url === "string" && target.url && typeof component.href === "string" && component.href === target.url) {
    return true;
  }

  return stringTargetValues(target).some((value) =>
    componentValues.some((componentValue) => componentValue.includes(value))
  );
}

function selectTargetGuidanceDirectUrlDecision(input: AgentDecisionInput): AgentDecision | undefined {
  if (!requiresPendingPreferredTarget(input)) {
    return undefined;
  }

  const url = resolvePreferredTargetUrl(input);
  if (!url) {
    return undefined;
  }

  return {
    kind: "act",
    description: "Open the recommendation card URL entrypoint.",
    reason: "The recommendation card provided a URL entrypoint, so the agent navigates there instead of choosing another CTA.",
    confidence: 0.88,
    action: {
      type: "goto",
      target: {
        url
      }
    },
    settleStrategy: {
      type: "network_idle",
      timeout_ms: 1_000
    },
    stage: "CTA",
    targetKey: `target:url:${url}`
  };
}

function currentUrlSatisfiesTargetGuidance(input: AgentDecisionInput): boolean {
  const preferredTarget = input.targetGuidance?.preferred_target;
  if (!preferredTarget) {
    return false;
  }

  return targetDescriptorMatches(preferredTarget, {
    url: input.observation.snapshot.finalUrl
  });
}

function resolvePreferredTargetUrl(input: AgentDecisionInput): string | null {
  const preferredTarget = input.targetGuidance?.preferred_target;
  const rawUrl = typeof preferredTarget?.url === "string" && preferredTarget.url.trim()
    ? preferredTarget.url.trim()
    : typeof preferredTarget?.href_contains === "string" && isUrlLikeHref(preferredTarget.href_contains)
      ? preferredTarget.href_contains.trim()
      : "";
  if (!rawUrl) {
    return null;
  }

  let targetUrl: URL;
  try {
    targetUrl = new URL(rawUrl, input.startUrl);
  } catch {
    return null;
  }

  if (targetUrl.protocol !== "http:" && targetUrl.protocol !== "https:") {
    return null;
  }

  try {
    if (new URL(input.observation.snapshot.finalUrl).href === targetUrl.href) {
      return null;
    }
  } catch {
    // If the current URL is not parseable, let navigation policy handle the target URL decision.
  }

  return targetUrl.href;
}

function isUrlLikeHref(value: string): boolean {
  return /^(https?:\/\/|\/)/i.test(value.trim());
}

function targetDescriptorMatches(preferredTarget: TargetDescriptorMap, actualTarget: unknown): boolean {
  if (!actualTarget || typeof actualTarget !== "object") {
    return false;
  }
  const actual = actualTarget as TargetDescriptorMap;
  if (typeof preferredTarget.selector === "string" && preferredTarget.selector && actual.selector === preferredTarget.selector) {
    return true;
  }
  if (typeof preferredTarget.url === "string" && preferredTarget.url && typeof actual.url === "string" && actual.url === preferredTarget.url) {
    return true;
  }
  if (typeof preferredTarget.href_contains === "string" && preferredTarget.href_contains) {
    const actualUrl = typeof actual.url === "string" ? actual.url : "";
    const actualHref = typeof actual.href === "string" ? actual.href : "";
    if (actualUrl.includes(preferredTarget.href_contains) || actualHref.includes(preferredTarget.href_contains)) {
      return true;
    }
  }
  return stringTargetValues(preferredTarget).some((value) =>
    stringTargetValues(actual).some((actualValue) => actualValue.includes(value))
  );
}

function targetMatchPriority(target: TargetDescriptorMap, component: InteractiveComponentObservationItem): number {
  return (typeof target.selector === "string" && component.selector === target.selector ? 80 : 0) +
    (typeof target.href_contains === "string" && typeof component.href === "string" && component.href.includes(target.href_contains) ? 60 : 0) +
    (typeof target.text === "string" && normalizeTargetText(component.text).includes(normalizeTargetText(target.text)) ? 50 : 0) +
    entrypointPriority(component);
}

function stringTargetValues(target: TargetDescriptorMap): string[] {
  const directKeys = ["text", "label", "placeholder", "name"];
  const arrayKeys = ["text_any", "label_any", "placeholder_any", "name_any"];
  return [
    ...directKeys.flatMap((key) => typeof target[key] === "string" ? [target[key] as string] : []),
    ...arrayKeys.flatMap((key) => Array.isArray(target[key]) ? (target[key] as unknown[]).filter((value): value is string => typeof value === "string") : [])
  ]
    .map(normalizeTargetText)
    .filter((value) => value.length > 0);
}

function componentSearchValues(component: InteractiveComponentObservationItem): string[] {
  return [
    component.text,
    component.visible_text,
    component.accessible_name,
    component.label_text,
    component.placeholder,
    component.name,
    component.href,
    component.selector,
    component.role,
    component.tag,
    ...(component.nearby_text ?? [])
  ]
    .filter((value): value is string => typeof value === "string")
    .map(normalizeTargetText)
    .filter((value) => value.length > 0);
}

function normalizeTargetText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function isPageChromeAction(component: InteractiveComponentObservationItem): boolean {
  const text = candidateText(component);
  return (plannerSemantics.cookieAccept.test(text) && plannerSemantics.cookieContext.test(text)) ||
    (plannerSemantics.consentAccept.test(text) && plannerSemantics.consentContext.test(text)) ||
    (plannerSemantics.popupDismiss.test(text) && plannerSemantics.popupContext.test(text));
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
