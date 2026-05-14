import test from 'node:test';
import assert from 'node:assert/strict';

import { nextPinnedReferenceBadgeId, referenceBadgesForFinding } from '../../src/features/report-viewer/lib/runReportReferences';
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
    label: 'WCAG 3.3.2',
    publisher: 'W3C',
    title: 'Labels or Instructions',
    basisSummary: 'Inputs need labels or instructions.',
    ariaLabel: 'WCAG 3.3.2 기준 근거: W3C Labels or Instructions. Inputs need labels or instructions.',
    isFallback: false,
  }]);
});

test('reference badges fall back to preparing copy when a rule has no external reference yet', () => {
  const badges = referenceBadgesForFinding(findingWithReferences([]));

  assert.deepEqual(badges, [{
    key: 'reference-pending',
    label: '근거 준비중',
    publisher: '외부 기준 배지 준비중',
    title: '분석 근거는 리포트 내용에 포함되어 있습니다',
    basisSummary: '이 항목의 외부 기준 배지는 아직 연결 준비 중입니다.',
    ariaLabel: '근거 준비중: 외부 기준 배지 준비중. 이 항목의 외부 기준 배지는 아직 연결 준비 중입니다.',
    isFallback: true,
  }]);
});

test('reference badges fall back when the recommendation is not linked to a finding', () => {
  const badges = referenceBadgesForFinding(null);

  assert.equal(badges[0].label, '근거 준비중');
  assert.equal(badges[0].isFallback, true);
});

test('reference badge click state toggles the selected badge and switches to another badge', () => {
  assert.equal(nextPinnedReferenceBadgeId(null, 'recommendation-1:WCAG 3.3.2'), 'recommendation-1:WCAG 3.3.2');
  assert.equal(nextPinnedReferenceBadgeId('recommendation-1:WCAG 3.3.2', 'recommendation-1:WCAG 3.3.2'), null);
  assert.equal(
    nextPinnedReferenceBadgeId('recommendation-1:WCAG 3.3.2', 'recommendation-2:reference-pending'),
    'recommendation-2:reference-pending',
  );
});
