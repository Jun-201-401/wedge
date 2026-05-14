import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { createDiscovery, getDiscovery } from '../../api/discoveries';
import { readCurrentUser } from '../../api/authSession';
import { readApiValidationFields, WedgeApiError } from '../../api/http';
import { createRun, startRun } from '../../api/runs';
import { confirmScenarioAuthoringCandidate, createScenarioAuthoringJob, getScenarioAuthoringJob } from '../../api/scenario-authoring';
import type { ScenarioAuthoringCandidate } from '../../entities/scenario-authoring';
import { FIRST_WORD_DELAY_MS, WORD_ROTATION_INTERVAL_MS } from '../../features/landing-vision';
import { HOME_PATH, LOGIN_PATH, RUNS_PATH } from '../../shared/lib/appPaths';
import { formatDisplayUrl } from '../../shared/lib/displayUrl';
import { pushAppPath } from '../../shared/lib/navigation';
import { buildRunMonitorPath } from '../run-monitor/lib/runMonitorRoute';
import {
  buildCreateAnalysisPath,
  createManualChoiceRouteState,
  createRecommendationChoiceRouteState,
  createScenarioReadyRouteState,
  parseCreateAnalysisRouteState,
  readCreateRunContextFromEnv,
  type CreateAnalysisRouteOptions,
  type CreateAnalysisRouteState,
  type CreateRunContext,
  withCreateRunContextFallback,
  withoutCreateRunContext,
} from './lib/createAnalysisRouteState';
import { normalizeAnalysisUrl } from './lib/createAnalysisUrl';
import {
  CREATE_ANALYSIS_SCENARIO_IDS,
  toManualScenarioRecommendationViewModels,
  toScenarioRecommendationViewModels,
  type CreateAnalysisScenarioId,
  type ScenarioRecommendationViewModel,
} from './lib/discoveryRecommendations';
import { createDiscoveryIdempotencyKey, isDiscoveryBusy } from './lib/discoveryPreflight';
import {
  createScenarioAuthoringIdempotencyKey,
  createScenarioPlanPreview,
  isScenarioAuthoringSupportedType,
  requireConfirmedScenarioPlanStartUrl,
  selectScenarioAuthoringCandidate,
  type ScenarioPlanPreview,
} from './lib/scenarioAuthoring';
import './CreateAnalysisPage.css';

type DiscoveryStepStatus = 'complete' | 'active' | 'pending';
type ScenarioId = CreateAnalysisScenarioId;
type ScenarioRecommendation = ScenarioRecommendationViewModel;
type ScenarioDepthId = 'hero-only' | 'next-screen' | 'form-depth';

interface CreateAnalysisPageProps {
  isAuthenticated?: boolean;
  isAuthChecking?: boolean;
  onLogout?: () => void;
}

type DiscoveryUiState =
  | { kind: 'idle' }
  | { kind: 'creating' }
  | { kind: 'polling'; discoveryId: string; status: string; progressSteps: DiscoveryStep[] }
  | { kind: 'completed'; discoveryId: string; scenarios: ScenarioRecommendation[] }
  | { kind: 'empty'; discoveryId: string; message: string }
  | { kind: 'failed'; message: string };

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 19V5M5 12l7-7 7 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function createDiscoveryFailureMessage(error: unknown) {
  if (!(error instanceof WedgeApiError)) {
    return '사이트 확인을 시작하지 못했습니다. 로그인 상태와 프로젝트 자동 생성 상태를 확인한 뒤 다시 시도해주세요.';
  }

  const validationFields = readApiValidationFields(error.details);
  if (error.status === 422 && validationFields.some((fieldError) => fieldError.field === 'projectId')) {
    return '사이트 확인 API가 아직 projectId 필수 계약으로 동작 중입니다. API 서버를 최신 코드로 재시작한 뒤 다시 시도해주세요.';
  }

  if (error.status === 422 && validationFields.some((fieldError) => fieldError.field === 'url')) {
    return '입력한 URL 형식이 API 검증을 통과하지 못했습니다. http 또는 https로 열 수 있는 공개 사이트 URL을 입력해주세요.';
  }

  if (error.status === 400 && error.code === 'invalid_request') {
    return '입력한 URL이 사이트 확인 검증을 통과하지 못했습니다. localhost, 사설망 주소가 아닌 공개 사이트 URL을 입력해주세요.';
  }

  if (error.status === 401) {
    return '로그인 세션이 만료되었습니다. 다시 로그인한 뒤 URL 확인을 시작해주세요.';
  }

  if (error.status === 403) {
    return '현재 계정으로 접근할 수 없는 프로젝트입니다. URL 확인을 다시 시작해 자동 프로젝트를 새로 연결해주세요.';
  }

  return '사이트 확인을 시작하지 못했습니다. 로그인 상태와 프로젝트 자동 생성 상태를 확인한 뒤 다시 시도해주세요.';
}

interface DiscoveryStep {
  label: string;
  detail: string;
  status: DiscoveryStepStatus;
}

interface ScenarioDepthOption {
  id: ScenarioDepthId;
  title: string;
  detail: string;
}

const HEADLINE_PHRASES = ['Find', 'Friction'] as const;
const DISCOVERY_POLL_INTERVAL_MS = 1800;
const DISCOVERY_TIMEOUT_MS = 90000;
const SCENARIO_AUTHORING_POLL_INTERVAL_MS = 1200;
const SCENARIO_AUTHORING_TIMEOUT_MS = 45000;
const DISCOVERY_VIEWPORT = { width: 1440, height: 900 } as const;
const PREFLIGHT_DISCOVERY_STEPS: DiscoveryStep[] = [
  {
    label: '탐색 준비',
    detail: '입력한 URL로 사이트 확인 작업을 준비합니다',
    status: 'active',
  },
  {
    label: '첫 화면 열기',
    detail: '페이지에 연결해 첫 화면과 주요 링크를 확인합니다',
    status: 'pending',
  },
  {
    label: '전환 후보 탐색',
    detail: '사용자가 다음 행동으로 이동하는 버튼, 링크, 입력 후보를 찾습니다',
    status: 'pending',
  },
  {
    label: '구매·문의 흐름 확인',
    detail: '요금제, 구매, 문의처럼 이어질 수 있는 흐름을 좁힙니다',
    status: 'pending',
  },
  {
    label: '추천 흐름 정리',
    detail: '지금 바로 실행할 만한 진단 흐름을 우선순위로 정리합니다',
    status: 'pending',
  },
];

const SCENARIO_DEPTH_OPTIONS: ScenarioDepthOption[] = [
  {
    id: 'hero-only',
    title: '첫 화면만 보기',
    detail: '첫 화면에서 다음 행동이 바로 보이는지 확인해요',
  },
  {
    id: 'next-screen',
    title: '다음 화면까지 보기',
    detail: '다음 화면의 맥락까지 이어서 확인해요',
  },
  {
    id: 'form-depth',
    title: '입력 폼까지 보기',
    detail: '입력 부담과 제출 전 신뢰 요소를 확인해요',
  },
];
const SCENARIO_IDS = CREATE_ANALYSIS_SCENARIO_IDS;
const SCENARIO_DEPTH_IDS = SCENARIO_DEPTH_OPTIONS.map((option) => option.id);
const DEFAULT_SCENARIO_DEPTH_ID = 'hero-only' satisfies ScenarioDepthId;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CREATE_ANALYSIS_ROUTE_OPTIONS: CreateAnalysisRouteOptions<ScenarioId, ScenarioDepthId> = {
  defaultDepthId: DEFAULT_SCENARIO_DEPTH_ID,
  validDepthIds: SCENARIO_DEPTH_IDS,
  validScenarioIds: SCENARIO_IDS,
};
const ENV_CREATE_RUN_CONTEXT = readCreateRunContextFromEnv(import.meta.env);

interface CreateRunIds {
  projectId: string;
  scenarioTemplateVersionId?: string;
}

type ScenarioAuthoringUiState =
  | { kind: 'idle' }
  | { kind: 'creating' }
  | { kind: 'polling'; authoringJobId: string; status: string }
  | { kind: 'succeeded'; authoringJobId: string; candidate: ScenarioAuthoringCandidate; preview: ScenarioPlanPreview | null }
  | { kind: 'failed'; message: string };

function readUserCreateRunContext(): Partial<CreateRunContext> {
  const currentUser = readCurrentUser();

  if (!currentUser?.defaultProjectId) {
    return {};
  }

  return {
    projectId: currentUser.defaultProjectId,
    ...(currentUser.defaultScenarioTemplateVersionId ? { scenarioTemplateVersionId: currentUser.defaultScenarioTemplateVersionId } : {}),
  };
}

function getCreateRunContextFallback(): Partial<CreateRunContext> {
  return {
    ...ENV_CREATE_RUN_CONTEXT,
    ...readUserCreateRunContext(),
  };
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
    getCreateRunContextFallback(),
  );
}

function getLoginPathForCurrentCreateAnalysisState() {
  const nextPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  return getLoginPathForNextPath(nextPath);
}

function getLoginPathForNextPath(nextPath: string) {
  return `${LOGIN_PATH}?${new URLSearchParams({ next: nextPath }).toString()}`;
}

function getLoginPathForCreateAnalysisRouteState(routeState: CreateAnalysisPageRouteState) {
  return getLoginPathForNextPath(buildCreateAnalysisPath(routeState, CREATE_ANALYSIS_ROUTE_OPTIONS));
}

function findScenarioById(scenarioId: ScenarioId | null, scenarios: ScenarioRecommendation[]) {
  return scenarios.find((scenario) => scenario.id === scenarioId) ?? null;
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

  if (!isUuid(projectId)) {
    return null;
  }

  return {
    projectId,
    ...(isUuid(scenarioTemplateVersionId) ? { scenarioTemplateVersionId } : {}),
  };
}

function clearCreateRunContext(routeState: CreateAnalysisPageRouteState): CreateAnalysisPageRouteState {
  return withoutCreateRunContext(routeState);
}

function createDiscoveryRouteState(routeState: CreateAnalysisPageRouteState, submittedUrl: string): CreateAnalysisPageRouteState {
  return clearCreateRunContext({
    ...routeState,
    stage: 'discovering',
    submittedUrl,
    scenarioId: null,
    depthId: null,
  });
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function isDiscoveryTerminalFailure(status: string) {
  return status === 'FAILED' || status === 'CANCELED' || status === 'EXPIRED';
}

function getPollingSteps(status: string): DiscoveryStep[] {
  if (status === 'COMPLETED') {
    return PREFLIGHT_DISCOVERY_STEPS.map((step) => ({ ...step, status: 'complete' }));
  }

  const activeIndex = status === 'RUNNING' ? 2 : 1;
  return PREFLIGHT_DISCOVERY_STEPS.map((step, index) => ({
    ...step,
    status: index < activeIndex ? 'complete' : index === activeIndex ? 'active' : 'pending',
  }));
}

interface PreflightAgentProps {
  submittedUrl: string;
  discoveryState: DiscoveryUiState;
  onRetry: () => void;
  onEditUrl: () => void;
}

interface RecommendationAgentProps {
  submittedUrl: string;
  scenarios: ScenarioRecommendation[];
  emptyMessage?: string;
  onChooseScenario: (scenario: ScenarioRecommendation) => void;
  onOpenManualChoice: () => void;
}

interface ManualChoiceAgentProps {
  submittedUrl: string;
  scenarios: ScenarioRecommendation[];
  onChooseScenario: (scenario: ScenarioRecommendation) => void;
  onBackToRecommendations: () => void;
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
  scenarioAuthoringEnabled: boolean;
  scenarioAuthoringState: ScenarioAuthoringUiState;
  isCreatingRun: boolean;
  runStartError: string;
  onChooseDifferentScenario: () => void;
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

function PreflightAgent({ submittedUrl, discoveryState, onRetry, onEditUrl }: PreflightAgentProps) {
  const steps = discoveryState.kind === 'polling' ? discoveryState.progressSteps : PREFLIGHT_DISCOVERY_STEPS;
  const progressPercent = getDiscoveryProgressPercent(steps);
  const isFailed = discoveryState.kind === 'failed';
  const submittedUrlLabel = formatDisplayUrl(submittedUrl);

  return (
    <section className="create-analysis-panel create-analysis-panel--preflight" aria-labelledby="discovery-progress-title">
      <div className="preflight-agent" aria-live="polite">
        <div className="preflight-agent__header">
          <div className="preflight-agent__header-main">
            <div className="preflight-agent__header-copy">
              <p>사전 탐색</p>
              <h2 id="discovery-progress-title">분석할 흐름을 찾고 있어요</h2>
            </div>
          </div>

          <div className="preflight-agent__progress" aria-label={`진행률 ${progressPercent}%`}>
            <span className="preflight-agent__progress-value">{progressPercent}</span>
            <span className="preflight-agent__progress-unit">%</span>
          </div>
        </div>

        <p className="preflight-agent__url" title={submittedUrl}>{submittedUrlLabel}</p>
        <div className="preflight-agent__divider" aria-hidden="true" />

        <ol className="preflight-agent__timeline" aria-label="Discovery 진행 상태">
          {steps.map((step, stepIndex) => (
            <li
              key={step.label}
              className={`preflight-agent__step preflight-agent__step--${step.status}`}
              aria-current={step.status === 'active' ? 'step' : undefined}
            >
              {stepIndex < steps.length - 1 ? (
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

        {isFailed ? (
          <div className="preflight-agent__state preflight-agent__state--error" role="alert">
            <span>확인 실패</span>
            <strong>사이트 확인을 시작하지 못했습니다</strong>
            <p>{discoveryState.message}</p>
            <div className="preflight-agent__actions">
              <button className="create-analysis-panel__action preflight-agent__action" type="button" onClick={onRetry}>
                다시 시도
              </button>
              <button className="create-analysis-secondary-action preflight-agent__secondary-action" type="button" onClick={onEditUrl}>
                URL 수정
              </button>
            </div>
          </div>
        ) : (
          <p className="preflight-agent__note">이 단계가 끝나면 바로 실행할 수 있는 점검 흐름을 추천해드릴게요.</p>
        )}
      </div>
    </section>
  );
}

function RecommendationAgent({ submittedUrl, scenarios, emptyMessage, onChooseScenario, onOpenManualChoice }: RecommendationAgentProps) {
  const visibleScenarios = scenarios.filter((scenario) => scenario.isRunnable);
  const detectedScenarioCount = visibleScenarios.length;
  const hasDetectedScenarios = detectedScenarioCount > 0;
  const hasManualScenarios = toManualScenarioRecommendationViewModels(visibleScenarios.map((scenario) => scenario.id)).length > 0;
  const submittedUrlLabel = formatDisplayUrl(submittedUrl);

  return (
    <section className="create-analysis-panel create-analysis-panel--recommendations" aria-labelledby="recommendations-title">
      <div className="recommendation-agent">
        <div className="recommendation-agent__header">
          <div className="recommendation-agent__header-main">
            <div className="recommendation-agent__header-copy">
              <p>진단 흐름 추천</p>
              <h2 id="recommendations-title">{hasDetectedScenarios ? '이 사이트에서 점검해볼 만한 흐름을 찾았어요' : '점검할 흐름을 직접 선택해주세요'}</h2>
            </div>
          </div>

          <div className="recommendation-agent__count" aria-label={`탐지된 추천 흐름 ${detectedScenarioCount}개`}>
            <span className="recommendation-agent__count-value">{detectedScenarioCount}</span>
            <span className="recommendation-agent__count-label">탐지됨</span>
          </div>
        </div>

        <p className="recommendation-agent__url" title={submittedUrl}>{submittedUrlLabel}</p>
        <p className="recommendation-agent__limitation">
          {hasDetectedScenarios
            ? '사이트 화면에서 확인한 버튼, 링크, 폼 신호를 기준으로 추천했어요. 이미지 텍스트, 숨겨진 메뉴, 로그인 뒤 화면은 제외될 수 있어요.'
            : '현재 화면에서 확인한 버튼, 링크, 폼 신호만으로는 바로 실행할 흐름을 고르기 어려워요.'}
        </p>
        <div className="recommendation-agent__divider" aria-hidden="true" />

        {visibleScenarios.length === 0 ? (
          <div className="recommendation-agent__empty" role="status">
            <strong>가입, 로그인, 결제 같은 흐름을 직접 고를 수 있어요</strong>
            <p>{emptyMessage ?? '다음 화면에서 점검할 흐름을 선택해 진단을 시작하세요.'}</p>
            {hasManualScenarios ? (
              <button className="create-analysis-secondary-action recommendation-agent__empty-action" type="button" onClick={onOpenManualChoice}>
                직접 흐름 선택
              </button>
            ) : null}
          </div>
        ) : (
          <div className="scenario-grid">
            {visibleScenarios.map((scenario) => (
              <article key={`${scenario.scenarioType}-${scenario.id}`} className={`scenario-card scenario-card--${scenario.tone}`}>
                <span className="scenario-card__level">{scenario.levelLabel}</span>
                <h3>{scenario.title}</h3>
                <p>{scenario.summary}</p>
                <div className="scenario-card__site-context" aria-label={`${scenario.title} 추천 근거`}>
                  <div className="scenario-card__context-row">
                    <span>추천 근거</span>
                    <strong>{scenario.signalLabels[0] ?? scenario.evidence}</strong>
                  </div>
                  {scenario.targetLabel || scenario.suggestedStartUrl ? (
                    <div className="scenario-card__context-row">
                      <span>추천 진입점</span>
                      <strong>{scenario.targetLabel ?? formatDisplayUrl(scenario.suggestedStartUrl ?? '', 46)}</strong>
                    </div>
                  ) : null}
                  <ol className="scenario-card__preview-steps">
                    {scenario.previewSteps.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                </div>
                <button
                  type="button"
                  aria-label={`${scenario.title} 흐름으로 진단`}
                  onClick={() => onChooseScenario(scenario)}
                >
                  {scenario.actionLabel}
                </button>
              </article>
            ))}
          </div>
        )}

        {hasDetectedScenarios && hasManualScenarios ? (
          <div className="recommendation-agent__manual-entry">
            <div>
              <strong>원하는 흐름이 없나요?</strong>
              <p>자동 추천에 없는 흐름은 다음 화면에서 직접 선택할 수 있어요.</p>
            </div>
            <button className="create-analysis-secondary-action" type="button" onClick={onOpenManualChoice}>
              다른 흐름 선택
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function ManualChoiceAgent({ submittedUrl, scenarios, onChooseScenario, onBackToRecommendations }: ManualChoiceAgentProps) {
  const submittedUrlLabel = formatDisplayUrl(submittedUrl);

  return (
    <section className="create-analysis-panel create-analysis-panel--manual-choice" aria-labelledby="manual-choice-title">
      <div className="manual-choice-agent">
        <div className="manual-choice-agent__header">
          <div className="manual-choice-agent__header-main">
            <div className="manual-choice-agent__header-copy">
              <p>직접 선택</p>
              <h2 id="manual-choice-title">점검할 흐름을 직접 고르세요</h2>
            </div>
          </div>
        </div>

        <p className="manual-choice-agent__url" title={submittedUrl}>{submittedUrlLabel}</p>
        <p className="manual-choice-agent__note">자동 탐지 근거가 약한 흐름은 사용자가 선택한 목표를 기준으로 안전하게 탐색합니다.</p>
        <div className="manual-choice-agent__divider" aria-hidden="true" />

        <div className="manual-choice-agent__grid">
          {scenarios.map((scenario) => (
            <button
              key={`manual-${scenario.id}`}
              className="manual-choice-agent__option"
              type="button"
              onClick={() => onChooseScenario(scenario)}
            >
              <span>{scenario.levelLabel}</span>
              <strong>{scenario.title}</strong>
              <small>{scenario.summary}</small>
            </button>
          ))}
        </div>

        <button className="create-analysis-secondary-action manual-choice-agent__back" type="button" onClick={onBackToRecommendations}>
          추천 흐름으로 돌아가기
        </button>
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

function isScenarioAuthoringBusy(state: ScenarioAuthoringUiState) {
  return state.kind === 'creating' || state.kind === 'polling';
}

function getAuthoringStatusText(state: ScenarioAuthoringUiState, isEnabled: boolean) {
  switch (state.kind) {
    case 'creating':
      return '사이트 맞춤 시나리오 생성 요청 중';
    case 'polling':
      return getAuthoringPollingStatusText(state.status);
    case 'succeeded':
      return '사이트 맞춤 시나리오 준비 완료';
    case 'failed':
      return '기본 추천 흐름으로 시작 가능';
    default:
      return isEnabled ? '사이트 맞춤 시나리오 생성 대기 중' : '기본 추천 흐름으로 시작 가능';
  }
}

function getAuthoringPollingStatusText(status: string) {
  switch (status) {
    case 'CREATED':
    case 'QUEUED':
      return '사이트 맞춤 시나리오 생성 대기 중';
    case 'RUNNING':
      return '사이트 맞춤 시나리오 생성 중';
    case 'SUCCEEDED':
      return '사이트 맞춤 시나리오 준비 완료';
    case 'FAILED':
    case 'CANCELED':
    case 'EXPIRED':
      return '기본 추천 흐름으로 시작 가능';
    default:
      return '시나리오 생성 상태 확인 중';
  }
}

function ReadyAgent({
  submittedUrl,
  selectedScenario,
  selectedDepth,
  scenarioAuthoringEnabled,
  scenarioAuthoringState,
  isCreatingRun,
  runStartError,
  onChooseDifferentScenario,
  onStartRun,
}: ReadyAgentProps) {
  const preview = scenarioAuthoringState.kind === 'succeeded' ? scenarioAuthoringState.preview : null;
  const submittedUrlLabel = formatDisplayUrl(submittedUrl);
  const previewStartUrlLabel = preview?.startUrl ? formatDisplayUrl(preview.startUrl) : '';

  return (
    <section className="create-analysis-panel create-analysis-panel--ready" aria-labelledby="ready-title">
      <div className="ready-agent">
        <div className="ready-agent__header">
          <div className="ready-agent__header-main">
            <div className="ready-agent__header-copy">
              <h2 id="ready-title">분석 시작 준비 완료</h2>
              <div className="ready-agent__header-status">
                <span className="ready-agent__header-status-dot" aria-hidden="true" />
                <span>{getAuthoringStatusText(scenarioAuthoringState, scenarioAuthoringEnabled)}</span>
              </div>
            </div>
          </div>

          <span className="ready-agent__badge">준비 완료</span>
        </div>

        <div className="ready-agent__url-card">
          <span>대상 URL</span>
          <strong title={submittedUrl}>{submittedUrlLabel}</strong>
        </div>

        <div className="ready-agent__summary-grid" aria-label="진단 시작 전 요약">
          <article className="ready-agent__summary-card">
            <span>진단 흐름</span>
            <strong>{selectedScenario.title}</strong>
            <p>{selectedScenario.summary}</p>
          </article>
          <article className="ready-agent__summary-card">
            <span>확인 범위</span>
            <strong>{selectedDepth.title}</strong>
            <p>{selectedDepth.detail}</p>
          </article>
        </div>

        {preview ? (
          <div className="ready-agent__scenario-plan" aria-label="생성된 시나리오 단계 미리보기">
            <div className="ready-agent__scenario-plan-head">
              <div>
                <span>생성된 흐름</span>
                <strong>{preview.title}</strong>
              </div>
              <small>{preview.stepCount}단계</small>
            </div>
            {preview.startUrl ? <p className="ready-agent__scenario-plan-url" title={preview.startUrl}>{previewStartUrlLabel}</p> : null}
            <ol className="ready-agent__scenario-steps">
              {preview.steps.map((step) => (
                <li key={step.id}>
                  <strong>{step.label}</strong>
                  <p>{step.detail}</p>
                </li>
              ))}
            </ol>
          </div>
        ) : (
          <div className="ready-agent__launch-plan" aria-label="분석 시작 후 진행 단계">
            <div>
              <span className="ready-agent__launch-step">1</span>
              <p>시나리오 생성</p>
            </div>
            <div>
              <span className="ready-agent__launch-step">2</span>
              <p>마찰 기록</p>
            </div>
            <div>
              <span className="ready-agent__launch-step">3</span>
              <p>리포트 생성</p>
            </div>
          </div>
        )}

        <div className="ready-agent__notice">
          <span>안전 설정</span>
          <strong>안전하게 탐색합니다</strong>
          <p>{preview?.safetyLabel ?? '실제 결제, 삭제, 변경 같은 위험 행동은 수행하지 않아요.'}</p>
        </div>

        {scenarioAuthoringState.kind === 'failed' ? (
          <p className="ready-agent__warning" role="status">
            {scenarioAuthoringState.message}
          </p>
        ) : null}

        {runStartError && (
          <p className="ready-agent__warning" role="status">
            {runStartError}
          </p>
        )}

        <div className="ready-agent__actions">
          <button className="create-analysis-panel__action ready-agent__primary-action" type="button" onClick={onStartRun} disabled={isCreatingRun}>
            {isCreatingRun ? '시나리오 준비 중…' : '분석 시작하기'}
          </button>
          <button className="create-analysis-secondary-action" type="button" onClick={onChooseDifferentScenario} disabled={isCreatingRun}>
            다른 흐름 선택
          </button>
        </div>
      </div>
    </section>
  );
}

export function CreateAnalysisPage({ isAuthenticated = false, isAuthChecking = false, onLogout }: CreateAnalysisPageProps) {
  const [routeState, setRouteState] = useState<CreateAnalysisPageRouteState>(getInitialRouteState);
  const [headlineIndex, setHeadlineIndex] = useState(0);
  const [urlInput, setUrlInput] = useState(routeState.submittedUrl ?? '');
  const [urlError, setUrlError] = useState('');
  const [discoveryState, setDiscoveryState] = useState<DiscoveryUiState>({ kind: 'idle' });
  const [scenarioAuthoringState, setScenarioAuthoringState] = useState<ScenarioAuthoringUiState>({ kind: 'idle' });
  const [isCreatingRun, setIsCreatingRun] = useState(false);
  const [runStartError, setRunStartError] = useState('');
  const discoveryRequestSeq = useRef(0);
  const scenarioAuthoringRequestSeq = useRef(0);
  const stage = routeState.stage;
  const submittedUrl = routeState.submittedUrl ?? '';
  const recommendationScenarios = useMemo(
    () => discoveryState.kind === 'completed' ? discoveryState.scenarios : [],
    [discoveryState],
  );
  const manualChoiceScenarios = useMemo(
    () => toManualScenarioRecommendationViewModels(recommendationScenarios.map((scenario) => scenario.id)),
    [recommendationScenarios],
  );
  const selectableScenarios = useMemo(
    () => [...recommendationScenarios, ...manualChoiceScenarios],
    [recommendationScenarios, manualChoiceScenarios],
  );
  const selectedScenario = useMemo(
    () => findScenarioById(routeState.scenarioId, selectableScenarios),
    [routeState.scenarioId, selectableScenarios],
  );
  const selectedDepthId = routeState.depthId ?? DEFAULT_SCENARIO_DEPTH_ID;
  const selectedDepth = useMemo(() => findDepthById(selectedDepthId), [selectedDepthId]);
  const createRunIds = useMemo(() => getCreateRunIds(routeState), [routeState]);
  const scenarioAuthoringRequestKey = useMemo(() => {
    if (!selectedScenario || !createRunIds?.scenarioTemplateVersionId || !selectedScenario.sourceDiscoveryId) {
      return null;
    }

    if (!isScenarioAuthoringSupportedType(selectedScenario.scenarioType)) {
      return null;
    }

    return createScenarioAuthoringIdempotencyKey(
      createRunIds.projectId,
      selectedScenario.sourceDiscoveryId,
      selectedScenario.scenarioType,
      selectedDepthId,
    );
  }, [createRunIds, selectedDepthId, selectedScenario]);
  const scenarioAuthoringBusy = isScenarioAuthoringBusy(scenarioAuthoringState);

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

  useEffect(() => () => {
    discoveryRequestSeq.current += 1;
  }, []);

  const normalizedUrl = useMemo(() => normalizeAnalysisUrl(urlInput), [urlInput]);
  const discoveryBusy = isDiscoveryBusy(discoveryState.kind);
  const canSubmit = urlInput.trim().length > 0 && !discoveryBusy;
  const navigateToRouteState = useCallback((nextRouteState: CreateAnalysisPageRouteState, historyMode: 'push' | 'replace' = 'push') => {
    const routeStateWithDevContext = withCreateRunContextFallback(nextRouteState, getCreateRunContextFallback());
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
      discoveryRequestSeq.current += 1;
      setRouteState(withCreateRunContextFallback(
        parseCreateAnalysisRouteState(window.location.search, CREATE_ANALYSIS_ROUTE_OPTIONS),
        getCreateRunContextFallback(),
      ));
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    setUrlInput(routeState.submittedUrl ?? '');
    setUrlError('');
  }, [routeState.submittedUrl]);

  useEffect(() => {
    scenarioAuthoringRequestSeq.current += 1;
    setScenarioAuthoringState({ kind: 'idle' });
  }, [routeState.scenarioId, routeState.depthId, routeState.submittedUrl]);

  useEffect(() => {
    if (stage !== 'discovering' || !submittedUrl || isAuthChecking || isAuthenticated) {
      return;
    }

    pushAppPath(getLoginPathForCreateAnalysisRouteState(clearCreateRunContext(routeState)));
  }, [isAuthenticated, isAuthChecking, routeState, stage, submittedUrl]);

  const runDiscovery = useCallback(async (targetUrl: string, currentRouteState: CreateAnalysisPageRouteState) => {
    const requestSeq = discoveryRequestSeq.current + 1;
    discoveryRequestSeq.current = requestSeq;
    setDiscoveryState({ kind: 'creating' });
    setRunStartError('');

    const discoveryRouteState = createDiscoveryRouteState(currentRouteState, targetUrl);
    let resolvedDiscoveryRouteState = discoveryRouteState;
    navigateToRouteState(discoveryRouteState);

    const completeDiscovery = (discoveryId: string, scenarios: ScenarioRecommendation[]) => {
      if (discoveryRequestSeq.current !== requestSeq) {
        return;
      }

      if (scenarios.length === 0) {
        setDiscoveryState({
          kind: 'empty',
          discoveryId,
          message: '현재 화면에서 바로 추천할 흐름을 고르기 어려워요. 다음 화면에서 직접 선택해 진단을 시작하세요.',
        });
      } else {
        setDiscoveryState({ kind: 'completed', discoveryId, scenarios });
      }

      navigateToRouteState({
        ...resolvedDiscoveryRouteState,
        stage: 'recommendations',
      });
    };

    try {
      const created = await createDiscovery({
        url: targetUrl,
        devicePreset: 'desktop',
        viewport: DISCOVERY_VIEWPORT,
      }, {
        idempotencyKey: createDiscoveryIdempotencyKey(targetUrl),
      });

      if (discoveryRequestSeq.current !== requestSeq) {
        return;
      }

      let discovery = created.data;
      const discoveryId = discovery.discoveryId;
      if (!isUuid(discovery.projectId)) {
        setDiscoveryState({
          kind: 'failed',
          message: '사이트 확인은 시작됐지만 연결된 프로젝트를 확인하지 못했습니다. 잠시 후 다시 시도해주세요.',
        });
        return;
      }
      resolvedDiscoveryRouteState = { ...discoveryRouteState, projectId: discovery.projectId };
      navigateToRouteState(resolvedDiscoveryRouteState, 'replace');
      setDiscoveryState({
        kind: 'polling',
        discoveryId,
        status: discovery.status,
        progressSteps: getPollingSteps(discovery.status),
      });

      const startedAt = Date.now();
      while (Date.now() - startedAt <= DISCOVERY_TIMEOUT_MS) {
        if (discovery.status === 'COMPLETED') {
          completeDiscovery(discoveryId, toScenarioRecommendationViewModels(discovery));
          return;
        }

        if (isDiscoveryTerminalFailure(discovery.status)) {
          setDiscoveryState({
            kind: 'failed',
            message: discovery.failureMessage ?? '사이트 확인에 실패했습니다. URL을 확인한 뒤 다시 시도해주세요.',
          });
          return;
        }

        await wait(DISCOVERY_POLL_INTERVAL_MS);
        if (discoveryRequestSeq.current !== requestSeq) {
          return;
        }

        const polled = await getDiscovery(discoveryId);
        discovery = polled.data;
        if (isUuid(discovery.projectId) && discovery.projectId !== resolvedDiscoveryRouteState.projectId) {
          resolvedDiscoveryRouteState = { ...resolvedDiscoveryRouteState, projectId: discovery.projectId };
          navigateToRouteState(resolvedDiscoveryRouteState, 'replace');
        }
        setDiscoveryState({
          kind: 'polling',
          discoveryId,
          status: discovery.status,
          progressSteps: getPollingSteps(discovery.status),
        });
      }

      setDiscoveryState({
        kind: 'failed',
        message: '사이트 확인 응답 시간이 초과됐습니다. 잠시 후 다시 시도해주세요.',
      });
    } catch (error) {
      if (discoveryRequestSeq.current === requestSeq) {
        setDiscoveryState({
          kind: 'failed',
          message: createDiscoveryFailureMessage(error),
        });
      }
    }
  }, [navigateToRouteState]);

  useEffect(() => {
    if (stage !== 'discovering' || !submittedUrl || isAuthChecking || !isAuthenticated || discoveryState.kind !== 'idle') {
      return;
    }

    void runDiscovery(submittedUrl, routeState);
  }, [discoveryState.kind, isAuthenticated, isAuthChecking, routeState, runDiscovery, stage, submittedUrl]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (discoveryBusy) {
      return;
    }

    if (!canSubmit) {
      setUrlError('분석할 사이트 URL을 입력해주세요.');
      return;
    }

    if (!normalizedUrl) {
      setUrlError('http 또는 https로 열 수 있는 사이트 URL을 입력해주세요.');
      return;
    }

    setUrlError('');

    const discoveryRouteState = createDiscoveryRouteState(routeState, normalizedUrl);

    if (isAuthChecking) {
      setUrlError('로그인 상태를 확인하는 중입니다. 잠시 후 다시 시도해주세요.');
      return;
    }

    if (!isAuthenticated) {
      pushAppPath(getLoginPathForCreateAnalysisRouteState(discoveryRouteState));
      return;
    }

    void runDiscovery(normalizedUrl, routeState);
  };

  const retryDiscovery = () => {
    if (!submittedUrl) {
      return;
    }

    void runDiscovery(submittedUrl, clearCreateRunContext(routeState));
  };

  const editUrl = () => {
    discoveryRequestSeq.current += 1;
    setDiscoveryState({ kind: 'idle' });
    navigateToRouteState(clearCreateRunContext({
      ...routeState,
      stage: 'input',
      submittedUrl: null,
      scenarioId: null,
      depthId: null,
    }));
  };

  const chooseScenario = (scenario: ScenarioRecommendation) => {
    if (!submittedUrl || !scenario.isRunnable) {
      return;
    }

    navigateToRouteState(createScenarioReadyRouteState(routeState, submittedUrl, scenario.id, DEFAULT_SCENARIO_DEPTH_ID));
  };

  const openManualChoice = () => {
    if (!submittedUrl) {
      return;
    }

    navigateToRouteState(createManualChoiceRouteState(routeState, submittedUrl));
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

  const chooseDifferentScenario = () => {
    if (!submittedUrl || isCreatingRun || scenarioAuthoringBusy) {
      return;
    }

    navigateToRouteState(createRecommendationChoiceRouteState(routeState, submittedUrl));
  };

  const createAndConfirmScenarioPlan = useCallback(async () => {
    if (!selectedScenario || !createRunIds?.scenarioTemplateVersionId || !selectedScenario.sourceDiscoveryId) {
      return null;
    }

    if (!isScenarioAuthoringSupportedType(selectedScenario.scenarioType)) {
      return null;
    }

    const requestSeq = scenarioAuthoringRequestSeq.current;
    const isCurrentRequest = () => scenarioAuthoringRequestSeq.current === requestSeq;
    setScenarioAuthoringState({ kind: 'creating' });
    const created = await createScenarioAuthoringJob({
      projectId: createRunIds.projectId,
      sourceDiscoveryId: selectedScenario.sourceDiscoveryId,
      selectedRecommendationId: selectedScenario.recommendationId ?? null,
      requestedGoal: `${selectedScenario.title} · ${selectedDepth.title}`,
      preferredScenarioType: selectedScenario.scenarioType,
      selectedRecommendation: selectedScenario.recommendationId ? null : {
        recommendationId: null,
        scenarioType: selectedScenario.scenarioType,
        recommendationLevel: selectedScenario.level,
        confidence: selectedScenario.confidence,
        evidenceRefs: selectedScenario.evidenceRefs,
        evidenceSummary: selectedScenario.evidenceSummary ?? null,
        suggestedStartUrl: selectedScenario.suggestedStartUrl ?? null,
        suggestedTarget: selectedScenario.suggestedTarget ?? null,
      },
      constraints: {
        depthId: selectedDepthId,
        depthTitle: selectedDepth.title,
      },
      providerPolicy: {
        providerOrder: ['RULE_BASED'],
        timeoutMs: SCENARIO_AUTHORING_TIMEOUT_MS,
        fallbackAllowed: true,
        approvalRequired: true,
      },
    }, {
      idempotencyKey: createScenarioAuthoringIdempotencyKey(
        createRunIds.projectId,
        selectedScenario.sourceDiscoveryId,
        selectedScenario.scenarioType,
        selectedDepthId,
      ),
    });

    if (!isCurrentRequest()) {
      return null;
    }

    let job = created.data;
    const authoringJobId = job.authoringJobId;
    const startedAt = Date.now();

    while (Date.now() - startedAt <= SCENARIO_AUTHORING_TIMEOUT_MS) {
      if (!isCurrentRequest()) {
        return null;
      }

      setScenarioAuthoringState({ kind: 'polling', authoringJobId, status: job.status });

      if (job.status === 'SUCCEEDED') {
        const candidate = selectScenarioAuthoringCandidate(job);
        if (!candidate) {
          throw new Error('생성된 시나리오 후보가 검증을 통과하지 못했습니다.');
        }

        const confirmed = await confirmScenarioAuthoringCandidate(authoringJobId, {
          candidateId: candidate.candidate_id,
        });
        const confirmedCandidate = confirmed.data.confirmedCandidate;
        const preview = createScenarioPlanPreview(confirmedCandidate.scenario_plan);
        if (!isCurrentRequest()) {
          return null;
        }

        setScenarioAuthoringState({
          kind: 'succeeded',
          authoringJobId,
          candidate: confirmedCandidate,
          preview,
        });
        return {
          authoringJobId,
          candidate: confirmedCandidate,
          preview,
        };
      }

      if (job.status === 'FAILED' || job.status === 'CANCELED' || job.status === 'EXPIRED') {
        throw new Error('사이트 맞춤 시나리오 생성이 완료되지 못했습니다.');
      }

      await wait(SCENARIO_AUTHORING_POLL_INTERVAL_MS);
      if (!isCurrentRequest()) {
        return null;
      }

      const polled = await getScenarioAuthoringJob(authoringJobId);
      job = polled.data;
    }

    throw new Error('사이트 맞춤 시나리오 생성 시간이 초과됐습니다.');
  }, [createRunIds, selectedDepth.title, selectedDepthId, selectedScenario]);

  useEffect(() => {
    if (stage !== 'ready' || !scenarioAuthoringRequestKey || scenarioAuthoringState.kind !== 'idle') {
      return;
    }

    void createAndConfirmScenarioPlan().catch((error) => {
      setScenarioAuthoringState({
        kind: 'failed',
        message: error instanceof Error
          ? `${error.message} 기본 추천 흐름으로 분석을 시작할 수 있어요.`
          : '사이트 맞춤 시나리오 생성에 실패해 기본 추천 흐름으로 분석을 시작할 수 있어요.',
      });
    });
  }, [createAndConfirmScenarioPlan, scenarioAuthoringRequestKey, scenarioAuthoringState.kind, stage]);

  const startAnalysisRun = async () => {
    if (!submittedUrl || !selectedScenario || isCreatingRun || scenarioAuthoringBusy) {
      return;
    }

    setIsCreatingRun(true);
    setRunStartError('');

    if (!createRunIds) {
      setRunStartError('분석 실행에 필요한 프로젝트 설정을 확인하지 못했습니다. URL 사전 탐색을 다시 진행해주세요.');
      setIsCreatingRun(false);
      return;
    }

    let createdRunId = '';

    try {
      let authoredScenario = scenarioAuthoringState.kind === 'succeeded'
        ? {
          authoringJobId: scenarioAuthoringState.authoringJobId,
          candidate: scenarioAuthoringState.candidate,
          preview: scenarioAuthoringState.preview,
        }
        : null;

      if (!authoredScenario && scenarioAuthoringState.kind !== 'failed') {
        try {
          authoredScenario = await createAndConfirmScenarioPlan();
        } catch (error) {
          setScenarioAuthoringState({
            kind: 'failed',
            message: error instanceof Error
              ? `${error.message} 기본 추천 흐름으로 분석을 시작합니다.`
              : '사이트 맞춤 시나리오 생성에 실패해 기본 추천 흐름으로 분석을 시작합니다.',
          });
        }
      }

      const scenarioPlan = authoredScenario?.candidate.scenario_plan ?? null;
      const runStartUrl = scenarioPlan ? requireConfirmedScenarioPlanStartUrl(scenarioPlan) : selectedScenario.suggestedStartUrl ?? submittedUrl;
      const runGoal = scenarioPlan ? selectedScenario.title : selectedScenario.summary;
      const scenarioOverrides: Record<string, unknown> = {
        depthId: selectedDepthId,
        source: 'create-analysis-agent-ready',
        sourceDiscoveryId: selectedScenario.sourceDiscoveryId ?? null,
        recommendationId: selectedScenario.recommendationId ?? null,
        scenarioType: selectedScenario.scenarioType,
        evidenceRefs: selectedScenario.evidenceRefs,
        evidenceSummary: selectedScenario.evidenceSummary ?? null,
        suggestedStartUrl: selectedScenario.suggestedStartUrl ?? null,
        suggestedTarget: selectedScenario.suggestedTarget ?? null,
        sourceAuthoringJobId: authoredScenario?.authoringJobId ?? null,
        sourceAuthoringCandidateId: authoredScenario?.candidate.candidate_id ?? null,
      };

      const response = await createRun({
        projectId: createRunIds.projectId,
        name: selectedScenario.title,
        startUrl: runStartUrl,
        goal: runGoal,
        devicePreset: 'desktop',
        scenarioTemplateVersionId: scenarioPlan ? createRunIds.scenarioTemplateVersionId : undefined,
        scenarioOverrides,
        scenarioPlan: scenarioPlan ?? undefined,
      });
      createdRunId = response.data.id;
    } catch {
      setRunStartError('분석 실행 준비에 실패했습니다. 프로젝트 설정과 URL을 확인한 뒤 다시 시도해주세요.');
      setIsCreatingRun(false);
      return;
    }

    try {
      await startRun(createdRunId);
    } catch {
      setRunStartError('분석 준비는 완료됐지만 시작 요청에 실패했습니다. 실시간 Trace에서 현재 상태를 확인합니다.');
    } finally {
      pushAppPath(buildRunMonitorPath(createdRunId, {
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
        <a href={HOME_PATH} className="create-analysis-nav__brand">
          Wedge
        </a>
        {stage === 'input' ? (
          <div className="create-analysis-nav__actions" aria-label="계정">
            {!isAuthenticated && !isAuthChecking ? (
              <a href={getLoginPathForCurrentCreateAnalysisState()}>로그인</a>
            ) : null}
            {isAuthenticated ? (
              <a href={RUNS_PATH} className="create-analysis-nav__link--secondary">실행 목록</a>
            ) : null}
            {isAuthenticated && onLogout ? (
              <button type="button" onClick={onLogout}>로그아웃</button>
            ) : null}
          </div>
        ) : null}
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

        {stage === 'discovering' && (
          <PreflightAgent submittedUrl={submittedUrl} discoveryState={discoveryState} onRetry={retryDiscovery} onEditUrl={editUrl} />
        )}

        {stage === 'recommendations' && (
          <RecommendationAgent
            submittedUrl={submittedUrl}
            scenarios={recommendationScenarios}
            emptyMessage={discoveryState.kind === 'empty' ? discoveryState.message : undefined}
            onChooseScenario={chooseScenario}
            onOpenManualChoice={openManualChoice}
          />
        )}

        {stage === 'manual-choice' && (
          <ManualChoiceAgent
            submittedUrl={submittedUrl}
            scenarios={manualChoiceScenarios}
            onChooseScenario={chooseScenario}
            onBackToRecommendations={() => navigateToRouteState(createRecommendationChoiceRouteState(routeState, submittedUrl))}
          />
        )}

        {stage === 'onboarding' && selectedScenario && (
          <ScenarioSetupAgent selectedScenario={selectedScenario} selectedDepthId={selectedDepthId} onDepthChange={chooseDepth} onReady={showReady} />
        )}

        {stage === 'ready' && selectedScenario && (
          <ReadyAgent
            submittedUrl={submittedUrl}
            selectedScenario={selectedScenario}
            selectedDepth={selectedDepth}
            scenarioAuthoringEnabled={scenarioAuthoringRequestKey !== null}
            scenarioAuthoringState={scenarioAuthoringState}
            isCreatingRun={isCreatingRun || scenarioAuthoringBusy}
            runStartError={runStartError}
            onChooseDifferentScenario={chooseDifferentScenario}
            onStartRun={startAnalysisRun}
          />
        )}
      </main>
    </div>
  );
}
