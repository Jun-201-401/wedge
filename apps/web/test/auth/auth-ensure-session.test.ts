import test from 'node:test';
import assert from 'node:assert/strict';

import { ensureAuthSession } from '../../src/api/auth';
import { clearAuthToken, readAccessToken } from '../../src/api/authSession';
import type { AuthToken } from '../../src/entities/auth';

const authToken: AuthToken = {
  accessToken: 'bootstrapped-access-token',
  tokenType: 'Bearer',
  expiresIn: 3600,
  user: {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'user@example.com',
    displayName: 'Wedge User',
    status: 'ACTIVE',
  },
};

function apiResponse<T>(data: T) {
  return new Response(JSON.stringify({ data, meta: { requestId: 'req_test' } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('ensureAuthSession shares one refresh request during StrictMode-style double mount', async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];

  clearAuthToken();
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    await new Promise((resolve) => setTimeout(resolve, 10));
    return apiResponse(authToken);
  }) as typeof fetch;

  try {
    const [first, second] = await Promise.all([
      ensureAuthSession(),
      ensureAuthSession(),
    ]);

    assert.equal(first, true);
    assert.equal(second, true);
    assert.deepEqual(calls, ['/api/auth/refresh']);
    assert.equal(readAccessToken(), authToken.accessToken);
  } finally {
    globalThis.fetch = originalFetch;
    clearAuthToken();
  }
});
