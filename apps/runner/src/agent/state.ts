import type { ScenarioAction } from "../shared/contracts.ts";

export interface AgentTurnRecord {
  turn: number;
  actionType: ScenarioAction["type"];
  targetKey: string | null;
  finalUrl: string;
  goalSatisfied: boolean;
}

export interface AgentExecutionState {
  started: boolean;
  scrollCount: number;
  clickedTargetKeys: Set<string>;
  targetGuidanceSatisfied: boolean;
  replayHintsDisabled: boolean;
  turns: AgentTurnRecord[];
}

export function createInitialAgentState(): AgentExecutionState {
  return {
    started: false,
    scrollCount: 0,
    clickedTargetKeys: new Set(),
    targetGuidanceSatisfied: false,
    replayHintsDisabled: false,
    turns: []
  };
}
