import type { Discovery, DiscoveryScenarioType, ScenarioRecommendation as ApiScenarioRecommendation, ScenarioRecommendationLevel } from '../../../entities/discovery';

export type CreateAnalysisScenarioId = 'landing-cta' | 'signup-form' | 'contact' | 'pricing' | 'checkout';
export type ScenarioTone = 'recommended' | 'available' | 'low' | 'unavailable';

export interface ScenarioRecommendationViewModel {
  id: CreateAnalysisScenarioId;
  scenarioType: DiscoveryScenarioType;
  level: ScenarioRecommendationLevel;
  tone: ScenarioTone;
  title: string;
  summary: string;
  evidence: string;
  actionLabel: string;
  levelLabel: string;
  confidenceLabel: string;
  confidence: number;
  isRunnable: boolean;
  sourceDiscoveryId?: string;
  recommendationId?: string | null;
  evidenceRefs: string[];
  evidenceSummary: ApiScenarioRecommendation['evidenceSummary'];
  signalLabels: string[];
  limitationLabels: string[];
  suggestedStartUrl?: string | null;
  suggestedTarget?: Record<string, unknown> | null;
}

export const CREATE_ANALYSIS_SCENARIO_IDS = ['landing-cta', 'signup-form', 'contact', 'pricing', 'checkout'] as const satisfies readonly CreateAnalysisScenarioId[];
const MANUAL_SCENARIO_TYPES = ['LANDING_CTA', 'SIGNUP_LEAD_FORM', 'CONTACT', 'PRICING', 'PURCHASE_CHECKOUT'] as const satisfies readonly DiscoveryScenarioType[];

const SCENARIO_COPY = {
  LANDING_CTA: {
    id: 'landing-cta',
    title: '랜딩 전환 CTA 점검',
    availableSummary: '랜딩 페이지에서 가입, 체험, 문의 같은 전환 CTA 후보를 발견했어요. 사용자가 다음 행동을 바로 이해할 수 있는지 확인하기 좋습니다.',
    unavailableSummary: '랜딩 페이지에서 명확한 전환 CTA 진입점을 찾지 못했어요.',
  },
  SIGNUP_LEAD_FORM: {
    id: 'signup-form',
    title: '가입 / 리드 Form 점검',
    availableSummary: '가입 또는 리드 Form 후보를 발견했어요. 입력 부담과 제출 전 신뢰 요소를 확인할 수 있습니다.',
    unavailableSummary: '가입 또는 리드 Form 진입점을 찾지 못했어요.',
  },
  CONTACT: {
    id: 'contact',
    title: '문의 / 상담 신청 흐름 점검',
    availableSummary: '문의, 상담, 데모 신청 후보를 발견했어요. B2B 전환 흐름을 점검하기 좋습니다.',
    unavailableSummary: '문의 또는 상담 신청 진입점을 찾지 못했어요.',
  },
  PRICING: {
    id: 'pricing',
    title: '가격 / 요금제 흐름 점검',
    availableSummary: '가격 또는 요금제 진입점을 발견했어요. 사용자가 플랜을 이해하고 다음 행동으로 이동하는지 확인할 수 있습니다.',
    unavailableSummary: '가격, 요금제, 플랜 비교 진입점을 찾지 못했어요.',
  },
  PURCHASE_CHECKOUT: {
    id: 'checkout',
    title: '구매 / 결제 흐름 점검',
    availableSummary: '구매 또는 결제 진입점을 발견했어요. 결제 전 단계까지의 마찰을 안전하게 점검할 수 있습니다.',
    unavailableSummary: '구매, 장바구니, 결제 진입점을 찾지 못했어요.',
  },
  CONTENT_ONLY: {
    id: 'landing-cta',
    title: '콘텐츠 이해 / 정보 탐색 흐름 점검',
    availableSummary: '명확한 전환 CTA보다는 정보 탐색형 콘텐츠가 중심인 사이트로 보여요.',
    unavailableSummary: '콘텐츠 탐색 흐름으로 추천할 만한 근거가 부족해요.',
  },
  CUSTOM_GUIDED: {
    id: 'landing-cta',
    title: '직접 목표 설정 흐름',
    availableSummary: '자동 추천 대신 사용자가 직접 목표를 지정해 흐름을 구성하는 것이 적합해 보여요.',
    unavailableSummary: '직접 목표 설정을 제안할 근거가 부족해요.',
  },
} as const satisfies Record<DiscoveryScenarioType, {
  id: CreateAnalysisScenarioId;
  title: string;
  availableSummary: string;
  unavailableSummary: string;
}>;

function toneFor(level: ScenarioRecommendationLevel): ScenarioTone {
  if (level === 'HIGH') {
    return 'recommended';
  }

  if (level === 'MEDIUM') {
    return 'available';
  }

  if (level === 'LOW') {
    return 'low';
  }

  return 'unavailable';
}

function recommendationLevelLabel(level: ScenarioRecommendationLevel) {
  switch (level) {
    case 'HIGH':
      return '추천';
    case 'MEDIUM':
      return '검토 가능';
    case 'LOW':
      return '약한 신호';
    case 'NOT_AVAILABLE':
      return '탐지 안 됨';
  }
}

function recommendationLevelRank(level: ScenarioRecommendationLevel) {
  switch (level) {
    case 'HIGH':
      return 0;
    case 'MEDIUM':
      return 1;
    case 'LOW':
      return 2;
    case 'NOT_AVAILABLE':
      return 3;
  }
}

function isDetectedRecommendation(recommendation: ApiScenarioRecommendation) {
  return recommendation.recommendationLevel !== 'NOT_AVAILABLE';
}

function detectionSignalLabel(confidence: number) {
  if (!Number.isFinite(confidence)) {
    return '없음';
  }

  const normalized = Math.max(0, Math.min(1, confidence));
  if (normalized >= 0.75) {
    return '높음';
  }

  if (normalized >= 0.55) {
    return '보통';
  }

  if (normalized > 0) {
    return '낮음';
  }

  return '없음';
}

function evidenceLabel(recommendation: ApiScenarioRecommendation) {
  const signalLabels = signalLabelsFor(recommendation);
  if (signalLabels.length > 0) {
    return signalLabels.slice(0, 2).join(', ');
  }

  const refs = recommendation.evidenceRefs?.filter(Boolean) ?? [];
  if (refs.length > 0) {
    return refs.slice(0, 3).join(', ');
  }

  const target = recommendation.suggestedTarget;
  const text = typeof target?.text === 'string' ? target.text : null;
  const selector = typeof target?.selector === 'string' ? target.selector : null;
  const href = typeof target?.href_contains === 'string' ? target.href_contains : null;
  return text ?? selector ?? href ?? '발견된 근거 없음';
}

function signalLabelsFor(recommendation: ApiScenarioRecommendation) {
  const summary = recommendation.evidenceSummary;
  const signals = summary?.matched_signals ?? [];
  return signals
    .map((signal) => {
      const source = sourceLabel(signal.source);
      const value = signal.value?.trim();
      return value ? `${source}: ${value}` : '';
    })
    .filter(Boolean)
    .slice(0, 4);
}

function limitationLabelsFor(recommendation: ApiScenarioRecommendation) {
  const summary = recommendation.evidenceSummary;
  const limitations = summary?.limitations ?? [];
  return limitations.map(limitationLabel).filter(Boolean).slice(0, 3);
}

function sourceLabel(source: string) {
  switch (source) {
    case 'aria_label':
      return 'aria-label';
    case 'aria_labelled_by_text':
      return 'aria-labelledby';
    case 'label_text':
      return 'label';
    case 'form_field':
      return 'form field';
    case 'shallow_navigation':
      return '도착 확인';
    default:
      return source;
  }
}

function limitationLabel(limitation: string) {
  switch (limitation) {
    case 'image_text_ocr_not_performed':
      return '이미지 안 텍스트는 OCR하지 않음';
    case 'authenticated_pages_not_explored':
      return '로그인 뒤 흐름은 탐색하지 않음';
    default:
      return limitation.replace(/_/g, ' ');
  }
}

function manualSummaryFor(scenarioType: DiscoveryScenarioType) {
  switch (scenarioType) {
    case 'LANDING_CTA':
      return '첫 화면에서 사용자가 다음 행동을 바로 이해하고 이동할 수 있는지 직접 확인합니다.';
    case 'SIGNUP_LEAD_FORM':
      return '가입 또는 리드 Form까지 이동하며 입력 부담과 제출 전 신뢰 요소를 확인합니다.';
    case 'CONTACT':
      return '문의, 상담, 데모 신청으로 이어지는 흐름을 사용자가 지정한 목표 기준으로 확인합니다.';
    case 'PRICING':
      return '가격, 요금제, 플랜 비교 진입점을 직접 따라가며 이해와 다음 행동을 확인합니다.';
    case 'PURCHASE_CHECKOUT':
      return '구매, 장바구니, 결제 전 단계까지 안전하게 이동하며 마찰을 확인합니다.';
    default:
      return '사용자가 지정한 목표 기준으로 첫 화면부터 흐름을 확인합니다.';
  }
}

export function toScenarioRecommendationViewModel(recommendation: ApiScenarioRecommendation, sourceDiscoveryId?: string): ScenarioRecommendationViewModel {
  const copy = SCENARIO_COPY[recommendation.scenarioType] ?? SCENARIO_COPY.CUSTOM_GUIDED;
  const isRunnable = recommendation.recommendationLevel !== 'NOT_AVAILABLE';
  const summaryPrefix = isRunnable ? copy.availableSummary : copy.unavailableSummary;

  return {
    id: copy.id,
    scenarioType: recommendation.scenarioType,
    level: recommendation.recommendationLevel,
    tone: toneFor(recommendation.recommendationLevel),
    title: copy.title,
    summary: summaryPrefix,
    evidence: evidenceLabel(recommendation),
    actionLabel: recommendation.recommendationLevel === 'LOW' ? '확인하며 시작하기' : isRunnable ? '이 흐름으로 시작하기' : '직접 설정 필요',
    levelLabel: recommendationLevelLabel(recommendation.recommendationLevel),
    confidenceLabel: detectionSignalLabel(recommendation.confidence),
    confidence: recommendation.confidence,
    isRunnable,
    sourceDiscoveryId,
    recommendationId: recommendation.recommendationId ?? null,
    evidenceRefs: recommendation.evidenceRefs ?? [],
    evidenceSummary: recommendation.evidenceSummary ?? null,
    signalLabels: signalLabelsFor(recommendation),
    limitationLabels: limitationLabelsFor(recommendation),
    suggestedStartUrl: recommendation.suggestedStartUrl ?? null,
    suggestedTarget: recommendation.suggestedTarget ?? null,
  };
}

export function toManualScenarioRecommendationViewModels(excludedScenarioIds: readonly CreateAnalysisScenarioId[] = []): ScenarioRecommendationViewModel[] {
  const excludedIds = new Set<CreateAnalysisScenarioId>(excludedScenarioIds);

  return MANUAL_SCENARIO_TYPES
    .map((scenarioType) => {
      const copy = SCENARIO_COPY[scenarioType];
      return {
        id: copy.id,
        scenarioType,
        level: 'LOW',
        tone: 'low',
        title: copy.title,
        summary: manualSummaryFor(scenarioType),
        evidence: '직접 선택한 흐름',
        actionLabel: '이 흐름 직접 선택',
        levelLabel: '직접 선택',
        confidenceLabel: '수동',
        confidence: 0,
        isRunnable: true,
        recommendationId: null,
        evidenceRefs: [],
        evidenceSummary: null,
        signalLabels: [],
        limitationLabels: [],
        suggestedStartUrl: null,
        suggestedTarget: null,
      } satisfies ScenarioRecommendationViewModel;
    })
    .filter((scenario) => !excludedIds.has(scenario.id));
}

export function toScenarioRecommendationViewModels(discovery: Discovery): ScenarioRecommendationViewModel[] {
  return (discovery.scenarioRecommendations ?? [])
    .filter(isDetectedRecommendation)
    .sort((left, right) => {
      const levelDelta = recommendationLevelRank(left.recommendationLevel) - recommendationLevelRank(right.recommendationLevel);
      if (levelDelta !== 0) {
        return levelDelta;
      }

      return right.confidence - left.confidence;
    })
    .map((recommendation) =>
      toScenarioRecommendationViewModel(recommendation, discovery.discoveryId),
    );
}
