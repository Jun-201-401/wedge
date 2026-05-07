export type DiscoveryUiStatus = 'idle' | 'creating' | 'polling' | 'completed' | 'empty' | 'failed';

export function isDiscoveryBusy(status: DiscoveryUiStatus) {
  return status === 'creating' || status === 'polling';
}

export function createDiscoveryIdempotencyKey(projectId: string, targetUrl: string) {
  const input = `${projectId}:${targetUrl}`;
  let hash = 0;

  for (let index = 0; index < input.length; index += 1) {
    hash = Math.imul(hash ^ input.charCodeAt(index), 16777619);
  }

  return `create-analysis-discovery:${projectId}:${(hash >>> 0).toString(36)}:${crypto.randomUUID()}`;
}
