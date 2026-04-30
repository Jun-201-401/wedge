import { getRunReportIdFromPath } from '../pages/run-report/lib/runReportRoute';
import { getRunIdFromPath } from '../pages/run-monitor/lib/runMonitorRoute';
import { CREATE_ANALYSIS_PATH, LOGIN_PATH, RUNS_PATH, SIGNUP_PATH } from '../shared/lib/appPaths';

export type AppRoute =
  | { kind: 'landing' }
  | { kind: 'login' }
  | { kind: 'signup' }
  | { kind: 'create-analysis' }
  | { kind: 'runs-list' }
  | { kind: 'run-monitor'; runId: string }
  | { kind: 'run-report'; runId: string };

export function resolveAppRoute(pathname: string): AppRoute {
  const reportRunId = getRunReportIdFromPath(pathname);

  if (reportRunId) {
    return { kind: 'run-report', runId: reportRunId };
  }

  const runId = getRunIdFromPath(pathname);

  if (runId) {
    return { kind: 'run-monitor', runId };
  }

  if (pathname === LOGIN_PATH) {
    return { kind: 'login' };
  }

  if (pathname === SIGNUP_PATH) {
    return { kind: 'signup' };
  }

  if (pathname === CREATE_ANALYSIS_PATH) {
    return { kind: 'create-analysis' };
  }

  if (pathname === RUNS_PATH) {
    return { kind: 'runs-list' };
  }

  return { kind: 'landing' };
}
