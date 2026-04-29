import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPrototypeScenarioPlan,
  isFatalPollError,
  isUuid,
  normalizeBaseUrl,
  readConfig,
  validateTerminalDetails,
} from './real-run-e2e-smoke.mjs';

test('smoke script builds a runner-compatible scenario plan', () => {
  const plan = buildPrototypeScenarioPlan({ targetUrl: 'https://example.com/' });

  assert.equal(plan.schema_version, '0.5');
  assert.equal(plan.scenario_type, 'custom_compiled');
  assert.equal(plan.start_url, 'https://example.com/');
  assert.equal(plan.environment.device, 'desktop');
  assert.equal(plan.environment.viewport.width, 1440);
  assert.equal(plan.environment.auth_state, 'anonymous');
  assert.equal(plan.safety.allow_external_navigation, false);
  assert.deepEqual(plan.steps.map((step) => step.action.type), ['goto', 'checkpoint']);
  assert.deepEqual(plan.steps.map((step) => step.checkpoint), [true, true]);
});

test('smoke script reads config from existing web dev env names', () => {
  const config = readConfig({
    VITE_DEV_PROJECT_ID: '11111111-1111-4111-8111-111111111111',
    VITE_DEV_SCENARIO_TEMPLATE_VERSION_ID: '22222222-2222-4222-8222-222222222222',
    WEDGE_SMOKE_API_BASE_URL: 'http://localhost:8080/',
    WEDGE_SMOKE_WEB_BASE_URL: 'http://localhost:5173/',
    WEDGE_SMOKE_TIMEOUT_MS: '12345',
    WEDGE_SMOKE_HEALTH_PATH: 'actuator/health',
    WEDGE_SMOKE_EXPECTED_STATUS: 'failed',
  });

  assert.equal(config.projectId, '11111111-1111-4111-8111-111111111111');
  assert.equal(config.scenarioTemplateVersionId, '22222222-2222-4222-8222-222222222222');
  assert.equal(config.apiBaseUrl, 'http://localhost:8080');
  assert.equal(config.webBaseUrl, 'http://localhost:5173');
  assert.equal(config.timeoutMs, 12345);
  assert.equal(config.healthPath, '/actuator/health');
  assert.equal(config.expectedStatus, 'FAILED');
});

test('smoke script helpers validate UUIDs and normalize base URLs', () => {
  assert.equal(isUuid('11111111-1111-4111-8111-111111111111'), true);
  assert.equal(isUuid('not-a-uuid'), false);
  assert.equal(normalizeBaseUrl('http://localhost:8080///'), 'http://localhost:8080');
});

test('smoke script treats terminal mismatch as fatal and requires failed-run details', () => {
  assert.equal(isFatalPollError(new Error('Run reached terminal status COMPLETED, expected FAILED')), true);
  assert.doesNotThrow(() => validateTerminalDetails({
    status: 'FAILED',
    failureCode: 'RUNNER_EXECUTION_FAILED',
    failureMessage: 'navigation failed',
  }, 'FAILED'));
  assert.throws(
    () => validateTerminalDetails({ status: 'FAILED', failureCode: null, failureMessage: null }, 'FAILED'),
    /failureCode\/failureMessage/
  );
});
