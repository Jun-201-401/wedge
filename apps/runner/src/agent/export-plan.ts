import type { AgentTask, AgentTrace, ScenarioAction, ScenarioPlan, ScenarioStage, ScenarioStep, SettleStrategy } from "../shared/contracts.ts";

export interface AgentTraceReplayExportResult {
  plan: ScenarioPlan;
  skippedUnsafeActionCount: number;
}

interface TraceTurnRecord {
  turn?: unknown;
  decision?: unknown;
  policy?: unknown;
  actionResult?: unknown;
  postActionVerification?: unknown;
}

interface TraceDecisionRecord {
  action?: unknown;
  reason?: unknown;
  description?: unknown;
  stage?: unknown;
  settleStrategy?: unknown;
}

interface TracePolicyRecord {
  allowed?: unknown;
}

interface TraceActionResultRecord {
  completed?: unknown;
}

interface TraceActionRecord {
  type?: unknown;
  tool?: unknown;
  targetKey?: unknown;
  target_key?: unknown;
  target?: unknown;
  value?: unknown;
  options?: unknown;
}

export function exportAgentTraceToScenarioPlan(input: {
  task: AgentTask;
  trace: AgentTrace;
}): AgentTraceReplayExportResult | null {
  if (input.trace.outcome.status !== "SUCCESS") {
    return null;
  }

  const steps: ScenarioStep[] = [];
  let skippedUnsafeActionCount = 0;

  for (const turn of input.trace.turns as TraceTurnRecord[]) {
    const decision = isRecord(turn.decision) ? turn.decision as TraceDecisionRecord : null;
    if (!decision) {
      continue;
    }

    const policy = isRecord(turn.policy) ? turn.policy as TracePolicyRecord : null;
    if (policy?.allowed !== true) {
      continue;
    }

    const actionResult = isRecord(turn.actionResult) ? turn.actionResult as TraceActionResultRecord : null;
    if (actionResult?.completed !== true) {
      continue;
    }

    const action = toScenarioAction(decision.action);
    if (!action) {
      continue;
    }
    if (isUnsafeReplayAction(action)) {
      skippedUnsafeActionCount += 1;
      continue;
    }

    steps.push({
      step_id: `agent_replay_${String(steps.length + 1).padStart(3, "0")}`,
      stage: isScenarioStage(decision.stage) ? decision.stage : "CTA",
      description: createReplayStepDescription(decision, steps.length),
      action,
      settle_strategy: isSettleStrategy(decision.settleStrategy) ? cloneSettleStrategy(decision.settleStrategy) : settleStrategyForAction(action),
      checkpoint: true
    });
  }

  if (steps.length === 0) {
    return null;
  }

  return {
    plan: {
      schema_version: "0.5",
      plan_id: `agent-trace-replay-${input.trace.attempt_id}`,
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
  const actionType = action.type ?? action.tool;
  if (!isScenarioActionType(actionType)) {
    return null;
  }

  const scenarioAction: ScenarioAction = {
    type: actionType
  };

  if (action.target !== undefined && action.target !== null) {
    scenarioAction.target = cloneJson(action.target) as ScenarioAction["target"];
  } else {
    const targetKey = typeof action.targetKey === "string" ? action.targetKey : action.target_key;
    if (typeof targetKey === "string" && targetKey.length > 0) {
      scenarioAction.target = {
        selector: targetKey
      };
    }
  }
  if (action.value !== undefined && action.value !== null) {
    scenarioAction.value = cloneJson(action.value);
  }
  if (isRecord(action.options) && Object.keys(action.options).length > 0) {
    scenarioAction.options = cloneJson(action.options) as ScenarioAction["options"];
  }

  return scenarioAction;
}

function isUnsafeReplayAction(action: ScenarioAction): boolean {
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
  const description = typeof decision.description === "string" ? decision.description : null;
  const reason = typeof decision.reason === "string" ? decision.reason : "agent trace decision";
  return description ?? `Replay AgentTrace decision ${index + 1}: ${reason}`;
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

function isSettleStrategy(value: unknown): value is SettleStrategy {
  return isRecord(value) && typeof value.type === "string" && typeof value.timeout_ms === "number";
}

function cloneSettleStrategy(settleStrategy: SettleStrategy): SettleStrategy {
  return cloneJson(settleStrategy) as SettleStrategy;
}

function cloneJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
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
  "결제 완료",
  "결제하기",
  "주문 완료",
  "place order",
  "delete account"
];
