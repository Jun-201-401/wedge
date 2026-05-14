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
  assert.equal(card.evidence, '문의나 신청으로 이어지는 링크를 발견했어요');
  assert.deepEqual(card.signalLabels, ['문의나 신청으로 이어지는 링크를 발견했어요']);
  assert.equal(card.targetLabel, 'Book a demo');
  assert.deepEqual(card.previewSteps, [
    '추천 시작 화면을 열어요',
    '"Book a demo" 버튼이나 링크를 따라가요',
    '제출 직전까지 이동하며 막히는 지점을 기록해요',
  ]);
  assert.equal(card.isRunnable, true);
  assert.equal(card.actionLabel, '이 흐름으로 시작하기');
  assert.equal(card.sourceDiscoveryId, undefined);
  assert.deepEqual(card.evidenceRefs, ['cp_001.obs_003']);
  assert.deepEqual(card.suggestedTarget, { text: 'Book a demo' });
});

test('discovery recommendation mapper shortens long href labels for cards', () => {
  const card = toScenarioRecommendationViewModel({
    ...contactRecommendation,
    evidenceSummary: {
      matched_signals: [{
        signal_id: 'sig_href',
        source: 'href',
        signal_type: 'pricing_keyword',
        value: 'https://in.naver.com/pland/contents/internal/950698252839936?campaign=very-long-campaign-value',
        evidence_ref: 'cp_001.obs_004',
        weight: 0.3,
      }],
      missing_signals: [],
      limitations: [],
    },
    suggestedTarget: {
      href: 'https://in.naver.com/pland/contents/internal/950698252839936?campaign=very-long-campaign-value',
    },
  });

  assert.equal(card.signalLabels[0], '가격이나 요금제 관련 진입점을 발견했어요');
  assert.match(card.targetLabel ?? '', /^in\.naver\.com\/pland\/contents\/.+\?…$/);
  assert.ok((card.targetLabel ?? '').length <= 46);
  assert.deepEqual(card.previewSteps, [
    '추천 시작 화면을 열어요',
    '추천 링크를 따라가요',
    '제출 직전까지 이동하며 막히는 지점을 기록해요',
  ]);
});

test('discovery recommendation mapper shortens long text targets for preview copy', () => {
  const card = toScenarioRecommendationViewModel({
    ...contactRecommendation,
    suggestedTarget: {
      text: '2026 큰별쌤 최태성의 별별한국사 기출 500제 한국사능력검정시험 심화(1,2,3급) 최태성 이투스북',
    },
  });

  assert.equal(card.targetLabel, '2026 큰별쌤 최태성의 별별한국사 기출 500제 한국사능력검…');
  assert.ok((card.targetLabel ?? '').length <= 35);
  assert.deepEqual(card.previewSteps, [
    '추천 시작 화면을 열어요',
    '"2026 큰별쌤 최태성의 별별한국사 기출 500제 한국사능력검…" 버튼이나 링크를 따라가요',
    '제출 직전까지 이동하며 막히는 지점을 기록해요',
  ]);
});

test('discovery recommendation mapper normalizes relative targets into concise labels', () => {
  const renaultUrl = 'https://www.renault.co.kr/ko/event/260509K/testdrive/app_testdrive.jsp?bannerUrl=a_navertd_KOLEOS_ETECH_SALES_A_26-05_&bannerSeq=1&utm_medium=display&utm_source=navertd&utm_campaign=kr-r-l-newcar-koleos-etech-05-2026-os-naver-dis-na-26-05';
  const card = toScenarioRecommendationViewModel({
    ...contactRecommendation,
    evidenceSummary: {
      matched_signals: [{
        signal_id: 'sig_relative_href',
        source: 'href',
        signal_type: 'contact_url',
        value: '/ko/event/260509K/testdrive/app_testdrive.jsp?bannerUrl=a_navertd_KOLEOS_ETECH_SALES_A_26-05_&bannerSeq=1&utm_medium=display',
        evidence_ref: 'cp_001.obs_005',
        weight: 0.3,
      }],
      missing_signals: [],
      limitations: ['image_text_ocr_not_performed', 'authenticated_pages_not_explored'],
    },
    suggestedStartUrl: renaultUrl,
    suggestedTarget: {
      href: '/ko/event/260509K/testdrive/app_testdrive.jsp?bannerUrl=a_navertd_KOLEOS_ETECH_SALES_A_26-05_&bannerSeq=1&utm_medium=display',
    },
  });

  assert.equal(card.signalLabels[0], '문의나 신청으로 이어지는 링크를 발견했어요');
  assert.match(card.targetLabel ?? '', /^renault\.co\.kr\/ko\/event\/260509K\//);
  assert.match(card.targetLabel ?? '', /\?…$/);
  assert.doesNotMatch(card.targetLabel ?? '', /utm_medium=display/);
  assert.ok((card.targetLabel ?? '').length <= 46);
  assert.deepEqual(card.previewSteps, [
    '추천 시작 화면을 열어요',
    '추천 링크를 따라가요',
    '제출 직전까지 이동하며 막히는 지점을 기록해요',
  ]);
});

test('discovery recommendation mapper hides internal selectors and evidence ids from user copy', () => {
  const card = toScenarioRecommendationViewModel({
    ...contactRecommendation,
    scenarioType: 'PURCHASE_CHECKOUT',
    evidenceRefs: ['cp_001.obs_001', 'cp_001.obs_002', 'cp_001.obs_003'],
    evidenceSummary: {
      matched_signals: [],
      missing_signals: [],
      limitations: [],
    },
    suggestedTarget: {
      selector: '.A8SBwf{margin:0 auto;max-width:58rem}',
      text: '.A8SBwf{margin:0 auto;max-width:58rem}',
    },
  });

  assert.equal(card.targetLabel, null);
  assert.equal(card.evidence, '구매나 결제로 이어지는 진입점을 발견했어요');
  assert.doesNotMatch(card.evidence, /cp_001/);
  assert.deepEqual(card.previewSteps, [
    '추천 시작 화면을 열어요',
    '구매/결제 전 단계까지 확인',
    '제출 직전까지 이동하며 막히는 지점을 기록해요',
  ]);
  assert.equal(card.previewSteps.some((step) => step.includes('.A8SBwf')), false);
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
    projectId: '8f06dca8-9c4d-4f20-b1a8-1d5ee40a9923',
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
    projectId: '8f06dca8-9c4d-4f20-b1a8-1d5ee40a9923',
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
  assert.equal(cards[0].title, '랜딩 전환 버튼 점검');
  assert.equal(cards[0].summary, '첫 화면의 가입, 체험, 문의 버튼 흐름을 확인해요.');
  assert.doesNotMatch(cards[0].summary, /CTA/);
  assert.equal(cards.every((card) => card.isRunnable), true);
});

test('manual scenario mapper exposes non-detected flows as direct choices', () => {
  const cards = toManualScenarioRecommendationViewModels(['landing-cta', 'pricing']);

  assert.deepEqual(cards.map((card) => card.id), ['signup-form', 'contact', 'checkout']);
  assert.equal(cards.every((card) => card.levelLabel === '직접 선택'), true);
  assert.equal(cards.every((card) => card.isRunnable), true);
  assert.equal(cards.every((card) => card.sourceDiscoveryId === undefined), true);
});
