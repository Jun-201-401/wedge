import test from 'node:test';
import assert from 'node:assert/strict';

import { isProtectedAppRoute, resolveAppRoute, resolveProtectedRouteGate } from '../../src/app/appRoute';

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


test('resolveProtectedRouteGate keeps real run routes off landing while auth is checking', () => {
  const monitorRoute = resolveAppRoute(`/runs/${runUuid}`);
  const reportRoute = resolveAppRoute(`/runs/${runUuid}/report`);

  assert.equal(isProtectedAppRoute(monitorRoute), true);
  assert.equal(isProtectedAppRoute(reportRoute), true);
  assert.equal(resolveProtectedRouteGate(monitorRoute, 'checking'), 'loading');
  assert.equal(resolveProtectedRouteGate(reportRoute, 'checking'), 'loading');
  assert.equal(resolveProtectedRouteGate(monitorRoute, 'anonymous'), 'blocked');
  assert.equal(resolveProtectedRouteGate(reportRoute, 'authenticated'), 'open');
});

test('resolveProtectedRouteGate leaves mock and public routes open during auth checking', () => {
  assert.equal(resolveProtectedRouteGate(resolveAppRoute('/runs/mock-landing-cta'), 'checking'), 'open');
  assert.equal(resolveProtectedRouteGate(resolveAppRoute('/'), 'checking'), 'open');
  assert.equal(resolveProtectedRouteGate(resolveAppRoute('/create-analysis'), 'checking'), 'open');
  assert.equal(resolveProtectedRouteGate(resolveAppRoute('/runs'), 'checking'), 'loading');
});
