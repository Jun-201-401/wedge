import { normalizeAnalysisUrl } from './createAnalysisUrl';

export type CreateAnalysisRouteStage = 'input' | 'discovering' | 'recommendations' | 'onboarding' | 'ready';

export interface CreateAnalysisRouteState<TScenarioId extends string = string, TDepthId extends string = string> {
  stage: CreateAnalysisRouteStage;
  submittedUrl: string | null;
  scenarioId: TScenarioId | null;
  depthId: TDepthId | null;
}

export interface CreateAnalysisRouteOptions<TScenarioId extends string = string, TDepthId extends string = string> {
  basePath?: string;
  defaultDepthId: TDepthId;
  validDepthIds: readonly TDepthId[];
  validScenarioIds: readonly TScenarioId[];
}

const DEFAULT_BASE_PATH = '/create-analysis';

const STEP_TO_STAGE = {
  preflight: 'discovering',
  recommendations: 'recommendations',
  setup: 'onboarding',
  ready: 'ready',
} as const satisfies Record<string, Exclude<CreateAnalysisRouteStage, 'input'>>;

const STAGE_TO_STEP = {
  discovering: 'preflight',
  recommendations: 'recommendations',
  onboarding: 'setup',
  ready: 'ready',
} as const satisfies Record<Exclude<CreateAnalysisRouteStage, 'input'>, string>;

function isOneOf<T extends string>(value: string | null, validValues: readonly T[]): value is T {
  return value !== null && validValues.includes(value as T);
}

function isRouteStep(value: string | null): value is keyof typeof STEP_TO_STAGE {
  return value !== null && Object.prototype.hasOwnProperty.call(STEP_TO_STAGE, value);
}

function inputRouteState<TScenarioId extends string, TDepthId extends string>(): CreateAnalysisRouteState<TScenarioId, TDepthId> {
  return {
    stage: 'input',
    submittedUrl: null,
    scenarioId: null,
    depthId: null,
  };
}

export function parseCreateAnalysisRouteState<TScenarioId extends string, TDepthId extends string>(
  search: string,
  options: CreateAnalysisRouteOptions<TScenarioId, TDepthId>,
): CreateAnalysisRouteState<TScenarioId, TDepthId> {
  const params = new URLSearchParams(search);
  const step = params.get('step');
  const parsedStage = isRouteStep(step) ? STEP_TO_STAGE[step] : 'input';

  if (parsedStage === 'input') {
    return inputRouteState();
  }

  const submittedUrl = normalizeAnalysisUrl(params.get('url') ?? '');

  if (!submittedUrl) {
    return inputRouteState();
  }

  if (parsedStage === 'discovering' || parsedStage === 'recommendations') {
    return {
      stage: parsedStage,
      submittedUrl,
      scenarioId: null,
      depthId: null,
    };
  }

  const scenarioId = params.get('scenario');

  if (!isOneOf(scenarioId, options.validScenarioIds)) {
    return {
      stage: 'recommendations',
      submittedUrl,
      scenarioId: null,
      depthId: null,
    };
  }

  const depthId = params.get('depth');
  const safeDepthId = isOneOf(depthId, options.validDepthIds) ? depthId : options.defaultDepthId;

  return {
    stage: parsedStage,
    submittedUrl,
    scenarioId,
    depthId: safeDepthId,
  };
}

export function buildCreateAnalysisPath<TScenarioId extends string, TDepthId extends string>(
  state: CreateAnalysisRouteState<TScenarioId, TDepthId>,
  options: CreateAnalysisRouteOptions<TScenarioId, TDepthId>,
) {
  const basePath = options.basePath ?? DEFAULT_BASE_PATH;

  if (state.stage === 'input') {
    return basePath;
  }

  if (!state.submittedUrl) {
    return basePath;
  }

  if ((state.stage === 'onboarding' || state.stage === 'ready') && !state.scenarioId) {
    return buildCreateAnalysisPath(
      {
        stage: 'recommendations',
        submittedUrl: state.submittedUrl,
        scenarioId: null,
        depthId: null,
      },
      options,
    );
  }

  const params = new URLSearchParams();
  params.set('step', STAGE_TO_STEP[state.stage]);

  params.set('url', state.submittedUrl);

  if ((state.stage === 'onboarding' || state.stage === 'ready') && state.scenarioId) {
    params.set('scenario', state.scenarioId);
    params.set('depth', state.depthId ?? options.defaultDepthId);
  }

  return `${basePath}?${params.toString()}`;
}
