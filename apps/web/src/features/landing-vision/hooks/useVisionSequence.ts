import type { MouseEvent as ReactMouseEvent } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { VISION_DEMO_URL } from '../lib/heroVision';
import {
  buildVisionPhaseSchedule,
  getVisionSequenceFlags,
  VISION_SEQUENCE_PHASES,
  VISION_SEQUENCE_TIMINGS,
  type VisionSequencePhase,
} from '../lib/visionSequence';

interface Particle {
  id: string;
  x: number;
  y: number;
}

interface UseVisionSequenceOptions {
  isVisible: boolean;
}

export function useVisionSequence({ isVisible }: UseVisionSequenceOptions) {
  const [particles, setParticles] = useState<Particle[]>([]);
  const [searchUrl, setSearchUrl] = useState('');
  const [isSearchExpanded, setIsSearchExpanded] = useState(false);
  const [isSearchSoftExiting, setIsSearchSoftExiting] = useState(false);
  const [sequencePhase, setSequencePhase] = useState<VisionSequencePhase>(VISION_SEQUENCE_PHASES.SEARCH);
  const searchRef = useRef<HTMLDivElement | null>(null);
  const particleTimeoutIdsRef = useRef<number[]>([]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!searchRef.current?.contains(event.target as Node) && !searchUrl) {
        setIsSearchExpanded(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);

    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [searchUrl]);

  useEffect(() => {
    return () => {
      particleTimeoutIdsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
      particleTimeoutIdsRef.current = [];
    };
  }, []);

  useEffect(() => {
    if (!isVisible) {
      setSearchUrl('');
      setIsSearchExpanded(false);
      setIsSearchSoftExiting(false);
      setParticles([]);
      setSequencePhase(VISION_SEQUENCE_PHASES.SEARCH);
      particleTimeoutIdsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
      particleTimeoutIdsRef.current = [];
      return undefined;
    }

    let typingIntervalId = 0;
    let isCancelled = false;
    const timeoutIds: number[] = [];
    const schedule = (callback: () => void, delay: number) => {
      const timeoutId = window.setTimeout(() => {
        if (!isCancelled) {
          callback();
        }
      }, delay);
      timeoutIds.push(timeoutId);
      return timeoutId;
    };

    schedule(() => setIsSearchExpanded(true), VISION_SEQUENCE_TIMINGS.searchExpandDelayMs);

    schedule(() => {
      let nextIndex = 0;

      typingIntervalId = window.setInterval(() => {
        nextIndex += 1;
        setSearchUrl(VISION_DEMO_URL.slice(0, nextIndex));

        if (nextIndex >= VISION_DEMO_URL.length) {
          window.clearInterval(typingIntervalId);

          schedule(() => setIsSearchSoftExiting(true), VISION_SEQUENCE_TIMINGS.searchSoftExitDelayMs);
          buildVisionPhaseSchedule(VISION_SEQUENCE_TIMINGS).forEach(({ phase, delay }) => {
            schedule(() => setSequencePhase(phase), delay);
          });
        }
      }, VISION_SEQUENCE_TIMINGS.searchTypingIntervalMs);
    }, VISION_SEQUENCE_TIMINGS.searchTypingStartDelayMs);

    return () => {
      isCancelled = true;
      timeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId));

      if (typingIntervalId) {
        window.clearInterval(typingIntervalId);
      }
    };
  }, [isVisible]);

  const createParticle = useCallback((event: Pick<MouseEvent, 'clientX' | 'clientY'>) => {
    const id = `${Date.now()}-${Math.random()}`;
    const particle = { id, x: event.clientX, y: event.clientY };

    setParticles((current) => [...current, particle]);

    const timeoutId = window.setTimeout(() => {
      setParticles((current) => current.filter((item) => item.id !== id));
      particleTimeoutIdsRef.current = particleTimeoutIdsRef.current.filter((value) => value !== timeoutId);
    }, VISION_SEQUENCE_TIMINGS.particleLifetimeMs);
    particleTimeoutIdsRef.current.push(timeoutId);
  }, []);

  const handleSearchClick = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      createParticle(event.nativeEvent);
      setIsSearchExpanded(true);
    },
    [createParticle],
  );

  const {
    isSearchVisible,
    isAgentRunning,
    isSearchExiting,
    isOrbVisible,
    isResonanceVisible,
    isProcessVisible,
    isResultsVisible,
    currentProcessStepIndex,
    currentResultStepIndex,
  } = getVisionSequenceFlags(sequencePhase);

  return {
    particles,
    searchRef,
    searchUrl,
    isSearchExpanded,
    isSearchSoftExiting,
    isSearchVisible,
    isAgentRunning,
    isSearchExiting,
    isOrbVisible,
    isResonanceVisible,
    isProcessVisible,
    isResultsVisible,
    currentProcessStepIndex,
    currentResultStepIndex,
    handleSearchClick,
  };
}
