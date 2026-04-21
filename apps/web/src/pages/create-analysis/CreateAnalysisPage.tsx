import { FormEvent, useEffect, useMemo, useState } from 'react';

import { FIRST_WORD_DELAY_MS, WORD_ROTATION_INTERVAL_MS } from '../../features/landing-vision';
import { normalizeAnalysisUrl } from './lib/createAnalysisUrl';
import './CreateAnalysisPage.css';

type DiscoveryStepStatus = 'complete' | 'active' | 'pending';
type ScenarioLevel = '추천' | '가능' | '낮음';
type ScenarioTone = 'recommended' | 'available' | 'low';
type CreateAnalysisStage = 'input' | 'discovering' | 'recommendations' | 'onboarding' | 'ready';

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 19V5M5 12l7-7 7 7"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

interface DiscoveryStep {
  label: string;
  status: DiscoveryStepStatus;
}

interface ScenarioRecommendation {
  id: string;
  level: ScenarioLevel;
  tone: ScenarioTone;
  title: string;
  summary: string;
  evidence: string;
  actionLabel: string;
}

const HEADLINE_PHRASES = ['Find', 'Friction'] as const;
const mockDiscoverySteps: DiscoveryStep[] = [
  { label: '페이지 열기', status: 'complete' },
  { label: '첫 화면 확인', status: 'complete' },
  { label: 'CTA 후보 탐색', status: 'active' },
  { label: 'Form / Pricing / Contact 후보 확인', status: 'pending' },
  { label: '추천 시나리오 정리', status: 'pending' },
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

function getStepStatusLabel(status: DiscoveryStepStatus) {
  if (status === 'complete') {
    return '완료';
  }

  if (status === 'active') {
    return '진행 중';
  }

  return '대기 중';
}

function getStepSymbol(status: DiscoveryStepStatus) {
  if (status === 'complete') {
    return '●';
  }

  if (status === 'active') {
    return '◐';
  }

  return '○';
}

export function CreateAnalysisPage() {
  const [headlineIndex, setHeadlineIndex] = useState(0);
  const [urlInput, setUrlInput] = useState('');
  const [submittedUrl, setSubmittedUrl] = useState('');
  const [stage, setStage] = useState<CreateAnalysisStage>('input');
  const [urlError, setUrlError] = useState('');
  const [selectedScenario, setSelectedScenario] = useState<ScenarioRecommendation | null>(null);

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
    setSubmittedUrl(normalizedUrl);
    setStage('discovering');
  };

  const showRecommendations = () => {
    setStage('recommendations');
  };

  const chooseScenario = (scenario: ScenarioRecommendation) => {
    setSelectedScenario(scenario);
    setStage('onboarding');
  };

  return (
    <div className="create-analysis-page">
      <div className="create-analysis-page__grain" />

      <svg className="create-analysis-filter-defs" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <defs>
          <filter id="gooey">
            <feColorMatrix
              in="SourceGraphic"
              type="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 255 -140"
            />
          </filter>
        </defs>
      </svg>

      <header className="create-analysis-nav" aria-label="Wedge home">
        <a href="/" className="create-analysis-nav__brand">Wedge</a>
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
                    style={
                      {
                        opacity: isActive ? 1 : 0,
                        filter: isActive ? 'blur(0px)' : 'blur(20px)',
                        transform: `translate(-50%, -50%) translateX(22px) scale(${isActive ? 1 : 1.1})`,
                      }
                    }
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
          <section className="create-analysis-panel create-analysis-panel--progress" aria-labelledby="discovery-progress-title">
            <p className="create-analysis-panel__eyebrow">Preflight</p>
            <h2 id="discovery-progress-title">사이트를 살펴보고 있어요</h2>
            <p className="create-analysis-panel__url">{submittedUrl}</p>

            <ol className="discovery-progress" aria-label="Discovery 진행 상태">
              {mockDiscoverySteps.map((step) => (
                <li
                  key={step.label}
                  className={`discovery-progress__item discovery-progress__item--${step.status}`}
                  aria-current={step.status === 'active' ? 'step' : undefined}
                >
                  <span aria-hidden="true">{getStepSymbol(step.status)}</span>
                  <span className="create-analysis-sr-only">{getStepStatusLabel(step.status)}</span>
                  {step.label}
                </li>
              ))}
            </ol>

            <p className="create-analysis-panel__note">이 단계는 전체 분석이 아니라 가능한 사용자 흐름을 찾기 위한 짧은 탐색입니다.</p>
            <button className="create-analysis-panel__action" type="button" onClick={showRecommendations}>
              추천 결과 보기
            </button>
          </section>
        )}

        {stage === 'recommendations' && (
          <section className="create-analysis-panel create-analysis-panel--recommendations" aria-labelledby="recommendations-title">
            <p className="create-analysis-panel__eyebrow">Recommendations</p>
            <h2 id="recommendations-title">이 사이트에서 가능한 진단 흐름을 찾았어요</h2>
            <p className="create-analysis-panel__url">{submittedUrl}</p>

            <div className="scenario-grid">
              {scenarioRecommendations.map((scenario) => (
                <article key={scenario.id} className={`scenario-card scenario-card--${scenario.tone}`}>
                  <span className="scenario-card__level">{scenario.level}</span>
                  <h3>{scenario.title}</h3>
                  <p>{scenario.summary}</p>
                  <p className="scenario-card__evidence">근거: {scenario.evidence}</p>
                  <button type="button" aria-label={`${scenario.title} 흐름으로 진단`} onClick={() => chooseScenario(scenario)}>
                    {scenario.actionLabel}
                  </button>
                </article>
              ))}
            </div>
          </section>
        )}

        {stage === 'onboarding' && selectedScenario && (
          <section className="create-analysis-panel create-analysis-panel--onboarding" aria-labelledby="onboarding-title">
            <p className="create-analysis-panel__eyebrow">Scenario setup</p>
            <h2 id="onboarding-title">{selectedScenario.title}</h2>
            <p className="create-analysis-panel__note">어디까지 확인할까요?</p>

            <div className="onboarding-options" role="radiogroup" aria-label="진단 범위 선택">
              <label>
                <input type="radio" name="scenario-depth" defaultChecked />첫 화면에서 CTA가 명확한지만 보기
              </label>
              <label>
                <input type="radio" name="scenario-depth" />CTA 클릭 후 다음 화면까지 보기
              </label>
              <label>
                <input type="radio" name="scenario-depth" />CTA 클릭 후 입력 Form까지 보기
              </label>
            </div>

            <button className="create-analysis-panel__action" type="button" onClick={() => setStage('ready')}>
              진단 시작 준비
            </button>
          </section>
        )}

        {stage === 'ready' && selectedScenario && (
          <section className="create-analysis-panel create-analysis-panel--ready" aria-labelledby="ready-title">
            <p className="create-analysis-panel__eyebrow">Ready</p>
            <h2 id="ready-title">진단을 시작할 준비가 됐어요</h2>
            <dl className="ready-summary">
              <div>
                <dt>URL</dt>
                <dd>{submittedUrl}</dd>
              </div>
              <div>
                <dt>선택한 흐름</dt>
                <dd>{selectedScenario.title}</dd>
              </div>
              <div>
                <dt>안전 설정</dt>
                <dd>실제 결제 / destructive action / OAuth 우회는 하지 않음</dd>
              </div>
            </dl>
            <p className="create-analysis-panel__note">실제 Discovery API 연동 후 이 버튼이 활성화됩니다.</p>
            <button className="create-analysis-panel__action" type="button" disabled>
              API 연동 후 진단 시작
            </button>
          </section>
        )}
      </main>
    </div>
  );
}
