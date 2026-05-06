import type { RunExecuteMessage, ScenarioPlan } from "../shared/contracts.ts";

const DEFAULT_VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 1024, height: 768 },
  mobile: { width: 390, height: 844 }
} as const;

export function createAgentRuntimePlan(payload: RunExecuteMessage["payload"]): ScenarioPlan {
  const viewport = DEFAULT_VIEWPORTS[payload.devicePreset];

  return {
    schema_version: "0.5",
    plan_id: `agent-runtime-${payload.runId}`,
    scenario_type: "custom_compiled",
    goal: payload.goal,
    start_url: payload.startUrl,
    source_discovery_id: null,
    environment: {
      device: payload.devicePreset,
      viewport: {
        width: viewport.width,
        height: viewport.height
      },
      locale: "ko-KR",
      timezone: "Asia/Seoul",
      auth_state: "anonymous"
    },
    safety: {
      allow_external_navigation: false,
      allow_payment_commit: false,
      allow_destructive_action: false,
      use_synthetic_inputs: true,
      stop_before_real_payment: true
    },
    steps: [
      {
        step_id: "agent_bootstrap_goto",
        stage: "FIRST_VIEW",
        description: "Agent runtime bootstrap step for browser session setup",
        action: {
          type: "goto",
          target: {
            url: payload.startUrl
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
