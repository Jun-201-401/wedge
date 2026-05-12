import type { ScenarioAuthoringCandidate, ScenarioAuthoringJob } from '../../../entities/scenario-authoring';

const AUTHORABLE_SCENARIO_TYPES = new Set([
  'LANDING_CTA',
  'SIGNUP_LEAD_FORM',
  'PRICING',
  'PURCHASE_CHECKOUT',
  'CONTACT',
  'CONTENT_ONLY',
]);

export function createScenarioAuthoringIdempotencyKey(projectId: string, sourceDiscoveryId: string, scenarioType: string, depthId: string) {
  return `scenario-authoring:${projectId}:${sourceDiscoveryId}:${scenarioType}:${depthId}`.slice(0, 160);
}

export function selectScenarioAuthoringCandidate(job: ScenarioAuthoringJob): ScenarioAuthoringCandidate | null {
  return job.candidates.find((candidate) =>
    candidate.validation.schema_valid
      && candidate.validation.safety_valid
      && candidate.validation.fit_requirements_valid,
  ) ?? null;
}

export function readScenarioPlanString(scenarioPlan: Record<string, unknown>, key: string) {
  const value = scenarioPlan[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

export function requireConfirmedScenarioPlanStartUrl(scenarioPlan: Record<string, unknown>) {
  const startUrl = readScenarioPlanString(scenarioPlan, 'start_url');
  if (!startUrl) {
    throw new Error('Confirmed ScenarioPlan is missing start_url.');
  }
  return startUrl;
}

export function isScenarioAuthoringSupportedType(scenarioType: string) {
  return AUTHORABLE_SCENARIO_TYPES.has(scenarioType);
}

export interface ScenarioPlanPreviewStep {
  id: string;
  label: string;
  detail: string;
}

export interface ScenarioPlanPreview {
  title: string;
  startUrl: string | null;
  stepCount: number;
  steps: ScenarioPlanPreviewStep[];
  safetyLabel: string;
}

export function createScenarioPlanPreview(scenarioPlan: Record<string, unknown> | null | undefined): ScenarioPlanPreview | null {
  if (!scenarioPlan) {
    return null;
  }

  const goal = readScenarioPlanString(scenarioPlan, 'goal') ?? '사이트 맞춤 시나리오';
  const startUrl = readScenarioPlanString(scenarioPlan, 'start_url');
  const steps = Array.isArray(scenarioPlan.steps) ? scenarioPlan.steps : [];
  const previewSteps = steps
    .map((step, index) => toPreviewStep(step, index))
    .filter((step): step is ScenarioPlanPreviewStep => step !== null)
    .slice(0, 5);

  return {
    title: goal,
    startUrl,
    stepCount: steps.length,
    steps: previewSteps,
    safetyLabel: readSafetyLabel(scenarioPlan.safety),
  };
}

function toPreviewStep(value: unknown, index: number): ScenarioPlanPreviewStep | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const step = value as Record<string, unknown>;
  const action = step.action && typeof step.action === 'object' && !Array.isArray(step.action)
    ? step.action as Record<string, unknown>
    : {};
  const actionType = typeof action.type === 'string' ? action.type : 'step';
  const description = typeof step.description === 'string' && step.description.trim().length > 0
    ? step.description
    : actionLabel(actionType);

  return {
    id: typeof step.step_id === 'string' && step.step_id.length > 0 ? step.step_id : `step_${index + 1}`,
    label: `${index + 1}. ${actionLabel(actionType)}`,
    detail: description,
  };
}

function actionLabel(actionType: string) {
  switch (actionType) {
    case 'goto':
      return '페이지 진입';
    case 'click':
      return '추천 요소 클릭';
    case 'fill':
    case 'select':
      return '입력 요소 확인';
    case 'checkpoint':
      return '화면 근거 수집';
    case 'stop_when':
      return '안전 중단 지점';
    default:
      return '시나리오 단계';
  }
}

function readSafetyLabel(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return '실제 결제, 삭제, 변경 같은 위험 행동은 수행하지 않아요.';
  }

  const safety = value as Record<string, unknown>;
  const blocksPayment = safety.allow_payment_commit === false || safety.stop_before_real_payment === true;
  const blocksDestructive = safety.allow_destructive_action === false;

  if (blocksPayment && blocksDestructive) {
    return '결제/파괴적 행동 전 중단하도록 구성됐어요.';
  }

  return '위험 행동을 제한하는 안전 설정을 적용합니다.';
}
