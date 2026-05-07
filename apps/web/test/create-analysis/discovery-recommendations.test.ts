import test from 'node:test';
import assert from 'node:assert/strict';

import { toManualScenarioRecommendationViewModels, toScenarioRecommendationViewModel, toScenarioRecommendationViewModels } from '../../src/pages/create-analysis/lib/discoveryRecommendations';
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
  assert.equal(card.levelLabel, '추천');
  assert.equal(card.tone, 'recommended');
  assert.equal(card.title, '문의 / 상담 신청 흐름 점검');
  assert.match(card.summary, /B2B 전환 흐름/);
  assert.doesNotMatch(card.summary, /candidate was found/);
  assert.equal(card.confidence, 0.86);
  assert.equal(card.confidenceLabel, '높음');
  assert.equal(card.evidence, 'aria-label: Book a demo');
  assert.deepEqual(card.signalLabels, ['aria-label: Book a demo']);
  assert.deepEqual(card.limitationLabels, ['이미지 안 텍스트는 OCR하지 않음']);
  assert.equal(card.isRunnable, true);
  assert.equal(card.actionLabel, '이 흐름으로 시작하기');
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
  assert.equal(card.levelLabel, '탐지 안 됨');
  assert.equal(card.tone, 'unavailable');
  assert.equal(card.actionLabel, '직접 설정 필요');
  assert.equal(card.confidenceLabel, '없음');
  assert.equal(card.isRunnable, false);
});

test('discovery recommendation mapper keeps LOW as a selectable weak signal', () => {
  const card = toScenarioRecommendationViewModel({
    ...contactRecommendation,
    recommendationLevel: 'LOW',
    confidence: 0.42,
  });

  assert.equal(card.level, 'LOW');
  assert.equal(card.levelLabel, '약한 신호');
  assert.equal(card.tone, 'low');
  assert.equal(card.confidenceLabel, '낮음');
  assert.equal(card.isRunnable, true);
  assert.equal(card.actionLabel, '확인하며 시작하기');
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

test('discovery recommendation mapper hides unavailable flows and sorts detected recommendations', () => {
  const discovery = {
    discoveryId: '20000000-0000-4000-8000-000000000012',
    status: 'COMPLETED',
    scenarioRecommendations: [
      {
        ...contactRecommendation,
        scenarioType: 'PRICING',
        recommendationLevel: 'LOW',
        confidence: 0.42,
      },
      {
        ...contactRecommendation,
        scenarioType: 'PURCHASE_CHECKOUT',
        recommendationLevel: 'NOT_AVAILABLE',
        confidence: 0,
      },
      {
        ...contactRecommendation,
        scenarioType: 'LANDING_CTA',
        recommendationLevel: 'HIGH',
        confidence: 0.78,
      },
    ],
  } satisfies Discovery;

  const cards = toScenarioRecommendationViewModels(discovery);

  assert.deepEqual(cards.map((card) => card.level), ['HIGH', 'LOW']);
  assert.deepEqual(cards.map((card) => card.id), ['landing-cta', 'pricing']);
  assert.equal(cards.every((card) => card.isRunnable), true);
});

test('manual scenario mapper exposes non-detected flows as direct choices', () => {
  const cards = toManualScenarioRecommendationViewModels(['landing-cta', 'pricing']);

  assert.deepEqual(cards.map((card) => card.id), ['signup-form', 'contact', 'checkout']);
  assert.equal(cards.every((card) => card.levelLabel === '직접 선택'), true);
  assert.equal(cards.every((card) => card.isRunnable), true);
  assert.equal(cards.every((card) => card.sourceDiscoveryId === undefined), true);
});
