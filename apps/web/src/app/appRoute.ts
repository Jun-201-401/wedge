import { getRunReportIdFromPath } from '../pages/run-report/lib/runReportRoute';
import { getRunIdFromPath } from '../pages/run-monitor/lib/runMonitorRoute';
import { CREATE_ANALYSIS_PATH, HOME_PATH, LANDING_PATH, LOGIN_PATH, RUNS_PATH, SIGNUP_PATH } from '../shared/lib/appPaths';

export type AppAuthState = 'checking' | 'authenticated' | 'anonymous';

export type ProtectedRouteGate = 'open' | 'loading' | 'blocked';

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

  if (pathname === HOME_PATH || pathname === CREATE_ANALYSIS_PATH) {
    return { kind: 'create-analysis' };
  }

  if (pathname === RUNS_PATH) {
    return { kind: 'runs-list' };
  }

  if (pathname === LANDING_PATH) {
    return { kind: 'landing' };
  }

  return { kind: 'create-analysis' };
}

export function isProtectedAppRoute(route: AppRoute) {
  const isRealRunRoute = (route.kind === 'run-report' || route.kind === 'run-monitor') && !route.runId.startsWith('mock-');
  return isRealRunRoute || route.kind === 'runs-list';
}

export function resolveProtectedRouteGate(route: AppRoute, authState: AppAuthState): ProtectedRouteGate {
  if (!isProtectedAppRoute(route)) {
    return 'open';
  }

  if (authState === 'checking') {
    return 'loading';
  }

  return authState === 'authenticated' ? 'open' : 'blocked';
}
