import type { ApiResponse, RequestOptions } from './http';
import { requestJson } from './http';
import type { CreateDiscoveryRequest, Discovery } from '../entities/discovery';

export function createDiscovery(request: CreateDiscoveryRequest, options?: RequestOptions) {
  return requestJson<ApiResponse<Discovery>>('/discoveries', {
    ...options,
    method: 'POST',
    body: JSON.stringify(request),
  });
}

export function getDiscovery(discoveryId: string, options?: RequestOptions) {
  return requestJson<ApiResponse<Discovery>>(`/discoveries/${encodeURIComponent(discoveryId)}`, options);
}

export const discoveriesApi = {
  createDiscovery,
  getDiscovery,
} as const;
