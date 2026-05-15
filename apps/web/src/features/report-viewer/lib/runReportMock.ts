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
    durationLabel: '1분 24초',
    completedAt: '방금 전',
    decisionNodes: [
      {
        id: 'see-primary-cta',
        code: '보기',
        tone: 'friction',
        title: '사용자가 주요 버튼을 발견했는가',
        summary: '히어로 섹션 진입 시 주요 버튼의 시각적 위계가 낮아 발견 지연이 발생합니다.',
        tags: ['마찰 높음', '근거 2개'],
      },
      {
        id: 'understand-primary-cta',
        code: '이해',
        tone: 'neutral',
        title: '주요 버튼의 의미를 이해했는가',
        summary: '버튼 카피는 일반적이지만 주변 문맥 덕분에 행동 의미는 비교적 명확하게 전달됩니다.',
        tags: [],
      },
      {
        id: 'trust-before-click',
        code: '신뢰',
        tone: 'friction',
        title: '버튼을 누를 만큼 신뢰했는가',
        summary: '주요 버튼 직전 단계에서 보안 및 환불 정책에 대한 정보가 부족하여 이탈 신호가 감지되었습니다.',
        tags: ['신뢰 보강 필요'],
      },
    ],
    heroTitle: '첫 화면에서 가치를 분명하게 보여주세요',
    heroSubtitle: '첫 화면 · 결과 요약 근거',
    heroCallToAction: '무료로 시작하기',
    evidencePreviewUrl: '/mock-report-evidence.png',
    findings: [
      {
        id: 'cta-contrast',
        issueId: 'PATH-CTA-001',
        order: 1,
        severity: 'high',
        stage: '행동 선택',
        title: '주요 버튼이 첫 화면에서 충분히 두드러지지 않음',
        summary: '주요 버튼은 보이지만 주변 메시지 대비가 약해 첫 행동으로 인식되는 힘이 낮습니다.',
        evidenceLabel: '첫 화면 > 주요 버튼',
        evidenceCount: 2,
        confidence: 0.86,
        priorityScore: 91,
        evidenceRefs: ['checkpoint.hero.primary_cta', 'artifact.screenshot.hero'],
        previewImageUrl: '/mock-report-evidence.png',
        references: [
          {
            label: 'Button Design',
            publisher: 'Baymard',
            title: '명확한 다음 경로',
            basisSummary: '사용자가 목표 행동으로 이어지는 다음 선택지를 확신할 수 있어야 합니다.',
            url: 'https://baymard.com/learn/button-design',
          },
          {
            label: 'Start using a service',
            publisher: 'GOV.UK',
            title: '서비스 시작 지점',
            basisSummary: '첫 화면은 사용자가 서비스 목적과 시작 지점을 빠르게 판단하도록 도와야 합니다.',
            url: 'https://design-system.service.gov.uk/patterns/start-using-a-service/',
          },
        ],
        recommendation: '주요 버튼 주변에 결과 중심 혜택 문구를 추가하고 버튼 대비를 한 단계 높이세요.',
        highlight: null,
      },
      {
        id: 'trust-delay',
        issueId: 'TRUST-INFO-002',
        order: 2,
        severity: 'medium',
        stage: '신뢰 판단',
        title: '신뢰 정보가 행동 이후에 등장함',
        summary: '사용자가 결정을 내리기 전 확인할 수 있는 증거와 신뢰 신호가 주요 버튼보다 늦게 배치되어 있습니다.',
        evidenceLabel: '하단 신뢰 근거',
        evidenceCount: 1,
        confidence: 0.74,
        priorityScore: 72,
        evidenceRefs: ['checkpoint.below_fold.proof'],
        previewImageUrl: '/mock-report-evidence.png',
        recommendation: '고객 수, 보안, 환불 정책처럼 즉시 판단을 돕는 신뢰 정보를 주요 버튼 근처로 올리세요.',
        highlight: null,
      },
      {
        id: 'form-context',
        issueId: 'FORM-CONTEXT-003',
        order: 3,
        severity: 'medium',
        stage: '입력 전환',
        title: '입력 단계 진입 전 기대 정보가 부족함',
        summary: '사용자가 클릭 후 어떤 정보 입력이 필요한지 예상하기 어려워 다음 화면 진입 저항이 생길 수 있습니다.',
        evidenceLabel: '다음 단계 안내',
        evidenceCount: 2,
        confidence: 0.7,
        priorityScore: 68,
        evidenceRefs: ['checkpoint.cta.destination', 'artifact.dom.form_hint'],
        previewImageUrl: '/mock-report-evidence.png',
        recommendation: '주요 버튼 하단에 예상 소요 시간과 필수 입력 항목 수를 짧게 안내하세요.',
        highlight: null,
      },
    ],
    recommendations: [
      {
        id: 'primary-copy',
        findingId: 'cta-contrast',
        priority: '개선 01',
        title: '주요 버튼 시각적 대비 및 위계 강화',
        detail: '현재 배경색과 버튼색의 대비가 낮아 첫인상에서 주요 버튼을 놓치기 쉽습니다. 버튼의 채도를 높이거나 배경에 은은한 그라데이션을 추가하여 시선을 유도하세요.',
        rationale: '주요 버튼은 보이지만 주변 메시지 대비가 약해 첫 행동으로 인식되는 힘이 낮습니다.',
        expectedImpact: '클릭 전환 개선',
        effort: '낮음',
        validationQuestion: '사용자는 첫 화면에서 3초 안에 주요 버튼을 식별할 수 있나요?',
      },
      {
        id: 'trust-signal',
        findingId: 'trust-delay',
        priority: '개선 02',
        title: '주요 버튼 직전 신뢰 요소 배치',
        detail: '사용자가 버튼을 누르기 전 망설이는 지점에 카드 등록 불필요, 언제든 해지 가능 같은 보조 문구를 배치하여 신뢰 마찰을 줄이세요.',
        rationale: '사용자가 결정을 내리기 전 확인할 수 있는 증거와 신뢰 신호가 주요 버튼보다 늦게 배치되어 있습니다.',
        expectedImpact: '가입 전환 개선',
        effort: '보통',
        validationQuestion: '사용자는 주요 버튼을 누르기 전 비용과 위험 조건을 이해할 수 있나요?',
      },
      {
        id: 'form-expectation',
        findingId: 'form-context',
        priority: '개선 03',
        title: '입력 단계 진입 전 기대치 안내',
        detail: '클릭 후 입력할 항목 수와 완료 시간을 버튼 보조 문구로 안내합니다.',
        rationale: '사용자가 클릭 후 어떤 정보 입력이 필요한지 예상하기 어려워 다음 화면 진입 저항이 생길 수 있습니다.',
        expectedImpact: '완료율 개선',
        effort: '낮음',
        validationQuestion: '사용자는 주요 버튼 클릭 전에 다음 단계의 입력 부담을 예측할 수 있나요?',
      },
    ],
  };
}
