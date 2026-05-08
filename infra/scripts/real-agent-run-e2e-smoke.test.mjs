import test from 'node:test';
import assert from 'node:assert/strict';

import { readAgentConfig } from './real-agent-run-e2e-smoke.mjs';

test('agent smoke wrapper forces agent execution mode without template version', () => {
  const config = readAgentConfig({
    VITE_DEV_PROJECT_ID: '11111111-1111-4111-8111-111111111111',
    VITE_DEV_SCENARIO_TEMPLATE_VERSION_ID: '22222222-2222-4222-8222-222222222222',
    WEDGE_SMOKE_EXECUTION_MODE: 'scenario',
  });

  assert.equal(config.projectId, '11111111-1111-4111-8111-111111111111');
  assert.equal(config.executionMode, 'agent');
  assert.equal(config.scenarioTemplateVersionId, undefined);
});
