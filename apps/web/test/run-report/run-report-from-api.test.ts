import test from 'node:test';
import assert from 'node:assert/strict';

import type { ReportDetail, RunReportProjection } from '../../src/entities/report';
import type { Run, RunArtifact } from '../../src/entities/run';
import { buildRunReportFromApi, selectLatestScreenshotPreviewUrl } from '../../src/features/report-viewer/lib/runReportFromApi';

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
  analysisStatus: 'COMPLETED',
  currentStepOrder: 3,
  startedAt: '2026-04-27T01:00:00.000Z',
  finishedAt: '2026-04-27T01:01:24.000Z',
  failureCode: null,
  failureMessage: null,
  latestSnapshot: null,
};

const readyReport: RunReportProjection = {
  runId: completedRun.id,
  reportStatus: 'READY',
  analysisStatus: 'COMPLETED',
  analysisJobId: '44444444-4444-4444-8444-444444444444',
  reportId: '55555555-5555-4555-8555-555555555555',
  title: '백엔드 리포트',
  format: 'JSON',
  status: 'READY',
  summary: {
    friction_score: 81,
    targetUrl: 'https://example.com/pricing',
    primary_cta: 'Start now',
    summary: 'CTA 결정 지점에 마찰이 있습니다.',
  },
  decisionMap: [{
    stage: 'CTA',
    displayName: '행동 선택',
    status: 'WARNING',
    issueIds: ['finding-1'],
    summary: 'CTA 문맥이 부족합니다.',
    evidenceRefs: ['cp-1.obs-1'],
  }],
  findings: [{
    id: 'finding-1',
    rankOrder: 1,
    title: 'CTA 문맥 부족',
    summary: '사용자가 다음 행동을 확신하기 어렵습니다.',
    category: 'friction',
    stage: 'CTA',
    axis: 'Friction',
    severity: 3,
    confidence: 0.91,
    priorityScore: 94,
    impactHypothesis: 'CTA 근처에 신뢰 문구를 추가하세요.',
    evidenceRefs: [{ checkpointId: 'cp-1', observationId: 'obs-1' }],
    references: [{
      label: 'WCAG 3.3.2',
      publisher: 'W3C',
      title: 'Labels or Instructions',
      basisSummary: 'Inputs need labels or instructions.',
      url: 'https://www.w3.org/WAI/WCAG22/Understanding/labels-or-instructions.html',
    }],
  }],
  nudges: [{
    id: 'nudge-1',
    findingId: 'finding-1',
    rankOrder: 1,
    title: 'CTA 보조 문구 추가',
    rationale: '사용자가 클릭 후 결과를 이해해야 합니다.',
    recommendation: 'CTA 아래에 기대 결과를 한 문장으로 설명하세요.',
    difficulty: 'Low',
    expectedEffect: '전환 판단 근거 강화',
    validationQuestion: null,
  }],
  errorCode: null,
  errorMessage: null,
  createdAt: '2026-04-27T01:02:00.000Z',
  updatedAt: '2026-04-27T01:03:00.000Z',
};

const reportDetail: ReportDetail = {
  id: '55555555-5555-4555-8555-555555555555',
  runId: completedRun.id,
  analysisJobId: '44444444-4444-4444-8444-444444444444',
  title: '백엔드 리포트',
  format: 'JSON',
  status: 'READY',
  frictionScore: 81,
  summary: readyReport.summary,
  decisionMap: [{
    stage: 'CTA',
    displayName: '행동 선택',
    status: 'WARNING',
    issueIds: ['detail-finding-1'],
    summary: 'CTA 문맥이 부족합니다.',
    evidenceRefs: ['cp-detail.obs-1'],
  }],
  initialDisplayCount: 3,
  findings: [{
    id: 'detail-finding-1',
    rank: 1,
    title: '상세 CTA 문맥 부족',
    summary: '상세 응답 기준으로 사용자가 다음 행동을 확신하기 어렵습니다.',
    category: 'friction',
    stage: 'CTA',
    axis: 'Friction',
    severity: 3,
    confidence: 0.93,
    priorityScore: 98,
    impactHypothesis: 'CTA 근처에 신뢰 문구를 추가하세요.',
    evidenceRefs: [{ ref: 'cp-detail.obs-1' }],
    references: [{
      label: 'GOV.UK Buttons',
      publisher: 'GOV.UK',
      title: 'Button component',
      basisSummary: 'Buttons should communicate the action users can take.',
      url: 'https://design-system.service.gov.uk/components/button/',
    }],
    previewImage: {
      artifact: {
        id: '66666666-6666-4666-8666-666666666666',
        runId: completedRun.id,
        stepId: null,
        stepKey: 'hero',
        artifactType: 'SCREENSHOT',
        bucket: 'wedge-artifacts',
        key: 'runs/report/hero.png',
        mimeType: 'image/png',
        width: 1440,
        height: 900,
        sizeBytes: 1024,
        sha256: null,
        url: null,
        contentUrl: `/api/runs/${completedRun.id}/artifacts/66666666-6666-4666-8666-666666666666/content`,
        createdAt: '2026-04-27T01:02:30.000Z',
      },
      source: 'STAGE_SCREENSHOT',
    },
    highlight: {
      evidenceRef: 'cp-detail.obs-1',
      label: 'Start free',
      source: 'artifact-coordinate',
      coordinateSpace: 'viewport',
      bounds: {
        x: 520,
        y: 360,
        width: 220,
        height: 56,
        unit: 'css_px',
      },
      viewport: {
        width: 1440,
        height: 900,
      },
      screenshotArtifactId: '66666666-6666-4666-8666-666666666666',
    },
    nudges: [{
      id: 'detail-nudge-1',
      rank: 1,
      title: '상세 CTA 보조 문구 추가',
      rationale: '사용자가 클릭 후 결과를 이해해야 합니다.',
      recommendation: '상세 CTA 아래에 기대 결과를 한 문장으로 설명하세요.',
      difficulty: 'Low',
      expectedEffect: '전환 판단 근거 강화',
      validationQuestion: null,
    }],
  }],
  createdAt: '2026-04-27T01:02:00.000Z',
};

const screenshotArtifacts: RunArtifact[] = [
  {
    id: '77777777-7777-4777-8777-777777777777',
    runId: completedRun.id,
    stepId: null,
    stepKey: 'first-view',
    artifactType: 'SCREENSHOT',
    bucket: 'wedge-artifacts',
    key: 'runs/report/first-view.png',
    mimeType: 'image/png',
    width: 1440,
    height: 900,
    sizeBytes: 2048,
    sha256: null,
    url: null,
    contentUrl: `/api/runs/${completedRun.id}/artifacts/77777777-7777-4777-8777-777777777777/content`,
    createdAt: '2026-04-27T01:02:00.000Z',
  },
  {
    id: '88888888-8888-4888-8888-888888888888',
    runId: completedRun.id,
    stepId: null,
    stepKey: 'final',
    artifactType: 'SCREENSHOT',
    bucket: 'wedge-artifacts',
    key: 'runs/report/final.png',
    mimeType: 'image/png',
    width: 1440,
    height: 900,
    sizeBytes: 4096,
    sha256: null,
    url: null,
    contentUrl: `/api/runs/${completedRun.id}/artifacts/88888888-8888-4888-8888-888888888888/content`,
    createdAt: '2026-04-27T01:03:00.000Z',
  },
  {
    id: '99999999-9999-4999-8999-999999999999',
    runId: completedRun.id,
    stepId: null,
    stepKey: 'dom',
    artifactType: 'DOM_SNAPSHOT',
    bucket: 'wedge-artifacts',
    key: 'runs/report/dom.html',
    mimeType: 'text/html',
    width: null,
    height: null,
    sizeBytes: 512,
    sha256: null,
    url: null,
    contentUrl: `/api/runs/${completedRun.id}/artifacts/99999999-9999-4999-8999-999999999999/content`,
    createdAt: '2026-04-27T01:04:00.000Z',
  },
];

test('buildRunReportFromApi projects backend report data into report view model', () => {
  const report = buildRunReportFromApi({ run: completedRun, report: readyReport, scenarioId: 'landing-cta' });

  assert.equal(report.runId, completedRun.id);
  assert.equal(report.reportId, readyReport.reportId);
  assert.equal(report.targetUrl, 'https://example.com/pricing');
  assert.equal(report.score, 81);
  assert.equal(report.heroTitle, '백엔드 리포트');
  assert.equal(report.heroCallToAction, 'Start now');
  assert.equal(report.decisionNodes[0].tone, 'friction');
  assert.equal(report.findings[0].severity, 'high');
  assert.equal(report.findings[0].evidenceRefs[0], 'cp-1');
  assert.equal(report.findings[0].references?.[0]?.label, 'WCAG 3.3.2');
  assert.equal(report.findings[0].highlight, null);
  assert.equal(report.recommendations[0].detail, 'CTA 아래에 기대 결과를 한 문장으로 설명하세요.');
});

test('buildRunReportFromApi prefers report detail finding preview image when available', () => {
  const report = buildRunReportFromApi({
    run: completedRun,
    report: readyReport,
    detail: reportDetail,
    scenarioId: 'landing-cta',
  });

  assert.equal(report.evidencePreviewUrl, reportDetail.findings[0].previewImage?.artifact.contentUrl);
  assert.equal(report.findings[0].id, 'detail-finding-1');
  assert.equal(report.findings[0].title, '상세 CTA 문맥 부족');
  assert.equal(report.findings[0].previewImageUrl, reportDetail.findings[0].previewImage?.artifact.contentUrl);
  assert.equal(report.findings[0].evidenceRefs[0], 'cp-detail.obs-1');
  assert.equal(report.findings[0].references?.[0]?.label, 'GOV.UK Buttons');
  assert.equal(report.findings[0].highlight?.source, 'artifact-coordinate');
  assert.equal(report.findings[0].highlight?.label, 'Start free');
  assert.equal(report.findings[0].highlight?.left, '36.11%');
  assert.equal(report.findings[0].highlight?.top, '40.00%');
  assert.equal(report.findings[0].highlight?.width, '15.28%');
  assert.equal(report.findings[0].highlight?.height, '6.22%');
  assert.equal(report.recommendations[0].findingId, 'detail-finding-1');
  assert.equal(report.recommendations[0].detail, '상세 CTA 아래에 기대 결과를 한 문장으로 설명하세요.');
});

test('buildRunReportFromApi projects viewport coordinates onto tall screenshot artifacts', () => {
  const tallScreenshotDetail: ReportDetail = {
    ...reportDetail,
    findings: [{
      ...reportDetail.findings[0],
      previewImage: {
        ...reportDetail.findings[0].previewImage!,
        artifact: {
          ...reportDetail.findings[0].previewImage!.artifact,
          width: 1440,
          height: 2835,
        },
      },
      highlight: {
        ...reportDetail.findings[0].highlight!,
        bounds: {
          x: 102,
          y: 47,
          width: 32,
          height: 32,
          unit: 'css_px',
        },
        viewport: {
          width: 1440,
          height: 900,
        },
      },
    }],
  };

  const report = buildRunReportFromApi({
    run: completedRun,
    report: readyReport,
    detail: tallScreenshotDetail,
    scenarioId: 'landing-cta',
  });

  assert.equal(report.findings[0].highlight?.left, '7.08%');
  assert.equal(report.findings[0].highlight?.top, '1.66%');
  assert.equal(report.findings[0].highlight?.width, '2.22%');
  assert.equal(report.findings[0].highlight?.height, '1.13%');
});

test('buildRunReportFromApi adds scroll offset when projecting viewport coordinates onto stitched screenshots', () => {
  const stitchedScreenshotDetail: ReportDetail = {
    ...reportDetail,
    findings: [{
      ...reportDetail.findings[0],
      previewImage: {
        ...reportDetail.findings[0].previewImage!,
        artifact: {
          ...reportDetail.findings[0].previewImage!.artifact,
          width: 1440,
          height: 8296,
        },
      },
      highlight: {
        ...reportDetail.findings[0].highlight!,
        scrollY: 7396,
        bounds: {
          x: 519,
          y: 231,
          width: 204,
          height: 36,
          unit: 'css_px',
        },
        viewport: {
          width: 1440,
          height: 900,
        },
      },
    }],
  };

  const report = buildRunReportFromApi({
    run: completedRun,
    report: readyReport,
    detail: stitchedScreenshotDetail,
    scenarioId: 'landing-cta',
  });

  assert.equal(report.findings[0].highlight?.left, '36.04%');
  assert.equal(report.findings[0].highlight?.top, '91.94%');
  assert.equal(report.findings[0].highlight?.width, '14.17%');
  assert.equal(report.findings[0].highlight?.height, '0.43%');
});

test('buildRunReportFromApi ignores scroll offset when projecting viewport coordinates onto viewport screenshots', () => {
  const viewportScreenshotDetail: ReportDetail = {
    ...reportDetail,
    findings: [{
      ...reportDetail.findings[0],
      highlight: {
        ...reportDetail.findings[0].highlight!,
        scrollY: 640,
      },
    }],
  };

  const report = buildRunReportFromApi({
    run: completedRun,
    report: readyReport,
    detail: viewportScreenshotDetail,
    scenarioId: 'landing-cta',
  });

  assert.equal(report.findings[0].highlight?.left, '36.11%');
  assert.equal(report.findings[0].highlight?.top, '40.00%');
  assert.equal(report.findings[0].highlight?.width, '15.28%');
  assert.equal(report.findings[0].highlight?.height, '6.22%');
});

test('buildRunReportFromApi ignores coordinate highlight when it targets another screenshot', () => {
  const mismatchedDetail: ReportDetail = {
    ...reportDetail,
    findings: [{
      ...reportDetail.findings[0],
      highlight: {
        ...reportDetail.findings[0].highlight!,
        screenshotArtifactId: '99999999-9999-4999-8999-999999999999',
      },
    }],
  };
  const report = buildRunReportFromApi({
    run: completedRun,
    report: readyReport,
    detail: mismatchedDetail,
    scenarioId: 'landing-cta',
  });

  assert.equal(report.findings[0].highlight, null);
});

test('buildRunReportFromApi accepts artifact-prefixed coordinate highlight ids', () => {
  const prefixedDetail: ReportDetail = {
    ...reportDetail,
    findings: [{
      ...reportDetail.findings[0],
      highlight: {
        ...reportDetail.findings[0].highlight!,
        screenshotArtifactId: `artifact:${reportDetail.findings[0].previewImage!.artifact.id}`,
      },
    }],
  };
  const report = buildRunReportFromApi({
    run: completedRun,
    report: readyReport,
    detail: prefixedDetail,
    scenarioId: 'landing-cta',
  });

  assert.equal(report.findings[0].highlight?.source, 'artifact-coordinate');
});

test('buildRunReportFromApi ignores coordinate highlight without a screenshot binding', () => {
  const unboundDetail: ReportDetail = {
    ...reportDetail,
    findings: [{
      ...reportDetail.findings[0],
      highlight: {
        ...reportDetail.findings[0].highlight!,
        screenshotArtifactId: '',
      },
    }],
  };
  const report = buildRunReportFromApi({
    run: completedRun,
    report: readyReport,
    detail: unboundDetail,
    scenarioId: 'landing-cta',
  });

  assert.equal(report.findings[0].highlight, null);
});

test('buildRunReportFromApi converts viewport ratio highlight coordinates directly', () => {
  const ratioDetail: ReportDetail = {
    ...reportDetail,
    findings: [{
      ...reportDetail.findings[0],
      highlight: {
        evidenceRef: 'cp-detail.obs-1',
        label: 'Ratio target',
        source: 'artifact-coordinate',
        coordinateSpace: 'viewport_ratio',
        bounds: {
          x: 0.25,
          y: 0.5,
          width: 0.2,
          height: 0.1,
          unit: 'viewport_ratio',
        },
        viewport: null,
        screenshotArtifactId: '66666666-6666-4666-8666-666666666666',
      },
    }],
  };
  const report = buildRunReportFromApi({
    run: completedRun,
    report: readyReport,
    detail: ratioDetail,
    scenarioId: 'landing-cta',
  });

  assert.equal(report.findings[0].highlight?.left, '25.00%');
  assert.equal(report.findings[0].highlight?.top, '50.00%');
  assert.equal(report.findings[0].highlight?.width, '20.00%');
  assert.equal(report.findings[0].highlight?.height, '10.00%');
});

test('buildRunReportFromApi scales screenshot pixel highlight coordinates against the preview artifact', () => {
  const screenshotPixelDetail: ReportDetail = {
    ...reportDetail,
    findings: [{
      ...reportDetail.findings[0],
      highlight: {
        evidenceRef: 'cp-detail.obs-1',
        label: 'Screenshot target',
        source: 'artifact-coordinate',
        coordinateSpace: 'screenshot',
        bounds: {
          x: 720,
          y: 225,
          width: 360,
          height: 90,
          unit: 'screenshot_px',
        },
        viewport: null,
        screenshotArtifactId: '66666666-6666-4666-8666-666666666666',
      },
    }],
  };
  const report = buildRunReportFromApi({
    run: completedRun,
    report: readyReport,
    detail: screenshotPixelDetail,
    scenarioId: 'landing-cta',
  });

  assert.equal(report.findings[0].highlight?.left, '50.00%');
  assert.equal(report.findings[0].highlight?.top, '25.00%');
  assert.equal(report.findings[0].highlight?.width, '25.00%');
  assert.equal(report.findings[0].highlight?.height, '10.00%');
});

test('buildRunReportFromApi accepts explicit screenshot pixel units when coordinate space is absent', () => {
  const screenshotPixelDetail: ReportDetail = {
    ...reportDetail,
    findings: [{
      ...reportDetail.findings[0],
      highlight: {
        ...reportDetail.findings[0].highlight!,
        coordinateSpace: null,
        bounds: {
          x: 720,
          y: 225,
          width: 360,
          height: 90,
          unit: 'screenshot_px',
        },
      },
    }],
  };
  const report = buildRunReportFromApi({
    run: completedRun,
    report: readyReport,
    detail: screenshotPixelDetail,
    scenarioId: 'landing-cta',
  });

  assert.equal(report.findings[0].highlight?.left, '50.00%');
  assert.equal(report.findings[0].highlight?.top, '25.00%');
});

test('buildRunReportFromApi ignores highlight coordinates with unsupported units', () => {
  const invalidUnitDetail: ReportDetail = {
    ...reportDetail,
    findings: [{
      ...reportDetail.findings[0],
      highlight: {
        ...reportDetail.findings[0].highlight!,
        coordinateSpace: 'screenshot',
        bounds: {
          ...reportDetail.findings[0].highlight!.bounds,
          unit: 'document_px' as never,
        },
      },
    }],
  };
  const report = buildRunReportFromApi({
    run: completedRun,
    report: readyReport,
    detail: invalidUnitDetail,
    scenarioId: 'landing-cta',
  });

  assert.equal(report.findings[0].highlight, null);
});

test('buildRunReportFromApi links detail fallback recommendations back to their findings', () => {
  const detailWithoutNudges: ReportDetail = {
    ...reportDetail,
    findings: [{
      ...reportDetail.findings[0],
      nudges: [],
    }],
  };
  const report = buildRunReportFromApi({
    run: completedRun,
    report: readyReport,
    detail: detailWithoutNudges,
    scenarioId: 'landing-cta',
  });

  assert.equal(report.recommendations[0].findingId, 'detail-finding-1');
  assert.equal(report.recommendations[0].title, '상세 CTA 문맥 부족');
});

test('selectLatestScreenshotPreviewUrl picks the latest screenshot artifact', () => {
  assert.equal(selectLatestScreenshotPreviewUrl(screenshotArtifacts), screenshotArtifacts[1].contentUrl);
  assert.equal(selectLatestScreenshotPreviewUrl([screenshotArtifacts[2]]), null);
});

test('selectLatestScreenshotPreviewUrl uses public artifact url when content url is absent', () => {
  assert.equal(selectLatestScreenshotPreviewUrl([{
    ...screenshotArtifacts[0],
    contentUrl: null,
    url: 'https://cdn.example.com/report-preview.png',
  }]), 'https://cdn.example.com/report-preview.png');
});

test('buildRunReportFromApi uses a run screenshot fallback when report findings have no preview', () => {
  const reportWithoutFindings: RunReportProjection = {
    ...readyReport,
    findings: [],
    nudges: [],
  };
  const fallbackPreviewUrl = selectLatestScreenshotPreviewUrl(screenshotArtifacts);
  const report = buildRunReportFromApi({
    run: completedRun,
    report: reportWithoutFindings,
    fallbackPreviewUrl,
    scenarioId: 'landing-cta',
  });

  assert.equal(report.findings.length, 0);
  assert.equal(report.evidencePreviewUrl, fallbackPreviewUrl);
});
