export { buildMockRunMonitorData } from './lib/runMonitorMock';
export type { MockRunMonitorData, RunActionLog, RunStepItem, StepStatus } from './lib/runMonitorMock';
export {
  RUN_MONITOR_REFRESH_INTERVAL_MS,
  buildApiStepTimeline,
  buildApiSnapshotLogs,
  buildApiSnapshotSteps,
  canOpenRunReport,
  canRequestRunDelete,
  canRequestRunStop,
  findEvidenceScreenshotArtifact,
  formatRunStartedAt,
  getApiCheckpoint,
  getApiProgressPercent,
  getCheckpointArtifacts,
  getDepthLabel,
  getDevicePresetLabel,
  getEvidenceArtifactLabel,
  getEvidenceCheckpointTitle,
  getEvidenceObservationSummary,
  getFailureCodeLabel,
  getStatusTone,
  getStepStatusLabel,
  resolveRunMonitorReportCtaState,
  shouldRefreshRunReport,
  shouldRefreshRunLive,
} from './lib/runMonitorViewModel';
export type { RunMonitorReportCtaKind, RunMonitorReportCtaState, RunStatusTone } from './lib/runMonitorViewModel';
export { useRunMonitorState } from './lib/useRunMonitorState';

export const runMonitorFeature = {
  name: 'run-monitor',
  description: 'Live run monitoring UI.',
};
