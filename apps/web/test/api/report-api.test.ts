import test from 'node:test';
import assert from 'node:assert/strict';

import type { ApiResponse } from '../../src/api/http';
import { createRunReportExport, downloadReportExport, getReport, generateRunReport, getRunReport, listRunReports } from '../../src/api/reports';
import { requestRunAnalysis } from '../../src/api/runs';
import type { AnalysisRequestResponse } from '../../src/entities/run';
import type { ReportDetail, ReportExport, ReportSummary, RunReportProjection } from '../../src/entities/report';

const runId = '11111111-1111-4111-8111-111111111111';
const reportId = '22222222-2222-4222-8222-222222222222';
const analysisJobId = '33333333-3333-4333-8333-333333333333';
const evidencePacketId = '44444444-4444-4444-8444-444444444444';

function response<T>(payload: ApiResponse<T>) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

const analysisResponse = {
  data: {
    analysisJobId,
    runId,
    status: 'QUEUED',
    analysisType: 'PRIMARY',
    evidencePacketId,
    evidencePacketIncluded: true,
    checkpointCount: 2,
    artifactCount: 1,
  },
  meta: { requestId: 'req_analysis' },
} satisfies ApiResponse<AnalysisRequestResponse>;

const runReportResponse = {
  data: {
    runId,
    reportStatus: 'READY',
    analysisStatus: 'COMPLETED',
    analysisJobId,
    reportId,
    title: 'Wedge Report',
    format: 'JSON',
    status: 'READY',
    summary: { friction_score: 72 },
    decisionMap: [],
    findings: [],
    nudges: [],
    errorCode: null,
    errorMessage: null,
    createdAt: '2026-05-04T01:00:00Z',
    updatedAt: '2026-05-04T01:00:00Z',
  },
  meta: { requestId: 'req_run_report' },
} satisfies ApiResponse<RunReportProjection>;

const reportSummaryResponse = {
  data: [{
    id: reportId,
    runId,
    analysisJobId,
    title: 'Wedge Report',
    format: 'JSON',
    status: 'READY',
    frictionScore: 72,
    summary: { friction_score: 72 },
    decisionMap: [],
    topFindings: [{
      id: 'finding-1',
      rank: 1,
      title: 'CTA is unclear',
      summary: 'Primary CTA needs stronger context.',
      stage: 'CTA',
      severity: 2,
      confidence: 0.82,
      priorityScore: 88,
      previewImage: null,
    }],
    createdAt: '2026-05-04T01:00:00Z',
  }],
  meta: { requestId: 'req_report_list' },
} satisfies ApiResponse<ReportSummary[]>;

const reportDetailResponse = {
  data: {
    id: reportId,
    runId,
    analysisJobId,
    title: 'Wedge Report',
    format: 'JSON',
    status: 'READY',
    frictionScore: 72,
    summary: { friction_score: 72 },
    decisionMap: [],
    initialDisplayCount: 3,
    findings: [{
      id: 'finding-1',
      rank: 1,
      title: 'CTA is unclear',
      summary: 'Primary CTA needs stronger context.',
      category: null,
      stage: 'CTA',
      axis: 'Friction',
      severity: 2,
      confidence: 0.82,
      priorityScore: 88,
      impactHypothesis: null,
      evidenceRefs: [{ checkpointId: 'cp-1' }],
      previewImage: null,
      nudges: [{
        id: 'nudge-1',
        rank: 1,
        title: 'Add CTA support copy',
        rationale: null,
        recommendation: null,
        difficulty: null,
        expectedEffect: null,
        validationQuestion: null,
      }],
    }],
    createdAt: '2026-05-04T01:00:00Z',
  },
  meta: { requestId: 'req_report_detail' },
} satisfies ApiResponse<ReportDetail>;

const reportExportResponse = {
  data: {
    reportId,
    runId,
    analysisJobId,
    format: 'MARKDOWN',
    status: 'READY',
    artifactId: '55555555-5555-4555-8555-555555555555',
    downloadUrl: `/api/runs/${runId}/artifacts/55555555-5555-4555-8555-555555555555/content`,
    createdAt: '2026-05-11T01:00:00Z',
  },
  meta: { requestId: 'req_report_export' },
} satisfies ApiResponse<ReportExport>;

test('analysis and report api clients call implemented backend endpoints', async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string }> = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ url, method });

    if (url.endsWith('/analysis')) {
      return response(analysisResponse);
    }

    if (url.endsWith('/reports') && method === 'POST') {
      return response(reportExportResponse);
    }

    if (url.endsWith('/reports')) {
      return response(reportSummaryResponse);
    }

    if (url.includes('/api/reports/')) {
      return response(reportDetailResponse);
    }

    return response(runReportResponse);
  }) as typeof fetch;

  try {
    const analysis = await requestRunAnalysis(runId);
    const runReport = await getRunReport(runId);
    const generatedReport = await generateRunReport(runId);
    const reportSummaries = await listRunReports(runId);
    const reportExport = await createRunReportExport(runId, { format: 'MARKDOWN', analysisJobId });
    const reportDetail = await getReport(reportId);

    assert.deepEqual(calls, [
      { url: `/api/runs/${runId}/analysis`, method: 'POST' },
      { url: `/api/runs/${runId}/report`, method: 'GET' },
      { url: `/api/runs/${runId}/report`, method: 'POST' },
      { url: `/api/runs/${runId}/reports`, method: 'GET' },
      { url: `/api/runs/${runId}/reports`, method: 'POST' },
      { url: `/api/reports/${reportId}`, method: 'GET' },
    ]);
    assert.equal(analysis.data.status, 'QUEUED');
    assert.equal(runReport.data.reportStatus, 'READY');
    assert.equal(generatedReport.data.reportId, reportId);
    assert.equal(reportSummaries.data[0].topFindings[0].rank, 1);
    assert.equal(reportExport.data.format, 'MARKDOWN');
    assert.equal(reportExport.data.downloadUrl, `/api/runs/${runId}/artifacts/55555555-5555-4555-8555-555555555555/content`);
    assert.equal(reportDetail.data.findings[0].nudges[0].recommendation, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('downloadReportExport fetches same-origin report artifact content as a blob', async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string }> = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), method: init?.method ?? 'GET' });
    return new Response('# 리포트\n', {
      status: 200,
      headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
    });
  }) as typeof fetch;

  try {
    const blob = await downloadReportExport(`/api/runs/${runId}/artifacts/artifact-1/content`);

    assert.equal(blob.type, 'text/markdown;charset=utf-8');
    assert.deepEqual(calls, [
      { url: `/api/runs/${runId}/artifacts/artifact-1/content`, method: 'GET' },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
