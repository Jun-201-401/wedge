interface PrototypeScenarioRecommendation {
  id: string;
  title: string;
  summary: string;
  evidence: string;
}

interface PrototypeScenarioDepthOption {
  id: string;
  title: string;
  detail: string;
}

interface BuildPrototypeScenarioPlanInput {
  submittedUrl: string;
  selectedScenario: PrototypeScenarioRecommendation;
  selectedDepth: PrototypeScenarioDepthOption;
}

function toStepIdFragment(value: string) {
  return value.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'scenario';
}

export function buildPrototypeScenarioPlan({
  submittedUrl,
  selectedScenario,
  selectedDepth,
}: BuildPrototypeScenarioPlanInput) {
  const scenarioKey = toStepIdFragment(selectedScenario.id);
  const depthKey = toStepIdFragment(selectedDepth.id);

  return {
    schema_version: '0.5',
    plan_id: `web_${scenarioKey}_${depthKey}`,
    scenario_type: 'custom_compiled',
    template_key: selectedScenario.id,
    goal: selectedScenario.summary,
    start_url: submittedUrl,
    environment: {
      device: 'desktop',
      viewport: {
        width: 1440,
        height: 900,
      },
      locale: 'ko-KR',
      timezone: 'Asia/Seoul',
      permissions: [],
      auth_state: 'anonymous',
      depth_id: selectedDepth.id,
    },
    safety: {
      allow_external_navigation: false,
      allow_payment_commit: false,
      allow_destructive_action: false,
      use_synthetic_inputs: true,
      stop_before_real_payment: true,
    },
    steps: [
      {
        step_id: 'step_001_goto_start_url',
        stage: 'FIRST_VIEW',
        description: '대상 URL 열기',
        action: {
          type: 'goto',
          target: {
            url: submittedUrl,
          },
        },
        settle_strategy: {
          type: 'network_idle',
          timeout_ms: 5000,
        },
        checkpoint: true,
      },
      {
        step_id: `step_002_checkpoint_${scenarioKey}`,
        stage: 'CTA',
        description: selectedScenario.title,
        action: {
          type: 'checkpoint',
          target: {
            scenario_id: selectedScenario.id,
            depth_id: selectedDepth.id,
            text: selectedScenario.evidence,
          },
        },
        settle_strategy: {
          type: 'fixed_short',
          timeout_ms: 500,
        },
        checkpoint: true,
      },
    ],
  };
}
