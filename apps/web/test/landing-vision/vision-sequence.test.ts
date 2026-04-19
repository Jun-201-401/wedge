import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  buildVisionPhaseSchedule,
  getVisionSequenceFlags,
  VISION_PROCESS_STEPS,
  VISION_SEQUENCE_PHASES,
  VISION_SEQUENCE_TIMINGS,
} from '../../src/features/landing-vision/lib/visionSequence';

test('vision sequence timings preserve the tuned staging order', () => {
  assert.equal(VISION_SEQUENCE_TIMINGS.searchExpandDelayMs, 280);
  assert.equal(VISION_SEQUENCE_TIMINGS.searchTypingStartDelayMs, 720);
  assert.equal(VISION_SEQUENCE_TIMINGS.searchRunningDelayMs, 0);
  assert.equal(VISION_SEQUENCE_TIMINGS.searchSoftExitDelayMs, 140);
  assert.equal(VISION_SEQUENCE_TIMINGS.searchExitDelayMs, 260);
  assert.ok(
    VISION_SEQUENCE_TIMINGS.searchRunningDelayMs < VISION_SEQUENCE_TIMINGS.searchSoftExitDelayMs &&
      VISION_SEQUENCE_TIMINGS.searchSoftExitDelayMs < VISION_SEQUENCE_TIMINGS.searchExitDelayMs &&
      VISION_SEQUENCE_TIMINGS.searchExitDelayMs < VISION_SEQUENCE_TIMINGS.orbRevealDelayMs,
  );
  assert.equal(VISION_SEQUENCE_TIMINGS.orbRevealDelayMs, 760);
  assert.equal(VISION_SEQUENCE_TIMINGS.resonanceRevealDelayMs, 1220);
  assert.equal(VISION_SEQUENCE_TIMINGS.processStartDelayMs, 2200);
  assert.equal(VISION_SEQUENCE_TIMINGS.processStepIntervalMs, 600);
  assert.equal(VISION_SEQUENCE_TIMINGS.resultsStartDelayMs, 4700);
  assert.equal(VISION_SEQUENCE_TIMINGS.resultsStepIntervalMs, 320);
});

test('vision sequence flags expose the running phase transitions from a single phase value', () => {
  assert.deepEqual(getVisionSequenceFlags(VISION_SEQUENCE_PHASES.SEARCH), {
    isSearchVisible: true,
    isAgentRunning: false,
    isSearchExiting: false,
    isOrbVisible: false,
    isResonanceVisible: false,
    isProcessVisible: false,
    isResultsVisible: false,
    currentProcessStepIndex: -1,
    currentResultStepIndex: -1,
  });

  assert.deepEqual(getVisionSequenceFlags(VISION_SEQUENCE_PHASES.RUNNING), {
    isSearchVisible: true,
    isAgentRunning: true,
    isSearchExiting: false,
    isOrbVisible: false,
    isResonanceVisible: false,
    isProcessVisible: false,
    isResultsVisible: false,
    currentProcessStepIndex: -1,
    currentResultStepIndex: -1,
  });

  assert.deepEqual(getVisionSequenceFlags(VISION_SEQUENCE_PHASES.EXITING), {
    isSearchVisible: true,
    isAgentRunning: true,
    isSearchExiting: true,
    isOrbVisible: false,
    isResonanceVisible: false,
    isProcessVisible: false,
    isResultsVisible: false,
    currentProcessStepIndex: -1,
    currentResultStepIndex: -1,
  });

  assert.deepEqual(getVisionSequenceFlags(VISION_SEQUENCE_PHASES.ORB), {
    isSearchVisible: false,
    isAgentRunning: true,
    isSearchExiting: true,
    isOrbVisible: true,
    isResonanceVisible: false,
    isProcessVisible: false,
    isResultsVisible: false,
    currentProcessStepIndex: -1,
    currentResultStepIndex: -1,
  });

  assert.deepEqual(getVisionSequenceFlags(VISION_SEQUENCE_PHASES.RESONATING), {
    isSearchVisible: false,
    isAgentRunning: true,
    isSearchExiting: true,
    isOrbVisible: true,
    isResonanceVisible: true,
    isProcessVisible: false,
    isResultsVisible: false,
    currentProcessStepIndex: -1,
    currentResultStepIndex: -1,
  });

  assert.deepEqual(getVisionSequenceFlags(VISION_SEQUENCE_PHASES.PROCESS_INTERPRET), {
    isSearchVisible: false,
    isAgentRunning: true,
    isSearchExiting: true,
    isOrbVisible: true,
    isResonanceVisible: true,
    isProcessVisible: true,
    isResultsVisible: false,
    currentProcessStepIndex: 2,
    currentResultStepIndex: -1,
  });

  assert.deepEqual(getVisionSequenceFlags(VISION_SEQUENCE_PHASES.RESULT_WHY), {
    isSearchVisible: false,
    isAgentRunning: false,
    isSearchExiting: true,
    isOrbVisible: false,
    isResonanceVisible: false,
    isProcessVisible: false,
    isResultsVisible: true,
    currentProcessStepIndex: -1,
    currentResultStepIndex: 1,
  });
});

test('vision phase schedule keeps the phase order in data', () => {
  assert.deepEqual(buildVisionPhaseSchedule(VISION_SEQUENCE_TIMINGS), [
    { phase: VISION_SEQUENCE_PHASES.RUNNING, delay: 0 },
    { phase: VISION_SEQUENCE_PHASES.EXITING, delay: 260 },
    { phase: VISION_SEQUENCE_PHASES.ORB, delay: 760 },
    { phase: VISION_SEQUENCE_PHASES.RESONATING, delay: 1220 },
    { phase: VISION_SEQUENCE_PHASES.PROCESS_RUN, delay: 2200 },
    { phase: VISION_SEQUENCE_PHASES.PROCESS_CAPTURE, delay: 2800 },
    { phase: VISION_SEQUENCE_PHASES.PROCESS_INTERPRET, delay: 3400 },
    { phase: VISION_SEQUENCE_PHASES.PROCESS_PRIORITIZE, delay: 4000 },
    { phase: VISION_SEQUENCE_PHASES.RESULT_EVIDENCE, delay: 4700 },
    { phase: VISION_SEQUENCE_PHASES.RESULT_WHY, delay: 5020 },
    { phase: VISION_SEQUENCE_PHASES.RESULT_NUDGE, delay: 5340 },
  ]);
});

test('vision process steps keep their icon and eyebrow metadata inline', () => {
  assert.deepEqual(
    VISION_PROCESS_STEPS.map(({ title, eyebrow, icon }) => ({ title, eyebrow, icon })),
    [
      { title: '실행', eyebrow: '여정 재생', icon: 'cube' },
      { title: '수집', eyebrow: '증거 포착', icon: 'pipeline' },
      { title: '해석', eyebrow: '마찰 해석', icon: 'layers' },
      { title: '정리', eyebrow: '우선순위 정리', icon: 'pulse' },
    ],
  );
});

test('vision process stage keeps the simulation and agent panels inside the two-column wrapper', () => {
  const source = fs.readFileSync(
    new URL('../../src/features/landing-vision/components/VisionProcessStage.tsx', import.meta.url),
    'utf8',
  );
  assert.match(source, /className="vision-process-stage__top"/);
  assert.match(source, /<section className=\{simulationClassName\}/);
  assert.match(source, /<section className="vision-process-stage__agent"/);
});


test('vision process stage hides simulation and keeps agent timeline on mobile', () => {
  const css = fs.readFileSync(
    new URL('../../src/features/landing-vision/styles/vision-process.css', import.meta.url),
    'utf8',
  );

  assert.match(css, /@media \(max-width: 720px\)/);
  assert.match(css, /\.vision-process-stage__top\s*\{[\s\S]*?grid-template-columns: 1fr/);
  assert.match(css, /\.vision-process-stage__simulation\s*\{[\s\S]*?display: none/);
  assert.match(css, /\.vision-process-stage__agent\s*\{[\s\S]*?padding: 1rem/);
  assert.match(css, /\.vision-process-stage__agent\s*\{[\s\S]*?overflow-y: auto/);
  assert.match(css, /\.vision-process__step--completed \.vision-process__subtasks--expanded\s*\{[\s\S]*?grid-template-rows: 0fr/);
  assert.match(css, /@media \(max-width: 720px\) and \(max-height: 640px\)/);
  assert.match(css, /max-height: calc\(100vh - 7rem\)/);
});

test('desktop vision results cards use a non-button action inside the clickable card shell', () => {
  const source = fs.readFileSync(
    new URL('../../src/features/landing-vision/components/VisionResultsStage.tsx', import.meta.url),
    'utf8',
  );
  assert.match(source, /className="vision-results-sample8-grid vision-results-desktop"/);
  assert.match(source, /role="button"/);
  assert.match(source, /aria-pressed=\{isExpanded\}/);
  assert.match(source, /aria-disabled=\{!isVisible\}/);
  assert.match(source, /if \(isVisible\) \{\n          onToggle\(card.key\);/);
  assert.match(source, /handleCardKeyDown =\n    \(cardKey: ResultCardKey, isVisible: boolean\)/);
  assert.match(source, /if \(isVisible\) \{\n          toggleCard\(cardKey\);/);
  assert.match(source, /<span className="sample8-back-action" aria-hidden="true">/);
  assert.doesNotMatch(source, /<button type="button" className="sample8-back-action">/);

  const css = fs.readFileSync(
    new URL('../../src/features/landing-vision/styles/vision-results.css', import.meta.url),
    'utf8',
  );
  assert.match(css, /vision-results-sample8-item--visible:hover/);
  assert.doesNotMatch(css, /vision-results-sample8-item:hover \.sample8-preserve-3d/);
});

test('vision search uses explicit handlers for visible controls', () => {
  const source = fs.readFileSync(
    new URL('../../src/features/landing-vision/components/VisionSearch.tsx', import.meta.url),
    'utf8',
  );
  assert.match(source, /const handleActionClick = \(event/);
  assert.match(source, /event\.stopPropagation\(\)/);
  assert.match(source, /<button className="vision-search__plus"[^>]+onClick=\{handleActionClick\}/);
  assert.match(source, /<button className="vision-search__send"[^>]+onClick=\{handleActionClick\}/);
});

test('vision sequence hook clears particle timeouts on unmount', () => {
  const source = fs.readFileSync(
    new URL('../../src/features/landing-vision/hooks/useVisionSequence.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /particleTimeoutIdsRef\.current\.forEach\(\(timeoutId\) => window\.clearTimeout\(timeoutId\)\)/);
  assert.match(source, /particleTimeoutIdsRef\.current = \[\]/);
});


test('mobile vision results cards expose expandable accessible details', () => {
  const source = fs.readFileSync(
    new URL('../../src/features/landing-vision/components/VisionResultsStage.tsx', import.meta.url),
    'utf8',
  );

  assert.match(source, /className="vision-results-mobile"/);
  assert.match(source, /className=\{`vision-results-mobile-card/);
  assert.match(source, /aria-expanded=\{isExpanded\}/);
  assert.match(source, /aria-controls=\{detailsId\}/);
  assert.match(source, /aria-hidden=\{!isExpanded\}/);
  assert.match(source, /id=\{detailsId\}/);
  assert.match(source, /vision-results-mobile-card__details/);
  assert.match(source, /vision-results-mobile-card__disclosure/);
});


test('mobile results disclosure uses text pill instead of arrow glyph', () => {
  const source = fs.readFileSync(
    new URL('../../src/features/landing-vision/components/VisionResultsStage.tsx', import.meta.url),
    'utf8',
  );
  const css = fs.readFileSync(
    new URL('../../src/features/landing-vision/styles/vision-results.css', import.meta.url),
    'utf8',
  );

  assert.match(source, /vision-results-mobile-card__disclosure/);
  assert.doesNotMatch(source, />\s*↓\s*<\/span>/);
  assert.match(css, /content: '보기'/);
  assert.match(css, /content: '접기'/);
  assert.match(css, /border-right: 1\.8px solid currentColor/);
});


test('vision process timeline does not render a live pill', () => {
  const source = fs.readFileSync(
    new URL('../../src/features/landing-vision/components/VisionProcessTimeline.tsx', import.meta.url),
    'utf8',
  );
  const css = fs.readFileSync(
    new URL('../../src/features/landing-vision/styles/vision-process.css', import.meta.url),
    'utf8',
  );

  assert.doesNotMatch(source, /vision-process__live-pill/);
  assert.doesNotMatch(css, /vision-process__live-pill/);
});
