import test from 'node:test';
import assert from 'node:assert/strict';

import { ensureAuthSession } from '../../src/api/auth';
import { AUTH_REFRESH_COOKIE_HINT_STORAGE_KEY, clearAuthToken, readAccessToken } from '../../src/api/authSession';
import type { AuthToken } from '../../src/entities/auth';


function installWindowWithStorage(storage: Storage) {
  Object.defineProperty(globalThis, 'window', {
    value: { localStorage: storage },
    configurable: true,
  });
}

function removeWindow() {
  Reflect.deleteProperty(globalThis, 'window');
}

function createMemoryStorage() {
  const items = new Map<string, string>();

  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      items.set(key, value);
    },
    removeItem: (key: string) => {
      items.delete(key);
    },
    clear: () => items.clear(),
    key: (index: number) => Array.from(items.keys())[index] ?? null,
    get length() {
      return items.size;
    },
  } as Storage;
}

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

test('ensureAuthSession skips refresh when no refresh-cookie hint exists', async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  const storage = createMemoryStorage();
  installWindowWithStorage(storage);

  clearAuthToken();
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return apiResponse(authToken);
  }) as typeof fetch;

  try {
    assert.equal(await ensureAuthSession(), false);
    assert.deepEqual(calls, []);
  } finally {
    globalThis.fetch = originalFetch;
    clearAuthToken();
    removeWindow();
  }
});

test('ensureAuthSession shares one refresh request during StrictMode-style double mount', async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  const storage = createMemoryStorage();
  installWindowWithStorage(storage);
  storage.setItem(AUTH_REFRESH_COOKIE_HINT_STORAGE_KEY, 'true');

  clearAuthToken();
  storage.setItem(AUTH_REFRESH_COOKIE_HINT_STORAGE_KEY, 'true');
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
    removeWindow();
  }
});
