import test from 'node:test';
import assert from 'node:assert/strict';

import {
  confirmScenarioAuthoringCandidate,
  createScenarioAuthoringJob,
  getScenarioAuthoringJob,
} from '../../src/api/scenario-authoring';
import type { ApiResponse } from '../../src/api/http';
import type { ScenarioAuthoringConfirmResponse, ScenarioAuthoringJob } from '../../src/entities/scenario-authoring';

const authoringJobId = '40000000-0000-4000-8000-000000000011';
const projectId = '8f06dca8-9c4d-4f20-b1a8-1d5ee40a9923';
const sourceDiscoveryId = '20000000-0000-4000-8000-000000000011';
const candidateId = 'rule_based_contact_001';

function response<T>(payload: ApiResponse<T>) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

const authoringJob = {
  schemaVersion: '0.5',
  authoringJobId,
  status: 'SUCCEEDED',
  projectId,
  sourceDiscoveryId,
  candidateCount: 1,
  providerOrder: ['INTERNAL_LLM', 'RULE_BASED'],
  input: {},
  providerPolicy: { provider_order: ['INTERNAL_LLM', 'RULE_BASED'] },
  providerTrace: [],
  candidates: [{
    candidate_id: candidateId,
    scenario_plan: {
      schema_version: '0.5',
      plan_id: 'plan_contact_001',
      scenario_type: 'custom_compiled',
      start_url: 'https://example.com/contact',
      goal: '문의 흐름 점검',
    },
    confidence: 0.86,
    rationale: 'RULE_BASED candidate',
    evidence_refs: ['cp_001.obs_003'],
    validation: {
      schema_valid: true,
      safety_valid: true,
      fit_requirements_valid: true,
      errors: [],
      warnings: [],
    },
  }],
  validation: {
    schema_valid: true,
    safety_valid: true,
    fit_requirements_valid: true,
    errors: [],
    warnings: [],
  },
  provenance: { source_discovery_id: sourceDiscoveryId },
  failure: null,
} satisfies ScenarioAuthoringJob;

test('scenario authoring api client creates, reads, and confirms candidates', async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string; body?: string | null }> = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), method: init?.method ?? 'GET', body: init?.body?.toString() });
    if (String(input).endsWith('/confirm')) {
      return response({
        data: {
          authoringJob: { ...authoringJob, confirmedCandidateId: candidateId },
          confirmedCandidate: authoringJob.candidates[0],
        },
        meta: { requestId: 'req_confirm' },
      } satisfies ApiResponse<ScenarioAuthoringConfirmResponse>);
    }
    return response({ data: authoringJob, meta: { requestId: 'req_authoring' } });
  }) as typeof fetch;

  try {
    const created = await createScenarioAuthoringJob({
      projectId,
      sourceDiscoveryId,
      requestedGoal: '문의 흐름 점검',
      preferredScenarioType: 'CONTACT',
      providerPolicy: { providerOrder: ['INTERNAL_LLM', 'RULE_BASED'], timeoutMs: 20000 },
    }, { idempotencyKey: 'idem_authoring_test' });
    const loaded = await getScenarioAuthoringJob(authoringJobId);
    const confirmed = await confirmScenarioAuthoringCandidate(authoringJobId, { candidateId });

    assert.equal(created.data.authoringJobId, authoringJobId);
    assert.equal(loaded.data.candidates[0].candidate_id, candidateId);
    assert.equal(confirmed.data.confirmedCandidate.scenario_plan.start_url, 'https://example.com/contact');
    assert.deepEqual(calls.map((call) => [call.method, call.url]), [
      ['POST', '/api/scenario-authoring-jobs'],
      ['GET', `/api/scenario-authoring-jobs/${authoringJobId}`],
      ['POST', `/api/scenario-authoring-jobs/${authoringJobId}/confirm`],
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
