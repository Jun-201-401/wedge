import type { ReportDetail, RunReportProjection } from '../../../entities/report';
import type { Run } from '../../../entities/run';
import { getScenarioLabel } from '../../../shared';
import type { FindingSeverity, ReportDecisionNode, ReportFinding, ReportRecommendation, RunReportViewModel } from './runReportViewModel';

interface BuildRunReportFromApiInput {
  run: Run;
  report: RunReportProjection;
  detail?: ReportDetail | null;
  scenarioId: string | null;
}

function readNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function severityFromScore(severity: number | null | undefined): FindingSeverity {
  if (typeof severity !== 'number') {
    return 'medium';
  }

  if (severity >= 3) {
    return 'high';
  }

  if (severity >= 2) {
    return 'medium';
  }

  return 'low';
}

function decisionTone(status: string): ReportDecisionNode['tone'] {
  return /fail|risk|warning|blocked|issue/i.test(status) ? 'friction' : 'neutral';
}

function buildDecisionNodes(report: RunReportProjection): ReportDecisionNode[] {
  if (!Array.isArray(report.decisionMap) || report.decisionMap.length === 0) {
    return [{
      id: 'report-summary',
      code: 'RPT',
      tone: report.findings.length > 0 ? 'friction' : 'neutral',
      title: '분석 결과 요약',
      summary: readString(report.summary.summary) ?? '백엔드 분석 결과를 바탕으로 리포트를 구성했습니다.',
      tags: [`Findings x${report.findings.length}`],
    }];
  }

  return report.decisionMap.map((item, index) => {
    const stage = readString(item.stage) ?? `stage-${index + 1}`;
    const status = readString(item.status) ?? 'UNKNOWN';
    const evidenceRefs = Array.isArray(item.evidenceRefs) ? item.evidenceRefs : [];
    const issueIds = Array.isArray(item.issueIds) ? item.issueIds : [];

    return {
      id: stage.toLowerCase().replace(/[^a-z0-9]+/g, '-') || `decision-${index + 1}`,
      code: stage.slice(0, 3).toUpperCase() || `D${index + 1}`,
      tone: decisionTone(status),
      title: readString(item.displayName) ?? stage,
      summary: readString(item.summary) ?? `${status} 상태로 분석된 결정 지점입니다.`,
      tags: [...issueIds, ...evidenceRefs].slice(0, 3),
    };
  });
}

function normalizeEvidenceRefs(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((ref, index) => {
    if (typeof ref === 'string') {
      return ref;
    }

    if (typeof ref === 'object' && ref !== null) {
      const record = ref as Record<string, unknown>;
      return readString(record.id)
        ?? readString(record.reference)
        ?? readString(record.ref)
        ?? readString(record.checkpointId)
        ?? readString(record.observationId)
        ?? `evidence-${index + 1}`;
    }

    return `evidence-${index + 1}`;
  });
}

function buildFindings(report: RunReportProjection): ReportFinding[] {
  return report.findings.map((finding, index) => {
    const severity = severityFromScore(finding.severity);
    const evidenceRefs = normalizeEvidenceRefs(finding.evidenceRefs);

    return {
      id: finding.id,
      issueId: `API-${String(index + 1).padStart(3, '0')}`,
      order: finding.rankOrder ?? index + 1,
      severity,
      stage: finding.stage ?? 'Report',
      title: finding.title,
      summary: finding.summary,
      evidenceLabel: evidenceRefs[0] ?? finding.stage ?? 'Report evidence',
      evidenceCount: evidenceRefs.length,
      confidence: finding.confidence ?? 0.72,
      priorityScore: finding.priorityScore ?? Math.max(50, 86 - index * 8),
      evidenceRefs,
      previewImageUrl: null,
      recommendation: finding.impactHypothesis ?? '분석 결과의 근거와 추천 nudge를 함께 검토하세요.',
      highlight: createHighlight(index),
    };
  });
}

function getFindingPreviewUrl(finding: ReportDetail['findings'][number]) {
  const artifact = finding.previewImage?.artifact;
  return artifact?.contentUrl ?? artifact?.url ?? null;
}

function buildFindingsFromDetail(detail: ReportDetail): ReportFinding[] {
  return detail.findings.map((finding, index) => {
    const severity = severityFromScore(finding.severity);
    const evidenceRefs = normalizeEvidenceRefs(finding.evidenceRefs);
    const firstNudge = finding.nudges[0] ?? null;

    return {
      id: finding.id,
      issueId: `DETAIL-${String(index + 1).padStart(3, '0')}`,
      order: finding.rank,
      severity,
      stage: finding.stage ?? 'Report',
      title: finding.title,
      summary: finding.summary,
      evidenceLabel: evidenceRefs[0] ?? finding.stage ?? 'Report evidence',
      evidenceCount: evidenceRefs.length,
      confidence: finding.confidence ?? 0.72,
      priorityScore: finding.priorityScore ?? Math.max(50, 86 - index * 8),
      evidenceRefs,
      previewImageUrl: getFindingPreviewUrl(finding),
      recommendation: firstNudge?.recommendation
        ?? firstNudge?.rationale
        ?? finding.impactHypothesis
        ?? '분석 결과의 근거와 추천 nudge를 함께 검토하세요.',
      highlight: createHighlight(index),
    };
  });
}

function createHighlight(index: number) {
  const highlights = [
    { label: 'REPORT FINDING', source: 'fallback' as const, top: '38%', left: '34%', width: '30%', height: '14%' },
    { label: 'DECISION POINT', source: 'fallback' as const, top: '58%', left: '18%', width: '36%', height: '15%' },
    { label: 'NUDGE TARGET', source: 'fallback' as const, top: '29%', left: '55%', width: '24%', height: '18%' },
  ];
  return highlights[index] ?? highlights[0];
}

function buildRecommendationsFromDetail(detail: ReportDetail, findings: ReportFinding[]): ReportRecommendation[] {
  const recommendations = detail.findings
    .flatMap((finding, findingIndex) => (
      finding.nudges.map((nudge, nudgeIndex) => ({
        id: nudge.id,
        priority: `NUDGE #${String(nudge.rank ?? nudgeIndex + 1).padStart(2, '0')}`,
        title: nudge.title,
        detail: nudge.recommendation ?? nudge.rationale ?? findings[findingIndex]?.recommendation ?? '분석 결과에 맞춰 전환 마찰을 줄이는 개선안을 검토하세요.',
        expectedImpact: nudge.expectedEffect ?? '전환 판단 근거 강화',
        effort: nudge.difficulty ?? 'Low',
      }))
    ))
    .slice(0, 3);

  if (recommendations.length > 0) {
    return recommendations;
  }

  return findings.slice(0, 3).map((finding, index) => ({
    id: `recommendation-${finding.id}`,
    priority: `NUDGE #${String(index + 1).padStart(2, '0')}`,
    title: finding.title,
    detail: finding.recommendation,
    expectedImpact: '전환 판단 근거 강화',
    effort: finding.severity === 'high' ? 'Medium' : 'Low',
  }));
}

function buildRecommendations(report: RunReportProjection, findings: ReportFinding[]): ReportRecommendation[] {
  if (report.nudges.length > 0) {
    return report.nudges.slice(0, 3).map((nudge, index) => ({
      id: nudge.id,
      findingId: nudge.findingId,
      priority: `NUDGE #${String(nudge.rankOrder ?? index + 1).padStart(2, '0')}`,
      title: nudge.title,
      detail: nudge.recommendation ?? nudge.rationale ?? '분석 결과에 맞춰 전환 마찰을 줄이는 개선안을 검토하세요.',
      expectedImpact: nudge.expectedEffect ?? '전환 판단 근거 강화',
      effort: nudge.difficulty ?? 'Low',
    }));
  }

  return findings.slice(0, 3).map((finding, index) => ({
    id: `recommendation-${finding.id}`,
    findingId: finding.id,
    priority: `NUDGE #${String(index + 1).padStart(2, '0')}`,
    title: finding.title,
    detail: finding.recommendation,
    expectedImpact: '전환 판단 근거 강화',
    effort: finding.severity === 'high' ? 'Medium' : 'Low',
  }));
}

function getDetailPreviewUrl(detail: ReportDetail | null | undefined) {
  const firstFinding = detail?.findings[0];
  return firstFinding ? getFindingPreviewUrl(firstFinding) : null;
}

function getCompletedAt(run: Run, report: RunReportProjection) {
  const timestamp = report.updatedAt ?? report.createdAt ?? run.finishedAt;

  if (!timestamp) {
    return '방금 전';
  }

  return new Intl.DateTimeFormat('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

function getDurationLabel(run: Run) {
  if (!run.startedAt || !run.finishedAt) {
    return '분석 완료';
  }

  const durationMs = new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime();
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return '분석 완료';
  }

  const seconds = Math.round(durationMs / 1000);
  return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
}

export function buildRunReportFromApi({ run, report, detail, scenarioId }: BuildRunReportFromApiInput): RunReportViewModel {
  const detailWithFindings = detail && detail.findings.length > 0 ? detail : null;
  const findings = detailWithFindings ? buildFindingsFromDetail(detailWithFindings) : buildFindings(report);
  const score = readNumber(report.summary.friction_score) ?? readNumber(report.summary.frictionScore) ?? 72;
  const targetUrl = readString(report.summary.targetUrl) ?? readString(report.summary.url) ?? run.startUrl;

  return {
    runId: run.id,
    reportId: report.reportId ?? `WDG-${run.id.slice(0, 8).toUpperCase()}`,
    targetUrl,
    scenarioLabel: getScenarioLabel(scenarioId),
    score,
    issueCount: findings.length,
    evidenceCount: findings.reduce((count, finding) => count + finding.evidenceCount, 0),
    totalSteps: Math.max(report.decisionMap.length, run.currentStepOrder ?? 0, 1),
    durationLabel: getDurationLabel(run),
    completedAt: getCompletedAt(run, report),
    decisionNodes: buildDecisionNodes(report),
    heroTitle: report.title ?? '전환 마찰 리포트',
    heroSubtitle: `${report.analysisStatus} · ${report.reportStatus}`,
    heroCallToAction: readString(report.summary.primary_cta) ?? readString(report.summary.primaryCta) ?? 'Primary CTA',
    evidencePreviewUrl: getDetailPreviewUrl(detailWithFindings),
    findings,
    recommendations: detailWithFindings ? buildRecommendationsFromDetail(detailWithFindings, findings) : buildRecommendations(report, findings),
  };
}
