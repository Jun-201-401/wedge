import { CREATE_ANALYSIS_PATH, LOGIN_PATH, RUNS_PATH, SIGNUP_PATH } from '../shared/lib/appPaths';
import { RUN_MONITOR_PATH_PREFIX } from './run-monitor/lib/runMonitorRoute';

export { LoginPage, SignupPage } from './auth';
export { CreateAnalysisPage } from './create-analysis';
export { LandingPage } from './landing';
export { RunMonitorPage } from './run-monitor';
export { RunReportPage } from './run-report';
export { RunsListPage } from './runs-list';
export { RUN_MONITOR_PATH_PREFIX } from './run-monitor/lib/runMonitorRoute';

export const pages = {
  auth: {
    loginPath: LOGIN_PATH,
    signupPath: SIGNUP_PATH,
  },
  createAnalysis: {
    id: 'create-analysis',
    path: CREATE_ANALYSIS_PATH,
  },
  home: {
    id: 'landing',
    path: '/',
  },
  runsList: {
    id: 'runs-list',
    path: RUNS_PATH,
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
