interface PrototypeScenarioRecommendation {
  id: string;
  title: string;
  summary: string;
  evidence: string;
  scenarioType?: string;
  sourceDiscoveryId?: string | null;
  evidenceRefs?: string[];
  suggestedStartUrl?: string | null;
  suggestedTarget?: Record<string, unknown> | null;
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

function entrypointTypesForScenario(scenarioType: string | undefined) {
  if (scenarioType === 'SIGNUP_LEAD_FORM') {
    return ['form', 'signup'];
  }

  if (scenarioType === 'CONTACT') {
    return ['contact', 'form', 'cta'];
  }

  if (scenarioType === 'PRICING') {
    return ['pricing', 'cta'];
  }

  if (scenarioType === 'PURCHASE_CHECKOUT') {
    return ['checkout', 'cart'];
  }

  return ['cta'];
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
    source_discovery_id: selectedScenario.sourceDiscoveryId ?? null,
    fit_requirements: selectedScenario.scenarioType ? {
      required_flow_type: selectedScenario.scenarioType,
      required_entrypoint_types: entrypointTypesForScenario(selectedScenario.scenarioType),
      fallback_allowed: true,
    } : null,
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
            evidence_refs: selectedScenario.evidenceRefs ?? [],
            suggested_start_url: selectedScenario.suggestedStartUrl ?? null,
            suggested_target: selectedScenario.suggestedTarget ?? null,
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
