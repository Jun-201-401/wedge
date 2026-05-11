import type { AgentTask, AgentTrace, ScenarioAction, ScenarioPlan, ScenarioStage, ScenarioStep, SettleStrategy } from "../shared/contracts.ts";

export interface AgentTraceReplayExportResult {
  plan: ScenarioPlan;
  skippedUnsafeActionCount: number;
}

interface TraceDecisionRecord {
  decision_id?: unknown;
  action?: unknown;
  reason?: unknown;
  confidence?: unknown;
  stage?: unknown;
}

interface TraceActionRecord {
  tool?: unknown;
  target_key?: unknown;
  target?: unknown;
  value?: unknown;
  options?: unknown;
}

export function exportAgentTraceToScenarioPlan(input: {
  task: AgentTask;
  trace: AgentTrace;
}): AgentTraceReplayExportResult | null {
  if (!input.trace.final_outcome.startsWith("SUCCESS_")) {
    return null;
  }

  const blockedDecisionIds = new Set(
    input.trace.policy_results
      .filter((result) => result.decision === "BLOCK")
      .map((result) => result.decision_id)
  );
  const completedDecisionIds = new Set(
    input.trace.events
      .filter((event) => event.event_type === "AGENT_ACTION_COMPLETED")
      .map((event) => typeof event.payload.decision_id === "string" ? event.payload.decision_id : null)
      .filter((decisionId): decisionId is string => decisionId !== null)
  );
  const completedActionKeys = new Set(
    input.trace.events
      .filter((event) => event.event_type === "AGENT_ACTION_COMPLETED")
      .map((event) => actionRecordKey(event.payload))
      .filter((actionKey): actionKey is string => actionKey !== null)
  );

  const steps: ScenarioStep[] = [];
  let skippedUnsafeActionCount = 0;

  for (const [index, decision] of input.trace.decisions.entries()) {
    const record = decision as TraceDecisionRecord;
    const decisionId = typeof record.decision_id === "string" ? record.decision_id : null;
    const actionKey = actionRecordKey(record.action);
    if (
      (decisionId !== null && blockedDecisionIds.has(decisionId))
      || (
        (decisionId === null || !completedDecisionIds.has(decisionId))
        && (actionKey === null || !completedActionKeys.has(actionKey))
      )
    ) {
      continue;
    }

    const action = toScenarioAction(record.action);
    if (!action) {
      continue;
    }
    if (isUnsafeReplayAction(action)) {
      skippedUnsafeActionCount += 1;
      continue;
    }

    steps.push({
      step_id: `agent_replay_${String(steps.length + 1).padStart(3, "0")}`,
      stage: isScenarioStage(record.stage) ? record.stage : "CTA",
      description: createReplayStepDescription(record, index),
      action,
      settle_strategy: settleStrategyForAction(action),
      checkpoint: true
    });
  }

  if (steps.length === 0) {
    return null;
  }

  return {
    plan: {
      schema_version: "0.5",
      plan_id: `agent-trace-replay-${input.trace.trace_id}`,
      scenario_type: "custom_compiled",
      goal: resolveTaskGoal(input.task),
      start_url: input.task.start_url,
      source_discovery_id: null,
      environment: input.task.environment,
      safety: {
        allow_external_navigation: input.task.allowed_navigation.allow_external_navigation,
        allow_payment_commit: false,
        allow_destructive_action: false,
        use_synthetic_inputs: true,
        stop_before_real_payment: true
      },
      steps
    },
    skippedUnsafeActionCount
  };
}

function toScenarioAction(value: unknown): ScenarioAction | null {
  if (!isRecord(value)) {
    return null;
  }

  const action = value as TraceActionRecord;
  if (!isScenarioActionType(action.tool)) {
    return null;
  }

  const scenarioAction: ScenarioAction = {
    type: action.tool
  };

  if (action.target !== undefined && action.target !== null) {
    scenarioAction.target = action.target as ScenarioAction["target"];
  } else if (typeof action.target_key === "string" && action.target_key.length > 0) {
    scenarioAction.target = {
      selector: action.target_key
    };
  }
  if (action.value !== undefined && action.value !== null) {
    scenarioAction.value = action.value;
  }
  if (isRecord(action.options) && Object.keys(action.options).length > 0) {
    scenarioAction.options = action.options;
  }

  return scenarioAction;
}

function isUnsafeReplayAction(action: ScenarioAction): boolean {
  if (action.type === "fill" || action.type === "select") {
    return containsUnsafeText(action);
  }
  if (action.type !== "click") {
    return false;
  }

  return containsUnsafeText(action);
}

function containsUnsafeText(action: ScenarioAction): boolean {
  const text = JSON.stringify(action).toLowerCase();
  return UNSAFE_REPLAY_KEYWORDS.some((keyword) => text.includes(keyword));
}

function settleStrategyForAction(action: ScenarioAction): SettleStrategy {
  switch (action.type) {
    case "goto":
      return {
        type: "network_idle",
        timeout_ms: 1_000
      };
    case "checkpoint":
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

function createReplayStepDescription(decision: TraceDecisionRecord, index: number): string {
  const reason = typeof decision.reason === "string" ? decision.reason : "agent trace decision";
  return `Replay AgentTrace decision ${index + 1}: ${reason}`;
}

function resolveTaskGoal(task: AgentTask): string {
  return task.goal ?? task.goal_type;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isScenarioActionType(value: unknown): value is ScenarioAction["type"] {
  return typeof value === "string" && SCENARIO_ACTION_TYPES.includes(value as ScenarioAction["type"]);
}

function isScenarioStage(value: unknown): value is ScenarioStage {
  return typeof value === "string" && SCENARIO_STAGES.includes(value as ScenarioStage);
}

function actionRecordKey(value: unknown): string | null {
  if (!isRecord(value)) {
    return null;
  }

  const action = value as TraceActionRecord;
  if (!isScenarioActionType(action.tool)) {
    return null;
  }

  return JSON.stringify({
    tool: action.tool,
    target_key: typeof action.target_key === "string" ? action.target_key : null,
    target: action.target ?? null
  });
}

const SCENARIO_ACTION_TYPES: ScenarioAction["type"][] = [
  "goto",
  "click",
  "fill",
  "select",
  "scroll",
  "hover",
  "wait_for",
  "checkpoint",
  "stop_when"
];

const SCENARIO_STAGES: ScenarioStage[] = ["FIRST_VIEW", "VALUE", "CTA", "INPUT", "COMMIT"];

const UNSAFE_REPLAY_KEYWORDS = [
  "pay now",
  "submit payment",
  "complete payment",
  "confirm payment",
  "final payment",
  "place order",
  "submit order",
  "complete order",
  "confirm order",
  "delete account",
  "remove account",
  "결제 완료",
  "최종 결제",
  "결제 확정",
  "주문 완료",
  "주문 확정",
  "구매 확정",
  "회원 탈퇴",
  "계정 삭제"
];
