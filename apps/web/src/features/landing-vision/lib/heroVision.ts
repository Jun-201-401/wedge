export const WORDS = ["Let's", 'Find', 'Your', 'Wedge'] as const;
export const FIRST_WORD_DELAY_MS = 1300;
export const WORD_ROTATION_INTERVAL_MS = 2200;
export const VISION_ACTIVATION_THRESHOLD = 0.57;
export const VISION_DEMO_URL = 'https://demo.wedge.so/pricing';

export interface VisionScrollStateInput {
  top: number;
  bottom: number;
  windowHeight: number;
  activationThreshold?: number;
}

export interface VisionScrollState {
  scrollProgress: number;
  isVisionActive: boolean;
  isVisionPanelPinned: boolean;
}

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function getVisionScrollState({
  top,
  bottom,
  windowHeight,
  activationThreshold = VISION_ACTIVATION_THRESHOLD,
}: VisionScrollStateInput): VisionScrollState {
  const rawProgress = clamp01((windowHeight - top) / windowHeight);
  const isVisionActive = rawProgress >= activationThreshold && bottom > 0;
  const scrollProgress = isVisionActive
    ? clamp01((rawProgress - activationThreshold) / (1 - activationThreshold))
    : 0;
  const isVisionPanelPinned = top <= 0 && bottom > 0;

  return {
    scrollProgress,
    isVisionActive,
    isVisionPanelPinned,
  };
}
