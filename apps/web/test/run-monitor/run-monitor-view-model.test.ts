import test from 'node:test';
import assert from 'node:assert/strict';

import type { EvidencePacket, Run, RunLive } from '../../src/entities/run';
import {
  buildApiSnapshotLogs,
  buildApiSnapshotSteps,
  canOpenRunReport,
  findEvidenceScreenshotArtifact,
  getApiCheckpoint,
  getApiProgressPercent,
  getCheckpointArtifacts,
  getEvidenceArtifactLabel,
  getEvidenceObservationSummary,
  getStatusTone,
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


test('run report CTA stays limited to mock runs until report API is connected', () => {
  assert.equal(canOpenRunReport(true), true);
  assert.equal(canOpenRunReport(false), false);
});
