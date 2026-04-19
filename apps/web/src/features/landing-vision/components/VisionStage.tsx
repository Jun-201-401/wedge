import '../styles/vision-stage.css';
import type { MouseEvent as ReactMouseEvent, RefObject } from 'react';
import VisionOrbStage from './VisionOrbStage';
import VisionProcessStage from './VisionProcessStage';
import VisionResultsStage from './VisionResultsStage';
import VisionSearch from './VisionSearch';

interface VisionParticle {
  id: string;
  x: number;
  y: number;
}

interface VisionSearchState {
  searchRef: RefObject<HTMLDivElement>;
  searchUrl: string;
  isSearchVisible: boolean;
  isSearchExpanded: boolean;
  isSearchSoftExiting: boolean;
}

interface VisionOrbState {
  isAgentRunning: boolean;
  isSearchExiting: boolean;
  isOrbVisible: boolean;
  isResonanceVisible: boolean;
}

interface VisionFlowState {
  isProcessVisible: boolean;
  currentProcessStepIndex: number;
  isResultsVisible: boolean;
  currentResultStepIndex: number;
}

interface VisionStageProps {
  isPanelVisible: boolean;
  particles: VisionParticle[];
  searchState: VisionSearchState;
  orbState: VisionOrbState;
  flowState: VisionFlowState;
  onSearchClick: (event: ReactMouseEvent<HTMLElement>) => void;
}

function VisionStage({
  isPanelVisible,
  particles,
  searchState,
  orbState,
  flowState,
  onSearchClick,
}: VisionStageProps) {
  const { searchRef, searchUrl, isSearchVisible, isSearchExpanded, isSearchSoftExiting } = searchState;
  const { isAgentRunning, isSearchExiting, isOrbVisible, isResonanceVisible } = orbState;
  const { isProcessVisible, currentProcessStepIndex, isResultsVisible, currentResultStepIndex } =
    flowState;

  return (
    <div className="vision-stage-root">
      <div
        className={`vision-panel ${isPanelVisible ? 'vision-panel--active vision-panel--visible' : ''}`}
      >
        <div className="vision-panel__content">
          <div
            className={`vision-stage-center ${isProcessVisible || isResultsVisible ? 'vision-stage-center--process' : ''}`}
          >
            {isSearchVisible ? (
              <div className="vision-stage-layer vision-stage-layer--search">
                <VisionSearch
                  isSearchVisible={isSearchVisible}
                  isPanelVisible={isPanelVisible}
                  searchRef={searchRef}
                  searchUrl={searchUrl}
                  isSearchExpanded={isSearchExpanded}
                  isSearchSoftExiting={isSearchSoftExiting}
                  isAgentRunning={isAgentRunning}
                  isSearchExiting={isSearchExiting}
                  onSearchClick={onSearchClick}
                />
              </div>
            ) : null}

            {!isProcessVisible && !isResultsVisible ? (
              <VisionOrbStage
                isAgentRunning={isAgentRunning}
                isSearchExiting={isSearchExiting}
                isOrbVisible={isOrbVisible}
                isResonanceVisible={isResonanceVisible}
                isProcessVisible={isProcessVisible}
              />
            ) : null}

            <div className="vision-stage-layer vision-stage-layer--process">
              <VisionProcessStage
                isVisible={isProcessVisible}
                currentStepIndex={currentProcessStepIndex}
              />
              <VisionResultsStage
                isVisible={isResultsVisible}
                currentResultStepIndex={currentResultStepIndex}
              />
            </div>
          </div>
        </div>
      </div>
      

      {particles.map((particle) => (
        <span
          key={particle.id}
          className="vision-search__particle"
          style={{ left: `${particle.x}px`, top: `${particle.y}px` }}
          aria-hidden="true"
        />
      ))}
    </div>
  );
}

export default VisionStage;
