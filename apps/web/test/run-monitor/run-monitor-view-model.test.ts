import test from 'node:test';
import assert from 'node:assert/strict';

import type { RunReportProjection } from '../../src/entities/report';
import type { EvidencePacket, Run, RunLive } from '../../src/entities/run';
import {
  buildApiStepTimeline,
  buildApiSnapshotLogs,
  buildApiSnapshotSteps,
  canOpenRunReport,
  canRequestRunDelete,
  canRequestRunStop,
  findEvidenceScreenshotArtifact,
  getApiCheckpoint,
  getApiProgressPercent,
  getCheckpointArtifacts,
  getEvidenceArtifactLabel,
  getEvidenceObservationSummary,
  getFailureCodeLabel,
  getStatusTone,
  resolveRunMonitorReportCtaState,
  shouldRefreshRunReport,
  shouldRefreshRunLive,
} from '../../src/features/run-monitor';

const baseRun: Run = {
  id: '11111111-1111-4111-8111-111111111111',
  type: 'run',
  projectId: '22222222-2222-4222-8222-222222222222',
  name: '첫 화면 CTA 점검',
  triggerSource: 'WEB',
  startUrl: 'https://example.com/',
  goal: '첫 화면 CTA 점검',
  devicePreset: 'desktop',
  scenarioTemplateVersionId: '33333333-3333-4333-8333-333333333333',
  status: 'RUNNING',
  resultCompleteness: 'PARTIAL',
  analysisStatus: 'RUNNING',
  currentStepOrder: 4,
  startedAt: '2026-04-27T01:00:00.000Z',
  finishedAt: null,
  failureCode: null,
  failureMessage: null,
  latestSnapshot: null,
};

const baseLive: RunLive = {
  runId: baseRun.id,
  status: 'RUNNING',
  currentStepOrder: 4,
  currentAction: null,
  latestFrame: null,
};

const baseReport: RunReportProjection = {
  runId: baseRun.id,
  reportStatus: 'READY',
  analysisStatus: 'COMPLETED',
  analysisJobId: 'analysis-1',
  reportId: '55555555-5555-4555-8555-555555555555',
  title: '백엔드 리포트',
  format: 'JSON',
  status: 'READY',
  summary: {},
  decisionMap: [],
  findings: [],
  nudges: [],
  errorCode: null,
  errorMessage: null,
  createdAt: '2026-04-27T01:05:00.000Z',
  updatedAt: '2026-04-27T01:05:00.000Z',
};

test('run monitor view model refreshes only live statuses', () => {
  assert.equal(shouldRefreshRunLive('CREATED'), true);
  assert.equal(shouldRefreshRunLive('QUEUED'), true);
  assert.equal(shouldRefreshRunLive('STARTING'), true);
  assert.equal(shouldRefreshRunLive('RUNNING'), true);
  assert.equal(shouldRefreshRunLive('STOP_REQUESTED'), true);
  assert.equal(shouldRefreshRunLive('STOPPED'), false);
  assert.equal(shouldRefreshRunLive('COMPLETED'), false);
  assert.equal(shouldRefreshRunLive('FAILED'), false);
});

test('run monitor report refreshes while backend analysis is active', () => {
  assert.equal(shouldRefreshRunReport(null), false);
  assert.equal(shouldRefreshRunReport(baseReport), false);
  assert.equal(shouldRefreshRunReport({ ...baseReport, reportStatus: 'GENERATABLE', reportId: null, status: null }), false);
  assert.equal(shouldRefreshRunReport({ ...baseReport, reportStatus: 'NOT_READY', analysisStatus: 'NOT_STARTED', reportId: null, status: null }), false);
  assert.equal(shouldRefreshRunReport({ ...baseReport, reportStatus: 'NOT_READY', analysisStatus: 'QUEUED', reportId: null, status: null }), true);
  assert.equal(shouldRefreshRunReport({ ...baseReport, reportStatus: 'NOT_READY', analysisStatus: 'RUNNING', reportId: null, status: null }), true);
});

test('run monitor view model exposes lifecycle command availability by status', () => {
  assert.equal(canRequestRunStop('CREATED'), true);
  assert.equal(canRequestRunStop('QUEUED'), true);
  assert.equal(canRequestRunStop('STARTING'), true);
  assert.equal(canRequestRunStop('RUNNING'), true);
  assert.equal(canRequestRunStop('STOP_REQUESTED'), false);
  assert.equal(canRequestRunStop('COMPLETED'), false);

  assert.equal(canRequestRunDelete('COMPLETED'), true);
  assert.equal(canRequestRunDelete('FAILED'), true);
  assert.equal(canRequestRunDelete('STOPPED'), true);
  assert.equal(canRequestRunDelete('RUNNING'), false);
});

test('run monitor view model handles stop requested without falling back to fresh-run copy', () => {
  const live: RunLive = {
    ...baseLive,
    status: 'STOP_REQUESTED',
    currentStepOrder: 4,
  };

  assert.equal(getStatusTone(live.status), 'stopping');
  assert.equal(getApiProgressPercent(live), 56);
  assert.equal(getApiCheckpoint(live), '중지 요청을 처리 중입니다');

  const steps = buildApiSnapshotSteps(baseRun, live);
  const logs = buildApiSnapshotLogs(baseRun, live);

  assert.equal(steps[1].status, 'active');
  assert.equal(steps[1].detail, '중지 요청을 처리 중입니다');
  assert.equal(logs[1].tone, 'warning');
});

test('run monitor view model maps API run steps into a real timeline with failure details', () => {
  const steps = buildApiStepTimeline({ ...baseRun, status: 'FAILED', failureCode: 'RUNNER_TIMEOUT', failureMessage: 'navigation timed out' }, {
    ...baseLive,
    status: 'FAILED',
    currentStepOrder: 2,
  }, [
    {
      id: 'step-2',
      runId: baseRun.id,
      stepOrder: 2,
      stepKey: 'step_002_submit',
      stepName: 'CTA 제출',
      stepType: 'CLICK',
      status: 'FAILED',
      startedAt: '2026-04-27T01:01:00.000Z',
      finishedAt: '2026-04-27T01:01:03.000Z',
      errorCode: 'RUNNER_TIMEOUT',
      errorMessage: 'locator click timed out',
    },
    {
      id: 'step-1',
      runId: baseRun.id,
      stepOrder: 1,
      stepKey: 'step_001_goto',
      stepName: '첫 화면 로드',
      stepType: 'GOTO',
      status: 'PASSED',
      startedAt: '2026-04-27T01:00:00.000Z',
      finishedAt: '2026-04-27T01:00:02.000Z',
      errorCode: null,
      errorMessage: null,
    },
  ]);

  assert.deepEqual(steps.map((step) => step.id), ['step-1', 'step-2']);
  assert.equal(steps[0].status, 'complete');
  assert.equal(steps[1].status, 'failed');
  assert.equal(steps[1].label, '2. CTA 제출');
  assert.equal(steps[1].detail, '시간 초과: locator click timed out');
  assert.equal(getFailureCodeLabel('RUNNER_TIMEOUT'), '시간 초과');
});

test('run monitor view model falls back to snapshot steps when API steps are not available', () => {
  const steps = buildApiStepTimeline(baseRun, baseLive, []);

  assert.deepEqual(
    steps.map((step) => step.id),
    buildApiSnapshotSteps(baseRun, baseLive).map((step) => step.id),
  );
});

const evidencePacket: EvidencePacket = {
  schema_version: '0.1.0',
  execution_type: 'RUN',
  run_id: baseRun.id,
  discovery_id: null,
  url: baseRun.startUrl,
  final_url: baseRun.startUrl,
  scenario: {},
  environment: {},
  checkpoints: [
    {
      checkpoint_id: 'checkpoint-1',
      step_id: 'step-1',
      primaryStage: 'hero',
      trigger: {},
      settle: { status: 'settled' },
      state: {},
      observations: [
        {
          observation_id: 'observation-1',
          type: 'click_target',
          stage: 'hero',
          source: ['dom'],
          data: { target: '시작하기 버튼', text: '가입하기', message: 'CTA 확인', field_key: 'cta' },
          confidence: 0.92,
        },
      ],
      deltas: [],
      artifact_refs: ['artifact:screenshot-1', 'dom-1'],
    },
  ],
  aggregate_signals: {},
  scenario_fit: null,
  artifacts: [
    {
      artifact_id: 'screenshot-1',
      type: 'screenshot',
      uri: '/api/runs/111/artifacts/screenshot-1/content',
      mime_type: 'image/png',
      size_bytes: 1024,
      metadata: {},
    },
    {
      artifact_id: 'dom-1',
      type: 'dom_snapshot',
      uri: '/api/runs/111/artifacts/dom-1/content',
      mime_type: 'text/html',
      size_bytes: 2048,
      metadata: {},
    },
  ],
  collection_notes: [],
};

test('run monitor view model maps evidence packet artifacts and observations', () => {
  const screenshot = findEvidenceScreenshotArtifact(evidencePacket);
  assert.equal(screenshot?.artifact_id, 'screenshot-1');
  assert.equal(getEvidenceArtifactLabel(evidencePacket.artifacts[0]), '스크린샷');
  assert.equal(getEvidenceArtifactLabel(evidencePacket.artifacts[1]), 'DOM 스냅샷');
  assert.equal(getEvidenceArtifactLabel({ ...evidencePacket.artifacts[1], type: 'unknown_type' }), 'unknown_type');

  const checkpointArtifacts = getCheckpointArtifacts(evidencePacket.checkpoints[0], evidencePacket.artifacts);
  assert.deepEqual(
    checkpointArtifacts.map((artifact) => artifact.artifact_id),
    ['screenshot-1', 'dom-1'],
  );

  assert.equal(getEvidenceObservationSummary(evidencePacket.checkpoints[0].observations[0]), '시작하기 버튼');
  assert.equal(
    getEvidenceObservationSummary({
      observation_id: 'observation-2',
      type: 'fallback_type',
      stage: 'form',
      source: ['runner'],
      data: { target: '   ', text: ' 대체 문구 ' },
    }),
    '대체 문구',
  );
  assert.equal(
    getEvidenceObservationSummary({
      observation_id: 'observation-3',
      type: 'fallback_type',
      stage: 'form',
      source: ['runner'],
      data: {},
    }),
    'fallback_type',
  );
});


test('run report CTA opens for mock runs or completed real runs with evidence checkpoints', () => {
  assert.equal(canOpenRunReport(true), true);
  assert.equal(canOpenRunReport(false), false);
  assert.equal(canOpenRunReport(false, baseRun, evidencePacket), false);
  assert.equal(canOpenRunReport(false, { ...baseRun, status: 'COMPLETED' }, evidencePacket), true);
});

test('run monitor report CTA state follows backend report readiness', () => {
  assert.deepEqual(
    resolveRunMonitorReportCtaState({
      isMockRun: true,
      report: null,
      isLoading: false,
      errorMessage: '',
    }),
    {
      kind: 'open',
      canOpenReport: true,
      titleLabel: '리포트 준비 완료',
      eyebrow: '다음 화면',
      message: '수집된 근거를 바탕으로 발견된 신호와 개선안을 확인합니다.',
    },
  );

  assert.equal(resolveRunMonitorReportCtaState({
    isMockRun: false,
    report: baseReport,
    isLoading: false,
    errorMessage: '',
  }).kind, 'open');

  assert.equal(resolveRunMonitorReportCtaState({
    isMockRun: false,
    report: { ...baseReport, reportStatus: 'GENERATABLE', reportId: null, status: null },
    isLoading: false,
    errorMessage: '',
  }).kind, 'generate');

  assert.equal(resolveRunMonitorReportCtaState({
    isMockRun: false,
    report: { ...baseReport, reportStatus: 'NOT_READY', analysisStatus: 'NOT_STARTED', reportId: null, status: null },
    isLoading: false,
    errorMessage: '',
  }).kind, 'request-analysis');

  assert.equal(resolveRunMonitorReportCtaState({
    isMockRun: false,
    report: { ...baseReport, reportStatus: 'NOT_READY', analysisStatus: 'RUNNING', reportId: null, status: null },
    isLoading: false,
    errorMessage: '',
  }).kind, 'waiting');

  assert.equal(resolveRunMonitorReportCtaState({
    isMockRun: false,
    report: { ...baseReport, reportStatus: 'FAILED', errorMessage: 'report failed' },
    isLoading: false,
    errorMessage: '',
  }).message, 'report failed');

  assert.equal(resolveRunMonitorReportCtaState({
    isMockRun: false,
    report: null,
    isLoading: false,
    errorMessage: '리포트 상태 오류',
  }).kind, 'error');
});
