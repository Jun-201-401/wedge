import { getScenarioLabel } from '../../../shared';
import type { RunReportViewModel } from './runReportViewModel';

function buildReadableReportId(runId: string) {
  if (runId.startsWith('mock-')) {
    return 'WDG-MOCK-CTA';
  }

  return `WDG-${runId.slice(0, 8).toUpperCase()}`;
}

export function buildMockRunReportData(runId: string, targetUrl: string, scenarioId: string | null): RunReportViewModel {
  const scenarioLabel = getScenarioLabel(scenarioId);

  return {
    runId,
    reportId: buildReadableReportId(runId),
    targetUrl,
    scenarioLabel,
    score: 68,
    issueCount: 3,
    evidenceCount: 5,
    totalSteps: 12,
    durationLabel: '1m 24s',
    completedAt: '방금 전',
    decisionNodes: [
      {
        id: 'see-primary-cta',
        code: 'SEE',
        tone: 'friction',
        title: '사용자가 CTA를 발견했는가',
        summary: '히어로 섹션 진입 시 주요 버튼의 시각적 위계가 낮아 발견 지연이 발생합니다.',
        tags: ['High Friction', 'Evidence x2'],
      },
      {
        id: 'understand-primary-cta',
        code: 'UND',
        tone: 'neutral',
        title: 'CTA의 의미를 이해했는가',
        summary: '버튼 카피는 일반적이지만 주변 문맥 덕분에 행동 의미는 비교적 명확하게 전달됩니다.',
        tags: [],
      },
      {
        id: 'trust-before-click',
        code: 'TRU',
        tone: 'friction',
        title: '버튼을 누를 만큼 신뢰했는가',
        summary: 'CTA 직전 단계에서 보안 및 환불 정책에 대한 정보가 부족하여 이탈 신호가 감지되었습니다.',
        tags: ['Trust Gap'],
      },
    ],
    heroTitle: 'Make your value clear above the fold',
    heroSubtitle: 'Hero section · 결과 요약 근거',
    heroCallToAction: 'Start free trial',
    evidencePreviewUrl: '/mock-report-evidence.png',
    findings: [
      {
        id: 'cta-contrast',
        issueId: 'PATH-CTA-001',
        order: 1,
        severity: 'high',
        stage: 'path',
        title: 'CTA가 첫 화면에서 충분히 두드러지지 않음',
        summary: '주요 버튼은 보이지만 주변 메시지 대비가 약해 첫 행동으로 인식되는 힘이 낮습니다.',
        evidenceLabel: 'Hero Section > Primary CTA',
        evidenceCount: 2,
        confidence: 0.86,
        priorityScore: 91,
        evidenceRefs: ['checkpoint.hero.primary_cta', 'artifact.screenshot.hero'],
        recommendation: 'CTA 주변에 결과 중심 혜택 문구를 추가하고 버튼 대비를 한 단계 높이세요.',
        highlight: {
          label: 'FRICTION POINT',
          top: '43%',
          left: '37%',
          width: '26%',
          height: '12%',
        },
      },
      {
        id: 'trust-delay',
        issueId: 'TRUST-INFO-002',
        order: 2,
        severity: 'medium',
        stage: 'evidence',
        title: '신뢰 정보가 행동 이후에 등장함',
        summary: '사용자가 결정을 내리기 전 확인할 수 있는 증거와 신뢰 신호가 CTA보다 늦게 배치되어 있습니다.',
        evidenceLabel: 'Below-fold proof',
        evidenceCount: 1,
        confidence: 0.74,
        priorityScore: 72,
        evidenceRefs: ['checkpoint.below_fold.proof'],
        recommendation: '고객 수, 보안, 환불 정책처럼 즉시 판단을 돕는 신뢰 정보를 CTA 근처로 올리세요.',
        highlight: {
          label: 'TRUST GAP',
          top: '67%',
          left: '17%',
          width: '31%',
          height: '16%',
        },
      },
      {
        id: 'form-context',
        issueId: 'FORM-CONTEXT-003',
        order: 3,
        severity: 'medium',
        stage: 'friction',
        title: 'Form 진입 전 기대 정보가 부족함',
        summary: '사용자가 클릭 후 어떤 정보 입력이 필요한지 예상하기 어려워 다음 화면 진입 저항이 생길 수 있습니다.',
        evidenceLabel: 'Next step context',
        evidenceCount: 2,
        confidence: 0.7,
        priorityScore: 68,
        evidenceRefs: ['checkpoint.cta.destination', 'artifact.dom.form_hint'],
        recommendation: 'CTA 하단에 예상 소요 시간과 필수 입력 항목 수를 짧게 안내하세요.',
        highlight: {
          label: 'NEXT STEP GAP',
          top: '31%',
          left: '22%',
          width: '56%',
          height: '15%',
        },
      },
    ],
    recommendations: [
      {
        id: 'primary-copy',
        priority: 'NUDGE #01',
        title: 'CTA 시각적 대비 및 위계 강화',
        detail: '현재 배경색과 버튼색의 대비가 낮아 첫인상에서 CTA를 놓치기 쉽습니다. 버튼의 채도를 높이거나 배경에 은은한 그라데이션을 추가하여 시선을 유도하세요.',
        expectedImpact: '+14% CTR',
        effort: 'Low',
      },
      {
        id: 'trust-signal',
        priority: 'NUDGE #02',
        title: 'CTA 직전 신뢰 요소 배치',
        detail: '사용자가 버튼을 누르기 전 망설이는 지점에 카드 등록 불필요, 언제든 해지 가능 같은 Micro-copy를 배치하여 신뢰 마찰을 줄이세요.',
        expectedImpact: '+8% Conversion',
        effort: 'Medium',
      },
      {
        id: 'form-expectation',
        priority: 'NUDGE #03',
        title: 'Form 진입 전 기대치 안내',
        detail: '클릭 후 입력할 항목 수와 완료 시간을 CTA 보조 문구로 안내합니다.',
        expectedImpact: '+5% Completion',
        effort: 'Low',
      },
    ],
  };
}
