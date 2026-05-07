import type { AgentTask, ScenarioPlan } from "../shared/contracts.ts";

const DEFAULT_VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 1024, height: 768 },
  mobile: { width: 390, height: 844 }
} as const;

export function createAgentRuntimePlan(task: AgentTask): ScenarioPlan {
  const fallbackViewport = DEFAULT_VIEWPORTS[task.environment.device];
  const viewport = task.environment.viewport ?? fallbackViewport;

  return {
    schema_version: "0.5",
    plan_id: `agent-runtime-${task.task_id}`,
    scenario_type: "custom_compiled",
    goal: resolveTaskGoal(task),
    start_url: task.start_url,
    source_discovery_id: null,
    environment: {
      ...task.environment,
      viewport: {
        width: viewport.width,
        height: viewport.height
      }
    },
    safety: {
      allow_external_navigation: task.allowed_navigation.allow_external_navigation,
      allowed_external_origins: [
        ...task.allowed_navigation.allowed_origins ?? [],
        ...task.allowed_navigation.allowed_checkout_redirect_origins ?? []
      ],
      allow_payment_commit: task.risk_policy.allow_final_payment_submit || task.risk_policy.allow_final_order_commit,
      allow_destructive_action: task.risk_policy.allow_destructive_action,
      use_synthetic_inputs: true,
      stop_before_real_payment: !task.risk_policy.allow_final_payment_submit
    },
    steps: [
      {
        step_id: "agent_bootstrap_goto",
        stage: "FIRST_VIEW",
        description: "Agent runtime bootstrap step for browser session setup",
        action: {
          type: "goto",
          target: {
            url: task.start_url
          }
        },
        settle_strategy: {
          type: "fixed_short",
          timeout_ms: 1
        },
        checkpoint: false
      }
    ]
  };
}

function resolveTaskGoal(task: AgentTask): string {
  return task.goal ?? task.goal_type;
}
