export interface RunMonitorRouteOptions {
  submittedUrl: string;
  scenarioId: string;
  depthId: string;
}

export const RUN_MONITOR_PATH_PREFIX = '/runs/';
export const MOCK_RUN_ID_PREFIX = 'mock-';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function buildRunMonitorPath(runId: string, options: RunMonitorRouteOptions) {
  if (!isRunMonitorRunId(runId)) {
    throw new Error('Run monitor path requires a UUID or mock run id.');
  }

  const params = new URLSearchParams({
    url: options.submittedUrl,
    scenario: options.scenarioId,
    depth: options.depthId,
  });

  return `${RUN_MONITOR_PATH_PREFIX}${encodeURIComponent(runId)}?${params.toString()}`;
}

export function buildMockRunId(scenarioId: string) {
  return `${MOCK_RUN_ID_PREFIX}${scenarioId}`;
}

export function isMockRunId(runId: string) {
  return runId.startsWith(MOCK_RUN_ID_PREFIX) && runId.length > MOCK_RUN_ID_PREFIX.length;
}

function isApiRunId(runId: string) {
  return UUID_PATTERN.test(runId);
}

export function isRunMonitorRunId(runId: string) {
  return isApiRunId(runId) || isMockRunId(runId);
}

export function getRunIdFromPath(pathname: string) {
  if (!pathname.startsWith(RUN_MONITOR_PATH_PREFIX)) {
    return null;
  }

  const encodedRunId = pathname.slice(RUN_MONITOR_PATH_PREFIX.length);

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
