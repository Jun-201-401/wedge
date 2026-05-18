import test from 'node:test';
import assert from 'node:assert/strict';

import type { RunReportProjection } from '../../src/entities/report';
import type { EvidencePacket, Run, RunEvent, RunLive, RunStep } from '../../src/entities/run';
import {
  buildApiEventLogs,
  buildApiEventTimeline,
  buildApiStepTimeline,
  buildApiSnapshotLogs,
  buildApiSnapshotSteps,
  buildRunCollectionSummaryStats,
  canOpenRunReport,
  canRequestRunDelete,
  canRequestRunStop,
  findEvidenceScreenshotArtifact,
  getApiCheckpoint,
  getApiProgressPercent,
  getCheckpointArtifacts,
  getCurrentRunReportProjection,
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
  name: '랜딩 전환 행동 점검',
  triggerSource: 'WEB',
  startUrl: 'https://example.com/',
  goal: '랜딩 전환 행동 점검',
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

test('run monitor report projection is scoped to the current run', () => {
  const staleGeneratableReport: RunReportProjection = {
    ...baseReport,
    runId: '99999999-9999-4999-8999-999999999999',
    reportStatus: 'GENERATABLE',
    reportId: null,
    status: null,
  };

  assert.equal(getCurrentRunReportProjection(staleGeneratableReport, baseRun.id), null);
  assert.equal(getCurrentRunReportProjection(staleGeneratableReport, staleGeneratableReport.runId), staleGeneratableReport);
  assert.equal(shouldRefreshRunReport(getCurrentRunReportProjection(staleGeneratableReport, baseRun.id)), false);
  assert.equal(
    resolveRunMonitorReportCtaState({
      isMockRun: false,
      report: getCurrentRunReportProjection(staleGeneratableReport, baseRun.id),
      isLoading: true,
      errorMessage: '',
    }).kind,
    'loading',
  );
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

test('run monitor view model presents stopped runs as bounded completion, not failure', () => {
  const live: RunLive = {
    ...baseLive,
    status: 'STOPPED',
    currentStepOrder: 3,
  };

  assert.equal(getStatusTone(live.status), 'stopping');
  assert.equal(getApiProgressPercent(live), 100);
  assert.equal(getApiCheckpoint(live), '가능한 범위의 근거 수집을 마쳤습니다');

  const steps = buildApiSnapshotSteps({ ...baseRun, status: 'STOPPED' }, live);

  assert.equal(steps[0].status, 'complete');
  assert.equal(steps[1].status, 'complete');
  assert.equal(steps[1].detail, '가능한 범위의 근거 수집을 마쳤습니다');
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
  assert.equal(steps[1].label, 'CTA 제출');
  assert.equal(steps[1].detail, '응답이 지연되어 확인이 막혔습니다.');
  assert.equal(getFailureCodeLabel('RUNNER_TIMEOUT'), '시간 초과');
  assert.equal(getFailureCodeLabel('RUN_START_FAILED'), '시작 실패');
  assert.equal(getFailureCodeLabel('RUN_REQUEST_FAILED'), '요청 실패');
  assert.equal(getFailureCodeLabel('RUNNER_EXECUTION_FAILED'), '진행 실패');
});


test('run monitor view model prefers API run events for timeline and logs', () => {
  const events: RunEvent[] = [
    {
      id: 'event-2',
      runId: baseRun.id,
      stepId: 'step-2',
      stepKey: 'step_002_submit',
      eventType: 'STEP_FAILED',
      eventSource: 'RUNNER',
      payload: {
        failureCode: 'RUNNER_TIMEOUT',
        failureMessage: 'locator click timed out',
      },
      occurredAt: '2026-04-27T01:01:03.000Z',
    },
    {
      id: 'event-1',
      runId: baseRun.id,
      stepId: 'step-1',
      stepKey: 'step_001_goto',
      eventType: 'STEP_STARTED',
      eventSource: 'RUNNER',
      payload: {
        description: '첫 화면 로드',
        stage: 'FIRST_VIEW',
      },
      occurredAt: '2026-04-27T01:00:00.000Z',
    },
    {
      id: 'event-3',
      runId: baseRun.id,
      stepId: 'step-1',
      stepKey: 'step_001_goto',
      eventType: 'ACTION_EXECUTED',
      eventSource: 'RUNNER',
      payload: {
        actionType: 'click',
        target: 'selector=#primary-cta',
        details: {
          clickedText: '무료로 시작하기',
        },
      },
      occurredAt: '2026-04-27T01:00:30.000Z',
    },
  ];
  const steps: RunStep[] = [
    {
      id: 'step-1',
      runId: baseRun.id,
      stepOrder: 1,
      stepKey: 'step_001_goto',
      stepName: '첫 화면 로드',
      stepType: 'GOTO',
      status: 'RUNNING',
      startedAt: '2026-04-27T01:00:00.000Z',
      finishedAt: null,
      errorCode: null,
      errorMessage: null,
    },
  ];

  const timeline = buildApiEventTimeline(baseRun, baseLive, events, steps);
  const logs = buildApiEventLogs(baseRun, baseLive, events);

  assert.deepEqual(timeline.map((step) => step.id), ['event-1', 'event-3', 'event-2']);
  assert.equal(timeline[0].label, '첫 화면 로드');
  assert.equal(timeline[0].status, 'complete');
  assert.equal(timeline[1].label, '화면 동작 확인');
  assert.equal(timeline[1].detail, '무료로 시작하기 버튼을 클릭했습니다');
  assert.equal(timeline[2].label, '확인 막힘');
  assert.equal(timeline[2].status, 'failed');
  assert.equal(timeline[2].detail, '응답이 지연되어 확인이 막혔습니다');
  assert.equal(logs[0].message, '첫 화면 로드 확인 중입니다');
  assert.equal(logs[1].message, '무료로 시작하기 버튼을 클릭했습니다');
  assert.equal(logs[2].message, '응답이 지연되어 확인이 막혔습니다');
  assert.equal(logs[2].tone, 'warning');
  assert.doesNotMatch(logs[2].message, /step_002_submit|STEP_FAILED|locator/);
});

test('run monitor view model turns event payload details into readable path entries', () => {
  const events: RunEvent[] = [
    {
      id: 'event-click-target',
      runId: baseRun.id,
      stepId: 'step-click',
      stepKey: 'step_click_cta',
      eventType: 'ACTION_EXECUTED',
      eventSource: 'RUNNER',
      payload: {
        actionType: 'click',
        target: 'label=Start free trial',
        details: {},
      },
      occurredAt: '2026-04-27T01:00:10.000Z',
    },
    {
      id: 'event-completed-url',
      runId: baseRun.id,
      stepId: 'step-click',
      stepKey: 'step_click_cta',
      eventType: 'STEP_COMPLETED',
      eventSource: 'RUNNER',
      payload: {
        finalUrl: 'https://example.com/signup?plan=starter',
        settle: {
          durationMs: 1420,
          status: 'settled',
        },
      },
      occurredAt: '2026-04-27T01:00:12.000Z',
    },
    {
      id: 'event-navigate-root',
      runId: baseRun.id,
      stepId: 'step-goto',
      stepKey: 'step_goto_root',
      eventType: 'ACTION_EXECUTED',
      eventSource: 'RUNNER',
      payload: {
        actionType: 'goto',
        details: {
          finalUrl: 'https://example.com/',
        },
      },
      occurredAt: '2026-04-27T01:00:12.500Z',
    },
    {
      id: 'event-completed-root',
      runId: baseRun.id,
      stepId: 'step-goto',
      stepKey: 'step_goto_root',
      eventType: 'STEP_COMPLETED',
      eventSource: 'RUNNER',
      payload: {
        finalUrl: 'https://example.com/',
      },
      occurredAt: '2026-04-27T01:00:12.600Z',
    },
    {
      id: 'event-completed-duration',
      runId: baseRun.id,
      stepId: 'step-wait',
      stepKey: 'step_wait_response',
      eventType: 'STEP_COMPLETED',
      eventSource: 'RUNNER',
      payload: {
        settle: {
          durationMs: 850,
          status: 'settled',
        },
      },
      occurredAt: '2026-04-27T01:00:13.000Z',
    },
    {
      id: 'event-timeout-click',
      runId: baseRun.id,
      stepId: 'step-click',
      stepKey: 'step_click_cta',
      eventType: 'STEP_FAILED',
      eventSource: 'RUNNER',
      payload: {
        actionType: 'click',
        failureCode: 'RUNNER_TIMEOUT',
        failureMessage: 'locator click timed out',
      },
      occurredAt: '2026-04-27T01:00:14.000Z',
    },
  ];

  const timeline = buildApiEventTimeline(baseRun, baseLive, events, []);

  assert.equal(timeline[0].detail, 'Start free trial 버튼을 클릭했습니다');
  assert.equal(timeline[1].detail, '도착 화면 /signup을 확인했습니다');
  assert.equal(timeline[2].detail, '첫 화면으로 이동했습니다');
  assert.equal(timeline[3].detail, '첫 화면을 확인했습니다');
  assert.equal(timeline[4].detail, '응답 대기 850ms 후 화면 변화를 확인했습니다');
  assert.equal(timeline[5].detail, '버튼 클릭 후 응답이 지연되어 확인이 막혔습니다');
  assert.doesNotMatch(timeline.map((step) => step.detail).join('\n'), /selector|locator|RUNNER_TIMEOUT/);
});

test('run monitor view model keeps generated scenario step logs readable', () => {
  const events: RunEvent[] = [
    {
      id: 'event-start-legacy-discovery',
      runId: baseRun.id,
      stepId: 'step-start',
      stepKey: 'step_001_goto',
      eventType: 'STEP_STARTED',
      eventSource: 'RUNNER',
      payload: {
        description: 'Discovery 추천 URL에 진입한다.',
      },
      occurredAt: '2026-04-27T01:00:00.000Z',
    },
    {
      id: 'event-start-next-screen',
      runId: baseRun.id,
      stepId: 'step-click',
      stepKey: 'step_003_probe_recommended_target',
      eventType: 'STEP_STARTED',
      eventSource: 'RUNNER',
      payload: {
        description: '추천된 진입점으로 다음 화면 이동 가능성을 확인한다.',
      },
      occurredAt: '2026-04-27T01:00:10.000Z',
    },
  ];
  const steps: RunStep[] = [
    {
      id: 'step-start',
      runId: baseRun.id,
      stepOrder: 1,
      stepKey: 'step_001_goto',
      stepName: 'Discovery 추천 URL에 진입한다.',
      stepType: 'GOTO',
      status: 'PASSED',
      startedAt: '2026-04-27T01:00:00.000Z',
      finishedAt: '2026-04-27T01:00:05.000Z',
      errorCode: null,
      errorMessage: null,
    },
    {
      id: 'step-click',
      runId: baseRun.id,
      stepOrder: 2,
      stepKey: 'step_003_probe_recommended_target',
      stepName: '추천된 진입점으로 다음 화면 이동 가능성을 확인한다.',
      stepType: 'CLICK',
      status: 'RUNNING',
      startedAt: '2026-04-27T01:00:10.000Z',
      finishedAt: null,
      errorCode: null,
      errorMessage: null,
    },
  ];

  const logs = buildApiEventLogs(baseRun, baseLive, events);
  const eventTimeline = buildApiEventTimeline(baseRun, baseLive, events, steps);
  const stepTimeline = buildApiStepTimeline(baseRun, baseLive, steps);

  assert.equal(logs[0].message, '추천된 시작 화면을 열고 있습니다');
  assert.equal(logs[1].message, '추천 진입점의 다음 화면 이동을 확인 중입니다');
  assert.deepEqual(eventTimeline.map((step) => step.label), ['추천 시작 화면', '추천 진입점 이동']);
  assert.deepEqual(stepTimeline.map((step) => step.label), ['추천 시작 화면', '추천 진입점 이동']);
  assert.doesNotMatch([
    ...logs.map((log) => log.message),
    ...eventTimeline.map((step) => step.label),
    ...stepTimeline.map((step) => step.label),
  ].join('\n'), /Discovery|진입한다 확인|의사결정/);
});

test('run monitor view model keeps selector-like action payloads readable but not raw', () => {
  const selectorLikeTargets = [
    'selector=#hero .primary-cta',
    'role=button, selector=#primary-cta',
    'role=button',
    'selector_any=#hero .primary-cta|button.primary',
    'button.primary',
    'main > button',
    'main nav a',
    'button:nth-child(2)',
    '[data-testid="primary-cta"]',
    '//button[@id="submit"]',
  ];

  const selectorEvents: RunEvent[] = selectorLikeTargets.map((target, index) => ({
    id: `event-selector-like-${index}`,
    runId: baseRun.id,
    stepId: 'step-click',
    stepKey: 'step_click_cta',
    eventType: 'ACTION_EXECUTED',
    eventSource: 'RUNNER',
    payload: {
      actionType: 'click',
      target,
      details: {},
    },
    occurredAt: '2026-04-27T01:00:10.000Z',
  }));
  const timeline = buildApiEventTimeline(baseRun, baseLive, selectorEvents, []);

  assert.equal(timeline.every((step) => step.detail === '버튼이나 링크를 클릭했습니다'), true);
  assert.doesNotMatch(timeline.map((step) => step.detail).join('\n'), /selector|#hero|primary-cta|data-testid|xpath|button\.primary|submit|role=|nth-child|main nav|main > button/);
});

test('run monitor view model strips query strings from displayed final urls', () => {
  const timeline = buildApiEventTimeline(baseRun, baseLive, [
    {
      id: 'event-sensitive-url',
      runId: baseRun.id,
      stepId: 'step-callback',
      stepKey: 'step_callback',
      eventType: 'STEP_COMPLETED',
      eventSource: 'RUNNER',
      payload: {
        finalUrl: 'https://example.com/callback?token=secret&email=user@example.com',
      },
      occurredAt: '2026-04-27T01:00:10.000Z',
    },
    {
      id: 'event-relative-sensitive-url',
      runId: baseRun.id,
      stepId: 'step-relative-callback',
      stepKey: 'step_relative_callback',
      eventType: 'STEP_COMPLETED',
      eventSource: 'RUNNER',
      payload: {
        finalUrl: '/relative-callback?code=secret-code',
      },
      occurredAt: '2026-04-27T01:00:11.000Z',
    },
  ], []);

  assert.equal(timeline[0].detail, '도착 화면 /callback을 확인했습니다');
  assert.equal(timeline[1].detail, '도착 화면 /relative-callback을 확인했습니다');
  assert.doesNotMatch(timeline.map((step) => step.detail).join('\n'), /token|secret|email|user@example\.com|code|\?/);
});

test('run monitor view model keeps unknown event logs generic', () => {
  const logs = buildApiEventLogs(baseRun, baseLive, [
    {
      id: 'event-unknown',
      runId: baseRun.id,
      stepId: null,
      stepKey: null,
      eventType: 'EXPERIMENTAL_BACKEND_EVENT',
      eventSource: 'RUNNER',
      payload: {
        message: 'raw backend diagnostic payload',
      },
      occurredAt: '2026-04-27T01:02:00.000Z',
    },
  ]);

  assert.equal(logs[0].message, '실행 상태가 업데이트되었습니다');
  assert.equal(logs[0].tone, 'info');
  assert.doesNotMatch(logs[0].message, /raw backend diagnostic payload|EXPERIMENTAL_BACKEND_EVENT/);
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

test('run monitor view model summarizes URL visits, screenshots, and steps for the report CTA', () => {
  const stats = buildRunCollectionSummaryStats({
    evidencePacket: {
      ...evidencePacket,
      final_url: 'https://example.com/cart',
      checkpoints: [
        {
          ...evidencePacket.checkpoints[0],
          checkpoint_id: 'checkpoint-1',
          state: { url: 'https://example.com/' },
        },
        {
          ...evidencePacket.checkpoints[0],
          checkpoint_id: 'checkpoint-2',
          state: { url: 'https://example.com/raw-redirect', page: { url: 'https://example.com/cart' } },
        },
        {
          ...evidencePacket.checkpoints[0],
          checkpoint_id: 'checkpoint-3',
          state: { url: 'https://example.com/cart#details' },
        },
      ],
      artifacts: [
        ...evidencePacket.artifacts,
        {
          artifact_id: 'screenshot-2',
          type: 'screenshot',
          uri: '/api/runs/111/artifacts/screenshot-2/content',
          mime_type: 'image/png',
          size_bytes: 2048,
          metadata: {},
        },
      ],
    },
    run: baseRun,
    live: baseLive,
    runSteps: [
      {
        id: 'step-1',
        runId: baseRun.id,
        stepOrder: 1,
        stepKey: 'step_001_goto',
        stepName: '첫 화면 로드',
        stepType: 'GOTO',
        status: 'PASSED',
        startedAt: null,
        finishedAt: null,
        errorCode: null,
        errorMessage: null,
      },
      {
        id: 'step-2',
        runId: baseRun.id,
        stepOrder: 2,
        stepKey: 'step_002_capture',
        stepName: '화면 수집',
        stepType: 'ASSERT',
        status: 'PASSED',
        startedAt: null,
        finishedAt: null,
        errorCode: null,
        errorMessage: null,
      },
      {
        id: 'step-3',
        runId: baseRun.id,
        stepOrder: 3,
        stepKey: 'step_003_click',
        stepName: '진입점 확인',
        stepType: 'CLICK',
        status: 'PASSED',
        startedAt: null,
        finishedAt: null,
        errorCode: null,
        errorMessage: null,
      },
      {
        id: 'step-4',
        runId: baseRun.id,
        stepOrder: 4,
        stepKey: 'step_004_stop',
        stepName: '안전 중단',
        stepType: 'ASSERT',
        status: 'PASSED',
        startedAt: null,
        finishedAt: null,
        errorCode: null,
        errorMessage: null,
      },
      {
        id: 'step-5',
        runId: baseRun.id,
        stepOrder: 9,
        stepKey: 'step_009_planned',
        stepName: '誘몄떎??怨꾪쉷',
        stepType: 'ASSERT',
        status: 'PENDING',
        startedAt: null,
        finishedAt: null,
        errorCode: null,
        errorMessage: null,
      },
    ],
  });

  assert.deepEqual(stats, {
    visitedPageCount: 2,
    screenshotCount: 2,
    stepCount: 4,
  });
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
      message: '수집된 근거와 개선안을 한눈에 정리했습니다.',
    },
  );

  assert.equal(resolveRunMonitorReportCtaState({
    isMockRun: false,
    report: baseReport,
    isLoading: false,
    errorMessage: '',
  }).kind, 'open');

  const generatableState = resolveRunMonitorReportCtaState({
    isMockRun: false,
    report: { ...baseReport, reportStatus: 'GENERATABLE', reportId: null, status: null },
    isLoading: false,
    errorMessage: '',
  });
  assert.equal(generatableState.kind, 'generate');
  assert.equal(generatableState.message, '분석 결과가 준비되었습니다. 리포트를 준비하는 중입니다. 완료되면 바로 확인할 수 있습니다.');

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
    report: { ...baseReport, reportStatus: 'FAILED', errorMessage: null },
    isLoading: false,
    errorMessage: '',
  }).message, '리포트를 준비하지 못했습니다. 분석 상태를 확인해주세요.');

  assert.equal(resolveRunMonitorReportCtaState({
    isMockRun: false,
    report: null,
    isLoading: false,
    errorMessage: '리포트 상태 오류',
  }).kind, 'error');
});
