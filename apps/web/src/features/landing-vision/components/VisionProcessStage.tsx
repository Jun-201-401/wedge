import '../styles/vision-process.css';
import VisionProcessTimeline from './VisionProcessTimeline';

interface VisionProcessStageProps {
  isVisible: boolean;
  currentStepIndex: number;
}

function VisionProcessStage({ isVisible, currentStepIndex }: VisionProcessStageProps) {
  const safeStepIndex = currentStepIndex >= 0 ? currentStepIndex : 0;
  const simulationClassName = [
    'vision-process-stage__simulation',
    `vision-process-stage__simulation--step-${safeStepIndex}`,
  ].join(' ');

  return (
    <div className={`vision-process-stage ${isVisible ? 'vision-process-stage--visible' : ''}`}>
      <div className="vision-process-stage__top">
        <section className={simulationClassName} aria-label="Journey simulation preview">
          <div className="vision-sim__meta" aria-hidden="true">
            <span className="vision-sim__eyebrow-chip" />
            <span className="vision-sim__status-chip" />
          </div>

          <div className="vision-sim__browser">
            <div className="vision-sim__browser-bar">
              <div className="vision-sim__browser-dots" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
              <div className="vision-sim__browser-url" aria-hidden="true">
                <span className="vision-sim__browser-url-bar" />
              </div>
            </div>

            <div className="vision-sim__viewport">
              <div className="vision-sim__grid" aria-hidden="true" />
              <div className="vision-sim__scanline" aria-hidden="true" />
              <div className="vision-sim__focus" aria-hidden="true" />
              <div className="vision-sim__signal" aria-hidden="true">
                <span className="vision-sim__signal-badge" />
                <span className="vision-sim__signal-note" />
              </div>
              <div className="vision-sim__content">
                <div className="vision-sim__nav">
                  <div className="vision-sim__logo" />
                  <div className="vision-sim__nav-links">
                    <span />
                    <span />
                    <span />
                  </div>
                </div>

                <div className="vision-sim__hero">
                  <div className="vision-sim__badge" aria-hidden="true" />
                  <div className="vision-sim__headline">
                    <span />
                    <span />
                    <span className="vision-sim__headline-muted" />
                  </div>
                  <div className="vision-sim__body">
                    <span />
                    <span />
                  </div>

                  <div className="vision-sim__cta-wrap">
                    <div className="vision-sim__cta" aria-hidden="true" />
                  </div>
                </div>

                <div className="vision-sim__cards">
                  <div className="vision-sim__card">
                    <div className="vision-sim__card-icon" />
                    <div className="vision-sim__card-title" />
                    <div className="vision-sim__card-lines">
                      <span />
                      <span />
                      <span />
                    </div>
                  </div>
                  <div className="vision-sim__card">
                    <div className="vision-sim__card-icon" />
                    <div className="vision-sim__card-title" />
                    <div className="vision-sim__card-lines">
                      <span />
                      <span />
                      <span />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="vision-process-stage__agent" aria-label="Agent workflow">
          <VisionProcessTimeline isVisible={isVisible} currentStepIndex={currentStepIndex} />
        </section>
      </div>
    </div>
  );
}

export default VisionProcessStage;
