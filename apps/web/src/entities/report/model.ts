import type { AnalysisStatus, RunArtifact } from '../run';

export type RunReportStatus = 'NOT_READY' | 'GENERATABLE' | 'READY' | 'FAILED';
export type ReportFormat = 'PDF' | 'MARKDOWN' | 'HTML' | 'JSON';
export type ReportStatus = 'GENERATING' | 'READY' | 'FAILED' | 'ARCHIVED';

export interface DecisionMapItem {
  stage: string;
  displayName: string;
  status: string;
  issueIds: string[];
  summary?: string | null;
  evidenceRefs: string[];
}

export interface ReportPreviewImage {
  artifact: RunArtifact;
  source: string;
}

export interface ReportFinding {
  id: string;
  rankOrder?: number | null;
  title: string;
  summary: string;
  category?: string | null;
  stage?: string | null;
  axis?: string | null;
  severity?: number | null;
  confidence?: number | null;
  priorityScore?: number | null;
  impactHypothesis?: string | null;
  evidenceRefs?: unknown;
}

export interface ReportNudge {
  id: string;
  findingId?: string | null;
  rankOrder?: number | null;
  title: string;
  rationale?: string | null;
  recommendation?: string | null;
  difficulty?: string | null;
  expectedEffect?: string | null;
  validationQuestion?: string | null;
}

export interface ReportTopFinding {
  id: string;
  rank: number;
  title: string;
  summary: string;
  stage: string;
  severity?: number | null;
  confidence?: number | null;
  priorityScore?: number | null;
  previewImage?: ReportPreviewImage | null;
}

export interface ReportDetailNudge {
  id: string;
  rank?: number | null;
  title: string;
  rationale?: string | null;
  recommendation?: string | null;
  difficulty?: string | null;
  expectedEffect?: string | null;
  validationQuestion?: string | null;
}

export interface ReportDetailFinding {
  id: string;
  rank: number;
  title: string;
  summary: string;
  category?: string | null;
  stage: string | null;
  axis?: string | null;
  severity?: number | null;
  confidence?: number | null;
  priorityScore?: number | null;
  impactHypothesis?: string | null;
  evidenceRefs: Array<Record<string, unknown>>;
  previewImage?: ReportPreviewImage | null;
  nudges: ReportDetailNudge[];
}

export interface RunReportProjection {
  runId: string;
  reportStatus: RunReportStatus;
  analysisStatus: AnalysisStatus | string;
  analysisJobId?: string | null;
  reportId?: string | null;
  title?: string | null;
  format?: ReportFormat | null;
  status?: ReportStatus | null;
  summary: Record<string, unknown>;
  decisionMap: DecisionMapItem[] | Array<Record<string, unknown>>;
  findings: ReportFinding[];
  nudges: ReportNudge[];
  errorCode?: string | null;
  errorMessage?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface ReportSummary {
  id: string;
  runId: string;
  analysisJobId?: string | null;
  title: string;
  format: ReportFormat;
  status: ReportStatus;
  frictionScore?: number | null;
  summary?: Record<string, unknown> | null;
  decisionMap: DecisionMapItem[];
  topFindings: ReportTopFinding[];
  createdAt: string;
}

export interface ReportDetail {
  id: string;
  runId: string;
  analysisJobId?: string | null;
  title: string;
  format: ReportFormat;
  status: ReportStatus;
  frictionScore?: number | null;
  summary?: Record<string, unknown> | null;
  decisionMap: DecisionMapItem[];
  initialDisplayCount: number;
  findings: ReportDetailFinding[];
  createdAt: string;
}
