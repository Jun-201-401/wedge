import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  FIRST_WORD_DELAY_MS,
  getVisionScrollState,
  VISION_ACTIVATION_THRESHOLD,
  WORD_ROTATION_INTERVAL_MS,
} from '../../src/features/landing-vision/lib/heroVision';

test('hero timing constants keep the tuned intro cadence', () => {
  assert.equal(FIRST_WORD_DELAY_MS, 1300);
  assert.equal(WORD_ROTATION_INTERVAL_MS, 2200);
});

test('vision scroll state stays inactive until the threshold is crossed', () => {
  const result = getVisionScrollState({
    top: 450,
    bottom: 1200,
    windowHeight: 1000,
  });

  assert.equal(result.isVisionActive, false);
  assert.equal(result.scrollProgress, 0);
  assert.equal(result.isVisionPanelPinned, false);
});

test('vision scroll state normalizes progress once activated', () => {
  const activeTop = 1000 - 1000 * 0.75;
  const result = getVisionScrollState({
    top: activeTop,
    bottom: 1500,
    windowHeight: 1000,
  });

  assert.equal(result.isVisionActive, true);
  assert.equal(result.isVisionPanelPinned, false);
  assert.ok(result.scrollProgress > 0);
  assert.ok(result.scrollProgress < 1);
});

test('vision scroll state marks the panel pinned only after the section reaches the top', () => {
  const result = getVisionScrollState({
    top: -10,
    bottom: 600,
    windowHeight: 1000,
    activationThreshold: VISION_ACTIVATION_THRESHOLD,
  });

  assert.equal(result.isVisionActive, true);
  assert.equal(result.isVisionPanelPinned, true);
});

test('landing page keeps the vision section as the final viewport without extra scroll track', () => {
  const landing = fs.readFileSync(new URL('../../src/pages/landing/LandingPage.tsx', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../../src/pages/landing/LandingPage.css', import.meta.url), 'utf8');

  assert.match(landing, /className="vision-wrap"/);
  assert.doesNotMatch(landing, /vision-wrap--complete/);
  assert.match(css, /\.vision-wrap\s*\{[\s\S]*?height: 100svh/);
  assert.doesNotMatch(css, /height:\s*2[025]0vh/);
});
