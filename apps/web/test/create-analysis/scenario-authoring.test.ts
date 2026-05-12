import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createScenarioPlanPreview,
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

test('scenario authoring helper turns dynamic ScenarioPlan steps into a user preview', () => {
  const preview = createScenarioPlanPreview({
    goal: '랜딩 CTA 점검',
    start_url: 'https://example.com',
    safety: {
      allow_payment_commit: false,
      allow_destructive_action: false,
      stop_before_real_payment: true,
    },
    steps: [
      {
        step_id: 'step_001_goto',
        description: '추천 URL에 진입한다.',
        action: { type: 'goto' },
      },
      {
        step_id: 'step_002_click',
        description: '추천 CTA를 클릭한다.',
        action: { type: 'click' },
      },
    ],
  });

  assert.equal(preview?.title, '랜딩 CTA 점검');
  assert.equal(preview?.startUrl, 'https://example.com');
  assert.equal(preview?.stepCount, 2);
  assert.equal(preview?.steps[0]?.label, '1. 페이지 진입');
  assert.equal(preview?.steps[1]?.label, '2. 추천 요소 클릭');
  assert.match(preview?.safetyLabel ?? '', /결제/);
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
