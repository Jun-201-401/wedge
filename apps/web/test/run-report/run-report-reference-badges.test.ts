import test from 'node:test';
import assert from 'node:assert/strict';

import {
  nextPinnedReferenceBadgeId,
  nextPinnedReferenceOverflowId,
  referenceBadgesForFinding,
  splitReferenceBadges,
} from '../../src/features/report-viewer/lib/runReportReferences';
import type { ReportFinding } from '../../src/features/report-viewer/lib/runReportViewModel';

function findingWithReferences(references: ReportFinding['references']): ReportFinding {
  return {
    id: 'finding-1',
    order: 1,
    severity: 'medium',
    issueId: 'ISSUE-1',
    stage: '입력',
    title: '입력 필드의 목적을 알기 어렵습니다',
    summary: '라벨 또는 안내가 부족합니다.',
    evidenceLabel: '입력 단계 근거 1개',
    evidenceCount: 1,
    confidence: 0.8,
    priorityScore: 82,
    evidenceRefs: ['cp_001.obs_001'],
    references,
    recommendation: '입력 필드 근처에 명확한 라벨을 둡니다.',
    highlight: null,
  };
}

function reference(label: string, publisher?: string): NonNullable<ReportFinding['references']>[number] {
  return {
    label,
    publisher: publisher ?? label,
    title: `${label} title`,
    basisSummary: `${label} summary`,
    url: `https://example.com/${label.toLowerCase()}`,
  };
}

test('reference badges expose Analyzer provided reference labels and tooltip copy', () => {
  const badges = referenceBadgesForFinding(findingWithReferences([{
    label: 'WCAG 3.3.2',
    publisher: 'W3C',
    title: 'Labels or Instructions',
    basisSummary: 'Inputs need labels or instructions.',
    url: 'https://www.w3.org/WAI/WCAG22/Understanding/labels-or-instructions.html',
  }]));

  assert.deepEqual(badges, [{
    key: 'WCAG 3.3.2:https://www.w3.org/WAI/WCAG22/Understanding/labels-or-instructions.html',
    label: '[W3C]',
    publisher: 'W3C',
    title: 'Labels or Instructions',
    basisSummary: 'Inputs need labels or instructions.',
    ariaLabel: 'WCAG 3.3.2 기준 근거: W3C Labels or Instructions. Inputs need labels or instructions.',
  }]);
});

test('reference badges show five preview source labels when a rule has no external reference yet', () => {
  const badges = referenceBadgesForFinding(findingWithReferences([]));
  const split = splitReferenceBadges(badges);

  assert.deepEqual(split.visible.map((badge) => badge.label), []);
  assert.deepEqual(split.overflow.map((badge) => badge.label), ['[출처1]', '[출처2]', '[출처3]', '[출처4]', '[출처5]']);
});

test('reference badges show five preview source labels when the recommendation is not linked to a finding', () => {
  const badges = referenceBadgesForFinding(null);
  const split = splitReferenceBadges(badges);

  assert.deepEqual(split.visible.map((badge) => badge.label), []);
  assert.deepEqual(split.overflow.map((badge) => badge.label), ['[출처1]', '[출처2]', '[출처3]', '[출처4]', '[출처5]']);
});

test('reference badges keep all publishers inside the overflow references list', () => {
  const badges = referenceBadgesForFinding(findingWithReferences([
    reference('WCAG 3.3.2', 'W3C'),
    reference('GOV.UK Buttons', 'GOV.UK'),
    reference('NN/g Forms', 'NN/g'),
    reference('Apple HIG', 'Apple'),
    reference('ISO 9241', 'ISO'),
  ]));

  const split = splitReferenceBadges(badges);

  assert.deepEqual(split.visible.map((badge) => badge.publisher), []);
  assert.deepEqual(split.overflow.map((badge) => badge.publisher), ['W3C', 'GOV.UK', 'NN/g', 'Apple', 'ISO']);
});

test('reference badges use numbered source labels when publisher is missing', () => {
  const badges = referenceBadgesForFinding(findingWithReferences([
    reference('Reference 1', ''),
    reference('Reference 2', '   '),
    { ...reference('Reference 3'), publisher: undefined as unknown as string },
    reference('Reference 4', ''),
    reference('Reference 5', ''),
  ]));

  const split = splitReferenceBadges(badges);

  assert.deepEqual(split.visible.map((badge) => badge.label), []);
  assert.deepEqual(split.overflow.map((badge) => badge.label), ['[출처1]', '[출처2]', '[출처3]', '[출처4]', '[출처5]']);
});

test('reference badge click state toggles the selected badge and switches to another badge', () => {
  assert.equal(nextPinnedReferenceBadgeId(null, 'recommendation-1:WCAG 3.3.2'), 'recommendation-1:WCAG 3.3.2');
  assert.equal(nextPinnedReferenceBadgeId('recommendation-1:WCAG 3.3.2', 'recommendation-1:WCAG 3.3.2'), null);
  assert.equal(
    nextPinnedReferenceBadgeId('recommendation-1:WCAG 3.3.2', 'recommendation-2:GOV.UK Buttons'),
    'recommendation-2:GOV.UK Buttons',
  );
});

test('reference overflow click state toggles the selected overflow list', () => {
  assert.equal(nextPinnedReferenceOverflowId(null, 'recommendation-1:references-overflow'), 'recommendation-1:references-overflow');
  assert.equal(nextPinnedReferenceOverflowId('recommendation-1:references-overflow', 'recommendation-1:references-overflow'), null);
  assert.equal(
    nextPinnedReferenceOverflowId('recommendation-1:references-overflow', 'recommendation-2:references-overflow'),
    'recommendation-2:references-overflow',
  );
});
