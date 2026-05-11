import type { ReportDetail, ReportFindingHighlightUnit, RunReportProjection } from '../../../entities/report';
import type { Run, RunArtifact } from '../../../entities/run';
import { getScenarioLabel } from '../../../shared';
import type { FindingSeverity, ReportDecisionNode, ReportFinding, ReportRecommendation, RunReportViewModel } from './runReportViewModel';

interface BuildRunReportFromApiInput {
  run: Run;
  report: RunReportProjection;
  detail?: ReportDetail | null;
  fallbackPreviewUrl?: string | null;
  scenarioId: string | null;
}

function readNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function artifactCreatedTime(artifact: RunArtifact) {
  if (!artifact.createdAt) {
    return 0;
  }

  const time = new Date(artifact.createdAt).getTime();
  return Number.isFinite(time) ? time : 0;
}

function artifactPreviewUrl(artifact: RunArtifact) {
  return artifact.contentUrl ?? artifact.url ?? null;
}

export function selectLatestScreenshotPreviewUrl(artifacts: RunArtifact[]) {
  return artifacts
    .filter((artifact) => artifact.artifactType === 'SCREENSHOT' && artifactPreviewUrl(artifact))
    .sort((left, right) => artifactCreatedTime(right) - artifactCreatedTime(left))
    .map(artifactPreviewUrl)[0] ?? null;
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

function stageDisplayName(stage: string | null | undefined) {
  return {
    FIRST_VIEW: '첫 화면',
    VALUE: '가치 판단',
    CTA: '행동/CTA',
    INPUT: '입력',
    COMMIT: '최종 전환',
  }[stage ?? ''] ?? stage ?? '리포트';
}

function buildUserFacingDecisionTags(issueIds: unknown[], evidenceRefs: unknown[]) {
  const tags: string[] = [];

  if (issueIds.length > 0) {
    tags.push(`이슈 ${issueIds.length}개`);
  }

  if (evidenceRefs.length > 0) {
    tags.push(`근거 ${evidenceRefs.length}개`);
  }

  return tags;
}

function userFacingDecisionSummary(status: string, summary: string | null) {
  if (status === 'PASS') {
    return '해당 단계에서 필요한 정보가 관찰되었고, 이슈는 감지되지 않았습니다.';
  }

  if (status === 'NOT_OBSERVED') {
    return '해당 단계에서 필요한 정보가 아직 관찰되지 않았습니다.';
  }

  if (summary) {
    return summary
      .replace(/evidence/g, '정보')
      .replace(/P0 issue/g, '이슈')
      .replace(/CTA/g, '행동 선택');
  }

  return '해당 단계의 분석 결과를 확인해 주세요.';
}

function evidenceLabelFor(stage: string | null | undefined, evidenceCount: number) {
  const stageLabel = stageDisplayName(stage);
  return evidenceCount > 0 ? `${stageLabel} 단계 근거 ${evidenceCount}개` : `${stageLabel} 단계`;
}

function buildDecisionNodes(report: RunReportProjection): ReportDecisionNode[] {
  if (!Array.isArray(report.decisionMap) || report.decisionMap.length === 0) {
    return [{
      id: 'report-summary',
      code: '요약',
      tone: report.findings.length > 0 ? 'friction' : 'neutral',
      title: '분석 결과 요약',
      summary: readString(report.summary.summary) ?? '서버 분석 결과를 바탕으로 리포트를 구성했습니다.',
      tags: report.findings.length > 0 ? [`이슈 ${report.findings.length}개`] : [],
    }];
  }

  return report.decisionMap.map((item, index) => {
    const stage = readString(item.stage) ?? `stage-${index + 1}`;
    const status = readString(item.status) ?? 'UNKNOWN';
    const evidenceRefs = Array.isArray(item.evidenceRefs) ? item.evidenceRefs : [];
    const issueIds = Array.isArray(item.issueIds) ? item.issueIds : [];

    return {
      id: stage.toLowerCase().replace(/[^a-z0-9]+/g, '-') || `decision-${index + 1}`,
      code: `단계${index + 1}`,
      tone: decisionTone(status),
      title: readString(item.displayName) ?? stage,
      summary: userFacingDecisionSummary(status, readString(item.summary)),
      tags: buildUserFacingDecisionTags(issueIds, evidenceRefs),
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
      issueId: `REPORT-${String(index + 1).padStart(3, '0')}`,
      order: finding.rankOrder ?? index + 1,
      severity,
      stage: stageDisplayName(finding.stage),
      title: finding.title,
      summary: finding.summary,
      evidenceLabel: evidenceLabelFor(finding.stage, evidenceRefs.length),
      evidenceCount: evidenceRefs.length,
      confidence: finding.confidence ?? 0.72,
      priorityScore: finding.priorityScore ?? Math.max(50, 86 - index * 8),
      evidenceRefs,
      previewImageUrl: null,
      recommendation: finding.impactHypothesis ?? '분석 결과의 근거와 개선 제안을 함께 검토하세요.',
      highlight: null,
    };
  });
}

function getFindingPreviewUrl(finding: ReportDetail['findings'][number]) {
  const artifact = finding.previewImage?.artifact;
  return artifact?.contentUrl ?? artifact?.url ?? null;
}

function readBound(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function boundsToPercent(value: number, total: number) {
  return `${Math.max(0, Math.min(100, (value / total) * 100)).toFixed(2)}%`;
}

function ratioToPercent(value: number) {
  return `${Math.max(0, Math.min(100, value * 100)).toFixed(2)}%`;
}

function normalizeArtifactRef(value: string | null) {
  return value?.startsWith('artifact:') ? value.slice('artifact:'.length) : value;
}

function unitFromCoordinateSpace(coordinateSpace: string | null) {
  if (coordinateSpace === null || coordinateSpace === 'viewport') {
    return 'css_px';
  }

  if (coordinateSpace === 'screenshot') {
    return 'screenshot_px';
  }

  if (coordinateSpace === 'viewport_ratio') {
    return 'viewport_ratio';
  }

  return null;
}

function isHighlightUnit(unit: string | null): unit is ReportFindingHighlightUnit {
  return unit === 'css_px' || unit === 'screenshot_px' || unit === 'viewport_ratio';
}

function resolveHighlightUnit(unit: string | null, coordinateSpace: string | null) {
  if (unit === null) {
    return unitFromCoordinateSpace(coordinateSpace);
  }

  if (!isHighlightUnit(unit)) {
    return null;
  }

  if (coordinateSpace === null) {
    return unit;
  }

  const coordinateUnit = unitFromCoordinateSpace(coordinateSpace);
  return coordinateUnit === unit ? unit : null;
}

function hasMatchedHighlightArtifact(finding: ReportDetail['findings'][number]) {
  const highlightArtifactId = normalizeArtifactRef(readString(finding.highlight?.screenshotArtifactId));
  const previewArtifactId = normalizeArtifactRef(readString(finding.previewImage?.artifact.id));
  return Boolean(highlightArtifactId && previewArtifactId && highlightArtifactId === previewArtifactId);
}

function createArtifactHighlight(finding: ReportDetail['findings'][number]) {
  const bounds = finding.highlight?.bounds;
  const viewport = finding.highlight?.viewport;
  const coordinateSpace = readString(finding.highlight?.coordinateSpace);
  const unit = resolveHighlightUnit(readString(bounds?.unit), coordinateSpace);
  const x = readBound(bounds?.x);
  const y = readBound(bounds?.y);
  const width = readBound(bounds?.width);
  const height = readBound(bounds?.height);

  if (x === null || y === null || width === null || height === null || unit === null || !hasMatchedHighlightArtifact(finding)) {
    return null;
  }

  if (unit === 'viewport_ratio') {
    return {
      label: readString(finding.highlight?.label) ?? '근거 대상',
      source: 'artifact-coordinate' as const,
      top: ratioToPercent(y),
      left: ratioToPercent(x),
      width: ratioToPercent(width),
      height: ratioToPercent(height),
    };
  }

  const scaleWidth = unit === 'screenshot_px'
    ? readBound(finding.previewImage?.artifact.width)
    : readBound(viewport?.width) ?? readBound(finding.previewImage?.artifact.width);
  const scaleHeight = unit === 'screenshot_px'
    ? readBound(finding.previewImage?.artifact.height)
    : readBound(viewport?.height) ?? readBound(finding.previewImage?.artifact.height);

  if (!scaleWidth || !scaleHeight) {
    return null;
  }

  return {
    label: readString(finding.highlight?.label) ?? '근거 대상',
    source: 'artifact-coordinate' as const,
    top: boundsToPercent(y, scaleHeight),
    left: boundsToPercent(x, scaleWidth),
    width: boundsToPercent(width, scaleWidth),
    height: boundsToPercent(height, scaleHeight),
  };
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
      stage: stageDisplayName(finding.stage),
      title: finding.title,
      summary: finding.summary,
      evidenceLabel: evidenceLabelFor(finding.stage, evidenceRefs.length),
      evidenceCount: evidenceRefs.length,
      confidence: finding.confidence ?? 0.72,
      priorityScore: finding.priorityScore ?? Math.max(50, 86 - index * 8),
      evidenceRefs,
      previewImageUrl: getFindingPreviewUrl(finding),
      recommendation: firstNudge?.recommendation
        ?? firstNudge?.rationale
        ?? finding.impactHypothesis
        ?? '분석 결과의 근거와 개선 제안을 함께 검토하세요.',
      highlight: createArtifactHighlight(finding),
    };
  });
}

function buildRecommendationsFromDetail(detail: ReportDetail, findings: ReportFinding[]): ReportRecommendation[] {
  const recommendations = detail.findings
    .flatMap((finding, findingIndex) => (
      finding.nudges.map((nudge, nudgeIndex) => ({
        id: nudge.id,
        findingId: finding.id,
        priority: `개선 ${String(nudge.rank ?? nudgeIndex + 1).padStart(2, '0')}`,
        title: nudge.title,
        detail: nudge.recommendation ?? nudge.rationale ?? findings[findingIndex]?.recommendation ?? '분석 결과에 맞춰 전환 마찰을 줄이는 개선안을 검토하세요.',
        rationale: nudge.rationale ?? null,
        expectedImpact: nudge.expectedEffect ?? '전환 판단 근거 강화',
        effort: nudge.difficulty ?? '낮음',
        validationQuestion: nudge.validationQuestion ?? null,
      }))
    ))
    .slice(0, 3);

  if (recommendations.length > 0) {
    return recommendations;
  }

  return findings.slice(0, 3).map((finding, index) => ({
    id: `recommendation-${finding.id}`,
    findingId: finding.id,
    priority: `개선 ${String(index + 1).padStart(2, '0')}`,
    title: finding.title,
    detail: finding.recommendation,
    rationale: finding.summary,
    expectedImpact: '전환 판단 근거 강화',
    effort: finding.severity === 'high' ? '보통' : '낮음',
    validationQuestion: '수정 후 같은 흐름에서 이 마찰이 다시 발생하지 않는지 확인하세요.',
  }));
}

function buildRecommendations(report: RunReportProjection, findings: ReportFinding[]): ReportRecommendation[] {
  if (report.nudges.length > 0) {
    return report.nudges.slice(0, 3).map((nudge, index) => ({
      id: nudge.id,
      findingId: nudge.findingId,
      priority: `개선 ${String(nudge.rankOrder ?? index + 1).padStart(2, '0')}`,
      title: nudge.title,
      detail: nudge.recommendation ?? nudge.rationale ?? '분석 결과에 맞춰 전환 마찰을 줄이는 개선안을 검토하세요.',
      rationale: nudge.rationale ?? null,
      expectedImpact: nudge.expectedEffect ?? '전환 판단 근거 강화',
      effort: nudge.difficulty ?? '낮음',
      validationQuestion: nudge.validationQuestion ?? null,
    }));
  }

  return findings.slice(0, 3).map((finding, index) => ({
    id: `recommendation-${finding.id}`,
    findingId: finding.id,
    priority: `개선 ${String(index + 1).padStart(2, '0')}`,
    title: finding.title,
    detail: finding.recommendation,
    rationale: finding.summary,
    expectedImpact: '전환 판단 근거 강화',
    effort: finding.severity === 'high' ? '보통' : '낮음',
    validationQuestion: '수정 후 같은 흐름에서 이 마찰이 다시 발생하지 않는지 확인하세요.',
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
  return seconds >= 60 ? `${Math.floor(seconds / 60)}분 ${seconds % 60}초` : `${seconds}초`;
}

export function buildRunReportFromApi({ run, report, detail, fallbackPreviewUrl, scenarioId }: BuildRunReportFromApiInput): RunReportViewModel {
  const detailWithFindings = detail && detail.findings.length > 0 ? detail : null;
  const findings = detailWithFindings ? buildFindingsFromDetail(detailWithFindings) : buildFindings(report);
  const detailPreviewUrl = getDetailPreviewUrl(detailWithFindings);
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
    heroSubtitle: '서버 분석 완료',
    heroCallToAction: readString(report.summary.primary_cta) ?? readString(report.summary.primaryCta) ?? '주요 행동 버튼',
    evidencePreviewUrl: detailPreviewUrl ?? fallbackPreviewUrl ?? null,
    findings,
    recommendations: detailWithFindings ? buildRecommendationsFromDetail(detailWithFindings, findings) : buildRecommendations(report, findings),
  };
}
