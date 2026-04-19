import type { CSSProperties } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  FIRST_WORD_DELAY_MS,
  getVisionScrollState,
  useVisionSequence,
  VisionStage,
  VISION_ACTIVATION_THRESHOLD,
  WORD_ROTATION_INTERVAL_MS,
  WORDS,
} from '../../features/landing-vision';
import './LandingPage.css';

export function LandingPage() {
  const [index, setIndex] = useState(0);
  const [isNavHidden, setIsNavHidden] = useState(false);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [isVisionActive, setIsVisionActive] = useState(false);
  const [isVisionPanelPinned, setIsVisionPanelPinned] = useState(false);
  const revealRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let rotationIntervalId = 0;

    const startRotation = () => {
      setIndex((prev) => (prev + 1) % WORDS.length);

      rotationIntervalId = window.setInterval(() => {
        setIndex((prev) => (prev + 1) % WORDS.length);
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

  useEffect(() => {
    let rafId = 0;

    const handleScroll = () => {
      if (rafId) {
        return;
      }

      rafId = window.requestAnimationFrame(() => {
        rafId = 0;
        setIsNavHidden(window.scrollY > 50);

        if (!revealRef.current) {
          return;
        }

        const rect = revealRef.current.getBoundingClientRect();
        const {
          scrollProgress: nextProgress,
          isVisionActive: nextIsActive,
          isVisionPanelPinned: nextIsPinned,
        } = getVisionScrollState({
          top: rect.top,
          bottom: rect.bottom,
          windowHeight: window.innerHeight,
          activationThreshold: VISION_ACTIVATION_THRESHOLD,
        });

        setScrollProgress(nextProgress);
        setIsVisionActive(nextIsActive);
        setIsVisionPanelPinned(nextIsPinned);
      });
    };

    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      window.removeEventListener('scroll', handleScroll);
      if (rafId) {
        window.cancelAnimationFrame(rafId);
      }
    };
  }, []);

  const isVisionPanelVisible = isVisionActive && isVisionPanelPinned;
  const {
    particles,
    searchRef,
    searchUrl,
    isSearchVisible,
    isSearchExpanded,
    isSearchSoftExiting,
    isSearchExiting,
    isAgentRunning,
    isOrbVisible,
    isResonanceVisible,
    isProcessVisible,
    isResultsVisible,
    currentProcessStepIndex,
    currentResultStepIndex,
    handleSearchClick,
  } = useVisionSequence({
    isVisible: isVisionPanelVisible,
  });

  const searchState = useMemo(
    () => ({
      searchRef,
      searchUrl,
      isSearchVisible,
      isSearchExpanded,
      isSearchSoftExiting,
    }),
    [searchRef, searchUrl, isSearchVisible, isSearchExpanded, isSearchSoftExiting],
  );

  const orbState = useMemo(
    () => ({
      isAgentRunning,
      isSearchExiting,
      isOrbVisible,
      isResonanceVisible,
    }),
    [isAgentRunning, isSearchExiting, isOrbVisible, isResonanceVisible],
  );

  const flowState = useMemo(
    () => ({
      isProcessVisible,
      currentProcessStepIndex,
      isResultsVisible,
      currentResultStepIndex,
    }),
    [isProcessVisible, currentProcessStepIndex, isResultsVisible, currentResultStepIndex],
  );

  const isVisionInverted = isVisionActive && scrollProgress > 0.06;

  const navClassName = useMemo(() => {
    const base = 'site-nav';
    const hidden = isNavHidden ? ' site-nav--hidden' : '';
    const inverse = isVisionInverted ? ' site-nav--inverse' : '';

    return `${base}${hidden}${inverse}`;
  }, [isNavHidden, isVisionInverted]);

  const heroClassName = useMemo(() => {
    const base = 'hero';
    const inverse = isVisionInverted ? ' hero--inverse' : '';

    return `${base}${inverse}`;
  }, [isVisionInverted]);

  return (
    <div className="app-shell landing-page" id="top">
      <div className="grain" />

      <svg className="filter-defs" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
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

      <nav className={navClassName}>
        <div className="site-nav__brand">Wedge</div>

        <div className="site-nav__links" aria-label="Section shortcuts">
          <a href="#vision">Vision</a>
        </div>
      </nav>

      <main>
        <section className={heroClassName}>
          <div className="hero__gooey" style={{ filter: 'url(#gooey)' }}>
            {WORDS.map((word, wordIndex) => {
              const isActive = wordIndex === index;

              return (
                <span
                  key={word}
                  className={`hero__word ${isActive ? 'hero__word--active' : ''}`}
                  style={
                    {
                      opacity: isActive ? 1 : 0,
                      filter: isActive ? 'blur(0px)' : 'blur(20px)',
                      transform: `translate(-50%, -50%) translateX(22px) scale(${isActive ? 1 : 1.1})`,
                      transition: 'all 1.5s cubic-bezier(0.4, 0, 0.2, 1)',
                      willChange: 'opacity, filter, transform',
                    } satisfies CSSProperties
                  }
                >
                  {word}
                </span>
              );
            })}
          </div>

          <div className="hero__indicator" aria-label="Active word indicator">
            {WORDS.map((word, wordIndex) => (
              <div
                key={word}
                className={`hero__indicator-dot ${wordIndex === index ? 'hero__indicator-dot--active' : ''}`}
              />
            ))}
          </div>
        </section>

        <section ref={revealRef} className="vision-wrap" id="vision">
          <div className="vision-sticky">
            <VisionStage
              isPanelVisible={isVisionPanelVisible}
              particles={particles}
              searchState={searchState}
              orbState={orbState}
              flowState={flowState}
              onSearchClick={handleSearchClick}
            />
          </div>
        </section>
      </main>
    </div>
  );
}
