import test from 'node:test';
import assert from 'node:assert/strict';

import type { EvidencePacket, RunArtifact } from '../../src/entities/run';
import { hydrateEvidenceArtifacts, normalizeRunArtifactType } from '../../src/features/report-viewer/lib/evidenceArtifactHydration';
import { buildRunReportFromEvidence } from '../../src/features/report-viewer/lib/runReportFromEvidence';

const evidencePacket: EvidencePacket = {
  schema_version: '0.5',
  execution_type: 'RUN',
  run_id: 'dd5f9c57-84e2-4ea6-b0c3-27b7f8a5b3e2',
  url: 'https://example.com/',
  final_url: 'https://example.com/',
  checkpoints: [
    {
      checkpoint_id: 'cp-1',
      step_id: 'step_001_goto',
      primaryStage: 'FIRST_VIEW',
      trigger: {},
      settle: {},
      state: { title: 'Example Landing' },
      observations: [
        {
          observation_id: 'obs-1',
          type: 'cta_candidate',
          stage: 'CTA',
          source: ['dom'],
          data: { target: 'Start free' },
        },
      ],
      deltas: [],
      artifact_refs: ['11111111-1111-4111-8111-111111111111'],
    },
  ],
  artifacts: [],
};

const screenshotArtifact: RunArtifact = {
  id: '11111111-1111-4111-8111-111111111111',
  runId: 'dd5f9c57-84e2-4ea6-b0c3-27b7f8a5b3e2',
  stepId: null,
  stepKey: 'step_001_goto',
  artifactType: 'SCREENSHOT',
  bucket: 'local-runner',
  key: 'screenshot.png',
  mimeType: 'image/png',
  width: 1440,
  height: 900,
  sizeBytes: 184211,
  sha256: null,
  url: null,
  contentUrl: '/api/runs/dd5f9c57-84e2-4ea6-b0c3-27b7f8a5b3e2/artifacts/11111111-1111-4111-8111-111111111111/content',
  createdAt: '2026-04-27T01:30:00Z',
};

test('hydrateEvidenceArtifacts normalizes run artifact types into evidence artifact types', () => {
  assert.equal(normalizeRunArtifactType('SCREENSHOT'), 'screenshot');
  assert.equal(normalizeRunArtifactType('DOM_SNAPSHOT'), 'dom_snapshot');
  assert.equal(normalizeRunArtifactType('REPORT_PDF'), 'report');

  const hydratedPacket = hydrateEvidenceArtifacts(evidencePacket, [screenshotArtifact]);

  assert.equal(hydratedPacket.artifacts.length, 1);
  assert.equal(hydratedPacket.artifacts[0].type, 'screenshot');
  assert.equal(hydratedPacket.artifacts[0].uri, screenshotArtifact.contentUrl);
});

test('hydrated screenshot artifacts can drive the report preview', () => {
  const hydratedPacket = hydrateEvidenceArtifacts(evidencePacket, [screenshotArtifact]);
  const report = buildRunReportFromEvidence({
    run: {
      id: 'dd5f9c57-84e2-4ea6-b0c3-27b7f8a5b3e2',
      type: 'run',
      projectId: '22222222-2222-4222-8222-222222222222',
      name: '첫 화면 CTA 점검',
      triggerSource: 'WEB',
      startUrl: 'https://example.com/',
      goal: '첫 화면 CTA 점검',
      devicePreset: 'desktop',
      scenarioTemplateVersionId: '33333333-3333-4333-8333-333333333333',
      status: 'COMPLETED',
      resultCompleteness: 'FINAL',
      analysisStatus: 'COMPLETED',
      currentStepOrder: 1,
      startedAt: '2026-04-27T01:00:00.000Z',
      finishedAt: '2026-04-27T01:01:00.000Z',
      failureCode: null,
      failureMessage: null,
      latestSnapshot: null,
    },
    evidencePacket: hydratedPacket,
    scenarioId: 'landing-cta',
  });

  assert.equal(report.evidencePreviewUrl, screenshotArtifact.contentUrl);
});
