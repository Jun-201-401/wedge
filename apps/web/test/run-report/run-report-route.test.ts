import test from 'node:test';
import assert from 'node:assert/strict';

import { buildRunReportPath, getRunReportIdFromPath } from '../../src/pages/run-report/lib/runReportRoute';

const runUuid = '11111111-1111-4111-8111-111111111111';

test('buildRunReportPath encodes accepted run ids and report query state', () => {
  assert.equal(
    buildRunReportPath(runUuid, {
      submittedUrl: 'https://example.com/path?a=1',
      scenarioId: 'landing-cta',
      depthId: 'hero-only',
    }),
    `/runs/${runUuid}/report?url=https%3A%2F%2Fexample.com%2Fpath%3Fa%3D1&scenario=landing-cta&depth=hero-only`,
  );

  assert.equal(
    buildRunReportPath('mock-landing-cta', {
      submittedUrl: 'https://example.com/',
      scenarioId: 'landing-cta',
      depthId: 'next-screen',
    }),
    '/runs/mock-landing-cta/report?url=https%3A%2F%2Fexample.com%2F&scenario=landing-cta&depth=next-screen',
  );

  assert.throws(() => buildRunReportPath('run 123', {
    submittedUrl: 'https://example.com/',
    scenarioId: 'landing-cta',
    depthId: 'hero-only',
  }), /requires a UUID or mock run id/);
});

test('getRunReportIdFromPath only accepts explicit report paths', () => {
  assert.equal(getRunReportIdFromPath(`/runs/${runUuid}/report`), runUuid);
  assert.equal(getRunReportIdFromPath('/runs/mock-landing-cta/report'), 'mock-landing-cta');
  assert.equal(getRunReportIdFromPath('/runs/mock-landing-cta'), null);
  assert.equal(getRunReportIdFromPath('/runs/mock-landing-cta/report/extra'), null);
  assert.equal(getRunReportIdFromPath('/runs/run-123/report'), null);
  assert.equal(getRunReportIdFromPath('/create-analysis'), null);
});
