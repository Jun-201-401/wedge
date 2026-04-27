import { RUN_MONITOR_PATH_PREFIX } from './run-monitor/lib/runMonitorRoute';

export { CreateAnalysisPage } from './create-analysis';
export { LandingPage } from './landing';
export { RunMonitorPage } from './run-monitor';
export { RunReportPage } from './run-report';
export { RUN_MONITOR_PATH_PREFIX } from './run-monitor/lib/runMonitorRoute';

export const pages = {
  createAnalysis: {
    id: 'create-analysis',
    path: '/create-analysis',
  },
  home: {
    id: 'landing',
    path: '/',
  },
  runMonitor: {
    id: 'run-monitor',
    pathPrefix: RUN_MONITOR_PATH_PREFIX,
  },
  runReport: {
    id: 'run-report',
    pathPattern: `${RUN_MONITOR_PATH_PREFIX}:runId/report`,
  },
} as const;
