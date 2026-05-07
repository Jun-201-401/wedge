import { randomUUID } from "node:crypto";
import type { AgentTask, ArtifactDraft, ScenarioAction, ScenarioPlan, ScenarioStep, SettleStrategy } from "../shared/contracts.ts";
import { toIsoTimestamp } from "../shared/utils.ts";
import { createAgentRuntimePlan } from "./runtime-plan.ts";
import type { AgentTrace, AgentTurnTrace } from "./trace.ts";

export interface AgentTraceScenarioPlanExport {
  schema_version: "0.1";
  export_id: string;
  task_id: string;
  attempt_id: string;
  run_id: string;
  exported_at: string;
  status: "EXPORTED" | "NOT_EXPORTABLE";
  reason: string;
  scenario_plan?: ScenarioPlan;
  skipped_turns: AgentTraceScenarioPlanSkippedTurn[];
}

export interface AgentTraceScenarioPlanSkippedTurn {
  turn: number;
  reason: string;
}

const REPLAYABLE_ACTION_TYPES = new Set<ScenarioAction["type"]>([
  "goto",
  "click",
  "scroll",
  "checkpoint"
]);

export function exportAgentTraceToScenarioPlan(input: {
  task: AgentTask;
  trace: AgentTrace;
  exportedAt?: string;
}): AgentTraceScenarioPlanExport {
  const exportedAt = input.exportedAt ?? toIsoTimestamp();
  const base = createExportBase(input.task, input.trace, exportedAt);

  if (input.trace.outcome.status !== "SUCCESS") {
    return {
      ...base,
      status: "NOT_EXPORTABLE",
      reason: `Only successful AgentTrace can be exported; received ${input.trace.outcome.status}.`,
      skipped_turns: input.trace.turns.map((turn) => ({
        turn: turn.turn,
        reason: "trace outcome is not SUCCESS"
      }))
    };
  }

  const skippedTurns: AgentTraceScenarioPlanSkippedTurn[] = [];
  const replaySteps = input.trace.turns.flatMap((turn) => {
    const step = turnToScenarioStep(turn, skippedTurns);
    return step ? [step] : [];
  });

  if (replaySteps.length === 0) {
    return {
      ...base,
      status: "NOT_EXPORTABLE",
      reason: "Successful AgentTrace did not contain completed replayable actions.",
      skipped_turns: skippedTurns
    };
  }

  const finalUrl = findFinalUrl(input.trace) ?? input.task.start_url;
  const scenarioPlan: ScenarioPlan = {
    ...createAgentRuntimePlan(input.task),
    plan_id: `agent-export-${input.task.task_id}`,
    scenario_type: "custom_compiled",
    goal: input.task.goal ?? input.task.goal_type,
    start_url: input.task.start_url,
    steps: [
      ...replaySteps,
      createFinalCheckpointStep(replaySteps.length + 1),
      createFinalStopStep(replaySteps.length + 2, finalUrl)
    ]
  };

  return {
    ...base,
    status: "EXPORTED",
    reason: "Successful AgentTrace was converted to a replayable ScenarioPlan candidate.",
    scenario_plan: scenarioPlan,
    skipped_turns: skippedTurns
  };
}

export function createAgentScenarioPlanExportArtifact(traceExport: AgentTraceScenarioPlanExport): ArtifactDraft {
  return {
    artifactId: randomUUID(),
    artifactType: "OTHER",
    stepKey: "agent_scenario_plan_export",
    mimeType: "application/json",
    fileExtension: "json",
    content: JSON.stringify(traceExport, null, 2)
  };
}

function createExportBase(task: AgentTask, trace: AgentTrace, exportedAt: string): Omit<AgentTraceScenarioPlanExport, "status" | "reason" | "scenario_plan" | "skipped_turns"> {
  return {
    schema_version: "0.1",
    export_id: `agent-trace-scenario-plan-${trace.attempt_id}`,
    task_id: task.task_id,
    attempt_id: task.attempt_id,
    run_id: task.run_id,
    exported_at: exportedAt
  };
}

function turnToScenarioStep(
  turn: AgentTurnTrace,
  skippedTurns: AgentTraceScenarioPlanSkippedTurn[]
): ScenarioStep | null {
  if (!turn.decision) {
    skippedTurns.push({
      turn: turn.turn,
      reason: "turn has no decision"
    });
    return null;
  }

  if (turn.decision.kind !== "act") {
    skippedTurns.push({
      turn: turn.turn,
      reason: `decision kind is ${turn.decision.kind}`
    });
    return null;
  }

  if (!turn.policy?.allowed) {
    skippedTurns.push({
      turn: turn.turn,
      reason: "policy did not allow the decision"
    });
    return null;
  }

  if (!turn.actionResult?.completed) {
    skippedTurns.push({
      turn: turn.turn,
      reason: "action did not complete"
    });
    return null;
  }

  if (!REPLAYABLE_ACTION_TYPES.has(turn.decision.action.type)) {
    skippedTurns.push({
      turn: turn.turn,
      reason: `action type ${turn.decision.action.type} is not replayable from AgentTrace export`
    });
    return null;
  }

  return {
    step_id: `agent_export_turn_${String(turn.turn).padStart(3, "0")}`,
    stage: turn.decision.stage,
    description: turn.decision.description,
    action: cloneAction(turn.decision.action),
    settle_strategy: cloneSettleStrategy(turn.decision.settleStrategy),
    checkpoint: turn.decision.action.type === "checkpoint" || turn.postActionVerification?.satisfied === true
  };
}

function createFinalCheckpointStep(order: number): ScenarioStep {
  return {
    step_id: `agent_export_${String(order).padStart(3, "0")}_final_checkpoint`,
    stage: "COMMIT",
    description: "Agent-exported final checkpoint before payment, final order, or other terminal commit boundary.",
    action: {
      type: "checkpoint"
    },
    settle_strategy: {
      type: "none",
      timeout_ms: 0
    },
    checkpoint: true
  };
}

function createFinalStopStep(order: number, finalUrl: string): ScenarioStep {
  return {
    step_id: `agent_export_${String(order).padStart(3, "0")}_stop_before_commit`,
    stage: "COMMIT",
    description: "Stop before payment submit, final order commit, or any destructive terminal action.",
    action: {
      type: "stop_when"
    },
    settle_strategy: {
      type: "none",
      timeout_ms: 0
    },
    checkpoint: false,
    stop_condition: {
      url_includes: finalUrl
    }
  };
}

function findFinalUrl(trace: AgentTrace): string | null {
  for (let index = trace.turns.length - 1; index >= 0; index -= 1) {
    const turn = trace.turns[index];
    if (turn?.actionResult?.finalUrl) {
      return turn.actionResult.finalUrl;
    }
    if (turn?.observation.finalUrl) {
      return turn.observation.finalUrl;
    }
  }

  return null;
}

function cloneAction(action: ScenarioAction): ScenarioAction {
  return JSON.parse(JSON.stringify(action)) as ScenarioAction;
}

function cloneSettleStrategy(settleStrategy: SettleStrategy): SettleStrategy {
  return JSON.parse(JSON.stringify(settleStrategy)) as SettleStrategy;
}
