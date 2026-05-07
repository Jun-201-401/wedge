import test from 'node:test';
import assert from 'node:assert/strict';

import type { RunReportProjection } from '../../src/entities/report';
import type { Run } from '../../src/entities/run';
import { buildRunReportFromApi } from '../../src/features/report-viewer/lib/runReportFromApi';

const completedRun: Run = {
  id: '11111111-1111-4111-8111-111111111111',
  type: 'run',
  projectId: '22222222-2222-4222-8222-222222222222',
  name: '랜딩 전환 CTA 점검',
  triggerSource: 'WEB',
  startUrl: 'https://example.com/',
  goal: '랜딩 전환 CTA 점검',
  devicePreset: 'desktop',
  scenarioTemplateVersionId: '33333333-3333-4333-8333-333333333333',
  status: 'COMPLETED',
  resultCompleteness: 'FINAL',
  analysisStatus: 'COMPLETED',
  currentStepOrder: 3,
  startedAt: '2026-04-27T01:00:00.000Z',
  finishedAt: '2026-04-27T01:01:24.000Z',
  failureCode: null,
  failureMessage: null,
  latestSnapshot: null,
};

const readyReport: RunReportProjection = {
  runId: completedRun.id,
  reportStatus: 'READY',
  analysisStatus: 'COMPLETED',
  analysisJobId: '44444444-4444-4444-8444-444444444444',
  reportId: '55555555-5555-4555-8555-555555555555',
  title: '백엔드 리포트',
  format: 'JSON',
  status: 'READY',
  summary: {
    friction_score: 81,
    targetUrl: 'https://example.com/pricing',
    primary_cta: 'Start now',
    summary: 'CTA 결정 지점에 마찰이 있습니다.',
  },
  decisionMap: [{
    stage: 'CTA',
    displayName: '행동 선택',
    status: 'WARNING',
    issueIds: ['finding-1'],
    summary: 'CTA 문맥이 부족합니다.',
    evidenceRefs: ['cp-1.obs-1'],
  }],
  findings: [{
    id: 'finding-1',
    rankOrder: 1,
    title: 'CTA 문맥 부족',
    summary: '사용자가 다음 행동을 확신하기 어렵습니다.',
    category: 'friction',
    stage: 'CTA',
    axis: 'Friction',
    severity: 3,
    confidence: 0.91,
    priorityScore: 94,
    impactHypothesis: 'CTA 근처에 신뢰 문구를 추가하세요.',
    evidenceRefs: [{ checkpointId: 'cp-1', observationId: 'obs-1' }],
  }],
  nudges: [{
    id: 'nudge-1',
    findingId: 'finding-1',
    rankOrder: 1,
    title: 'CTA 보조 문구 추가',
    rationale: '사용자가 클릭 후 결과를 이해해야 합니다.',
    recommendation: 'CTA 아래에 기대 결과를 한 문장으로 설명하세요.',
    difficulty: 'Low',
    expectedEffect: '전환 판단 근거 강화',
    validationQuestion: null,
  }],
  errorCode: null,
  errorMessage: null,
  createdAt: '2026-04-27T01:02:00.000Z',
  updatedAt: '2026-04-27T01:03:00.000Z',
};

test('buildRunReportFromApi projects backend report data into report view model', () => {
  const report = buildRunReportFromApi({ run: completedRun, report: readyReport, scenarioId: 'landing-cta' });

  assert.equal(report.runId, completedRun.id);
  assert.equal(report.reportId, readyReport.reportId);
  assert.equal(report.targetUrl, 'https://example.com/pricing');
  assert.equal(report.score, 81);
  assert.equal(report.heroTitle, '백엔드 리포트');
  assert.equal(report.heroCallToAction, 'Start now');
  assert.equal(report.decisionNodes[0].tone, 'friction');
  assert.equal(report.findings[0].severity, 'high');
  assert.equal(report.findings[0].evidenceRefs[0], 'cp-1');
  assert.equal(report.recommendations[0].detail, 'CTA 아래에 기대 결과를 한 문장으로 설명하세요.');
});
