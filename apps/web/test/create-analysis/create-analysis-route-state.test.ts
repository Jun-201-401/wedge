import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCreateAnalysisPath,
  parseCreateAnalysisRouteState,
  type CreateAnalysisRouteOptions,
} from '../../src/pages/create-analysis/lib/createAnalysisRouteState';

type ScenarioId = 'landing-cta' | 'signup-form';
type DepthId = 'hero-only' | 'next-screen';

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

test('parseCreateAnalysisRouteState restores preflight and recommendations with normalized URL', () => {
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
