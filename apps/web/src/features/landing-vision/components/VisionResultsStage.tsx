import type { KeyboardEvent } from 'react';
import { useEffect, useState } from 'react';
import '../styles/vision-results.css';

const RESULT_CARDS = [
  {
    key: 'evidence',
    label: '근거',
    option: '행동 신호',
    frontTitle: '근거',
    frontSubtitle: '행동 전 멈칫 신호 감지',
    backTitle: '근거 신호',
    backSummary:
      '버튼 대비, 가격 구간 체류, 신뢰 신호 도착 시점에서 전환 저항이 함께 관찰됩니다.',
    cta: '근거 보기',
  },
  {
    key: 'why',
    label: '원인',
    option: '원인 해석',
    frontTitle: '원인',
    frontSubtitle: '확신 전에 행동을 요구받음',
    backTitle: '왜 멈췄는가',
    backSummary:
      '행동 버튼은 먼저 보이지만 확신을 만드는 맥락은 늦게 도착해 결정을 미루게 만듭니다.',
    cta: '원인 보기',
  },
  {
    key: 'nudge',
    label: '개선',
    option: '우선순위',
    frontTitle: '개선',
    frontSubtitle: '영향 큰 개선부터 제안',
    backTitle: '먼저 바꿀 것',
    backSummary:
      '신뢰 문구 선배치, 가격 밀도 정리, 행동 대비 강화 순으로 적용하면 전환 저항을 빠르게 줄일 수 있습니다.',
    cta: '개선안 보기',
  },
] as const;

type ResultCard = (typeof RESULT_CARDS)[number];
type ResultCardKey = ResultCard['key'];
type ExpandedState = Record<ResultCardKey, boolean>;

function createInitialExpandedState(): ExpandedState {
  return Object.fromEntries(RESULT_CARDS.map(({ key }) => [key, false])) as ExpandedState;
}

interface FrontIconProps {
  cardKey: ResultCardKey;
}

function FrontIcon({ cardKey }: FrontIconProps) {
  if (cardKey === 'evidence') {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="8" />
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2" />
        <path d="M12 20v2" />
        <path d="M2 12h2" />
        <path d="M20 12h2" />
      </svg>
    );
  }

  if (cardKey === 'why') {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" />
        <circle cx="12" cy="12" r="2.5" />
      </svg>
    );
  }

  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 6h12" />
      <path d="M8 12h12" />
      <path d="M8 18h12" />
      <circle cx="4" cy="6" r="1.2" />
      <circle cx="4" cy="12" r="1.2" />
      <circle cx="4" cy="18" r="1.2" />
    </svg>
  );
}

interface ResultCardProps {
  card: ResultCard;
  isVisible: boolean;
  isExpanded: boolean;
  onToggle: (cardKey: ResultCardKey) => void;
  onKeyDown: (cardKey: ResultCardKey, isVisible: boolean) => (event: KeyboardEvent<HTMLDivElement>) => void;
}

function DesktopResultCard({ card, isVisible, isExpanded, onToggle, onKeyDown }: ResultCardProps) {
  return (
    <div
      className={`vision-results-sample8-item ${
        isVisible ? 'vision-results-sample8-item--visible' : ''
      } ${isExpanded ? 'is-flipped' : ''}`}
      role="button"
      aria-label={`${card.label} card`}
      aria-pressed={isExpanded}
      aria-disabled={!isVisible}
      tabIndex={isVisible ? 0 : -1}
      onClick={() => {
        if (isVisible) {
          onToggle(card.key);
        }
      }}
      onKeyDown={onKeyDown(card.key, isVisible)}
    >
      <div className="sample8-preserve-3d">
        <div className="sample8-face sample8-front" aria-hidden={isExpanded}>
          <div className="sample8-front-aura-wrap" aria-hidden="true">
            <span className="sample8-front-aura sample8-front-aura--primary" />
            <span className="sample8-front-aura sample8-front-aura--secondary" />
          </div>

          <div className="sample8-front-center" aria-hidden="true">
            <div className="sample8-front-node">
              <div className="sample8-front-node-core">
                <FrontIcon cardKey={card.key} />
              </div>
            </div>
          </div>

          <div className="sample8-front-bottom">
            <div className="sample8-front-copy">
              <p className="sample8-front-option">{card.option}</p>
              <h3>{card.frontTitle}</h3>
              <p className="sample8-front-subtitle">{card.frontSubtitle}</p>
            </div>
          </div>
        </div>

        <div className="sample8-face sample8-back" aria-hidden={!isExpanded}>
          <div className="sample8-back-header">
            <div className="sample8-back-icon" aria-hidden="true">
              <FrontIcon cardKey={card.key} />
            </div>
            <div className="sample8-back-copy">
              <h3>{card.backTitle}</h3>
              <p>{card.label}</p>
            </div>
          </div>

          <div className="sample8-back-divider" />

          <p className="sample8-back-summary">{card.backSummary}</p>

          <span className="sample8-back-action" aria-hidden="true">
            <span>{card.cta}</span>
            <span className="sample8-back-action-arrow">→</span>
          </span>
        </div>
      </div>
    </div>
  );
}

function MobileResultCard({ card, isVisible, isExpanded, onToggle, onKeyDown }: ResultCardProps) {
  const detailsId = `mobile-result-details-${card.key}`;

  return (
    <article
      className={`vision-results-mobile-card ${isVisible ? 'vision-results-mobile-card--visible' : ''} ${
        isExpanded ? 'vision-results-mobile-card--expanded' : ''
      }`}
      role="button"
      aria-label={`${card.label} details`}
      aria-expanded={isExpanded}
      aria-controls={detailsId}
      aria-disabled={!isVisible}
      tabIndex={isVisible ? 0 : -1}
      onClick={() => {
        if (isVisible) {
          onToggle(card.key);
        }
      }}
      onKeyDown={onKeyDown(card.key, isVisible)}
    >
      <div className="vision-results-mobile-card__summary">
        <div className="vision-results-mobile-card__icon" aria-hidden="true">
          <FrontIcon cardKey={card.key} />
        </div>
        <div className="vision-results-mobile-card__copy">
          <p className="vision-results-mobile-card__eyebrow">{card.option}</p>
          <h3>{card.frontTitle}</h3>
          <p>{card.frontSubtitle}</p>
        </div>
        <span className="vision-results-mobile-card__disclosure" aria-hidden="true" />
      </div>

      <div
        id={detailsId}
        className="vision-results-mobile-card__details"
        aria-hidden={!isExpanded}
      >
        <div className="vision-results-mobile-card__details-inner">
          <div className="vision-results-mobile-card__divider" />
          <p className="vision-results-mobile-card__back-label">{card.label}</p>
          <h4>{card.backTitle}</h4>
          <p className="vision-results-mobile-card__back-summary">{card.backSummary}</p>
          <span className="vision-results-mobile-card__action" aria-hidden="true">
            <span>{card.cta}</span>
            <span>→</span>
          </span>
        </div>
      </div>
    </article>
  );
}

interface VisionResultsStageProps {
  isVisible: boolean;
  currentResultStepIndex: number;
}

function VisionResultsStage({ isVisible, currentResultStepIndex }: VisionResultsStageProps) {
  const [expanded, setExpanded] = useState(createInitialExpandedState);

  useEffect(() => {
    if (!isVisible) {
      setExpanded(createInitialExpandedState());
    }
  }, [isVisible]);

  const toggleCard = (cardKey: ResultCardKey) => {
    setExpanded((prev) => ({ ...prev, [cardKey]: !prev[cardKey] }));
  };

  const handleCardKeyDown =
    (cardKey: ResultCardKey, isVisible: boolean) => (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();

        if (isVisible) {
          toggleCard(cardKey);
        }
      }
    };

  return (
    <section
      className={`vision-results ${isVisible ? 'vision-results--visible' : ''}`}
      aria-label="Analysis findings"
    >
      <div className="vision-results-sample8-grid vision-results-desktop">
        {RESULT_CARDS.map((card, cardIndex) => (
          <DesktopResultCard
            key={card.key}
            card={card}
            isVisible={currentResultStepIndex >= cardIndex}
            isExpanded={expanded[card.key]}
            onToggle={toggleCard}
            onKeyDown={handleCardKeyDown}
          />
        ))}
      </div>

      <div className="vision-results-mobile" aria-label="Analysis findings mobile cards">
        {RESULT_CARDS.map((card, cardIndex) => (
          <MobileResultCard
            key={card.key}
            card={card}
            isVisible={currentResultStepIndex >= cardIndex}
            isExpanded={expanded[card.key]}
            onToggle={toggleCard}
            onKeyDown={handleCardKeyDown}
          />
        ))}
      </div>
    </section>
  );
}

export default VisionResultsStage;
