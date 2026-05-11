import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildAgentSmokeScenarioPlan,
  buildFixtureHomeHtml,
  isFatalPollError,
  readConfig,
  validateAgentTrace,
  validateTerminalDetails,
} from './real-agent-run-e2e-smoke.mjs';

test('agent smoke script builds a runner-compatible metadata scenario plan', () => {
  const plan = buildAgentSmokeScenarioPlan({ targetUrl: 'http://host.docker.internal:43210/' });

  assert.equal(plan.schema_version, '0.5');
  assert.equal(plan.scenario_type, 'custom_compiled');
  assert.equal(plan.start_url, 'http://host.docker.internal:43210/');
  assert.equal(plan.environment.device, 'desktop');
  assert.equal(plan.environment.viewport.width, 1440);
  assert.equal(plan.safety.allow_external_navigation, false);
  assert.deepEqual(plan.steps.map((step) => step.action.type), ['goto']);
  assert.deepEqual(plan.steps.map((step) => step.checkpoint), [false]);
});

test('agent smoke script reads agent-specific config before shared smoke config', () => {
  const config = readConfig({
    VITE_DEV_PROJECT_ID: '11111111-1111-4111-8111-111111111111',
    VITE_DEV_SCENARIO_TEMPLATE_VERSION_ID: '22222222-2222-4222-8222-222222222222',
    WEDGE_SMOKE_TARGET_URL: 'https://shared.example/',
    WEDGE_AGENT_SMOKE_TARGET_URL: 'https://agent.example/',
    WEDGE_AGENT_SMOKE_API_BASE_URL: 'http://localhost:8081/',
    WEDGE_AGENT_SMOKE_WEB_BASE_URL: 'http://localhost:5174/',
    WEDGE_AGENT_SMOKE_TIMEOUT_MS: '12345',
    WEDGE_AGENT_SMOKE_HEALTH_PATH: 'actuator/health',
    WEDGE_AGENT_SMOKE_EXPECTED_STATUS: 'stopped',
    WEDGE_AGENT_SMOKE_VERIFY_REPLAY: 'false',
    WEDGE_AGENT_SMOKE_FIXTURE_PUBLIC_HOST: 'localhost',
  });

  assert.equal(config.targetUrl, 'https://agent.example/');
  assert.equal(config.apiBaseUrl, 'http://localhost:8081');
  assert.equal(config.webBaseUrl, 'http://localhost:5174');
  assert.equal(config.timeoutMs, 12345);
  assert.equal(config.healthPath, '/actuator/health');
  assert.equal(config.expectedStatus, 'STOPPED');
  assert.equal(config.verifyReplayHints, false);
  assert.equal(config.fixturePublicHost, 'localhost');
});

test('agent smoke script defaults to fixture site when no target URL is configured', () => {
  const config = readConfig({
    WEDGE_AGENT_SMOKE_PROJECT_ID: '11111111-1111-4111-8111-111111111111',
    WEDGE_AGENT_SMOKE_SCENARIO_TEMPLATE_VERSION_ID: '22222222-2222-4222-8222-222222222222',
  });

  assert.equal(config.targetUrl, null);
  assert.equal(config.fixturePublicHost, 'host.docker.internal');
  assert.equal(config.expectedStatus, 'STOPPED');
  assert.equal(config.verifyReplayHints, true);
});

test('agent smoke fixture exposes a signup CTA that the rule-based planner can find', () => {
  const html = buildFixtureHomeHtml();

  assert.match(html, /id="signup-cta"/);
  assert.match(html, /href="\/signup"/);
  assert.match(html, /Start signup/);
});

test('agent smoke validates successful trace and replay planner evidence', () => {
  const trace = {
    trace_id: '33333333-3333-4333-8333-333333333333',
    final_outcome: 'SUCCESS_CHECKOUT_ENTRY_REACHED',
    events: [
      { event_type: 'AGENT_ACTION_COMPLETED' },
    ],
    decisions: [
      { planner_source: 'rule_based' },
      { planner_source: 'replay_hint' },
    ],
  };

  assert.equal(validateAgentTrace(trace), 1);
  assert.equal(validateAgentTrace(trace, { expectReplayHintPlanner: true }), 1);
});

test('agent smoke fails replay validation when no replay hint decision is present', () => {
  assert.throws(
    () => validateAgentTrace({
      trace_id: '33333333-3333-4333-8333-333333333333',
      final_outcome: 'SUCCESS_CHECKOUT_ENTRY_REACHED',
      events: [{ event_type: 'AGENT_ACTION_COMPLETED' }],
      decisions: [{ planner_source: 'rule_based' }],
    }, { expectReplayHintPlanner: true }),
    /Replay Agent run did not use/
  );
});

test('agent smoke treats terminal mismatch and replay validation failure as fatal', () => {
  assert.equal(isFatalPollError(new Error('Agent run reached terminal status COMPLETED, expected STOPPED')), true);
  assert.equal(isFatalPollError(new Error('Replay Agent run did not use any replay_hint planner decisions.')), true);
  assert.doesNotThrow(() => validateTerminalDetails({ status: 'STOPPED' }, 'STOPPED'));
  assert.throws(
    () => validateTerminalDetails({ status: 'FAILED', failureCode: null, failureMessage: null }, 'FAILED'),
    /failureCode\/failureMessage/
  );
});
