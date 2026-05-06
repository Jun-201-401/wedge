import type { ApiResponse, RequestOptions } from './http';
import { requestJson } from './http';
import type {
  ScenarioAuthoringConfirmRequest,
  ScenarioAuthoringConfirmResponse,
  ScenarioAuthoringJob,
  ScenarioAuthoringJobCreateRequest,
} from '../entities/scenario-authoring';

export function createScenarioAuthoringJob(request: ScenarioAuthoringJobCreateRequest, options?: RequestOptions) {
  return requestJson<ApiResponse<ScenarioAuthoringJob>>('/scenario-authoring-jobs', {
    ...options,
    method: 'POST',
    body: JSON.stringify(request),
  });
}

export function getScenarioAuthoringJob(authoringJobId: string, options?: RequestOptions) {
  return requestJson<ApiResponse<ScenarioAuthoringJob>>(`/scenario-authoring-jobs/${encodeURIComponent(authoringJobId)}`, options);
}

export function confirmScenarioAuthoringCandidate(
  authoringJobId: string,
  request: ScenarioAuthoringConfirmRequest,
  options?: RequestOptions,
) {
  return requestJson<ApiResponse<ScenarioAuthoringConfirmResponse>>(
    `/scenario-authoring-jobs/${encodeURIComponent(authoringJobId)}/confirm`,
    {
      ...options,
      method: 'POST',
      body: JSON.stringify(request),
    },
  );
}

export const scenarioAuthoringApi = {
  createScenarioAuthoringJob,
  getScenarioAuthoringJob,
  confirmScenarioAuthoringCandidate,
} as const;
