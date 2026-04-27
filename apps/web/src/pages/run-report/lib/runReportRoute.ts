import { RUN_MONITOR_PATH_PREFIX, isRunMonitorRunId, type RunMonitorRouteOptions } from '../../run-monitor/lib/runMonitorRoute';

const RUN_REPORT_PATH_SUFFIX = '/report';

export function buildRunReportPath(runId: string, options: RunMonitorRouteOptions) {
  if (!isRunMonitorRunId(runId)) {
    throw new Error('Run report path requires a UUID or mock run id.');
  }

  const params = new URLSearchParams({
    url: options.submittedUrl,
    scenario: options.scenarioId,
    depth: options.depthId,
  });

  return `${RUN_MONITOR_PATH_PREFIX}${encodeURIComponent(runId)}${RUN_REPORT_PATH_SUFFIX}?${params.toString()}`;
}

export function getRunReportIdFromPath(pathname: string) {
  if (!pathname.startsWith(RUN_MONITOR_PATH_PREFIX) || !pathname.endsWith(RUN_REPORT_PATH_SUFFIX)) {
    return null;
  }

  const encodedRunId = pathname.slice(
    RUN_MONITOR_PATH_PREFIX.length,
    pathname.length - RUN_REPORT_PATH_SUFFIX.length,
  );

  if (!encodedRunId || encodedRunId.includes('/')) {
    return null;
  }

  try {
    const runId = decodeURIComponent(encodedRunId);
    return !runId.includes('/') && isRunMonitorRunId(runId) ? runId : null;
  } catch {
    return null;
  }
}
