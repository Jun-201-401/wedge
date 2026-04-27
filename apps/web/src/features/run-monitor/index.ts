export { buildMockRunMonitorData, getScenarioLabel } from './lib/runMonitorMock';
export type { MockRunMonitorData, RunActionLog, RunStepItem, StepStatus } from './lib/runMonitorMock';
export {
  RUN_MONITOR_REFRESH_INTERVAL_MS,
  buildApiSnapshotLogs,
  buildApiSnapshotSteps,
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
  getStatusTone,
  getStepStatusLabel,
  shouldRefreshRunLive,
} from './lib/runMonitorViewModel';
export type { RunStatusTone } from './lib/runMonitorViewModel';
export { useRunMonitorState } from './lib/useRunMonitorState';

export const runMonitorFeature = {
  name: 'run-monitor',
  description: 'Live run monitoring UI.',
};
