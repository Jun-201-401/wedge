import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';

import { createRun, startRun } from '../../api/runs';
import { FIRST_WORD_DELAY_MS, WORD_ROTATION_INTERVAL_MS } from '../../features/landing-vision';
import { buildMockRunId, buildRunMonitorPath } from '../run-monitor/lib/runMonitorRoute';
import {
  buildCreateAnalysisPath,
  parseCreateAnalysisRouteState,
  readCreateRunContextFromEnv,
  type CreateAnalysisRouteOptions,
  type CreateAnalysisRouteState,
  type CreateAnalysisRouteStage,
  withCreateRunContextFallback,
} from './lib/createAnalysisRouteState';
import { normalizeAnalysisUrl } from './lib/createAnalysisUrl';
import { buildPrototypeScenarioPlan } from './lib/prototypeScenarioPlan';
import './CreateAnalysisPage.css';

type DiscoveryStepStatus = 'complete' | 'active' | 'pending';
type ScenarioLevel = '추천' | '가능' | '낮음';
type ScenarioTone = 'recommended' | 'available' | 'low';
type CreateAnalysisStage = CreateAnalysisRouteStage;
type ScenarioId = 'landing-cta' | 'signup-form' | 'checkout';
type ScenarioDepthId = 'hero-only' | 'next-screen' | 'form-depth';

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 19V5M5 12l7-7 7 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

interface DiscoveryStep {
  label: string;
  detail: string;
  status: DiscoveryStepStatus;
}

interface ScenarioRecommendation {
  id: ScenarioId;
  level: ScenarioLevel;
  tone: ScenarioTone;
  title: string;
  summary: string;
  evidence: string;
  actionLabel: string;
}

interface ScenarioDepthOption {
  id: ScenarioDepthId;
  title: string;
  detail: string;
}

const HEADLINE_PHRASES = ['Find', 'Friction'] as const;
const PREFLIGHT_DISCOVERY_STEPS: DiscoveryStep[] = [
  {
    label: '페이지 열기',
    detail: '입력한 URL에 연결하고 기본 응답을 확인합니다',
    status: 'complete',
  },
  {
    label: '첫 화면 확인',
    detail: '첫 화면의 메시지와 주요 섹션을 읽습니다',
    status: 'complete',
  },
  {
    label: 'CTA 후보 탐색',
    detail: '사용자가 다음 행동으로 이동하는 버튼과 링크를 찾습니다',
    status: 'active',
  },
  {
    label: 'Form / Pricing / Contact 후보 확인',
    detail: '진단 가능한 전환 흐름 후보를 좁히는 중입니다',
    status: 'pending',
  },
  {
    label: '추천 시나리오 정리',
    detail: '사이트에 맞는 진단 흐름을 우선순위로 정리합니다',
    status: 'pending',
  },
];
const scenarioRecommendations: ScenarioRecommendation[] = [
  {
    id: 'landing-cta',
    level: '추천',
    tone: 'recommended',
    title: '첫 화면 CTA 점검',
    summary: '첫 화면에서 주요 CTA 후보 2개를 발견했어요. 사용자가 다음 행동을 바로 이해할 수 있는지 확인하기 좋습니다.',
    evidence: 'hero section, primary button, nav CTA',
    actionLabel: '이 흐름으로 진단',
  },
  {
    id: 'signup-form',
    level: '가능',
    tone: 'available',
    title: '가입 / 문의 Form 점검',
    summary: '문의 또는 가입 form 후보 1개를 발견했어요. 입력 부담과 제출 전 신뢰 요소를 확인할 수 있습니다.',
    evidence: 'contact link, email input candidate',
    actionLabel: '이 흐름으로 진단',
  },
  {
    id: 'checkout',
    level: '낮음',
    tone: 'low',
    title: '구매 / 결제 흐름 점검',
    summary: '가격, 장바구니, 결제 진입점을 아직 찾지 못했어요. 이 URL에는 랜딩 CTA나 문의 흐름이 더 적합해 보입니다.',
    evidence: 'pricing / checkout 후보 없음',
    actionLabel: '그래도 직접 설정',
  },
];
const SCENARIO_DEPTH_OPTIONS: ScenarioDepthOption[] = [
  {
    id: 'hero-only',
    title: '첫 화면만 보기',
    detail: 'CTA가 명확한지, 첫 행동이 바로 보이는지 빠르게 확인합니다',
  },
  {
    id: 'next-screen',
    title: '다음 화면까지 보기',
    detail: 'CTA 클릭 후 도착 화면의 맥락까지 확인합니다',
  },
  {
    id: 'form-depth',
    title: 'Form까지 보기',
    detail: '입력 부담과 제출 전 신뢰 요소까지 확인합니다',
  },
];
const SCENARIO_IDS = scenarioRecommendations.map((scenario) => scenario.id);
const SCENARIO_DEPTH_IDS = SCENARIO_DEPTH_OPTIONS.map((option) => option.id);
const DEFAULT_SCENARIO_DEPTH_ID = 'hero-only' satisfies ScenarioDepthId;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CREATE_ANALYSIS_ROUTE_OPTIONS: CreateAnalysisRouteOptions<ScenarioId, ScenarioDepthId> = {
  defaultDepthId: DEFAULT_SCENARIO_DEPTH_ID,
  validDepthIds: SCENARIO_DEPTH_IDS,
  validScenarioIds: SCENARIO_IDS,
};
const DEV_CREATE_RUN_CONTEXT = readCreateRunContextFromEnv(import.meta.env);

interface CreateRunIds {
  projectId: string;
  scenarioTemplateVersionId: string;
}

function getStepStatusLabel(status: DiscoveryStepStatus) {
  if (status === 'complete') {
    return '완료';
  }

  if (status === 'active') {
    return '진행 중';
  }

  return '대기 중';
}

function getDiscoveryProgressPercent(steps: DiscoveryStep[]) {
  const activeStepIndex = steps.findIndex((step) => step.status === 'active');

  if (activeStepIndex >= 0) {
    return Math.round(((activeStepIndex + 1) / steps.length) * 100);
  }

  const completedStepCount = steps.filter((step) => step.status === 'complete').length;
  return Math.round((completedStepCount / steps.length) * 100);
}

const PREFLIGHT_PROGRESS_PERCENT = getDiscoveryProgressPercent(PREFLIGHT_DISCOVERY_STEPS);

type CreateAnalysisPageRouteState = CreateAnalysisRouteState<ScenarioId, ScenarioDepthId>;

function getInitialRouteState(): CreateAnalysisPageRouteState {
  if (typeof window === 'undefined') {
    return {
      stage: 'input',
      submittedUrl: null,
      scenarioId: null,
      depthId: null,
    };
  }

  return withCreateRunContextFallback(
    parseCreateAnalysisRouteState(window.location.search, CREATE_ANALYSIS_ROUTE_OPTIONS),
    DEV_CREATE_RUN_CONTEXT,
  );
}

function findScenarioById(scenarioId: ScenarioId | null) {
  return scenarioRecommendations.find((scenario) => scenario.id === scenarioId) ?? null;
}

function findDepthById(depthId: ScenarioDepthId | null) {
  return SCENARIO_DEPTH_OPTIONS.find((option) => option.id === depthId) ?? SCENARIO_DEPTH_OPTIONS[0];
}

function isUuid(value: string | null): value is string {
  return value !== null && UUID_PATTERN.test(value);
}

function getCreateRunIds(routeState: CreateAnalysisPageRouteState): CreateRunIds | null {
  const projectId = routeState.projectId ?? null;
  const scenarioTemplateVersionId = routeState.scenarioTemplateVersionId ?? null;

  if (!isUuid(projectId) || !isUuid(scenarioTemplateVersionId)) {
    return null;
  }

  return {
    projectId,
    scenarioTemplateVersionId,
  };
}

interface PreflightAgentProps {
  submittedUrl: string;
  onShowRecommendations: () => void;
}

interface RecommendationAgentProps {
  submittedUrl: string;
  scenarios: ScenarioRecommendation[];
  onChooseScenario: (scenario: ScenarioRecommendation) => void;
}

interface ScenarioSetupAgentProps {
  selectedScenario: ScenarioRecommendation;
  selectedDepthId: ScenarioDepthId;
  onDepthChange: (depthId: ScenarioDepthId) => void;
  onReady: () => void;
}

interface ReadyAgentProps {
  submittedUrl: string;
  selectedScenario: ScenarioRecommendation;
  selectedDepth: ScenarioDepthOption;
  isCreatingRun: boolean;
  runStartError: string;
  onEditScope: () => void;
  onStartRun: () => void;
}

function PreflightNode({ status }: { status: DiscoveryStepStatus }) {
  if (status === 'complete') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className="preflight-agent__node-check">
        <path d="M19.5 6.5 9 17 4.5 12.5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  if (status === 'active') {
    return (
      <>
        <svg viewBox="0 0 24 24" fill="none" className="preflight-agent__node-spinner">
          <path d="M21 12a9 9 0 1 1-6.3-8.58" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
        <span className="preflight-agent__node-spinner-ring" />
      </>
    );
  }

  return <span className="preflight-agent__node-dot" />;
}

function PreflightAgent({ submittedUrl, onShowRecommendations }: PreflightAgentProps) {
  return (
    <section className="create-analysis-panel create-analysis-panel--preflight" aria-labelledby="discovery-progress-title">
      <div className="preflight-agent" aria-live="polite">
        <div className="preflight-agent__header">
          <div className="preflight-agent__header-main">
            <div className="preflight-agent__header-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M12 3 4 7.5v9L12 21l8-4.5v-9L12 3Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
              </svg>
            </div>
            <div className="preflight-agent__header-copy">
              <p>Preflight</p>
              <h2 id="discovery-progress-title">사이트를 살펴보고 있어요</h2>
              <div className="preflight-agent__header-status">
                <span className="preflight-agent__header-status-dot" aria-hidden="true" />
                <span>Site trace active</span>
              </div>
            </div>
          </div>

          <div className="preflight-agent__progress" aria-label={`진행률 ${PREFLIGHT_PROGRESS_PERCENT}%`}>
            <span className="preflight-agent__progress-value">{PREFLIGHT_PROGRESS_PERCENT}</span>
            <span className="preflight-agent__progress-unit">%</span>
          </div>
        </div>

        <p className="preflight-agent__url">{submittedUrl}</p>
        <div className="preflight-agent__divider" aria-hidden="true" />

        <ol className="preflight-agent__timeline" aria-label="Discovery 진행 상태">
          {PREFLIGHT_DISCOVERY_STEPS.map((step, stepIndex) => (
            <li
              key={step.label}
              className={`preflight-agent__step preflight-agent__step--${step.status}`}
              aria-current={step.status === 'active' ? 'step' : undefined}
            >
              {stepIndex < PREFLIGHT_DISCOVERY_STEPS.length - 1 ? (
                <div className="preflight-agent__rail" aria-hidden="true">
                  <div className="preflight-agent__rail-base" />
                  <div className="preflight-agent__rail-stream" />
                </div>
              ) : null}

              <div className="preflight-agent__node-wrap">
                <div className="preflight-agent__node" aria-hidden="true">
                  <PreflightNode status={step.status} />
                </div>
              </div>

              <div className="preflight-agent__content">
                <span className="create-analysis-sr-only">{getStepStatusLabel(step.status)}</span>
                <div className="preflight-agent__content-head">
                  <h3>{step.label}</h3>
                </div>
                <p className="preflight-agent__detail">{step.detail}</p>
              </div>
            </li>
          ))}
        </ol>

        <p className="preflight-agent__note">전체 분석 전, 가능한 사용자 흐름을 찾기 위한 짧은 탐색입니다.</p>
        <button className="create-analysis-panel__action preflight-agent__action" type="button" onClick={onShowRecommendations}>
          추천 결과 보기
        </button>
      </div>
    </section>
  );
}

function RecommendationAgent({ submittedUrl, scenarios, onChooseScenario }: RecommendationAgentProps) {
  return (
    <section className="create-analysis-panel create-analysis-panel--recommendations" aria-labelledby="recommendations-title">
      <div className="recommendation-agent">
        <div className="recommendation-agent__header">
          <div className="recommendation-agent__header-main">
            <div className="recommendation-agent__header-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path d="m12 4 8 4-8 4-8-4 8-4Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                <path d="m4 12 8 4 8-4" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                <path d="m4 16 8 4 8-4" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
              </svg>
            </div>

            <div className="recommendation-agent__header-copy">
              <p>Recommendations</p>
              <h2 id="recommendations-title">이 사이트에서 가능한 진단 흐름을 찾았어요</h2>
              <div className="recommendation-agent__header-status">
                <span className="recommendation-agent__header-status-dot" aria-hidden="true" />
                <span>Scenario match complete</span>
              </div>
            </div>
          </div>

          <div className="recommendation-agent__count" aria-label={`추천 흐름 ${scenarios.length}개`}>
            <span className="recommendation-agent__count-value">{scenarios.length}</span>
            <span className="recommendation-agent__count-label">found</span>
          </div>
        </div>

        <p className="recommendation-agent__url">{submittedUrl}</p>
        <div className="recommendation-agent__divider" aria-hidden="true" />

        <div className="scenario-grid">
          {scenarios.map((scenario) => (
            <article key={scenario.id} className={`scenario-card scenario-card--${scenario.tone}`}>
              <span className="scenario-card__level">{scenario.level}</span>
              <h3>{scenario.title}</h3>
              <p>{scenario.summary}</p>
              <p className="scenario-card__evidence">근거: {scenario.evidence}</p>
              <button type="button" aria-label={`${scenario.title} 흐름으로 진단`} onClick={() => onChooseScenario(scenario)}>
                {scenario.actionLabel}
              </button>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function ScenarioSetupAgent({ selectedScenario, selectedDepthId, onDepthChange, onReady }: ScenarioSetupAgentProps) {
  return (
    <section className="create-analysis-panel create-analysis-panel--onboarding" aria-labelledby="onboarding-title">
      <div className="scenario-setup-agent">
        <div className="scenario-setup-agent__header">
          <div className="scenario-setup-agent__header-main">
            <div className="scenario-setup-agent__header-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M4 6h16M4 12h10M4 18h7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <path d="m17 14 3 3-3 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>

            <div className="scenario-setup-agent__header-copy">
              <p>Scenario Setup</p>
              <h2 id="onboarding-title">확인할 범위를 정해주세요</h2>
              <div className="scenario-setup-agent__header-status">
                <span className="scenario-setup-agent__header-status-dot" aria-hidden="true" />
                <span>Scope selection</span>
              </div>
            </div>
          </div>
        </div>

        <div className="scenario-setup-agent__selected-flow">
          <span>선택한 흐름</span>
          <strong>{selectedScenario.title}</strong>
        </div>

        <div className="scenario-setup-agent__divider" aria-hidden="true" />

        <p className="scenario-setup-agent__prompt">어디까지 확인할까요?</p>

        <div className="scenario-depth-options" role="radiogroup" aria-label="진단 범위 선택">
          {SCENARIO_DEPTH_OPTIONS.map((option) => {
            const isSelected = selectedDepthId === option.id;

            return (
              <label key={option.id} className={`scenario-depth-option ${isSelected ? 'scenario-depth-option--selected' : ''}`}>
                <input type="radio" name="scenario-depth" value={option.id} checked={isSelected} onChange={() => onDepthChange(option.id)} />
                <span className="scenario-depth-option__marker" aria-hidden="true" />
                <span className="scenario-depth-option__copy">
                  <strong>{option.title}</strong>
                  <span>{option.detail}</span>
                </span>
              </label>
            );
          })}
        </div>

        <button className="create-analysis-panel__action scenario-setup-agent__action" type="button" onClick={onReady}>
          진단 시작 준비
        </button>
      </div>
    </section>
  );
}

function ReadyAgent({ submittedUrl, selectedScenario, selectedDepth, isCreatingRun, runStartError, onEditScope, onStartRun }: ReadyAgentProps) {
  return (
    <section className="create-analysis-panel create-analysis-panel--ready" aria-labelledby="ready-title">
      <div className="ready-agent">
        <div className="ready-agent__header">
          <div className="ready-agent__header-main">
            <div className="ready-agent__header-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M12 3.5 19.5 7.75v8.5L12 20.5l-7.5-4.25v-8.5L12 3.5Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                <path d="m8.5 12 2.25 2.25L15.75 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>

            <div className="ready-agent__header-copy">
              <p>Ready</p>
              <h2 id="ready-title">이 설정으로 분석을 시작할게요</h2>
              <div className="ready-agent__header-status">
                <span className="ready-agent__header-status-dot" aria-hidden="true" />
                <span>Run 생성 준비 완료</span>
              </div>
            </div>
          </div>

          <span className="ready-agent__badge">실행 전 확인</span>
        </div>

        <div className="ready-agent__url-card">
          <span>대상 URL</span>
          <strong>{submittedUrl}</strong>
        </div>

        <div className="ready-agent__summary-grid" aria-label="진단 시작 전 요약">
          <article className="ready-agent__summary-card">
            <span>선택한 흐름</span>
            <strong>{selectedScenario.title}</strong>
            <p>{selectedScenario.summary}</p>
          </article>
          <article className="ready-agent__summary-card">
            <span>확인 범위</span>
            <strong>{selectedDepth.title}</strong>
            <p>{selectedDepth.detail}</p>
          </article>
        </div>

        <div className="ready-agent__launch-plan" aria-label="분석 시작 후 진행 단계">
          <div>
            <span className="ready-agent__launch-step">1</span>
            <p>Run 생성</p>
          </div>
          <div>
            <span className="ready-agent__launch-step">2</span>
            <p>실시간 Trace 확인</p>
          </div>
          <div>
            <span className="ready-agent__launch-step">3</span>
            <p>마찰 리포트 작성</p>
          </div>
        </div>

        <div className="ready-agent__notice">
          <span>안전 설정</span>
          <strong>위험 행동 없이 탐색합니다</strong>
          <p>실제 결제, 삭제·변경 같은 위험 행동, OAuth 우회는 수행하지 않습니다.</p>
        </div>

        {runStartError && (
          <p className="ready-agent__warning" role="status">
            {runStartError}
          </p>
        )}

        <div className="ready-agent__actions">
          <button className="create-analysis-panel__action ready-agent__primary-action" type="button" onClick={onStartRun} disabled={isCreatingRun}>
            {isCreatingRun ? 'Run 생성 중…' : '분석 시작'}
          </button>
          <button className="ready-agent__secondary-action" type="button" onClick={onEditScope} disabled={isCreatingRun}>
            범위 다시 조정
          </button>
        </div>

        <p className="ready-agent__note">분석 시작 후 실시간 Trace 화면에서 진행률, 체크포인트, 화면 미리보기를 확인할 수 있습니다.</p>
      </div>
    </section>
  );
}

export function CreateAnalysisPage() {
  const [routeState, setRouteState] = useState<CreateAnalysisPageRouteState>(getInitialRouteState);
  const [headlineIndex, setHeadlineIndex] = useState(0);
  const [urlInput, setUrlInput] = useState(routeState.submittedUrl ?? '');
  const [urlError, setUrlError] = useState('');
  const [isCreatingRun, setIsCreatingRun] = useState(false);
  const [runStartError, setRunStartError] = useState('');
  const stage = routeState.stage;
  const submittedUrl = routeState.submittedUrl ?? '';
  const selectedScenario = useMemo(() => findScenarioById(routeState.scenarioId), [routeState.scenarioId]);
  const selectedDepthId = routeState.depthId ?? DEFAULT_SCENARIO_DEPTH_ID;
  const selectedDepth = useMemo(() => findDepthById(selectedDepthId), [selectedDepthId]);
  const createRunIds = useMemo(() => getCreateRunIds(routeState), [routeState]);

  useEffect(() => {
    let rotationIntervalId = 0;

    const startRotation = () => {
      setHeadlineIndex((currentIndex) => (currentIndex + 1) % HEADLINE_PHRASES.length);

      rotationIntervalId = window.setInterval(() => {
        setHeadlineIndex((currentIndex) => (currentIndex + 1) % HEADLINE_PHRASES.length);
      }, WORD_ROTATION_INTERVAL_MS);
    };

    const firstRotationTimeoutId = window.setTimeout(startRotation, FIRST_WORD_DELAY_MS);

    return () => {
      window.clearTimeout(firstRotationTimeoutId);

      if (rotationIntervalId) {
        window.clearInterval(rotationIntervalId);
      }
    };
  }, []);

  const normalizedUrl = useMemo(() => normalizeAnalysisUrl(urlInput), [urlInput]);
  const canSubmit = urlInput.trim().length > 0;
  const navigateToRouteState = useCallback((nextRouteState: CreateAnalysisPageRouteState, historyMode: 'push' | 'replace' = 'push') => {
    const routeStateWithDevContext = withCreateRunContextFallback(nextRouteState, DEV_CREATE_RUN_CONTEXT);
    const nextPath = buildCreateAnalysisPath(routeStateWithDevContext, CREATE_ANALYSIS_ROUTE_OPTIONS);

    if (historyMode === 'replace') {
      window.history.replaceState(null, '', nextPath);
    } else {
      window.history.pushState(null, '', nextPath);
    }

    setRouteState(routeStateWithDevContext);
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      setRouteState(withCreateRunContextFallback(
        parseCreateAnalysisRouteState(window.location.search, CREATE_ANALYSIS_ROUTE_OPTIONS),
        DEV_CREATE_RUN_CONTEXT,
      ));
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    setUrlInput(routeState.submittedUrl ?? '');
    setUrlError('');
  }, [routeState.submittedUrl]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!canSubmit) {
      setUrlError('분석할 사이트 URL을 입력해주세요.');
      return;
    }

    if (!normalizedUrl) {
      setUrlError('http 또는 https로 열 수 있는 사이트 URL을 입력해주세요.');
      return;
    }

    setUrlError('');
    navigateToRouteState({
      ...routeState,
      stage: 'discovering',
      submittedUrl: normalizedUrl,
      scenarioId: null,
      depthId: null,
    });
  };

  const showRecommendations = () => {
    if (!submittedUrl) {
      return;
    }

    navigateToRouteState({
      ...routeState,
      stage: 'recommendations',
      submittedUrl,
      scenarioId: null,
      depthId: null,
    });
  };

  const chooseScenario = (scenario: ScenarioRecommendation) => {
    if (!submittedUrl) {
      return;
    }

    navigateToRouteState({
      ...routeState,
      stage: 'onboarding',
      submittedUrl,
      scenarioId: scenario.id,
      depthId: DEFAULT_SCENARIO_DEPTH_ID,
    });
  };

  const chooseDepth = (depthId: ScenarioDepthId) => {
    if (!submittedUrl || !selectedScenario) {
      return;
    }

    navigateToRouteState(
      {
        ...routeState,
        stage: 'onboarding',
        submittedUrl,
        scenarioId: selectedScenario.id,
        depthId,
      },
      'replace',
    );
  };

  const showReady = () => {
    if (!submittedUrl || !selectedScenario) {
      return;
    }

    navigateToRouteState({
      ...routeState,
      stage: 'ready',
      submittedUrl,
      scenarioId: selectedScenario.id,
      depthId: selectedDepthId,
    });
  };

  const editScope = () => {
    if (!submittedUrl || !selectedScenario || isCreatingRun) {
      return;
    }

    navigateToRouteState({
      ...routeState,
      stage: 'onboarding',
      submittedUrl,
      scenarioId: selectedScenario.id,
      depthId: selectedDepthId,
    });
  };

  const startAnalysisRun = async () => {
    if (!submittedUrl || !selectedScenario || isCreatingRun) {
      return;
    }

    setIsCreatingRun(true);
    setRunStartError('');

    const fallbackPath = buildRunMonitorPath(buildMockRunId(selectedScenario.id), {
      submittedUrl,
      scenarioId: selectedScenario.id,
      depthId: selectedDepthId,
    });
    if (!createRunIds) {
      setRunStartError('Run 생성에 필요한 project/scenario UUID가 없어 mock live trace로 이동합니다.');
      window.location.assign(fallbackPath);
      return;
    }

    let createdRunId = '';

    try {
      const response = await createRun({
        projectId: createRunIds.projectId,
        name: selectedScenario.title,
        startUrl: submittedUrl,
        goal: selectedScenario.summary,
        devicePreset: 'desktop',
        scenarioTemplateVersionId: createRunIds.scenarioTemplateVersionId,
        scenarioOverrides: {
          depthId: selectedDepthId,
          source: 'create-analysis-ready',
        },
        scenarioPlan: buildPrototypeScenarioPlan({ submittedUrl, selectedScenario, selectedDepth }),
      });
      createdRunId = response.data.id;
    } catch {
      setRunStartError('Run 생성에 실패했습니다. 프로젝트와 시나리오 설정을 확인한 뒤 다시 시도해주세요.');
      setIsCreatingRun(false);
      return;
    }

    try {
      await startRun(createdRunId);
    } catch {
      setRunStartError('Run은 생성됐지만 시작 요청에 실패했습니다. 실시간 Trace에서 현재 상태를 확인합니다.');
    } finally {
      window.location.assign(buildRunMonitorPath(createdRunId, {
        submittedUrl,
        scenarioId: selectedScenario.id,
        depthId: selectedDepthId,
      }));
    }
  };

  return (
    <div className="create-analysis-page">
      <div className="create-analysis-page__grain" />

      <svg className="create-analysis-filter-defs" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <defs>
          <filter id="gooey">
            <feColorMatrix in="SourceGraphic" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 255 -140" />
          </filter>
        </defs>
      </svg>

      <header className="create-analysis-nav" aria-label="Wedge home">
        <a href="/" className="create-analysis-nav__brand">
          Wedge
        </a>
      </header>

      <main className="create-analysis-page__main">
        {stage === 'input' && (
          <section className="create-analysis-hero" aria-labelledby="create-analysis-title">
            <h1 className="create-analysis-hero__accessible-title" id="create-analysis-title">
              Find friction in your conversion flow
            </h1>

            <div className="create-analysis-hero__gooey" style={{ filter: 'url(#gooey)' }} aria-hidden="true">
              {HEADLINE_PHRASES.map((phrase, phraseIndex) => {
                const isActive = phraseIndex === headlineIndex;

                return (
                  <span
                    key={phrase}
                    className={`create-analysis-hero__word ${isActive ? 'create-analysis-hero__word--active' : ''}`}
                    style={{
                      opacity: isActive ? 1 : 0,
                      filter: isActive ? 'blur(0px)' : 'blur(20px)',
                      transform: `translate(-50%, -50%) translateX(22px) scale(${isActive ? 1 : 1.1})`,
                    }}
                  >
                    {phrase}
                  </span>
                );
              })}
            </div>

            <form className={`create-analysis-search ${urlInput.trim() ? 'create-analysis-search--has-value' : ''}`} onSubmit={handleSubmit}>
              <label className="create-analysis-search__label" htmlFor="analysis-url">
                분석할 사이트 URL
              </label>
              <input
                id="analysis-url"
                className="create-analysis-search__input"
                value={urlInput}
                onChange={(event) => {
                  setUrlInput(event.target.value);
                  setUrlError('');
                }}
                placeholder="분석할 사이트 URL을 입력하세요"
                inputMode="url"
                autoComplete="url"
                aria-describedby={urlError ? 'analysis-url-error' : undefined}
                aria-invalid={urlError ? 'true' : 'false'}
              />
              <div className="create-analysis-search__action">
                <div className="create-analysis-search__status-dot" aria-hidden="true">
                  <SendIcon />
                </div>

                <button className="create-analysis-search__send" type="submit" disabled={!canSubmit} aria-label="사이트 살펴보기">
                  <SendIcon />
                </button>
              </div>
            </form>
            {urlError && (
              <p className="create-analysis-search__error" id="analysis-url-error" role="alert">
                {urlError}
              </p>
            )}
          </section>
        )}

        {stage === 'discovering' && <PreflightAgent submittedUrl={submittedUrl} onShowRecommendations={showRecommendations} />}

        {stage === 'recommendations' && (
          <RecommendationAgent submittedUrl={submittedUrl} scenarios={scenarioRecommendations} onChooseScenario={chooseScenario} />
        )}

        {stage === 'onboarding' && selectedScenario && (
          <ScenarioSetupAgent selectedScenario={selectedScenario} selectedDepthId={selectedDepthId} onDepthChange={chooseDepth} onReady={showReady} />
        )}

        {stage === 'ready' && selectedScenario && (
          <ReadyAgent
            submittedUrl={submittedUrl}
            selectedScenario={selectedScenario}
            selectedDepth={selectedDepth}
            isCreatingRun={isCreatingRun}
            runStartError={runStartError}
            onEditScope={editScope}
            onStartRun={startAnalysisRun}
          />
        )}
      </main>
    </div>
  );
}
