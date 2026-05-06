import test from 'node:test';
import assert from 'node:assert/strict';

import { toScenarioRecommendationViewModel, toScenarioRecommendationViewModels } from '../../src/pages/create-analysis/lib/discoveryRecommendations';
import type { Discovery, ScenarioRecommendation } from '../../src/entities/discovery';

const contactRecommendation = {
  scenarioType: 'CONTACT',
  recommendationLevel: 'HIGH',
  confidence: 0.86,
  reason: 'Contact, consultation, or demo request candidate was found.',
  evidenceRefs: ['cp_001.obs_003'],
  suggestedStartUrl: 'https://example.com',
  suggestedTarget: { text: 'Book a demo' },
} satisfies ScenarioRecommendation;

test('discovery recommendation mapper exposes canonical levels and CONTACT copy', () => {
  const card = toScenarioRecommendationViewModel(contactRecommendation);

  assert.equal(card.id, 'contact');
  assert.equal(card.level, 'HIGH');
  assert.equal(card.tone, 'recommended');
  assert.equal(card.title, '문의 / 상담 신청 흐름 점검');
  assert.match(card.summary, /B2B 전환 흐름/);
  assert.equal(card.confidenceLabel, '86%');
  assert.equal(card.evidence, 'cp_001.obs_003');
  assert.equal(card.isRunnable, true);
  assert.equal(card.sourceDiscoveryId, undefined);
  assert.deepEqual(card.evidenceRefs, ['cp_001.obs_003']);
  assert.deepEqual(card.suggestedTarget, { text: 'Book a demo' });
});

test('discovery recommendation mapper preserves NOT_AVAILABLE as a direct setup card', () => {
  const card = toScenarioRecommendationViewModel({
    ...contactRecommendation,
    recommendationLevel: 'NOT_AVAILABLE',
    confidence: 0,
    evidenceRefs: [],
  });

  assert.equal(card.level, 'NOT_AVAILABLE');
  assert.equal(card.tone, 'unavailable');
  assert.equal(card.actionLabel, '직접 설정하기');
  assert.equal(card.confidenceLabel, '0%');
});

test('discovery recommendation mapper converts completed discovery payloads', () => {
  const discovery = {
    discoveryId: '20000000-0000-4000-8000-000000000011',
    status: 'COMPLETED',
    scenarioRecommendations: [contactRecommendation],
  } satisfies Discovery;

  const cards = toScenarioRecommendationViewModels(discovery);

  assert.equal(cards.length, 1);
  assert.equal(cards[0].sourceDiscoveryId, discovery.discoveryId);
});
