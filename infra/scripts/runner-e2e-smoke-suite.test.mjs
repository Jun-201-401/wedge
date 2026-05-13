import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRunnerSmokeSuitePlan } from './runner-e2e-smoke-suite.mjs';

test('runner smoke suite defaults to discovery, scenario, and agent checks', () => {
  const plan = buildRunnerSmokeSuitePlan({
    env: {},
    root: '/repo',
  });

  assert.deepEqual(plan.map((step) => step.name), ['discovery', 'scenario', 'agent']);
  assert.equal(plan[0].requiresApi, false);
  assert.equal(plan[1].requiresApi, true);
  assert.equal(plan[2].requiresApi, true);
  assert.deepEqual(plan.map((step) => step.args[0]), [
    '/repo/infra/scripts/real-discovery-smoke.mjs',
    '/repo/infra/scripts/real-run-e2e-smoke.mjs',
    '/repo/infra/scripts/real-agent-run-e2e-smoke.mjs',
  ]);
});

test('runner smoke suite allows a narrowed ordered step list', () => {
  const plan = buildRunnerSmokeSuitePlan({
    env: {
      WEDGE_RUNNER_SMOKE_SUITE_STEPS: 'agent,scenario',
    },
    root: '/repo',
  });

  assert.deepEqual(plan.map((step) => step.name), ['agent', 'scenario']);
});

test('runner smoke suite rejects unknown step names', () => {
  assert.throws(
    () => buildRunnerSmokeSuitePlan({
      env: {
        WEDGE_RUNNER_SMOKE_SUITE_STEPS: 'discovery,unknown',
      },
      root: '/repo',
    }),
    /Unsupported WEDGE_RUNNER_SMOKE_SUITE_STEPS entry: unknown/
  );
});
