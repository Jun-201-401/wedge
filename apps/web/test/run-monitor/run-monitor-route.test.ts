import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildMockRunId,
  buildRunMonitorPath,
  getRunIdFromPath,
  isMockRunId,
  isRunMonitorRunId,
} from '../../src/pages/run-monitor/lib/runMonitorRoute';

test('buildRunMonitorPath encodes run id and monitor query state', () => {
  const runUuid = '11111111-1111-4111-8111-111111111111';

  assert.equal(
    buildRunMonitorPath(runUuid, {
      submittedUrl: 'https://example.com/path?a=1',
      scenarioId: 'landing-cta',
      depthId: 'hero-only',
    }),
    `/runs/${runUuid}?url=https%3A%2F%2Fexample.com%2Fpath%3Fa%3D1&scenario=landing-cta&depth=hero-only`,
  );
  assert.throws(() => buildRunMonitorPath('run 123', {
    submittedUrl: 'https://example.com/',
    scenarioId: 'landing-cta',
    depthId: 'hero-only',
  }), /requires a UUID or mock run id/);
});

test('getRunIdFromPath rejects malformed and ambiguous run monitor paths', () => {
  const runUuid = '11111111-1111-4111-8111-111111111111';

  assert.equal(getRunIdFromPath('/create-analysis'), null);
  assert.equal(getRunIdFromPath('/runs/'), null);
  assert.equal(getRunIdFromPath('/runs/%'), null);
  assert.equal(getRunIdFromPath('/runs/run-1/extra'), null);
  assert.equal(getRunIdFromPath('/runs/run-1'), null);
  assert.equal(getRunIdFromPath(`/runs/${runUuid}`), runUuid);
});

test('mock run ids use one explicit demo prefix', () => {
  assert.equal(buildMockRunId('landing-cta'), 'mock-landing-cta');
  assert.equal(isMockRunId('mock-landing-cta'), true);
  assert.equal(isRunMonitorRunId('mock-landing-cta'), true);
  assert.equal(isMockRunId('mock-'), false);
  assert.equal(isMockRunId('run-123'), false);
  assert.equal(getRunIdFromPath('/runs/mock-landing-cta'), 'mock-landing-cta');
});
