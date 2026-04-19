export const VISION_SEQUENCE_PHASES = {
  SEARCH: 'search',
  RUNNING: 'running',
  EXITING: 'exiting',
  ORB: 'orb',
  RESONATING: 'resonating',
  PROCESS_RUN: 'process-run',
  PROCESS_CAPTURE: 'process-capture',
  PROCESS_INTERPRET: 'process-interpret',
  PROCESS_PRIORITIZE: 'process-prioritize',
  RESULT_EVIDENCE: 'result-evidence',
  RESULT_WHY: 'result-why',
  RESULT_NUDGE: 'result-nudge',
} as const;

export type VisionSequencePhase = (typeof VISION_SEQUENCE_PHASES)[keyof typeof VISION_SEQUENCE_PHASES];

export const VISION_SEQUENCE_TIMINGS = {
  searchExpandDelayMs: 280,
  searchTypingStartDelayMs: 720,
  searchRunningDelayMs: 0,
  searchTypingIntervalMs: 46,
  particleLifetimeMs: 500,
  searchSoftExitDelayMs: 140,
  searchExitDelayMs: 260,
  orbRevealDelayMs: 760,
  resonanceRevealDelayMs: 1220,
  processStartDelayMs: 2200,
  processStepIntervalMs: 600,
  resultsStartDelayMs: 4700,
  resultsStepIntervalMs: 320,
} as const;

export type VisionSequenceTimings = typeof VISION_SEQUENCE_TIMINGS;

export const VISION_PROCESS_STEPS = [
  {
    title: '실행',
    eyebrow: '여정 재생',
    icon: 'cube',
    label: '실제 사용 흐름을 그대로 돌려봅니다',
    subtasks: ['핵심 전환 구간 다시 보기', '의사결정 지점 흐름 맞춰 보기'],
  },
  {
    title: '수집',
    eyebrow: '증거 포착',
    icon: 'pipeline',
    label: '화면과 구조 신호를 함께 모읍니다',
    subtasks: ['화면·DOM 상태 기록', '클릭·입력 신호 수집'],
  },
  {
    title: '해석',
    eyebrow: '마찰 해석',
    icon: 'layers',
    label: '머뭇거린 이유를 맥락으로 읽습니다',
    subtasks: ['머뭇거림 신호 묶기', '멈춘 이유에 맥락 붙이기'],
  },
  {
    title: '정리',
    eyebrow: '우선순위 정리',
    icon: 'pulse',
    label: '무엇부터 바꿀지 순서를 세웁니다',
    subtasks: ['영향 큰 수정 먼저 정리', '다음 액션으로 연결'],
  },
] as const;

export function buildVisionPhaseSchedule(timings: VisionSequenceTimings) {
  return [
    { phase: VISION_SEQUENCE_PHASES.RUNNING, delay: timings.searchRunningDelayMs },
    { phase: VISION_SEQUENCE_PHASES.EXITING, delay: timings.searchExitDelayMs },
    { phase: VISION_SEQUENCE_PHASES.ORB, delay: timings.orbRevealDelayMs },
    { phase: VISION_SEQUENCE_PHASES.RESONATING, delay: timings.resonanceRevealDelayMs },
    { phase: VISION_SEQUENCE_PHASES.PROCESS_RUN, delay: timings.processStartDelayMs },
    {
      phase: VISION_SEQUENCE_PHASES.PROCESS_CAPTURE,
      delay: timings.processStartDelayMs + timings.processStepIntervalMs,
    },
    {
      phase: VISION_SEQUENCE_PHASES.PROCESS_INTERPRET,
      delay: timings.processStartDelayMs + timings.processStepIntervalMs * 2,
    },
    {
      phase: VISION_SEQUENCE_PHASES.PROCESS_PRIORITIZE,
      delay: timings.processStartDelayMs + timings.processStepIntervalMs * 3,
    },
    { phase: VISION_SEQUENCE_PHASES.RESULT_EVIDENCE, delay: timings.resultsStartDelayMs },
    {
      phase: VISION_SEQUENCE_PHASES.RESULT_WHY,
      delay: timings.resultsStartDelayMs + timings.resultsStepIntervalMs,
    },
    {
      phase: VISION_SEQUENCE_PHASES.RESULT_NUDGE,
      delay: timings.resultsStartDelayMs + timings.resultsStepIntervalMs * 2,
    },
  ];
}

export function getVisionSequenceFlags(phase: VisionSequencePhase) {
  const processPhases = [
    VISION_SEQUENCE_PHASES.PROCESS_RUN,
    VISION_SEQUENCE_PHASES.PROCESS_CAPTURE,
    VISION_SEQUENCE_PHASES.PROCESS_INTERPRET,
    VISION_SEQUENCE_PHASES.PROCESS_PRIORITIZE,
  ] as VisionSequencePhase[];
  const resultPhases = [
    VISION_SEQUENCE_PHASES.RESULT_EVIDENCE,
    VISION_SEQUENCE_PHASES.RESULT_WHY,
    VISION_SEQUENCE_PHASES.RESULT_NUDGE,
  ] as VisionSequencePhase[];
  const currentProcessStepIndex = processPhases.indexOf(phase);
  const currentResultStepIndex = resultPhases.indexOf(phase);

  return {
    isSearchVisible:
      phase === VISION_SEQUENCE_PHASES.SEARCH ||
      phase === VISION_SEQUENCE_PHASES.RUNNING ||
      phase === VISION_SEQUENCE_PHASES.EXITING,
    isAgentRunning:
      phase === VISION_SEQUENCE_PHASES.RUNNING ||
      phase === VISION_SEQUENCE_PHASES.EXITING ||
      phase === VISION_SEQUENCE_PHASES.ORB ||
      phase === VISION_SEQUENCE_PHASES.RESONATING ||
      currentProcessStepIndex >= 0,
    isSearchExiting:
      phase === VISION_SEQUENCE_PHASES.EXITING ||
      phase === VISION_SEQUENCE_PHASES.ORB ||
      phase === VISION_SEQUENCE_PHASES.RESONATING ||
      currentProcessStepIndex >= 0 ||
      currentResultStepIndex >= 0,
    isOrbVisible:
      phase === VISION_SEQUENCE_PHASES.ORB ||
      phase === VISION_SEQUENCE_PHASES.RESONATING ||
      currentProcessStepIndex >= 0,
    isResonanceVisible:
      phase === VISION_SEQUENCE_PHASES.RESONATING || currentProcessStepIndex >= 0,
    isProcessVisible: currentProcessStepIndex >= 0,
    isResultsVisible: currentResultStepIndex >= 0,
    currentProcessStepIndex,
    currentResultStepIndex,
  };
}
