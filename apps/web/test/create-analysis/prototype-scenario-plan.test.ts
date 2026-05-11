import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPrototypeScenarioPlan } from '../../src/pages/create-analysis/lib/prototypeScenarioPlan';

const selectedScenario = {
  id: 'contact',
  title: '문의 / 상담 신청 흐름 점검',
  summary: '문의 CTA 후보를 점검합니다.',
  evidence: 'cp_001.obs_003',
  scenarioType: 'CONTACT',
  sourceDiscoveryId: '20000000-0000-4000-8000-000000000011',
  evidenceRefs: ['cp_001.obs_003'],
  suggestedStartUrl: 'https://example.com/',
  suggestedTarget: { text: 'Book a demo' },
};

const selectedDepth = {
  id: 'hero-only',
  title: '첫 화면만 보기',
  detail: 'CTA가 명확한지 빠르게 확인합니다.',
};

test('prototype scenario plan is compatible with the runner run.execute contract', () => {
  const plan = buildPrototypeScenarioPlan({
    submittedUrl: 'https://example.com/',
    selectedScenario,
    selectedDepth,
  });

  assert.equal(plan.schema_version, '0.5');
  assert.equal(plan.scenario_type, 'custom_compiled');
  assert.equal(plan.template_key, 'contact');
  assert.equal(plan.goal, selectedScenario.summary);
  assert.equal(plan.start_url, 'https://example.com/');
  assert.equal(plan.source_discovery_id, selectedScenario.sourceDiscoveryId);
  assert.deepEqual(plan.fit_requirements, {
    required_flow_type: 'CONTACT',
    required_entrypoint_types: ['contact', 'form', 'cta'],
    fallback_allowed: true,
  });
  assert.deepEqual(plan.environment.viewport, { width: 1440, height: 900 });
  assert.equal(plan.environment.device, 'desktop');
  assert.equal(plan.environment.locale, 'ko-KR');
  assert.equal(plan.environment.timezone, 'Asia/Seoul');
  assert.equal(plan.environment.auth_state, 'anonymous');
  assert.deepEqual(plan.safety, {
    allow_external_navigation: false,
    allow_payment_commit: false,
    allow_destructive_action: false,
    use_synthetic_inputs: true,
    stop_before_real_payment: true,
  });
  assert.equal(plan.steps.length, 2);
  assert.deepEqual(plan.steps.map((step) => step.step_id), [
    'step_001_goto_start_url',
    'step_002_checkpoint_contact',
  ]);
  assert.deepEqual(plan.steps.map((step) => step.stage), ['FIRST_VIEW', 'CTA']);
  assert.deepEqual(plan.steps.map((step) => step.action.type), ['goto', 'checkpoint']);
  assert.deepEqual(plan.steps.map((step) => step.settle_strategy.type), ['network_idle', 'fixed_short']);
  assert.deepEqual(plan.steps.map((step) => step.checkpoint), [true, true]);
  assert.deepEqual(plan.steps[1].action.target.evidence_refs, ['cp_001.obs_003']);
  assert.deepEqual(plan.steps[1].action.target.suggested_target, { text: 'Book a demo' });
});
