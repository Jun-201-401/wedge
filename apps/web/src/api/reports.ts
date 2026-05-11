import type { ApiResponse, RequestOptions } from './http';
import { toSameOriginApiPath } from '../shared/lib/apiResourcePath';
import { requestBlob, requestJson } from './http';
import type { ReportCreateRequest, ReportDetail, ReportExport, ReportSummary, RunReportProjection } from '../entities/report';

export function getRunReport(runId: string, options?: RequestOptions) {
  return requestJson<ApiResponse<RunReportProjection>>(`/runs/${runId}/report`, options);
}

export function generateRunReport(runId: string, options?: RequestOptions) {
  return requestJson<ApiResponse<RunReportProjection>>(`/runs/${runId}/report`, {
    ...options,
    method: 'POST',
  });
}

export function listRunReports(runId: string, options?: RequestOptions) {
  return requestJson<ApiResponse<ReportSummary[]>>(`/runs/${runId}/reports`, options);
}

export function createRunReportExport(runId: string, request: ReportCreateRequest, options?: RequestOptions) {
  return requestJson<ApiResponse<ReportExport>>(`/runs/${runId}/reports`, {
    ...options,
    method: 'POST',
    body: JSON.stringify(request),
  });
}

export function getReport(reportId: string, options?: RequestOptions) {
  return requestJson<ApiResponse<ReportDetail>>(`/reports/${reportId}`, options);
}

export function downloadReportExport(downloadUrl: string, options?: RequestOptions) {
  const apiPath = toSameOriginApiPath(downloadUrl);
  if (!apiPath) {
    throw new Error('Report export download URL must be a same-origin API resource.');
  }
  return requestBlob(apiPath, options);
}

export const reportsApi = {
  getRunReport,
  generateRunReport,
  listRunReports,
  createRunReportExport,
  getReport,
  downloadReportExport,
};
