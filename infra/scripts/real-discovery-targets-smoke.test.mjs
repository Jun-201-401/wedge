import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildDiscoveryTargetsSmokePlan,
  readDiscoveryTargetsSmokeConfig,
  summarizeDiscoveryResult,
} from './real-discovery-targets-smoke.mjs';

test('discovery targets smoke defaults to the three Korean storefront targets', () => {
  const config = readDiscoveryTargetsSmokeConfig({});

  assert.deepEqual(config.targetUrls, [
    'https://www.mgdj.co.kr/',
    'https://www.jinjood.com/',
    'http://hanaro.mrpage.kr/',
  ]);
  assert.deepEqual(config.expectedFlows, []);
  assert.equal(config.requireRecommendation, true);
  assert.equal(config.allowPartial, false);
});

test('discovery targets smoke builds isolated child plans per target', () => {
  const plan = buildDiscoveryTargetsSmokePlan({
    root: '/repo',
    artifactsRoot: '/tmp/artifacts',
    env: {
      WEDGE_DISCOVERY_SMOKE_TARGET_URLS: 'https://a.example/, http://b.example/path',
      WEDGE_DISCOVERY_TARGET_SMOKE_EXPECTED_FLOWS: 'LANDING_CTA,CONTACT',
      WEDGE_DISCOVERY_TARGET_SMOKE_MAX_DURATION_MS: '12000',
      WEDGE_DISCOVERY_TARGET_SMOKE_MAX_SCROLL_COUNT: '3',
    },
  });

  assert.equal(plan.length, 2);
  assert.equal(plan[0].targetUrl, 'https://a.example/');
  assert.equal(plan[1].targetUrl, 'http://b.example/path');
  assert.notEqual(plan[0].discoveryId, plan[1].discoveryId);
  assert.equal(plan[0].cwd, '/repo');
  assert.equal(plan[0].args[0], '/repo/infra/scripts/real-discovery-smoke.mjs');
  assert.equal(plan[0].env.WEDGE_DISCOVERY_SMOKE_EXPECTED_FLOWS, 'LANDING_CTA,CONTACT');
  assert.equal(plan[0].env.WEDGE_DISCOVERY_SMOKE_MAX_DURATION_MS, '12000');
  assert.equal(plan[0].env.WEDGE_DISCOVERY_SMOKE_MAX_SCROLL_COUNT, '3');
  assert.match(plan[1].artifactsRoot, /02-b\.example-path$/);
  assert.match(plan[1].resultFile, /site-discovery-result\.json$/);
});

test('discovery targets smoke summarizes runnable recommendation targets', () => {
  const summary = summarizeDiscoveryResult({
    detected_flow_types: ['LANDING_CTA', 'CONTACT'],
    missing_flow_types: ['PURCHASE_CHECKOUT'],
    scenario_recommendations: [
      {
        scenario_type: 'CONTACT',
        recommendation_level: 'HIGH',
        confidence: 0.86,
        suggested_target: { text: '1:1문의게시판', selector: '#inquiry' },
      },
      {
        scenario_type: 'PURCHASE_CHECKOUT',
        recommendation_level: 'NOT_AVAILABLE',
        confidence: 0,
        suggested_target: null,
      },
    ],
  });

  assert.deepEqual(summary.detectedFlowTypes, ['LANDING_CTA', 'CONTACT']);
  assert.equal(summary.recommendationCount, 2);
  assert.equal(summary.runnableRecommendationCount, 1);
  assert.deepEqual(summary.topRecommendations, [{
    scenarioType: 'CONTACT',
    level: 'HIGH',
    confidence: 0.86,
    target: { text: '1:1문의게시판' },
  }]);
});
