import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createScenarioAuthoringIdempotencyKey,
  isScenarioAuthoringSupportedType,
  readScenarioPlanString,
  requireConfirmedScenarioPlanStartUrl,
  selectScenarioAuthoringCandidate,
} from '../../src/pages/create-analysis/lib/scenarioAuthoring';
import type { ScenarioAuthoringJob } from '../../src/entities/scenario-authoring';

function authoringJob(candidates: ScenarioAuthoringJob['candidates']): ScenarioAuthoringJob {
  return {
    schemaVersion: '0.5',
    authoringJobId: '40000000-0000-4000-8000-000000000011',
    status: 'SUCCEEDED',
    projectId: '8f06dca8-9c4d-4f20-b1a8-1d5ee40a9923',
    sourceDiscoveryId: '20000000-0000-4000-8000-000000000011',
    candidateCount: candidates.length,
    providerOrder: ['RULE_BASED'],
    input: {},
    providerPolicy: { provider_order: ['RULE_BASED'] },
    providerTrace: [],
    candidates,
    validation: {
      schema_valid: true,
      safety_valid: true,
      fit_requirements_valid: true,
      errors: [],
      warnings: [],
    },
    provenance: {},
    failure: null,
  };
}

test('scenario authoring helper selects the first validated candidate', () => {
  const job = authoringJob([
    {
      candidate_id: 'invalid',
      scenario_plan: {},
      confidence: 0.1,
      rationale: 'invalid',
      evidence_refs: [],
      validation: {
        schema_valid: false,
        safety_valid: true,
        fit_requirements_valid: true,
        errors: [],
        warnings: [],
      },
    },
    {
      candidate_id: 'valid',
      scenario_plan: { start_url: 'https://example.com' },
      confidence: 0.8,
      rationale: 'valid',
      evidence_refs: [],
      validation: {
        schema_valid: true,
        safety_valid: true,
        fit_requirements_valid: true,
        errors: [],
        warnings: [],
      },
    },
  ]);

  assert.equal(selectScenarioAuthoringCandidate(job)?.candidate_id, 'valid');
});

test('scenario authoring helper keeps idempotency bounded and authorable types explicit', () => {
  const key = createScenarioAuthoringIdempotencyKey('project', 'discovery', 'CONTACT', 'hero-only');

  assert.equal(key, 'scenario-authoring:project:discovery:CONTACT:hero-only');
  assert.ok(key.length <= 160);
  assert.equal(isScenarioAuthoringSupportedType('CONTACT'), true);
  assert.equal(isScenarioAuthoringSupportedType('CUSTOM_GUIDED'), false);
  assert.equal(readScenarioPlanString({ goal: '문의 흐름 점검' }, 'goal'), '문의 흐름 점검');
  assert.equal(readScenarioPlanString({ goal: '' }, 'goal'), null);
  assert.equal(requireConfirmedScenarioPlanStartUrl({ start_url: 'https://example.com/contact' }), 'https://example.com/contact');
  assert.throws(() => requireConfirmedScenarioPlanStartUrl({}), /missing start_url/);
});

test('scenario authoring helper does not fall back to invalid candidates', () => {
  const job = authoringJob([{
    candidate_id: 'invalid',
    scenario_plan: {},
    confidence: 0.1,
    rationale: 'invalid',
    evidence_refs: [],
    validation: {
      schema_valid: false,
      safety_valid: true,
      fit_requirements_valid: true,
      errors: [],
      warnings: [],
    },
  }]);

  assert.equal(selectScenarioAuthoringCandidate(job), null);
});
