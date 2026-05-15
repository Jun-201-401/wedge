import { VISION_PROCESS_STEPS } from '../lib/visionSequence';

type StepIconType = (typeof VISION_PROCESS_STEPS)[number]['icon'] | 'cube';

interface StepIconProps {
  type: StepIconType;
  isActive?: boolean;
  isCompleted?: boolean;
  isPending?: boolean;
}

function StepIcon({ type, isActive = false, isCompleted = false, isPending = false }: StepIconProps) {
  const className = [
    'vision-process__step-icon',
    isActive && 'vision-process__step-icon--active',
    isCompleted && 'vision-process__step-icon--completed',
    isPending && 'vision-process__step-icon--pending',
  ]
    .filter(Boolean)
    .join(' ');

  if (type === 'pipeline') {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="6" cy="6" r="2.5" stroke="currentColor" strokeWidth="2" />
        <circle cx="18" cy="18" r="2.5" stroke="currentColor" strokeWidth="2" />
        <path d="M6 18V10a8 8 0 0 0 8 8h1.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }

  if (type === 'layers') {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="m12 4 8 4-8 4-8-4 8-4Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        <path d="m4 12 8 4 8-4" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        <path d="m4 16 8 4 8-4" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      </svg>
    );
  }

  if (type === 'pulse') {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M3 12h4l2.5-5 5 10 2.5-5H21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3 4 7.5v9L12 21l8-4.5v-9L12 3Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

interface VisionProcessTimelineProps {
  isVisible: boolean;
  currentStepIndex: number;
}

function VisionProcessTimeline({ isVisible, currentStepIndex }: VisionProcessTimelineProps) {
  const safeStepIndex = currentStepIndex >= 0 ? currentStepIndex : 0;
  const progressPercent = Math.round(((safeStepIndex + 1) / VISION_PROCESS_STEPS.length) * 100);

  return (
    <div className={`vision-process ${isVisible ? 'vision-process--visible' : ''}`} aria-live="polite">
      <div className="vision-process__frame">
        <div className="vision-process__header">
          <div className="vision-process__header-main">
            <div className="vision-process__header-icon" aria-hidden="true">
              <StepIcon type="cube" />
            </div>
            <div className="vision-process__header-copy">
              <h2>분석 흐름</h2>
              <div className="vision-process__header-status">
                <span className="vision-process__header-status-dot" />
                <span>실시간 검토 중</span>
              </div>
            </div>
          </div>
          <div className="vision-process__header-progress" aria-label={`진행률 ${progressPercent}%`}>
            <span className="vision-process__header-progress-value">{progressPercent}</span>
            <span className="vision-process__header-progress-unit">%</span>
          </div>
        </div>

        <div className="vision-process__divider" aria-hidden="true" />

        <div className="vision-process__timeline">
          {VISION_PROCESS_STEPS.map((step, index) => {
            const isCompleted = safeStepIndex > index;
            const isActive = safeStepIndex === index;
            const isPending = safeStepIndex < index;

            return (
              <div
                key={step.title}
                className={`vision-process__step ${
                  isCompleted
                    ? 'vision-process__step--completed'
                    : isActive
                      ? 'vision-process__step--active'
                      : 'vision-process__step--pending'
                }`}
              >
                {index < VISION_PROCESS_STEPS.length - 1 ? (
                  <div className="vision-process__rail" aria-hidden="true">
                    <div className="vision-process__rail-base" />
                    <div className="vision-process__rail-stream" />
                  </div>
                ) : null}

                <div className="vision-process__node-wrap">
                  <div className="vision-process__node" aria-hidden="true">
                    {isCompleted ? (
                      <svg viewBox="0 0 24 24" fill="none" className="vision-process__node-check">
                        <path d="M19.5 6.5 9 17 4.5 12.5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    ) : isActive ? (
                      <>
                        <svg viewBox="0 0 24 24" fill="none" className="vision-process__node-spinner">
                          <path d="M21 12a9 9 0 1 1-6.3-8.58" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                        </svg>
                        <span className="vision-process__node-spinner-ring" />
                      </>
                    ) : (
                      <span className="vision-process__node-dot" />
                    )}
                  </div>
                </div>

                <div className="vision-process__content">
                  <div className="vision-process__content-head">
                    <div>
                      <h3>{step.title}</h3>
                      <p className="vision-process__eyebrow">{step.eyebrow}</p>
                    </div>
                    <div className="vision-process__content-head-actions">
                      <StepIcon type={step.icon} isActive={isActive} isCompleted={isCompleted} isPending={isPending} />
                    </div>
                  </div>

                  <div className={`vision-process__subtasks ${isActive || isCompleted ? 'vision-process__subtasks--expanded' : ''}`}>
                    <div className="vision-process__subtasks-inner">
                      {step.subtasks.map((subtask, subtaskIndex) => (
                        <div key={subtask} className={`vision-process__subtask ${isActive && subtaskIndex === 0 ? 'vision-process__subtask--live' : ''}`}>
                          <span className="vision-process__subtask-marker" aria-hidden="true">
                            {isCompleted ? (
                              <svg viewBox="0 0 24 24" fill="none" className="vision-process__subtask-check">
                                <path d="M19.5 6.5 9 17 4.5 12.5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            ) : isActive && subtaskIndex === 0 ? (
                              <span className="vision-process__subtask-live-dot" />
                            ) : (
                              <span className="vision-process__subtask-idle-dot" />
                            )}
                          </span>
                          <span>{subtask}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default VisionProcessTimeline;
