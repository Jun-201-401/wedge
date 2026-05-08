import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AUTH_ACCESS_TOKEN_STORAGE_KEY,
  AUTH_REFRESH_TOKEN_STORAGE_KEY,
  AUTH_USER_STORAGE_KEY,
  AUTH_REFRESH_COOKIE_HINT_STORAGE_KEY,
  LEGACY_ACCESS_TOKEN_STORAGE_KEY,
  clearAuthToken,
  hasRefreshCookieHint,
  readAccessToken,
  readCurrentUser,
  saveAuthToken,
} from '../../src/api/authSession';
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
  accessToken: 'access-token',
  tokenType: 'Bearer',
  expiresIn: 3600,
  user: {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'user@example.com',
    displayName: 'Wedge User',
    status: 'ACTIVE',
  },
};

test('auth session keeps access token in memory and never persists refresh token data', () => {
  const storage = createMemoryStorage();
  installWindowWithStorage(storage);

  storage.setItem(AUTH_ACCESS_TOKEN_STORAGE_KEY, 'old-access-token');
  storage.setItem(AUTH_REFRESH_TOKEN_STORAGE_KEY, 'old-refresh-token');
  storage.setItem(AUTH_USER_STORAGE_KEY, '{"id":"old"}');
  storage.setItem(LEGACY_ACCESS_TOKEN_STORAGE_KEY, 'legacy-token');

  saveAuthToken(authToken);

  assert.equal(readAccessToken(), authToken.accessToken);
  assert.deepEqual(readCurrentUser(), authToken.user);
  assert.equal(storage.getItem(AUTH_ACCESS_TOKEN_STORAGE_KEY), null);
  assert.equal(storage.getItem(AUTH_REFRESH_TOKEN_STORAGE_KEY), null);
  assert.equal(storage.getItem(AUTH_USER_STORAGE_KEY), null);
  assert.equal(storage.getItem(LEGACY_ACCESS_TOKEN_STORAGE_KEY), null);
  assert.equal(storage.getItem(AUTH_REFRESH_COOKIE_HINT_STORAGE_KEY), 'true');
  assert.equal(hasRefreshCookieHint(), true);

  clearAuthToken();
  assert.equal(readAccessToken(), null);
  assert.equal(readCurrentUser(), null);
  assert.equal(storage.getItem(AUTH_REFRESH_COOKIE_HINT_STORAGE_KEY), null);
  assert.equal(hasRefreshCookieHint(), false);
  removeWindow();
});

test('auth session tolerates unavailable storage because tokens are memory only', () => {
  removeWindow();

  saveAuthToken(authToken);
  assert.equal(readAccessToken(), authToken.accessToken);
  assert.deepEqual(readCurrentUser(), authToken.user);

  clearAuthToken();
  assert.equal(readAccessToken(), null);
  assert.equal(readCurrentUser(), null);
});

test('auth session cleanup ignores storage removal failures', () => {
  const storage = createMemoryStorage();
  storage.removeItem = () => {
    throw new Error('storage disabled');
  };
  installWindowWithStorage(storage);

  assert.doesNotThrow(() => saveAuthToken(authToken));
  assert.equal(readAccessToken(), authToken.accessToken);
  assert.doesNotThrow(() => clearAuthToken());
  assert.equal(readAccessToken(), null);
  removeWindow();
});
