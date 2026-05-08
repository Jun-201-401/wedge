import test from 'node:test';
import assert from 'node:assert/strict';

import { handleSpaNavigationClick } from '../../src/shared/lib/navigation';

function installWindow() {
  const originalWindow = globalThis.window;
  const originalPopStateEvent = globalThis.PopStateEvent;
  const pushedPaths: string[] = [];
  const events: string[] = [];

  class TestPopStateEvent {
    type: string;

    constructor(type: string) {
      this.type = type;
    }
  }

  Object.defineProperty(globalThis, 'window', {
    value: {
      history: {
        pushState: (_state: unknown, _title: string, path: string) => {
          pushedPaths.push(path);
        },
      },
      dispatchEvent: (event: { type: string }) => {
        events.push(event.type);
        return true;
      },
    },
    configurable: true,
  });
  Object.defineProperty(globalThis, 'PopStateEvent', {
    value: TestPopStateEvent,
    configurable: true,
  });

  return {
    pushedPaths,
    events,
    restore: () => {
      Object.defineProperty(globalThis, 'window', { value: originalWindow, configurable: true });
      Object.defineProperty(globalThis, 'PopStateEvent', { value: originalPopStateEvent, configurable: true });
    },
  };
}

function clickEvent(overrides: Partial<Parameters<typeof handleSpaNavigationClick>[0]> = {}) {
  let defaultPrevented = false;
  return {
    get prevented() {
      return defaultPrevented;
    },
    event: {
      button: 0,
      defaultPrevented: false,
      metaKey: false,
      altKey: false,
      ctrlKey: false,
      shiftKey: false,
      preventDefault: () => {
        defaultPrevented = true;
      },
      ...overrides,
    },
  };
}

test('handleSpaNavigationClick intercepts ordinary left-click navigation through history', () => {
  const harness = installWindow();
  const click = clickEvent();

  try {
    assert.equal(handleSpaNavigationClick(click.event, '/runs/run-id/report'), true);
    assert.equal(click.prevented, true);
    assert.deepEqual(harness.pushedPaths, ['/runs/run-id/report']);
    assert.deepEqual(harness.events, ['popstate']);
  } finally {
    harness.restore();
  }
});

test('handleSpaNavigationClick preserves modified native link clicks', () => {
  const harness = installWindow();
  const click = clickEvent({ metaKey: true });

  try {
    assert.equal(handleSpaNavigationClick(click.event, '/runs/run-id/report'), false);
    assert.equal(click.prevented, false);
    assert.deepEqual(harness.pushedPaths, []);
    assert.deepEqual(harness.events, []);
  } finally {
    harness.restore();
  }
});
