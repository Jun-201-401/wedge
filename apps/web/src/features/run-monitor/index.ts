export { buildMockRunMonitorData } from './lib/runMonitorMock';
export type { MockRunMonitorData, RunActionLog, RunStepItem, StepStatus } from './lib/runMonitorMock';
export {
  RUN_MONITOR_REFRESH_INTERVAL_MS,
  buildApiEventLogs,
  buildApiEventTimeline,
  buildApiStepTimeline,
  buildApiSnapshotLogs,
  buildApiSnapshotSteps,
  buildRunCollectionSummaryStats,
  canAnalyzeRun,
  canOpenRunReport,
  canRequestRunDelete,
  canRequestRunStop,
  findEvidenceScreenshotArtifact,
  formatRunStartedAt,
  getApiCheckpoint,
  getApiProgressPercent,
  getCheckpointArtifacts,
  getCurrentRunReportProjection,
  getDepthLabel,
  getDevicePresetLabel,
  getEvidenceArtifactLabel,
  getEvidenceScreenshotPreviewUrl,
  getEvidenceCheckpointTitle,
  getEvidenceObservationSummary,
  getFailureCodeLabel,
  getStatusTone,
  getStepStatusLabel,
  resolveRunMonitorReportCtaState,
  shouldRefreshRunReport,
  shouldRefreshRunLive,
} from './lib/runMonitorViewModel';
export type { RunCollectionSummaryStats, RunMonitorReportCtaKind, RunMonitorReportCtaState, RunStatusTone } from './lib/runMonitorViewModel';
export { useRunMonitorState } from './lib/useRunMonitorState';

export const runMonitorFeature = {
  name: 'run-monitor',
  description: 'Live run monitoring UI.',
};
