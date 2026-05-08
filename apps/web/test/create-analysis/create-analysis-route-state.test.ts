import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCreateAnalysisPath,
  createManualChoiceRouteState,
  createRecommendationChoiceRouteState,
  createScenarioReadyRouteState,
  MVP_SMOKE_CREATE_RUN_CONTEXT,
  parseCreateAnalysisRouteState,
  readCreateRunContextFromEnv,
  withCreateRunContextFallback,
  type CreateAnalysisRouteOptions,
} from '../../src/pages/create-analysis/lib/createAnalysisRouteState';

type ScenarioId = 'landing-cta' | 'signup-form';
type DepthId = 'hero-only' | 'next-screen';
const projectId = '11111111-1111-4111-8111-111111111111';
const scenarioTemplateVersionId = '22222222-2222-4222-8222-222222222222';

const options: CreateAnalysisRouteOptions<ScenarioId, DepthId> = {
  defaultDepthId: 'hero-only',
  validDepthIds: ['hero-only', 'next-screen'],
  validScenarioIds: ['landing-cta', 'signup-form'],
};

test('parseCreateAnalysisRouteState returns input for empty or invalid search', () => {
  assert.deepEqual(parseCreateAnalysisRouteState('', options), {
    stage: 'input',
    submittedUrl: null,
    scenarioId: null,
    depthId: null,
  });

  assert.deepEqual(parseCreateAnalysisRouteState('?step=preflight&url=abc', options), {
    stage: 'input',
    submittedUrl: null,
    scenarioId: null,
    depthId: null,
  });

  assert.deepEqual(parseCreateAnalysisRouteState('?step=constructor&url=example.com&scenario=landing-cta', options), {
    stage: 'input',
    submittedUrl: null,
    scenarioId: null,
    depthId: null,
  });
});

test('parseCreateAnalysisRouteState restores preflight, recommendations, and manual choice with normalized URL', () => {
  assert.deepEqual(parseCreateAnalysisRouteState('?step=preflight&url=example.com', options), {
    stage: 'discovering',
    submittedUrl: 'https://example.com/',
    scenarioId: null,
    depthId: null,
  });

  assert.deepEqual(parseCreateAnalysisRouteState('?step=recommendations&url=https%3A%2F%2Fexample.com%2Fpricing', options), {
    stage: 'recommendations',
    submittedUrl: 'https://example.com/pricing',
    scenarioId: null,
    depthId: null,
  });

  assert.deepEqual(parseCreateAnalysisRouteState('?step=manual&url=example.com', options), {
    stage: 'manual-choice',
    submittedUrl: 'https://example.com/',
    scenarioId: null,
    depthId: null,
  });
});

test('parseCreateAnalysisRouteState restores setup and ready scenario state', () => {
  assert.deepEqual(parseCreateAnalysisRouteState('?step=setup&url=example.com&scenario=landing-cta&depth=next-screen', options), {
    stage: 'onboarding',
    submittedUrl: 'https://example.com/',
    scenarioId: 'landing-cta',
    depthId: 'next-screen',
  });

  assert.deepEqual(parseCreateAnalysisRouteState('?step=ready&url=example.com&scenario=signup-form&depth=nope', options), {
    stage: 'ready',
    submittedUrl: 'https://example.com/',
    scenarioId: 'signup-form',
    depthId: 'hero-only',
  });
});

test('create-analysis route state preserves valid run creation context', () => {
  assert.deepEqual(
    parseCreateAnalysisRouteState(
      `?step=preflight&url=example.com&projectId=${projectId}&scenarioTemplateVersionId=${scenarioTemplateVersionId}`,
      options,
    ),
    {
      stage: 'discovering',
      submittedUrl: 'https://example.com/',
      scenarioId: null,
      depthId: null,
      projectId,
      scenarioTemplateVersionId,
    },
  );

  assert.equal(
    buildCreateAnalysisPath(
      {
        stage: 'ready',
        submittedUrl: 'https://example.com/',
        scenarioId: 'landing-cta',
        depthId: 'next-screen',
        projectId,
        scenarioTemplateVersionId,
      },
      options,
    ),
    `/create-analysis?step=ready&url=https%3A%2F%2Fexample.com%2F&scenario=landing-cta&depth=next-screen&projectId=${projectId}&scenarioTemplateVersionId=${scenarioTemplateVersionId}`,
  );
});

test('create-analysis route state exposes MVP smoke run context defaults', () => {
  assert.deepEqual(MVP_SMOKE_CREATE_RUN_CONTEXT, {
    projectId: '8f06dca8-9c4d-4f20-b1a8-1d5ee40a9923',
  });
});

test('create-analysis route state can use dev env run context as fallback', () => {
  const fallbackContext = readCreateRunContextFromEnv({
    VITE_DEV_PROJECT_ID: projectId,
    VITE_DEV_SCENARIO_TEMPLATE_VERSION_ID: scenarioTemplateVersionId,
  });

  assert.deepEqual(fallbackContext, { projectId, scenarioTemplateVersionId });

  assert.deepEqual(
    withCreateRunContextFallback(
      { stage: 'input', submittedUrl: null, scenarioId: null, depthId: null },
      fallbackContext,
    ),
    {
      stage: 'input',
      submittedUrl: null,
      scenarioId: null,
      depthId: null,
      projectId,
      scenarioTemplateVersionId,
    },
  );

  assert.deepEqual(
    readCreateRunContextFromEnv({
      VITE_DEV_PROJECT_ID: 'not-a-uuid',
      VITE_DEV_SCENARIO_TEMPLATE_VERSION_ID: scenarioTemplateVersionId,
    }),
    {},
  );

  assert.equal(
    buildCreateAnalysisPath(
      { stage: 'input', submittedUrl: null, scenarioId: null, depthId: null, ...fallbackContext },
      options,
    ),
    `/create-analysis?projectId=${projectId}&scenarioTemplateVersionId=${scenarioTemplateVersionId}`,
  );

  assert.deepEqual(
    withCreateRunContextFallback(
      {
        stage: 'input',
        submittedUrl: null,
        scenarioId: null,
        depthId: null,
        projectId: '33333333-3333-4333-8333-333333333333',
        scenarioTemplateVersionId: '44444444-4444-4444-8444-444444444444',
      },
      fallbackContext,
    ),
    {
      stage: 'input',
      submittedUrl: null,
      scenarioId: null,
      depthId: null,
      projectId: '33333333-3333-4333-8333-333333333333',
      scenarioTemplateVersionId: '44444444-4444-4444-8444-444444444444',
    },
  );
});

test('parseCreateAnalysisRouteState falls back to recommendations for invalid scenario', () => {
  assert.deepEqual(parseCreateAnalysisRouteState('?step=setup&url=example.com&scenario=missing', options), {
    stage: 'recommendations',
    submittedUrl: 'https://example.com/',
    scenarioId: null,
    depthId: null,
  });
});

test('buildCreateAnalysisPath encodes create-analysis route state', () => {
  assert.equal(
    buildCreateAnalysisPath({ stage: 'input', submittedUrl: null, scenarioId: null, depthId: null }, options),
    '/create-analysis',
  );

  assert.equal(
    buildCreateAnalysisPath({ stage: 'discovering', submittedUrl: 'https://example.com/', scenarioId: null, depthId: null }, options),
    '/create-analysis?step=preflight&url=https%3A%2F%2Fexample.com%2F',
  );

  assert.equal(
    buildCreateAnalysisPath({ stage: 'manual-choice', submittedUrl: 'https://example.com/', scenarioId: null, depthId: null }, options),
    '/create-analysis?step=manual&url=https%3A%2F%2Fexample.com%2F',
  );

  assert.equal(
    buildCreateAnalysisPath(
      {
        stage: 'ready',
        submittedUrl: 'https://example.com/',
        scenarioId: 'landing-cta',
        depthId: 'next-screen',
      },
      options,
    ),
    '/create-analysis?step=ready&url=https%3A%2F%2Fexample.com%2F&scenario=landing-cta&depth=next-screen',
  );
});

test('buildCreateAnalysisPath avoids impossible non-input route states', () => {
  assert.equal(
    buildCreateAnalysisPath({ stage: 'recommendations', submittedUrl: null, scenarioId: null, depthId: null }, options),
    '/create-analysis',
  );

  assert.equal(
    buildCreateAnalysisPath(
      {
        stage: 'ready',
        submittedUrl: 'https://example.com/',
        scenarioId: null,
        depthId: null,
      },
      options,
    ),
    '/create-analysis?step=recommendations&url=https%3A%2F%2Fexample.com%2F',
  );
});


test('create-analysis recommendation route helpers move selection directly to ready and back', () => {
  const currentState = {
    stage: 'recommendations',
    submittedUrl: 'https://example.com/',
    scenarioId: null,
    depthId: null,
    projectId,
    scenarioTemplateVersionId,
  } as const;

  const readyState = createScenarioReadyRouteState(currentState, 'https://example.com/', 'landing-cta', options.defaultDepthId);

  assert.deepEqual(readyState, {
    stage: 'ready',
    submittedUrl: 'https://example.com/',
    scenarioId: 'landing-cta',
    depthId: 'hero-only',
    projectId,
    scenarioTemplateVersionId,
  });
  assert.equal(
    buildCreateAnalysisPath(readyState, options),
    `/create-analysis?step=ready&url=https%3A%2F%2Fexample.com%2F&scenario=landing-cta&depth=hero-only&projectId=${projectId}&scenarioTemplateVersionId=${scenarioTemplateVersionId}`,
  );

  assert.deepEqual(createRecommendationChoiceRouteState(readyState, 'https://example.com/'), {
    stage: 'recommendations',
    submittedUrl: 'https://example.com/',
    scenarioId: null,
    depthId: null,
    projectId,
    scenarioTemplateVersionId,
  });

  assert.deepEqual(createManualChoiceRouteState(readyState, 'https://example.com/'), {
    stage: 'manual-choice',
    submittedUrl: 'https://example.com/',
    scenarioId: null,
    depthId: null,
    projectId,
    scenarioTemplateVersionId,
  });
});
