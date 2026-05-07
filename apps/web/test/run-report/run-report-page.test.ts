import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('app routes /runs/:runId/report to the run report page before monitor matching', () => {
  const source = fs.readFileSync(new URL('../../src/app/App.tsx', import.meta.url), 'utf8');
  const appRoute = fs.readFileSync(new URL('../../src/app/appRoute.ts', import.meta.url), 'utf8');
  const pages = fs.readFileSync(new URL('../../src/pages/index.ts', import.meta.url), 'utf8');

  assert.match(source, /import \{ resolveAppRoute \}/);
  assert.match(source, /<RunReportPage runId=\{route\.runId\} \/>/);
  assert.match(appRoute, /const reportRunId = getRunReportIdFromPath\(pathname\);[\s\S]*const runId = getRunIdFromPath\(pathname\);/);
  assert.match(pages, /runReport/);
  assert.match(pages, /:runId\/report/);
});

test('run report page follows the report.html result-first layout', () => {
  const page = fs.readFileSync(new URL('../../src/pages/run-report/RunReportPage.tsx', import.meta.url), 'utf8');
  const viewer = fs.readFileSync(new URL('../../src/features/report-viewer/components/RunReportViewer.tsx', import.meta.url), 'utf8');
  const state = fs.readFileSync(new URL('../../src/pages/run-report/lib/runReportState.ts', import.meta.url), 'utf8');
  const source = `${page}\n${viewer}\n${state}`;
  const mock = fs.readFileSync(new URL('../../src/features/report-viewer/lib/runReportMock.ts', import.meta.url), 'utf8');
  const viewModel = fs.readFileSync(new URL('../../src/features/report-viewer/lib/runReportViewModel.ts', import.meta.url), 'utf8');

  assert.match(source, /랜딩 페이지/);
  assert.match(source, /CTA 전환 마찰 리포트/);
  assert.match(source, /function RunReportStatePage/);
  assert.match(source, /getRun\(runId\)/);
  assert.match(source, /getRunReport\(runId\)/);
  assert.match(source, /getReport\(reportProjection\.reportId\)/);
  assert.match(source, /generateRunReport\(runId\)/);
  assert.match(source, /requestRunAnalysis\(runId\)/);
  assert.match(source, /getRunEvidencePacket\(runId\)/);
  assert.match(source, /listRunArtifacts\(runId\)/);
  assert.match(source, /hydrateEvidenceArtifacts/);
  assert.match(source, /Artifact list is a preview\/download enhancement/);
  assert.match(source, /buildMockRunReportData/);
  assert.match(source, /buildRunReportFromApi/);
  assert.match(source, /buildRunReportFromEvidence/);
  assert.match(source, /reportProjection\?\.reportStatus === 'READY'/);
  assert.match(source, /\[evidencePacket, isMockRun, reportDetail, reportLoadError, reportProjection, run, runId, scenarioId, targetUrl\]/);
  assert.match(source, /sourceNotice: reportLoadError/);
  assert.match(source, /useAuthenticatedResourceUrl\(report\.evidencePreviewUrl\)/);
  assert.match(source, /role="status"/);
  assert.match(source, /if \(isMockRun\)/);
  assert.match(source, /리포트 준비 중입니다/);
  assert.match(source, /리포트 생성/);
  assert.match(source, /분석 시작/);
  assert.match(source, /리포트 데이터 연결 대기 중입니다/);
  assert.match(source, /리포트 근거를 불러오는 중입니다/);
  assert.match(source, /Run을 찾을 수 없습니다/);
  assert.match(source, /분석 완료/);
  assert.match(source, /Report ID:/);
  assert.match(source, /Export PDF/);
  assert.match(source, /Share Report/);
  assert.match(source, /isMockRunId\(runId\)/);
  assert.match(source, /발견된 마찰이 없습니다/);
  assert.match(source, /총 단계/);
  assert.match(source, /마찰 지점/);
  assert.match(source, /소요 시간/);
  assert.match(source, /Decision Map/);
  assert.match(source, /Evidence Details/);
  assert.match(source, /Recommended Nudge/);
  assert.match(source, /Recommended Nudge[\s\S]*Decision Map[\s\S]*Evidence Details/);
  assert.match(source, /Expected Impact/);
  assert.match(source, /Difficulty/);
  assert.match(source, /run-report-section--priority/);
  assert.match(source, /run-report-decision-map/);
  assert.match(source, /run-report-nudge-card/);
  assert.match(source, /run-report-evidence-preview/);
  assert.doesNotMatch(source, /run-report-side-column/);
  assert.match(mock, /reportId/);
  assert.match(mock, /mock-report-evidence\.png/);
  assert.doesNotMatch(mock, /interface RunReportViewModel/);
  assert.match(viewModel, /interface RunReportViewModel/);
  assert.match(mock, /totalSteps/);
  assert.match(mock, /durationLabel/);
  assert.match(mock, /decisionNodes/);
  assert.match(mock, /사용자가 CTA를 발견했는가/);
  assert.match(mock, /CTA가 첫 화면에서 충분히 두드러지지 않음/);
  assert.match(mock, /issueId/);
  assert.match(mock, /priorityScore/);
  assert.match(mock, /evidenceRefs/);
  assert.match(mock, /expectedImpact/);
  assert.match(mock, /CTA 직전 신뢰 요소 배치/);
  assert.match(mock, /Form 진입 전 기대 정보가 부족함/);
});

test('run report css keeps result-first content in the live simulation cockpit tone', () => {
  const css = fs.readFileSync(new URL('../../src/features/report-viewer/styles/run-report-viewer.css', import.meta.url), 'utf8');

  assert.match(css, /\.run-report-page\s*\{[\s\S]*?background: #fff/);
  assert.match(css, /\.run-report-grid-bg\s*\{[\s\S]*?radial-gradient\(#f1f5f9 1px/);
  assert.match(css, /\.run-report-brand\s*\{[\s\S]*?color: #7dd3fc/);
  assert.match(css, /\.run-report-topbar__share\s*\{[\s\S]*?background: #334155/);
  assert.match(css, /\.run-report-shell\s*\{[\s\S]*?height: calc\(100vh - 4rem\)/);
  assert.match(css, /\.run-report-hero\s*\{[\s\S]*?align-items: flex-end/);
  assert.match(css, /\.run-report-hero h1 span\s*\{[\s\S]*?color: #020617/);
  assert.match(css, /\.run-report-hero \.run-report-hero__notice\s*\{[\s\S]*?background: rgba\(254, 252, 232, 0\.92\)/);
  assert.match(css, /\.run-report-hero-stats\s*\{[\s\S]*?background: #f8fafc/);
  assert.match(css, /\.run-report-hero-stats div \+ div\s*\{[\s\S]*?border-left: 1px solid #e5e7eb/);
  assert.match(css, /\.run-report-main-column\s*\{[\s\S]*?width: min\(100%, 76rem\)/);
  assert.match(css, /\.run-report-main-column > \.run-report-section--priority\s*\{[\s\S]*?background: linear-gradient/);
  assert.doesNotMatch(css, /!important/);
  assert.match(css, /\.run-report-nudge-list\s*\{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.run-report-decision-map::before\s*\{[\s\S]*?background: #f1f5f9/);
  assert.match(css, /\.run-report-evidence-preview\s*\{[\s\S]*?aspect-ratio: 16 \/ 8/);
  assert.match(css, /\.run-report-evidence-preview__hero button\s*\{[\s\S]*?background: #111827/);
  assert.match(css, /\.run-report-state-card a,\s*\n\.run-report-state-card button\s*\{[\s\S]*?background: #334155/);
  assert.doesNotMatch(css, /run-report-side-column/);
  assert.match(css, /@media \(max-width: 1080px\)/);
  assert.match(css, /@media \(max-width: 760px\)/);
});

test('authenticated resource hook avoids raw api image urls and cleans blob urls', () => {
  const source = fs.readFileSync(
    new URL('../../src/shared/lib/authenticatedResourceUrl.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /useState<string \\| null>\(null\)/);
  assert.doesNotMatch(source, /useState<string \\| null>\(resourceUrl \?\? null\)/);
  assert.match(source, /URL\.createObjectURL\(blob\)/);
  assert.match(source, /URL\.revokeObjectURL\(objectUrl\)/);
  assert.match(source, /\.catch\(\(\) => \{[\s\S]*?setResolvedUrl\(null\)/);
});

test('run monitor exposes a report CTA into /runs/:runId/report', () => {
  const source = fs.readFileSync(new URL('../../src/pages/run-monitor/RunMonitorPage.tsx', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../../src/pages/run-monitor/RunMonitorPage.css', import.meta.url), 'utf8');

  assert.match(source, /import \{ buildRunReportPath \}/);
  assert.match(source, /const reportCtaState = resolveRunMonitorReportCtaState/);
  assert.match(source, /const reportPath = reportCtaState\.canOpenReport[\s\S]*buildRunReportPath\(run\.id/);
  assert.match(source, /getRunReport\(run\.id\)/);
  assert.match(source, /generateRunReport\(requestedRunId\)/);
  assert.match(source, /requestRunAnalysis\(requestedRunId\)/);
  assert.match(source, /reportCtaState\.titleLabel/);
  assert.match(source, /reportCtaState\.kind !== 'hidden'/);
  assert.match(source, /분석 결과 리포트/);
  assert.match(source, /리포트 보기/);
  assert.match(source, /리포트 생성/);
  assert.match(source, /분석 시작/);
  assert.doesNotMatch(source, /모의 리포트 보기/);
  assert.match(css, /\.run-monitor-report-cta\s*\{[\s\S]*?background: rgba\(240, 249, 255, 0\.62\)/);
  assert.match(css, /\.run-monitor-report-cta a,\s*\n\.run-monitor-report-cta button\s*\{[\s\S]*?background: #334155/);
  assert.match(css, /\.run-monitor-report-cta button:disabled\s*\{[\s\S]*?cursor: not-allowed/);
});
