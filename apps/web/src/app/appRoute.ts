import { getRunReportIdFromPath } from '../pages/run-report/lib/runReportRoute';
import { getRunIdFromPath } from '../pages/run-monitor/lib/runMonitorRoute';

export type AppRoute =
  | { kind: 'landing' }
  | { kind: 'create-analysis' }
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

  if (pathname === '/create-analysis') {
    return { kind: 'create-analysis' };
  }

  return { kind: 'landing' };
}
