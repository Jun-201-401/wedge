import type { AgentObservation } from "./observation.ts";
import type { AgentExecutionState } from "./state.ts";
import type {
  InteractiveComponentObservationItem,
  ScenarioAction,
  ScenarioStage,
  SettleStrategy
} from "../shared/contracts.ts";
import { candidateText, targetFromComponent, targetKey } from "./component-target.ts";
import { ADD_TO_CART_PATTERN, CART_NAVIGATION_PATTERN, CHECKOUT_GOAL_PATTERN, CHECKOUT_NAVIGATION_PATTERN, COOKIE_ACCEPT_PATTERN, COOKIE_CONTEXT_PATTERN } from "./semantics.ts";

export type AgentDecisionKind = "act" | "checkpoint" | "finish";

export interface AgentDecision {
  kind: AgentDecisionKind;
  description: string;
  reason: string;
  confidence: number;
  action: ScenarioAction;
  settleStrategy: SettleStrategy;
  stage: ScenarioStage;
  targetKey: string | null;
}

export interface AgentDecisionInput {
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


function selectActionCandidate(input: AgentDecisionInput): ActionCandidate | undefined {
  const untriedComponents = input.observation.snapshot.interactiveComponents.filter((component) =>
    component.clickable && !input.state.clickedTargetKeys.has(targetKey(component))
  );

  const cookieAction = selectCookieAction(untriedComponents);
  if (cookieAction) {
    return cookieAction;
  }

  if (CHECKOUT_GOAL_PATTERN.test(input.goal)) {
    const checkoutAction = selectCheckoutAction(untriedComponents);
    if (checkoutAction) {
      return checkoutAction;
    }
  }

  return selectPrimaryAction(untriedComponents);
}

function selectCookieAction(components: InteractiveComponentObservationItem[]): ActionCandidate | undefined {
  const component = components.find((candidate) => {
    const text = candidateText(candidate);
    return COOKIE_ACCEPT_PATTERN.test(text) && COOKIE_CONTEXT_PATTERN.test(text);
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
  const rankedRules: Array<{
    pattern: RegExp;
    reason: string;
    confidence: number;
    stage: ScenarioStage;
  }> = [
    {
      pattern: ADD_TO_CART_PATTERN,
      reason: "Checkout verification should add an obvious product to the cart before looking for checkout.",
      confidence: 0.82,
      stage: "CTA"
    },
    {
      pattern: CART_NAVIGATION_PATTERN,
      reason: "Checkout verification should inspect the cart after a cart-related entrypoint appears.",
      confidence: 0.78,
      stage: "CTA"
    },
    {
      pattern: CHECKOUT_NAVIGATION_PATTERN,
      reason: "Checkout verification found a checkout or payment-entry navigation candidate.",
      confidence: 0.84,
      stage: "COMMIT"
    }
  ];

  for (const rule of rankedRules) {
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

function selectPrimaryAction(components: InteractiveComponentObservationItem[]): ActionCandidate | undefined {
  const component = components.find((candidate) =>
    candidate.is_primary_like || candidate.is_cta_candidate
  ) ?? components[0];

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
    targetKey: targetKey(candidate.component)
  };
}
