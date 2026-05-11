import type { AgentReplayHintStep, AgentReplayHints, ScenarioAction, ScenarioStage, SettleStrategy } from "../shared/contracts.ts";
import { decideNextAction, type AgentDecision, type AgentDecisionInput } from "./planner.ts";

export interface AgentPlanner {
  decideNextAction: (input: AgentDecisionInputWithReplayHints) => AgentDecision;
}

interface AgentDecisionInputWithReplayHints extends AgentDecisionInput {
  replayHints?: AgentReplayHints | null;
}

export function createReplayHintPlanner(fallbackPlanner: AgentPlanner = { decideNextAction }): AgentPlanner {
  return {
    decideNextAction(input) {
      const replayDecision = decideFromReplayHints(input);
      return replayDecision ?? fallbackPlanner.decideNextAction(input);
    }
  };
}

export const replayHintAgentPlanner = createReplayHintPlanner();

function decideFromReplayHints(input: AgentDecisionInputWithReplayHints): AgentDecision | null {
  const replayHints = input.replayHints;
  if ((input.state as { replayHintsDisabled?: boolean }).replayHintsDisabled || !replayHints || replayHints.steps.length === 0) {
    return null;
  }

  const step = replayHints.steps[resolveReplayStepIndex(input, replayHints)];
  if (!step) {
    return null;
  }

  if (!input.state.started && step.action.type !== "goto") {
    return null;
  }

  const targetKey = replayTargetKey(step);
  if (step.action.type === "click" && targetKey && input.state.clickedTargetKeys.has(targetKey)) {
    return null;
  }

  if (step.action.type === "checkpoint" || step.action.type === "stop_when") {
    return null;
  }

  return {
    kind: "act",
    description: step.description ?? replayDescription(step),
    reason: replayReason(replayHints, step),
    confidence: clampConfidence(step.confidence ?? 0.76),
    action: step.action,
    settleStrategy: step.settle_strategy ?? defaultSettleStrategy(step.action),
    stage: step.stage ?? defaultStage(step.action),
    targetKey
  };
}

function resolveReplayStepIndex(input: AgentDecisionInputWithReplayHints, replayHints: AgentReplayHints): number {
  const firstHint = replayHints.steps[0];
  if (input.state.started && firstHint?.action.type !== "goto") {
    return Math.max(0, input.state.turns.length - 1);
  }

  return input.state.turns.length;
}

function replayDescription(step: AgentReplayHintStep): string {
  return `Replay hinted ${step.action.type} action before heuristic exploration.`;
}

function replayReason(replayHints: AgentReplayHints, step: AgentReplayHintStep): string {
  const source = replayHints.source_plan_id ?? replayHints.source_trace_id ?? "prior successful agent path";
  return step.description
    ? `Replay hint from ${source}: ${step.description}`
    : `Replay hint from ${source} is tried before heuristic exploration.`;
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) {
    return 0.76;
  }
  return Math.max(0, Math.min(1, value));
}

function replayTargetKey(step: AgentReplayHintStep): string | null {
  if (step.target_key !== undefined) {
    return step.target_key;
  }

  const target = step.action.target;
  if (typeof target === "string") {
    return target;
  }
  if (!target || typeof target !== "object" || Array.isArray(target)) {
    if (step.action.type === "scroll") {
      return `scroll:${String(step.action.value ?? "")}`;
    }
    return null;
  }

  if (typeof target.selector === "string") {
    return target.selector;
  }
  if (typeof target.url === "string") {
    return target.url;
  }
  if (typeof target.href_contains === "string") {
    return `href:${target.href_contains}`;
  }
  if (typeof target.text === "string") {
    return `text:${target.text}`;
  }
  if (typeof target.role === "string") {
    return `role:${target.role}`;
  }

  return null;
}

function defaultSettleStrategy(action: ScenarioAction): SettleStrategy {
  switch (action.type) {
    case "goto":
      return {
        type: "network_idle",
        timeout_ms: 1_000
      };
    case "checkpoint":
    case "stop_when":
      return {
        type: "none",
        timeout_ms: 0
      };
    case "scroll":
      return {
        type: "fixed_short",
        timeout_ms: 250
      };
    default:
      return {
        type: "fixed_short",
        timeout_ms: 500
      };
  }
}

function defaultStage(action: ScenarioAction): ScenarioStage {
  switch (action.type) {
    case "goto":
      return "FIRST_VIEW";
    case "fill":
    case "select":
      return "INPUT";
    case "scroll":
      return "VALUE";
    case "checkpoint":
    case "stop_when":
      return "COMMIT";
    default:
      return "CTA";
  }
}
