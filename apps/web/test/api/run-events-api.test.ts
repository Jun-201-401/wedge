import test from 'node:test';
import assert from 'node:assert/strict';

import type { ApiResponse } from '../../src/api/http';
import { listRunEvents } from '../../src/api/runs';
import type { RunEvent } from '../../src/entities/run';

const runId = '11111111-1111-4111-8111-111111111111';
const stepId = '22222222-2222-4222-8222-222222222222';
const cursor = '33333333-3333-4333-8333-333333333333';

function response<T>(payload: ApiResponse<T>) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

const eventResponse = {
  data: [
    {
      id: '44444444-4444-4444-8444-444444444444',
      runId,
      stepId,
      stepKey: 'step_002_submit',
      eventType: 'STEP_FAILED',
      eventSource: 'RUNNER',
      payload: {
        failureCode: 'RUNNER_TIMEOUT',
        failureMessage: 'locator click timed out',
      },
      occurredAt: '2026-04-27T01:01:03.000Z',
    },
  ],
  meta: {
    requestId: 'req_events',
    nextCursor: '44444444-4444-4444-8444-444444444444',
    hasMore: true,
  },
} satisfies ApiResponse<RunEvent[]>;

test('run events API client forwards event list query params', async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string }> = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), method: init?.method ?? 'GET' });
    return response(eventResponse);
  }) as typeof fetch;

  try {
    const result = await listRunEvents(runId, {
      cursor,
      limit: 20,
      stepId,
      eventType: 'STEP_FAILED',
    });

    assert.deepEqual(calls, [
      {
        url: `/api/runs/${runId}/events?cursor=${cursor}&limit=20&stepId=${stepId}&eventType=STEP_FAILED`,
        method: 'GET',
      },
    ]);
    assert.equal(result.data[0].eventType, 'STEP_FAILED');
    assert.equal(result.meta.hasMore, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
