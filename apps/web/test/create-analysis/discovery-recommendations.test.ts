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
  evidenceSummary: {
    matched_signals: [{
      signal_id: 'sig_001',
      source: 'aria_label',
      signal_type: 'contact_keyword',
      value: 'Book a demo',
      evidence_ref: 'cp_001.obs_003',
      weight: 0.3,
    }],
    missing_signals: ['safe_submit_boundary_not_verified'],
    limitations: ['image_text_ocr_not_performed'],
  },
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
  assert.equal(card.confidence, 0.86);
  assert.equal(card.confidenceLabel, '높음');
  assert.equal(card.evidence, 'aria-label: Book a demo');
  assert.deepEqual(card.signalLabels, ['aria-label: Book a demo']);
  assert.deepEqual(card.limitationLabels, ['이미지 안 텍스트는 OCR하지 않음']);
  assert.equal(card.isRunnable, true);
  assert.equal(card.sourceDiscoveryId, undefined);
  assert.deepEqual(card.evidenceRefs, ['cp_001.obs_003']);
  assert.deepEqual(card.suggestedTarget, { text: 'Book a demo' });
});

test('discovery recommendation mapper keeps NOT_AVAILABLE non-runnable without a percentage confidence', () => {
  const card = toScenarioRecommendationViewModel({
    ...contactRecommendation,
    recommendationLevel: 'NOT_AVAILABLE',
    confidence: 0,
    evidenceRefs: [],
  });

  assert.equal(card.level, 'NOT_AVAILABLE');
  assert.equal(card.tone, 'unavailable');
  assert.equal(card.actionLabel, '직접 설정 필요');
  assert.equal(card.confidenceLabel, '없음');
  assert.equal(card.isRunnable, false);
});

test('discovery recommendation mapper keeps LOW as a visible but non-runnable weak signal', () => {
  const card = toScenarioRecommendationViewModel({
    ...contactRecommendation,
    recommendationLevel: 'LOW',
    confidence: 0.42,
  });

  assert.equal(card.level, 'LOW');
  assert.equal(card.tone, 'low');
  assert.equal(card.confidenceLabel, '낮음');
  assert.equal(card.isRunnable, false);
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
