import type { ApiResponse, RequestOptions } from './http';
import { requestJson } from './http';
import type { ReportDetail, ReportSummary, RunReportProjection } from '../entities/report';

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

export function getReport(reportId: string, options?: RequestOptions) {
  return requestJson<ApiResponse<ReportDetail>>(`/reports/${reportId}`, options);
}

export const reportsApi = {
  getRunReport,
  generateRunReport,
  listRunReports,
  getReport,
};
