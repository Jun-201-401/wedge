import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertScenarioPlanReplayable,
  buildReplayRunRequest,
  parseScenarioPlanExportArtifact,
  readConfig,
  selectScenarioPlanExportArtifactId,
  validateConfig,
} from './real-agent-trace-export-replay-smoke.mjs';

const PROJECT_ID = '8f06dca8-9c4d-4f20-b1a8-1d5ee40a9923';
const TEMPLATE_VERSION_ID = '5c5f4c77-0c32-4ab3-9841-2b6f6cc07a40';

function exportedScenarioPlan() {
  return {
    schema_version: '0.5',
    plan_id: 'agent-export-task-1',
    scenario_type: 'custom_compiled',
    template_key: 'agent-runtime',
    goal: 'Stop before payment',
    start_url: 'http://host.docker.internal:3000/product.html',
    environment: {
      device: 'desktop',
      viewport: { width: 1440, height: 900 },
      locale: 'ko-KR',
      timezone: 'Asia/Seoul',
      permissions: [],
      auth_state: 'anonymous',
      depth_id: 'agent-runtime',
    },
    safety: {
      allow_external_navigation: false,
      allow_payment_commit: false,
      allow_destructive_action: false,
      use_synthetic_inputs: false,
      stop_before_real_payment: true,
    },
    steps: [
      {
        step_id: 'agent_export_turn_001',
        stage: 'CTA',
        description: 'Add to cart',
        action: {
          type: 'click',
          target: { selector: '#add-to-cart' },
          options: { replay_hint: { selector: '#add-to-cart', frame_id: 'main' } },
        },
        settle_strategy: { type: 'fixed_short', timeout_ms: 500 },
        checkpoint: false,
      },
      {
        step_id: 'agent_export_002_stop_before_commit',
        stage: 'COMMIT',
        description: 'Stop before payment',
        action: { type: 'stop_when' },
        settle_strategy: { type: 'none', timeout_ms: 0 },
        checkpoint: false,
        stop_condition: { url_includes: '/checkout.html' },
      },
    ],
  };
}

test('[real agent trace export replay smoke config] reads env and validates project/template ids', () => {
  const config = readConfig({
    WEDGE_AGENT_EXPORT_REPLAY_SMOKE_API_BASE_URL: 'http://localhost:8080/',
    WEDGE_AGENT_EXPORT_REPLAY_SMOKE_PROJECT_ID: PROJECT_ID,
    WEDGE_AGENT_EXPORT_REPLAY_SMOKE_SCENARIO_TEMPLATE_VERSION_ID: TEMPLATE_VERSION_ID,
    WEDGE_AGENT_EXPORT_REPLAY_SMOKE_TARGET_URL: 'https://example.test/product.html',
    WEDGE_AGENT_EXPORT_REPLAY_SMOKE_TIMEOUT_MS: '12345',
  });

  assert.equal(config.apiBaseUrl, 'http://localhost:8080');
  assert.equal(config.projectId, PROJECT_ID);
  assert.equal(config.scenarioTemplateVersionId, TEMPLATE_VERSION_ID);
  assert.equal(config.targetUrl, 'https://example.test/product.html');
  assert.equal(config.timeoutMs, 12345);
  assert.doesNotThrow(() => validateConfig(config));
});

test('[real agent trace export replay smoke config] rejects missing ScenarioTemplate version', () => {
  const config = readConfig({
    WEDGE_AGENT_EXPORT_REPLAY_SMOKE_PROJECT_ID: PROJECT_ID,
  });

  assert.throws(() => validateConfig(config), /SCENARIO_TEMPLATE_VERSION_ID/);
});

test('[real agent trace export replay smoke events] selects nested ScenarioPlan export artifact id', () => {
  const exportArtifactId = selectScenarioPlanExportArtifactId([
    { eventType: 'AGENT_ACTION_COMPLETED', payload: { payload: { targetKey: '#checkout-link' } } },
    { eventType: 'AGENT_TRACE_PERSISTED', payload: { payload: { scenarioPlanExportStatus: 'EXPORTED', scenarioPlanExportArtifactId: 'artifact-1' } } },
  ]);

  assert.equal(exportArtifactId, 'artifact-1');
});

test('[real agent trace export replay smoke artifact] parses exported ScenarioPlan content', () => {
  const parsed = parseScenarioPlanExportArtifact(JSON.stringify({
    status: 'EXPORTED',
    scenario_plan: exportedScenarioPlan(),
    skipped_turns: [],
  }));

  assert.equal(parsed.scenario_plan.plan_id, 'agent-export-task-1');
  assert.equal(parsed.scenario_plan.steps.length, 2);
});

test('[real agent trace export replay smoke artifact] rejects non-exportable content', () => {
  assert.throws(
    () => parseScenarioPlanExportArtifact(JSON.stringify({ status: 'NOT_EXPORTABLE' })),
    /EXPORTED/
  );
});

test('[real agent trace export replay smoke replay] requires replay_hint and stop_when without final payment target', () => {
  const result = assertScenarioPlanReplayable(exportedScenarioPlan());

  assert.equal(result.replayHintStepCount, 1);
  assert.equal(result.hasStopWhen, true);
});

test('[real agent trace export replay smoke request] builds static replay run from exported plan', () => {
  const body = buildReplayRunRequest({
    projectId: PROJECT_ID,
    scenarioTemplateVersionId: TEMPLATE_VERSION_ID,
  }, {
    scenarioPlan: exportedScenarioPlan(),
    sourceAgentRunId: 'agent-run-1',
    exportArtifactId: 'artifact-1',
  });

  assert.equal(body.name, 'Real Agent Trace Export Replay Smoke');
  assert.equal(body.projectId, PROJECT_ID);
  assert.equal(body.scenarioTemplateVersionId, TEMPLATE_VERSION_ID);
  assert.equal(body.startUrl, 'http://host.docker.internal:3000/product.html');
  assert.equal(body.goal, 'Stop before payment');
  assert.equal(body.devicePreset, 'desktop');
  assert.equal(body.scenarioOverrides.sourceAgentRunId, 'agent-run-1');
  assert.equal(body.scenarioOverrides.exportArtifactId, 'artifact-1');
  assert.equal(body.scenarioPlan.plan_id, 'agent-export-task-1');
});
