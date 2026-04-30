import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveAppRoute } from '../../src/app/appRoute';

const runUuid = '11111111-1111-4111-8111-111111111111';

test('resolveAppRoute routes report paths before run monitor paths', () => {
  assert.deepEqual(resolveAppRoute(`/runs/${runUuid}/report`), {
    kind: 'run-report',
    runId: runUuid,
  });

  assert.deepEqual(resolveAppRoute('/runs/mock-landing-cta/report'), {
    kind: 'run-report',
    runId: 'mock-landing-cta',
  });
});

test('resolveAppRoute routes monitor, create-analysis, and landing paths', () => {
  assert.deepEqual(resolveAppRoute(`/runs/${runUuid}`), {
    kind: 'run-monitor',
    runId: runUuid,
  });
  assert.deepEqual(resolveAppRoute('/create-analysis'), { kind: 'create-analysis' });
  assert.deepEqual(resolveAppRoute('/runs'), { kind: 'runs-list' });
  assert.deepEqual(resolveAppRoute('/login'), { kind: 'login' });
  assert.deepEqual(resolveAppRoute('/signup'), { kind: 'signup' });
  assert.deepEqual(resolveAppRoute('/'), { kind: 'landing' });
  assert.deepEqual(resolveAppRoute('/runs/not-a-valid-run/report'), { kind: 'landing' });
});
