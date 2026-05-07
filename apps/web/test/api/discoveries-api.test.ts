import test from 'node:test';
import assert from 'node:assert/strict';

import type { ApiResponse } from '../../src/api/http';
import { createDiscovery, getDiscovery } from '../../src/api/discoveries';
import type { Discovery } from '../../src/entities/discovery';

const projectId = '8f06dca8-9c4d-4f20-b1a8-1d5ee40a9923';
const discoveryId = '20000000-0000-4000-8000-000000000011';

function response<T>(payload: ApiResponse<T>) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

const discoveryResponse = {
  data: {
    discoveryId,
    status: 'COMPLETED',
    inputUrl: 'https://example.com',
    finalUrl: 'https://example.com',
    scenarioRecommendations: [{
      scenarioType: 'CONTACT',
      recommendationLevel: 'HIGH',
      confidence: 0.86,
      reason: 'Contact, consultation, or demo request candidate was found.',
      evidenceRefs: ['cp_001.obs_003'],
      evidenceSummary: {
        matched_signals: [{
          signal_id: 'sig_001',
          source: 'aria_label',
          signal_type: 'contact_keyword',
          value: 'Book a demo',
          evidence_ref: 'cp_001.obs_003',
        }],
        missing_signals: ['safe_submit_boundary_not_verified'],
        limitations: ['image_text_ocr_not_performed'],
      },
      suggestedStartUrl: 'https://example.com',
      suggestedTarget: { text: 'Book a demo' },
    }],
  },
  meta: { requestId: 'req_discovery' },
} satisfies ApiResponse<Discovery>;

test('discovery api client creates and polls public discovery endpoints', async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string; body?: string | null }> = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), method: init?.method ?? 'GET', body: init?.body?.toString() });
    return response(discoveryResponse);
  }) as typeof fetch;

  try {
    const created = await createDiscovery({
      projectId,
      url: 'https://example.com',
      devicePreset: 'desktop',
      viewport: { width: 1440, height: 900 },
    }, { idempotencyKey: 'idem_discovery_test' });
    const polled = await getDiscovery(discoveryId);

    assert.equal(created.data.discoveryId, discoveryId);
    assert.equal(polled.data.scenarioRecommendations?.[0]?.scenarioType, 'CONTACT');
    assert.equal(polled.data.scenarioRecommendations?.[0]?.evidenceSummary?.matched_signals?.[0]?.value, 'Book a demo');
    assert.deepEqual(calls.map((call) => [call.method, call.url]), [
      ['POST', '/api/discoveries'],
      ['GET', `/api/discoveries/${discoveryId}`],
    ]);
    assert.deepEqual(JSON.parse(calls[0].body ?? '{}'), {
      projectId,
      url: 'https://example.com',
      devicePreset: 'desktop',
      viewport: { width: 1440, height: 900 },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
