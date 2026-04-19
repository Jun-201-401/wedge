export * from './landing-vision';
export { projectManagementFeature } from './project-management';
export { reportViewerFeature } from './report-viewer';
export { runMonitorFeature } from './run-monitor';
export { scenarioBuilderFeature } from './scenario-builder';

export const features = {
  landingVision: 'landing-vision',
  runMonitor: 'run-monitor',
  reportViewer: 'report-viewer',
  projectManagement: 'project-management',
  scenarioBuilder: 'scenario-builder',
} as const;
