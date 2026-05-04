import { normalizeAnalysisUrl } from './createAnalysisUrl';

export type CreateAnalysisRouteStage = 'input' | 'discovering' | 'recommendations' | 'onboarding' | 'ready';

export interface CreateAnalysisRouteState<TScenarioId extends string = string, TDepthId extends string = string> {
  stage: CreateAnalysisRouteStage;
  submittedUrl: string | null;
  scenarioId: TScenarioId | null;
  depthId: TDepthId | null;
  projectId?: string;
  scenarioTemplateVersionId?: string;
}

export interface CreateAnalysisRouteOptions<TScenarioId extends string = string, TDepthId extends string = string> {
  basePath?: string;
  defaultDepthId: TDepthId;
  validDepthIds: readonly TDepthId[];
  validScenarioIds: readonly TScenarioId[];
}

export interface CreateRunContext {
  projectId: string;
  scenarioTemplateVersionId: string;
}

export const MVP_SMOKE_CREATE_RUN_CONTEXT: CreateRunContext = {
  projectId: '8f06dca8-9c4d-4f20-b1a8-1d5ee40a9923',
  scenarioTemplateVersionId: '5c5f4c77-0c32-4ab3-9841-2b6f6cc07a40',
};

const DEFAULT_BASE_PATH = '/create-analysis';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

function readUuidValue(value: string | null | undefined) {
  return value !== null && value !== undefined && UUID_PATTERN.test(value) ? value : null;
}

function readUuidParam(params: URLSearchParams, name: string) {
  return readUuidValue(params.get(name));
}

function readCreateRunContext(params: URLSearchParams) {
  const projectId = readUuidParam(params, 'projectId');
  const scenarioTemplateVersionId = readUuidParam(params, 'scenarioTemplateVersionId');

  if (!projectId || !scenarioTemplateVersionId) {
    return {};
  }

  return {
    projectId,
    scenarioTemplateVersionId,
  };
}

function hasCreateRunContext<TScenarioId extends string, TDepthId extends string>(
  state: CreateAnalysisRouteState<TScenarioId, TDepthId>,
): state is CreateAnalysisRouteState<TScenarioId, TDepthId> & { projectId: string; scenarioTemplateVersionId: string } {
  return UUID_PATTERN.test(state.projectId ?? '') && UUID_PATTERN.test(state.scenarioTemplateVersionId ?? '');
}

function inputRouteState<TScenarioId extends string, TDepthId extends string>(
  createRunContext: Partial<Pick<CreateAnalysisRouteState<TScenarioId, TDepthId>, 'projectId' | 'scenarioTemplateVersionId'>> = {},
): CreateAnalysisRouteState<TScenarioId, TDepthId> {
  return {
    stage: 'input',
    submittedUrl: null,
    scenarioId: null,
    depthId: null,
    ...createRunContext,
  };
}

export function readCreateRunContextFromEnv(env: Record<string, string | undefined>): Partial<CreateRunContext> {
  const projectId = readUuidValue(env.VITE_DEV_PROJECT_ID);
  const scenarioTemplateVersionId = readUuidValue(env.VITE_DEV_SCENARIO_TEMPLATE_VERSION_ID);

  if (!projectId || !scenarioTemplateVersionId) {
    return {};
  }

  return {
    projectId,
    scenarioTemplateVersionId,
  };
}

export function withCreateRunContextFallback<TScenarioId extends string, TDepthId extends string>(
  state: CreateAnalysisRouteState<TScenarioId, TDepthId>,
  fallbackContext: Partial<CreateRunContext>,
): CreateAnalysisRouteState<TScenarioId, TDepthId> {
  const projectId = readUuidValue(fallbackContext.projectId);
  const scenarioTemplateVersionId = readUuidValue(fallbackContext.scenarioTemplateVersionId);

  if (hasCreateRunContext(state) || !projectId || !scenarioTemplateVersionId) {
    return state;
  }

  return {
    ...state,
    projectId,
    scenarioTemplateVersionId,
  };
}

export function parseCreateAnalysisRouteState<TScenarioId extends string, TDepthId extends string>(
  search: string,
  options: CreateAnalysisRouteOptions<TScenarioId, TDepthId>,
): CreateAnalysisRouteState<TScenarioId, TDepthId> {
  const params = new URLSearchParams(search);
  const step = params.get('step');
  const parsedStage = isRouteStep(step) ? STEP_TO_STAGE[step] : 'input';
  const createRunContext = readCreateRunContext(params);

  if (parsedStage === 'input') {
    return inputRouteState(createRunContext);
  }

  const submittedUrl = normalizeAnalysisUrl(params.get('url') ?? '');

  if (!submittedUrl) {
    return inputRouteState(createRunContext);
  }

  if (parsedStage === 'discovering' || parsedStage === 'recommendations') {
    return {
      stage: parsedStage,
      submittedUrl,
      scenarioId: null,
      depthId: null,
      ...createRunContext,
    };
  }

  const scenarioId = params.get('scenario');

  if (!isOneOf(scenarioId, options.validScenarioIds)) {
    return {
      stage: 'recommendations',
      submittedUrl,
      scenarioId: null,
      depthId: null,
      ...createRunContext,
    };
  }

  const depthId = params.get('depth');
  const safeDepthId = isOneOf(depthId, options.validDepthIds) ? depthId : options.defaultDepthId;

  return {
    stage: parsedStage,
    submittedUrl,
    scenarioId,
    depthId: safeDepthId,
    ...createRunContext,
  };
}

export function buildCreateAnalysisPath<TScenarioId extends string, TDepthId extends string>(
  state: CreateAnalysisRouteState<TScenarioId, TDepthId>,
  options: CreateAnalysisRouteOptions<TScenarioId, TDepthId>,
) {
  const basePath = options.basePath ?? DEFAULT_BASE_PATH;

  if (state.stage === 'input') {
    if (hasCreateRunContext(state)) {
      const inputParams = new URLSearchParams({
        projectId: state.projectId,
        scenarioTemplateVersionId: state.scenarioTemplateVersionId,
      });

      return `${basePath}?${inputParams.toString()}`;
    }

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
        projectId: state.projectId,
        scenarioTemplateVersionId: state.scenarioTemplateVersionId,
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

  if (hasCreateRunContext(state)) {
    params.set('projectId', state.projectId);
    params.set('scenarioTemplateVersionId', state.scenarioTemplateVersionId);
  }

  return `${basePath}?${params.toString()}`;
}
