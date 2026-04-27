import test from 'node:test';
import assert from 'node:assert/strict';

import type { Run, RunLive } from '../../src/entities/run';
import {
  buildApiSnapshotLogs,
  buildApiSnapshotSteps,
  getApiCheckpoint,
  getApiProgressPercent,
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
