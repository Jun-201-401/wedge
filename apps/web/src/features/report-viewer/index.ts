export { RunReportBrand, RunReportViewer, type ReportDownloadFormat } from './components/RunReportViewer';
export { hydrateEvidenceArtifacts, normalizeRunArtifactType } from './lib/evidenceArtifactHydration';
export { buildMockRunReportData } from './lib/runReportMock';
export { buildRunReportFromApi, selectLatestScreenshotPreviewUrl } from './lib/runReportFromApi';
export { buildRunReportFromEvidence } from './lib/runReportFromEvidence';
export type {
  DecisionNodeTone,
  FindingSeverity,
  ReportDecisionNode,
  ReportFinding,
  ReportRecommendation,
  RunReportViewModel,
} from './lib/runReportViewModel';

export const reportViewerFeature = {
  name: 'report-viewer',
  description: 'Report and evidence viewing UI.',
};
