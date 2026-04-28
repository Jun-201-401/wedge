export { RunReportBrand, RunReportViewer } from './components/RunReportViewer';
export { buildMockRunReportData } from './lib/runReportMock';
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
