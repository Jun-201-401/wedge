import type { AckResponse, ApiResponse, RequestOptions } from './http';
import { requestJson } from './http';
import type {
  AnalysisStatus,
  EvidencePacket,
  Run,
  RunActionRequest,
  RunCreateRequest,
  RunArtifact,
  RunLive,
  RunStatus,
} from '../entities/run';

export interface ListRunsParams {
  projectId?: string;
  status?: RunStatus;
  analysisStatus?: AnalysisStatus;
  createdFrom?: string;
  createdTo?: string;
  cursor?: string;
  limit?: number;
}

function buildQuery(params: ListRunsParams = {}) {
  const query = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      query.set(key, String(value));
    }
  });

  const queryString = query.toString();
  return queryString ? `?${queryString}` : '';
}

export function listRuns(params?: ListRunsParams, options?: RequestOptions) {
  return requestJson<ApiResponse<Run[]>>(`/runs${buildQuery(params)}`, options);
}

export function createRun(request: RunCreateRequest, options?: RequestOptions) {
  return requestJson<ApiResponse<Run>>('/runs', {
    ...options,
    method: 'POST',
    body: JSON.stringify(request),
  });
}

export function getRun(runId: string, options?: RequestOptions) {
  return requestJson<ApiResponse<Run>>(`/runs/${runId}`, options);
}

export function deleteRun(runId: string, options?: RequestOptions) {
  return requestJson<void>(`/runs/${runId}`, {
    ...options,
    method: 'DELETE',
  });
}

export function startRun(runId: string, options?: RequestOptions) {
  return requestJson<AckResponse>(`/runs/${runId}/start`, {
    ...options,
    method: 'POST',
  });
}

export function stopRun(runId: string, request?: RunActionRequest, options?: RequestOptions) {
  return requestJson<AckResponse>(`/runs/${runId}/stop`, {
    ...options,
    method: 'POST',
    body: request ? JSON.stringify(request) : undefined,
  });
}

export function getRunLive(runId: string, options?: RequestOptions) {
  return requestJson<ApiResponse<RunLive>>(`/runs/${runId}/live`, options);
}

export function getRunEvidencePacket(runId: string, options?: RequestOptions) {
  return requestJson<ApiResponse<EvidencePacket>>(`/runs/${runId}/evidence-packet`, options);
}

export function listRunArtifacts(runId: string, options?: RequestOptions) {
  return requestJson<ApiResponse<RunArtifact[]>>(`/runs/${runId}/artifacts`, options);
}

export function listRunSteps(runId: string, options?: RequestOptions) {
  return requestJson<ApiResponse<unknown[]>>(`/runs/${runId}/steps`, options);
}

export const runsApi = {
  listRuns,
  createRun,
  getRun,
  deleteRun,
  startRun,
  stopRun,
  getRunLive,
  getRunEvidencePacket,
  listRunArtifacts,
  listRunSteps,
};
