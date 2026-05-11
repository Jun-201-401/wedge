import test from 'node:test';
import assert from 'node:assert/strict';

import type { RunReportProjection } from '../../src/entities/report';
import type { Run } from '../../src/entities/run';
import { resolveRunReportState } from '../../src/pages/run-report/lib/runReportState';

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
  analysisStatus: 'NOT_STARTED',
  currentStepOrder: 12,
  startedAt: '2026-04-27T01:00:00.000Z',
  finishedAt: '2026-04-27T01:01:24.000Z',
  failureCode: null,
  failureMessage: null,
  latestSnapshot: null,
};

const baseReport: RunReportProjection = {
  runId: completedRun.id,
  reportStatus: 'READY',
  analysisStatus: 'COMPLETED',
  analysisJobId: '44444444-4444-4444-8444-444444444444',
  reportId: '55555555-5555-4555-8555-555555555555',
  title: 'Wedge Report',
  format: 'JSON',
  status: 'READY',
  summary: {},
  decisionMap: [],
  findings: [],
  nudges: [],
  errorCode: null,
  errorMessage: null,
  createdAt: '2026-04-27T01:02:00.000Z',
  updatedAt: '2026-04-27T01:02:00.000Z',
};

test('resolveRunReportState renders mock reports without calling real API readiness states', () => {
  assert.deepEqual(resolveRunReportState({
    isMockRun: true,
    isRunLoading: false,
    runLoadError: '',
    run: null,
  }), { kind: 'ready' });
});

test('resolveRunReportState exposes loading and error states for real runs', () => {
  assert.equal(resolveRunReportState({
    isMockRun: false,
    isRunLoading: true,
    runLoadError: '',
    run: null,
  }).kind, 'loading');

  const errorState = resolveRunReportState({
    isMockRun: false,
    isRunLoading: false,
    runLoadError: '접근 권한 없음',
    run: null,
  });

  assert.equal(errorState.kind, 'error');
  assert.equal(errorState.message, '접근 권한 없음');
});

test('resolveRunReportState treats missing real run data as an error', () => {
  const missingRun = resolveRunReportState({
    isMockRun: false,
    isRunLoading: false,
    runLoadError: '',
    run: null,
  });

  assert.equal(missingRun.kind, 'error');
  assert.equal(missingRun.title, '실행 결과를 찾을 수 없습니다');
});

test('resolveRunReportState blocks incomplete real runs and completed real runs without evidence data', () => {
  const notReady = resolveRunReportState({
    isMockRun: false,
    isRunLoading: false,
    runLoadError: '',
    run: { ...completedRun, status: 'RUNNING', analysisStatus: 'RUNNING' },
  });

  assert.equal(notReady.kind, 'not-ready');
  assert.match(notReady.message, /실행 중/);

  assert.equal(resolveRunReportState({
    isMockRun: false,
    isRunLoading: false,
    runLoadError: '',
    run: completedRun,
  }).kind, 'api-pending');

  assert.equal(resolveRunReportState({
    isMockRun: false,
    isRunLoading: false,
    runLoadError: '',
    run: completedRun,
    evidencePacket: { checkpoints: [{ checkpoint_id: 'cp-1', primaryStage: 'CTA', trigger: {}, settle: {}, state: {}, observations: [], deltas: [], artifact_refs: [] }], artifacts: [] },
  }).kind, 'ready');
});

test('resolveRunReportState uses backend report readiness before evidence fallback', () => {
  assert.equal(resolveRunReportState({
    isMockRun: false,
    isRunLoading: false,
    runLoadError: '',
    run: completedRun,
    report: baseReport,
  }).kind, 'ready');

  const generatable = resolveRunReportState({
    isMockRun: false,
    isRunLoading: false,
    runLoadError: '',
    run: completedRun,
    report: { ...baseReport, reportStatus: 'GENERATABLE', reportId: null, status: null },
  });
  assert.equal(generatable.kind, 'api-pending');
  assert.equal(generatable.message, '분석이 완료됐습니다. 리포트를 생성해주세요.');

  const notReady = resolveRunReportState({
    isMockRun: false,
    isRunLoading: false,
    runLoadError: '',
    run: completedRun,
    report: { ...baseReport, reportStatus: 'NOT_READY', analysisStatus: 'NOT_STARTED', reportId: null, status: null },
  });
  assert.equal(notReady.kind, 'api-pending');
  assert.match(notReady.message, /아직 분석이 시작되지 않았습니다/);

  const failed = resolveRunReportState({
    isMockRun: false,
    isRunLoading: false,
    runLoadError: '',
    run: completedRun,
    report: { ...baseReport, reportStatus: 'FAILED', errorMessage: 'report failed' },
  });
  assert.equal(failed.kind, 'error');
  assert.equal(failed.message, 'report failed');
});
