import test from 'node:test';
import assert from 'node:assert/strict';

import type { ReportDetail, RunReportProjection } from '../../src/entities/report';
import type { Run } from '../../src/entities/run';
import { buildRunReportFromApi } from '../../src/features/report-viewer/lib/runReportFromApi';

const completedRun: Run = {
  id: '11111111-1111-4111-8111-111111111111',
  type: 'run',
  projectId: '22222222-2222-4222-8222-222222222222',
  name: '첫 화면 CTA 점검',
  triggerSource: 'WEB',
  startUrl: 'https://example.com/',
  goal: '첫 화면 CTA 점검',
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

const reportDetail: ReportDetail = {
  id: '55555555-5555-4555-8555-555555555555',
  runId: completedRun.id,
  analysisJobId: '44444444-4444-4444-8444-444444444444',
  title: '백엔드 리포트',
  format: 'JSON',
  status: 'READY',
  frictionScore: 81,
  summary: readyReport.summary,
  decisionMap: [{
    stage: 'CTA',
    displayName: '행동 선택',
    status: 'WARNING',
    issueIds: ['detail-finding-1'],
    summary: 'CTA 문맥이 부족합니다.',
    evidenceRefs: ['cp-detail.obs-1'],
  }],
  initialDisplayCount: 3,
  findings: [{
    id: 'detail-finding-1',
    rank: 1,
    title: '상세 CTA 문맥 부족',
    summary: '상세 응답 기준으로 사용자가 다음 행동을 확신하기 어렵습니다.',
    category: 'friction',
    stage: 'CTA',
    axis: 'Friction',
    severity: 3,
    confidence: 0.93,
    priorityScore: 98,
    impactHypothesis: 'CTA 근처에 신뢰 문구를 추가하세요.',
    evidenceRefs: [{ ref: 'cp-detail.obs-1' }],
    previewImage: {
      artifact: {
        id: '66666666-6666-4666-8666-666666666666',
        runId: completedRun.id,
        stepId: null,
        stepKey: 'hero',
        artifactType: 'SCREENSHOT',
        bucket: 'wedge-artifacts',
        key: 'runs/report/hero.png',
        mimeType: 'image/png',
        width: 1440,
        height: 900,
        sizeBytes: 1024,
        sha256: null,
        url: null,
        contentUrl: `/api/runs/${completedRun.id}/artifacts/66666666-6666-4666-8666-666666666666/content`,
        createdAt: '2026-04-27T01:02:30.000Z',
      },
      source: 'STAGE_SCREENSHOT',
    },
    nudges: [{
      id: 'detail-nudge-1',
      rank: 1,
      title: '상세 CTA 보조 문구 추가',
      rationale: '사용자가 클릭 후 결과를 이해해야 합니다.',
      recommendation: '상세 CTA 아래에 기대 결과를 한 문장으로 설명하세요.',
      difficulty: 'Low',
      expectedEffect: '전환 판단 근거 강화',
      validationQuestion: null,
    }],
  }],
  createdAt: '2026-04-27T01:02:00.000Z',
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

test('buildRunReportFromApi prefers report detail finding preview image when available', () => {
  const report = buildRunReportFromApi({
    run: completedRun,
    report: readyReport,
    detail: reportDetail,
    scenarioId: 'landing-cta',
  });

  assert.equal(report.evidencePreviewUrl, reportDetail.findings[0].previewImage?.artifact.contentUrl);
  assert.equal(report.findings[0].id, 'detail-finding-1');
  assert.equal(report.findings[0].title, '상세 CTA 문맥 부족');
  assert.equal(report.findings[0].evidenceRefs[0], 'cp-detail.obs-1');
  assert.equal(report.recommendations[0].detail, '상세 CTA 아래에 기대 결과를 한 문장으로 설명하세요.');
});
