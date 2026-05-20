import test from 'node:test';
import assert from 'node:assert/strict';

import type { EvidencePacket, Run } from '../../src/entities/run';
import { buildRunReportFromEvidence } from '../../src/features/report-viewer/lib/runReportFromEvidence';

const completedRun: Run = {
  id: '11111111-1111-4111-8111-111111111111',
  type: 'run',
  projectId: '22222222-2222-4222-8222-222222222222',
  name: '랜딩 전환 행동 점검',
  triggerSource: 'WEB',
  startUrl: 'https://example.com/',
  goal: '랜딩 전환 행동 점검',
  devicePreset: 'desktop',
  scenarioTemplateVersionId: '33333333-3333-4333-8333-333333333333',
  status: 'COMPLETED',
  resultCompleteness: 'FINAL',
  analysisStatus: 'NOT_STARTED',
  currentStepOrder: 2,
  startedAt: '2026-04-27T01:00:00.000Z',
  finishedAt: '2026-04-27T01:01:24.000Z',
  failureCode: null,
  failureMessage: null,
  latestSnapshot: null,
};

const evidencePacket: EvidencePacket = {
  schema_version: '0.5',
  execution_type: 'RUN',
  run_id: completedRun.id,
  discovery_id: null,
  url: completedRun.startUrl,
  final_url: completedRun.startUrl,
  scenario: {
    scenario_type: 'LANDING_CTA',
    goal: '첫 화면 CTA 흐름 점검',
  },
  environment: {
    device: 'desktop',
  },
  checkpoints: [
    {
      checkpoint_id: 'cp_first_view_001',
      step_id: 'step_001_goto',
      primaryStage: 'FIRST_VIEW',
      trigger: { actionType: 'goto' },
      settle: { strategy: 'network_idle', durationMs: 1260, status: 'settled' },
      state: { page: { title: 'Example Landing', url: completedRun.startUrl } },
      observations: [
        {
          observation_id: 'obs_cta_001',
          type: 'cta_candidate',
          stage: 'CTA',
          source: ['dom', 'layout'],
          data: { text: 'Start free', target: 'Primary CTA' },
          confidence: 0.86,
        },
      ],
      deltas: [],
      artifact_refs: ['artifact:screenshot-1'],
    },
  ],
  aggregate_signals: {
    checkpoint_count: 1,
    artifact_count: 1,
    cta_candidate_count: 1,
    console_error_count: 0,
    network_failure_count: 0,
  },
  scenario_fit: null,
  artifacts: [
    {
      artifact_id: 'screenshot-1',
      type: 'screenshot',
      uri: '/api/runs/111/artifacts/screenshot-1/content',
      mime_type: 'image/png',
      size_bytes: 1024,
      metadata: {},
    },
  ],
  collection_notes: [],
};

test('buildRunReportFromEvidence projects persisted evidence into report view model', () => {
  const report = buildRunReportFromEvidence({
    run: completedRun,
    evidencePacket,
    scenarioId: 'landing-cta',
  });

  assert.equal(report.runId, completedRun.id);
  assert.equal(report.reportId, 'WDG-11111111');
  assert.equal(report.targetUrl, completedRun.startUrl);
  assert.equal(report.scenarioLabel, '랜딩 전환 버튼 점검');
  assert.equal(report.totalSteps, 2);
  assert.equal(report.durationLabel, '1분 24초');
  assert.equal(report.evidencePreviewUrl, '/api/runs/111/artifacts/screenshot-1/content');
  assert.equal(report.heroTitle, 'Example Landing');
  assert.equal(report.heroCallToAction, 'Primary CTA');
  assert.equal(report.findings.length, 1);
  assert.equal(report.findings[0].evidenceRefs.includes('obs_cta_001'), true);
  assert.equal(report.findings[0].highlight, null);
  assert.equal(report.recommendations.length, 1);
  assert.equal(report.decisionNodes.some((node) => node.id === 'evidence-depth'), true);
});

test('buildRunReportFromEvidence derives scenario label from persisted scenario type when route query is absent', () => {
  const report = buildRunReportFromEvidence({
    run: completedRun,
    evidencePacket: {
      ...evidencePacket,
      scenario: {
        scenario_type: 'PRICING',
        goal: '가격표에서 플랜 선택까지 확인',
      },
    },
    scenarioId: null,
  });

  assert.equal(report.scenarioLabel, '가격 / 요금제 흐름 점검');
});
