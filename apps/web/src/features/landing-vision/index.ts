export { default as VisionStage } from './components/VisionStage';
export { useVisionSequence } from './hooks/useVisionSequence';
export {
  FIRST_WORD_DELAY_MS,
  getVisionScrollState,
  VISION_ACTIVATION_THRESHOLD,
  WORD_ROTATION_INTERVAL_MS,
  WORDS,
} from './lib/heroVision';
export {
  buildVisionPhaseSchedule,
  getVisionSequenceFlags,
  VISION_PROCESS_STEPS,
  VISION_SEQUENCE_PHASES,
  VISION_SEQUENCE_TIMINGS,
} from './lib/visionSequence';
