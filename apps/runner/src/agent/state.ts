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
  turns: AgentTurnRecord[];
  replayHintsDisabled: boolean;
}

export function createInitialAgentState(): AgentExecutionState {
  return {
    started: false,
    scrollCount: 0,
    clickedTargetKeys: new Set(),
    turns: [],
    replayHintsDisabled: false
  };
}
