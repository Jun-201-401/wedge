import type { AgentObservation } from "./observation.ts";
import type { AgentExecutionState } from "./state.ts";
import type {
  InteractiveComponentObservationItem,
  ScenarioAction,
  ScenarioStage,
  SettleStrategy,
  TargetDescriptorMap
} from "../shared/contracts.ts";

export type AgentDecisionKind = "act" | "finish";

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
}

export interface AgentPlanner {
  decideNextAction: (input: AgentDecisionInput) => AgentDecision;
}

export const ruleBasedAgentPlanner: AgentPlanner = {
  decideNextAction
};

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

  const component = selectPrimaryCandidate(input.observation.snapshot.interactiveComponents, input.state.clickedTargetKeys);
  if (component) {
    return {
      kind: "act",
      description: `Click likely UX entrypoint: ${component.text || component.selector || component.role || component.tag}`,
      reason: component.is_primary_like
        ? "The component is the primary-like CTA candidate in the current viewport."
        : "The component matches CTA-like copy or interaction semantics.",
      confidence: component.is_primary_like ? 0.82 : 0.68,
      action: {
        type: "click",
        target: targetFromComponent(component)
      },
      settleStrategy: {
        type: "fixed_short",
        timeout_ms: 500
      },
      stage: "CTA",
      targetKey: targetKey(component)
    };
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

function selectPrimaryCandidate(
  components: InteractiveComponentObservationItem[],
  clickedTargetKeys: Set<string>
): InteractiveComponentObservationItem | undefined {
  return components.find((component) =>
    (component.is_primary_like || component.is_cta_candidate) && !clickedTargetKeys.has(targetKey(component))
  ) ?? components.find((component) => component.clickable && !clickedTargetKeys.has(targetKey(component)));
}

function targetFromComponent(component: InteractiveComponentObservationItem): TargetDescriptorMap {
  const target: TargetDescriptorMap = {};

  if (component.selector) {
    target.selector = component.selector;
  }

  if (component.role) {
    target.role = component.role;
  }

  if (component.text) {
    target.text = component.text;
  }

  return target;
}

export function targetKey(component: InteractiveComponentObservationItem): string {
  return component.selector ?? `${component.role ?? component.tag}:${component.text}`;
}
