import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAuthoringRequest,
  buildRunRequestFromCandidate,
  readConfig,
  selectAuthorableRecommendation,
  selectValidCandidate,
  validateConfig,
} from './real-discovery-authoring-run-e2e-smoke.mjs';

const PROJECT_ID = '8f06dca8-9c4d-4f20-b1a8-1d5ee40a9923';
const SCENARIO_TEMPLATE_VERSION_ID = '5c5f4c77-0c32-4ab3-9841-2b6f6cc07a40';

test('[real chain smoke config] reads chain-specific environment with safe defaults', () => {
  const config = readConfig({
    WEDGE_CHAIN_SMOKE_API_BASE_URL: 'http://localhost:8080/',
    WEDGE_CHAIN_SMOKE_PROJECT_ID: PROJECT_ID,
    WEDGE_CHAIN_SMOKE_SCENARIO_TEMPLATE_VERSION_ID: SCENARIO_TEMPLATE_VERSION_ID,
    WEDGE_CHAIN_SMOKE_TARGET_URL: 'https://example.test/',
    WEDGE_CHAIN_SMOKE_PREFERRED_SCENARIO_TYPE: 'LANDING_CTA',
    WEDGE_CHAIN_SMOKE_EXPECTED_RUN_STATUSES: 'completed, stopped',
    WEDGE_CHAIN_SMOKE_REQUIRE_ARTIFACTS: 'true',
  });

  assert.equal(config.apiBaseUrl, 'http://localhost:8080');
  assert.equal(config.targetUrl, 'https://example.test/');
  assert.equal(config.preferredScenarioType, 'LANDING_CTA');
  assert.deepEqual(config.expectedRunStatuses, ['COMPLETED', 'STOPPED']);
  assert.equal(config.requireEvidenceArtifacts, true);
  assert.doesNotThrow(() => validateConfig(config));
});

test('[real chain smoke config] rejects missing expected run statuses', () => {
  const config = readConfig({
    WEDGE_CHAIN_SMOKE_PROJECT_ID: PROJECT_ID,
    WEDGE_CHAIN_SMOKE_SCENARIO_TEMPLATE_VERSION_ID: SCENARIO_TEMPLATE_VERSION_ID,
    WEDGE_CHAIN_SMOKE_TARGET_URL: 'https://example.test/',
    WEDGE_CHAIN_SMOKE_EXPECTED_RUN_STATUSES: '',
  });

  assert.throws(() => validateConfig(config), /EXPECTED_RUN_STATUSES/);
});

test('[real chain smoke recommendation] selects preferred HIGH/MEDIUM recommendation with evidence', () => {
  const recommendation = selectAuthorableRecommendation({
    summary: { detectedFlowTypes: ['LANDING_CTA', 'PRICING'] },
    scenarioRecommendations: [
      {
        recommendationId: 'rec-low',
        scenarioType: 'LANDING_CTA',
        recommendationLevel: 'LOW',
        confidence: 0.4,
        evidenceRefs: ['cp_001.obs_001'],
      },
      {
        recommendationId: 'rec-pricing',
        scenarioType: 'PRICING',
        recommendationLevel: 'MEDIUM',
        confidence: 0.7,
        evidenceRefs: ['cp_001.obs_002'],
      },
    ],
  }, 'PRICING');

  assert.equal(recommendation.recommendationId, 'rec-pricing');
});

test('[real chain smoke recommendation] rejects Discovery results without authorable evidence', () => {
  assert.throws(
    () => selectAuthorableRecommendation({
      summary: { detectedFlowTypes: [] },
      scenarioRecommendations: [
        {
          recommendationId: 'rec-missing-evidence',
          scenarioType: 'LANDING_CTA',
          recommendationLevel: 'HIGH',
          confidence: 0.9,
          evidenceRefs: [],
        },
      ],
    }, null),
    /no authorable HIGH\/MEDIUM recommendation/
  );
});

test('[real chain smoke authoring] builds request from persisted Discovery recommendation id', () => {
  const config = { projectId: PROJECT_ID };
  const discovery = { discoveryId: '30000000-0000-4000-8000-000000000099' };
  const recommendation = {
    recommendationId: '40000000-0000-4000-8000-000000000123',
    scenarioType: 'LANDING_CTA',
  };

  const request = buildAuthoringRequest(config, discovery, recommendation);

  assert.equal(request.projectId, PROJECT_ID);
  assert.equal(request.sourceDiscoveryId, discovery.discoveryId);
  assert.equal(request.selectedRecommendationId, recommendation.recommendationId);
  assert.equal(request.preferredScenarioType, 'LANDING_CTA');
  assert.deepEqual(request.providerPolicy.providerOrder, ['RULE_BASED']);
});

test('[real chain smoke candidate] selects only candidates with full validation pass', () => {
  const candidate = selectValidCandidate({
    authoringJobId: '50000000-0000-4000-8000-000000000123',
    candidates: [
      {
        candidate_id: 'invalid',
        validation: {
          schema_valid: true,
          safety_valid: false,
          fit_requirements_valid: true,
          errors: [],
        },
      },
      {
        candidate_id: 'valid',
        validation: {
          schema_valid: true,
          safety_valid: true,
          fit_requirements_valid: true,
          errors: [],
        },
      },
    ],
  });

  assert.equal(candidate.candidate_id, 'valid');
});

test('[real chain smoke run] builds RunCreateRequest from confirmed ScenarioAuthoring candidate', () => {
  const config = {
    projectId: PROJECT_ID,
    scenarioTemplateVersionId: SCENARIO_TEMPLATE_VERSION_ID,
    targetUrl: 'https://example.test/',
  };
  const request = buildRunRequestFromCandidate(config, {
    candidate_id: 'rule_based_landing_cta_001',
    scenario_plan: {
      schema_version: '0.5',
      plan_id: 'plan-1',
      scenario_type: 'custom_compiled',
      source_discovery_id: '30000000-0000-4000-8000-000000000099',
      goal: 'Open the page and capture CTA evidence.',
      start_url: 'https://example.test/',
      environment: { device: 'desktop' },
      safety: {},
      steps: [],
    },
  });

  assert.equal(request.projectId, PROJECT_ID);
  assert.equal(request.startUrl, 'https://example.test/');
  assert.equal(request.scenarioTemplateVersionId, SCENARIO_TEMPLATE_VERSION_ID);
  assert.equal(request.scenarioOverrides.source, 'infra-real-discovery-authoring-run-e2e-smoke');
  assert.equal(request.scenarioOverrides.candidateId, 'rule_based_landing_cta_001');
  assert.equal(request.scenarioPlan.plan_id, 'plan-1');
});
