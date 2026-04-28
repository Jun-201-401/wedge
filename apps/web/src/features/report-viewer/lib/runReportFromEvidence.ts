import type { EvidenceArtifact, EvidenceObservation, EvidencePacket, Run } from '../../../entities/run';
import { getScenarioLabel } from '../../../shared';
import type { FindingSeverity, ReportDecisionNode, ReportFinding, ReportRecommendation, RunReportViewModel } from './runReportViewModel';

interface BuildRunReportFromEvidenceInput {
  run: Run;
  evidencePacket: EvidencePacket;
  scenarioId: string | null;
}

function buildReadableReportId(runId: string) {
  return `WDG-${runId.slice(0, 8).toUpperCase()}`;
}

function readString(value: unknown) {
  if (typeof value !== 'string') {
    return null;
  }

  const text = value.trim();
  return text || null;
}

function readNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readNestedRecord(value: unknown) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function getObservationText(observation: EvidenceObservation) {
  return readString(observation.data.target)
    ?? readString(observation.data.text)
    ?? readString(observation.data.message)
    ?? readString(observation.data.field_key)
    ?? observation.type;
}

function getObservationConfidence(observation: EvidenceObservation) {
  return typeof observation.confidence === 'number' ? observation.confidence : 0.68;
}

function getEvidencePreviewArtifact(evidencePacket: EvidencePacket): EvidenceArtifact | null {
  return evidencePacket.artifacts.find((artifact) => artifact.type === 'screenshot') ?? null;
}

function countAggregateSignal(evidencePacket: EvidencePacket, key: string) {
  const value = evidencePacket.aggregate_signals?.[key];
  return typeof value === 'number' ? value : 0;
}

function getPrimaryPageTitle(evidencePacket: EvidencePacket, fallbackUrl: string) {
  for (const checkpoint of evidencePacket.checkpoints) {
    const page = readNestedRecord(checkpoint.state.page);
    const title = readString(page?.title);
    if (title) {
      return title;
    }

    const directTitle = readString(checkpoint.state.title);
    if (directTitle) {
      return directTitle;
    }
  }

  try {
    return new URL(fallbackUrl).hostname;
  } catch {
    return fallbackUrl;
  }
}

function getPrimaryCallToAction(evidencePacket: EvidencePacket) {
  const ctaObservation = evidencePacket.checkpoints
    .flatMap((checkpoint) => checkpoint.observations)
    .find((observation) => observation.type.includes('cta'));

  return ctaObservation ? getObservationText(ctaObservation) : 'Primary CTA';
}

function getDurationLabel(run: Run, evidencePacket: EvidencePacket) {
  if (run.startedAt && run.finishedAt) {
    const durationMs = new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime();
    if (Number.isFinite(durationMs) && durationMs > 0) {
      const seconds = Math.round(durationMs / 1000);
      if (seconds >= 60) {
        return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
      }

      return `${seconds}s`;
    }
  }

  const settleDurationMs = evidencePacket.checkpoints.reduce((total, checkpoint) => {
    const durationMs = readNumber(checkpoint.settle.durationMs) ?? readNumber(checkpoint.settle.duration_ms) ?? 0;
    return total + durationMs;
  }, 0);

  return settleDurationMs > 0 ? `${Math.max(1, Math.round(settleDurationMs / 1000))}s` : '방금 전';
}

function getCompletedAt(run: Run) {
  if (!run.finishedAt) {
    return '방금 전';
  }

  return new Intl.DateTimeFormat('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(run.finishedAt));
}

function severityFromObservation(observation: EvidenceObservation): FindingSeverity {
  if (observation.type.includes('error') || observation.type.includes('failure')) {
    return 'high';
  }

  if (observation.type.includes('cta') || observation.type.includes('form')) {
    return 'medium';
  }

  return 'low';
}

function titleFromObservation(observation: EvidenceObservation) {
  if (observation.type.includes('cta')) {
    return 'CTA 발견성과 행동 유도 근거를 확인해야 함';
  }

  if (observation.type.includes('form')) {
    return 'Form 진입 전 입력 기대치 확인이 필요함';
  }

  if (observation.type.includes('console_error')) {
    return '콘솔 오류가 사용자 경험에 영향을 줄 수 있음';
  }

  if (observation.type.includes('network_failure')) {
    return '네트워크 실패 요청이 실행 중 감지됨';
  }

  return `${observation.type} 관찰 결과 검토 필요`;
}

function recommendationFromObservation(observation: EvidenceObservation) {
  if (observation.type.includes('cta')) {
    return 'CTA 주변의 가치 문구, 버튼 대비, 다음 행동 설명을 함께 확인해 전환 마찰을 줄이세요.';
  }

  if (observation.type.includes('form')) {
    return 'Form 진입 전 예상 입력 항목과 완료 시간을 짧게 안내하세요.';
  }

  if (observation.type.includes('error') || observation.type.includes('failure')) {
    return '실패한 요청이나 콘솔 오류가 핵심 전환 경로에 영향을 주는지 우선 확인하세요.';
  }

  return '해당 관찰 지점이 사용자의 다음 행동 판단에 어떤 영향을 주는지 확인하세요.';
}

function stageLabel(stage: string) {
  if (stage === 'FIRST_VIEW') {
    return '첫 화면';
  }

  if (stage === 'CTA') {
    return 'CTA';
  }

  if (stage === 'INPUT') {
    return '입력';
  }

  if (stage === 'COMMIT') {
    return '결정';
  }

  return stage || 'Evidence';
}

function buildFindings(evidencePacket: EvidencePacket): ReportFinding[] {
  const observationSources = evidencePacket.checkpoints.flatMap((checkpoint) => (
    checkpoint.observations.map((observation) => ({ checkpoint, observation }))
  ));

  const findingSources = observationSources.length > 0
    ? observationSources
    : evidencePacket.checkpoints.map((checkpoint) => ({ checkpoint, observation: null }));

  return findingSources.slice(0, 3).map(({ checkpoint, observation }, index) => {
    const severity = observation ? severityFromObservation(observation) : 'low';
    const evidenceText = observation ? getObservationText(observation) : checkpoint.checkpoint_id;
    const confidence = observation ? getObservationConfidence(observation) : 0.6;

    return {
      id: observation?.observation_id ?? checkpoint.checkpoint_id,
      issueId: `EVIDENCE-${String(index + 1).padStart(3, '0')}`,
      order: index + 1,
      severity,
      stage: stageLabel(observation?.stage ?? checkpoint.primaryStage),
      title: observation ? titleFromObservation(observation) : `${stageLabel(checkpoint.primaryStage)} 체크포인트 확인 필요`,
      summary: observation
        ? `${evidenceText} 근거가 ${stageLabel(observation.stage)} 단계에서 수집되었습니다.`
        : `${checkpoint.checkpoint_id} 체크포인트에서 수집된 실행 상태를 바탕으로 화면 흐름을 검토하세요.`,
      evidenceLabel: `${stageLabel(checkpoint.primaryStage)} > ${evidenceText}`,
      evidenceCount: checkpoint.artifact_refs.length + (observation ? 1 : checkpoint.observations.length),
      confidence,
      priorityScore: Math.min(95, Math.max(45, Math.round(confidence * 100) + (severity === 'high' ? 8 : severity === 'medium' ? 3 : 0))),
      evidenceRefs: [checkpoint.checkpoint_id, ...(observation ? [observation.observation_id] : [])],
      recommendation: observation ? recommendationFromObservation(observation) : '해당 체크포인트의 화면 캡처와 DOM 근거를 함께 확인하세요.',
      highlight: createHighlight(index),
    };
  });
}

function createHighlight(index: number) {
  const highlights = [
    { label: 'EVIDENCE POINT', top: '38%', left: '34%', width: '30%', height: '14%' },
    { label: 'CHECKPOINT', top: '58%', left: '18%', width: '36%', height: '15%' },
    { label: 'FOLLOW-UP', top: '29%', left: '55%', width: '24%', height: '18%' },
  ];
  return highlights[index] ?? highlights[0];
}

function buildDecisionNodes(evidencePacket: EvidencePacket, findings: ReportFinding[]): ReportDecisionNode[] {
  const ctaCount = countAggregateSignal(evidencePacket, 'cta_candidate_count');
  const consoleErrorCount = countAggregateSignal(evidencePacket, 'console_error_count');
  const networkFailureCount = countAggregateSignal(evidencePacket, 'network_failure_count');

  return [
    {
      id: 'see-primary-cta',
      code: 'SEE',
      tone: ctaCount > 0 ? 'neutral' : 'friction',
      title: '사용자가 CTA를 발견했는가',
      summary: ctaCount > 0
        ? `실행 중 CTA 후보 ${ctaCount}개가 관찰되었습니다.`
        : 'CTA 후보 관찰이 부족해 첫 행동 발견성을 추가 확인해야 합니다.',
      tags: ctaCount > 0 ? [`CTA x${ctaCount}`] : ['Needs Evidence'],
    },
    {
      id: 'technical-stability',
      code: 'REL',
      tone: consoleErrorCount + networkFailureCount > 0 ? 'friction' : 'neutral',
      title: '실행 중 기술적 방해가 있었는가',
      summary: consoleErrorCount + networkFailureCount > 0
        ? `콘솔 오류 ${consoleErrorCount}개, 네트워크 실패 ${networkFailureCount}개가 감지되었습니다.`
        : '콘솔 오류와 네트워크 실패가 주요 근거에서 감지되지 않았습니다.',
      tags: consoleErrorCount + networkFailureCount > 0 ? ['Tech Signal'] : [],
    },
    {
      id: 'evidence-depth',
      code: 'EVD',
      tone: findings.length > 0 ? 'neutral' : 'friction',
      title: '판단 가능한 근거가 충분한가',
      summary: `${evidencePacket.checkpoints.length}개 체크포인트와 ${evidencePacket.artifacts.length}개 artifact를 바탕으로 리포트를 구성했습니다.`,
      tags: [`Evidence x${evidencePacket.checkpoints.length + evidencePacket.artifacts.length}`],
    },
  ];
}

type RecommendationSource = Pick<ReportFinding, 'id' | 'title' | 'recommendation' | 'severity'>;

function buildRecommendations(findings: ReportFinding[]): ReportRecommendation[] {
  const sourceFindings: RecommendationSource[] = findings.length > 0 ? findings : [{
    id: 'evidence-review',
    title: 'Evidence Packet 기반 결과 검토',
    recommendation: '수집된 checkpoint와 artifact를 바탕으로 데모 URL의 핵심 전환 흐름을 직접 확인하세요.',
    severity: 'low',
  }];

  return sourceFindings.slice(0, 3).map((finding, index) => ({
    id: `recommendation-${finding.id}`,
    priority: `NUDGE #${String(index + 1).padStart(2, '0')}`,
    title: finding.title,
    detail: finding.recommendation,
    expectedImpact: index === 0 ? '전환 판단 근거 강화' : '마찰 원인 식별',
    effort: finding.severity === 'high' ? 'Medium' : 'Low',
  }));
}

function calculateScore(evidencePacket: EvidencePacket, findings: ReportFinding[]) {
  const technicalPenalty = countAggregateSignal(evidencePacket, 'console_error_count') * 8
    + countAggregateSignal(evidencePacket, 'network_failure_count') * 10;
  const evidenceBonus = Math.min(12, evidencePacket.checkpoints.length * 4 + evidencePacket.artifacts.length * 2);
  const findingPenalty = findings.filter((finding) => finding.severity === 'high').length * 10
    + findings.filter((finding) => finding.severity === 'medium').length * 5;

  return Math.min(95, Math.max(35, 72 + evidenceBonus - technicalPenalty - findingPenalty));
}

export function buildRunReportFromEvidence({ run, evidencePacket, scenarioId }: BuildRunReportFromEvidenceInput): RunReportViewModel {
  const findings = buildFindings(evidencePacket);
  const previewArtifact = getEvidencePreviewArtifact(evidencePacket);
  const targetUrl = evidencePacket.final_url ?? evidencePacket.url ?? run.startUrl;

  return {
    runId: run.id,
    reportId: buildReadableReportId(run.id),
    targetUrl,
    scenarioLabel: getScenarioLabel(scenarioId),
    score: calculateScore(evidencePacket, findings),
    issueCount: findings.length,
    evidenceCount: evidencePacket.checkpoints.length + evidencePacket.artifacts.length,
    totalSteps: Math.max(evidencePacket.checkpoints.length, run.currentStepOrder ?? 0, 1),
    durationLabel: getDurationLabel(run, evidencePacket),
    completedAt: getCompletedAt(run),
    decisionNodes: buildDecisionNodes(evidencePacket, findings),
    heroTitle: getPrimaryPageTitle(evidencePacket, targetUrl),
    heroSubtitle: `${evidencePacket.checkpoints.length} checkpoints · ${evidencePacket.artifacts.length} artifacts`,
    heroCallToAction: getPrimaryCallToAction(evidencePacket),
    evidencePreviewUrl: previewArtifact?.uri ?? null,
    findings,
    recommendations: buildRecommendations(findings),
  };
}
