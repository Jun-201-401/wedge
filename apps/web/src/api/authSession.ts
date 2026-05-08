import type { AuthToken, User } from '../entities/auth';

export const AUTH_ACCESS_TOKEN_STORAGE_KEY = 'wedge.accessToken';
export const AUTH_REFRESH_TOKEN_STORAGE_KEY = 'wedge.refreshToken';
export const AUTH_USER_STORAGE_KEY = 'wedge.user';
export const AUTH_REFRESH_COOKIE_HINT_STORAGE_KEY = 'wedge.refreshCookiePresent';
export const LEGACY_ACCESS_TOKEN_STORAGE_KEY = 'accessToken';

const REFRESH_COOKIE_HINT_VALUE = 'true';

let accessTokenInMemory: string | null = null;
let userInMemory: User | null = null;

function getStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') {
      return null;
    }

    return window.localStorage;
  } catch {
    return null;
  }
}

function removeStorageItem(storage: Storage, key: string) {
  try {
    storage.removeItem(key);
  } catch {
    // Best-effort cleanup for restricted browser storage contexts.
  }
}

function setStorageItem(storage: Storage, key: string, value: string) {
  try {
    storage.setItem(key, value);
  } catch {
    // Best-effort session hint for restricted browser storage contexts.
  }
}

function clearPersistedTokenStorage() {
  const storage = getStorage();

  if (!storage) {
    return;
  }

  removeStorageItem(storage, AUTH_ACCESS_TOKEN_STORAGE_KEY);
  removeStorageItem(storage, AUTH_REFRESH_TOKEN_STORAGE_KEY);
  removeStorageItem(storage, AUTH_USER_STORAGE_KEY);
  removeStorageItem(storage, LEGACY_ACCESS_TOKEN_STORAGE_KEY);
}

function rememberRefreshCookieIssued() {
  const storage = getStorage();

  if (!storage) {
    return;
  }

  setStorageItem(storage, AUTH_REFRESH_COOKIE_HINT_STORAGE_KEY, REFRESH_COOKIE_HINT_VALUE);
}

function clearRefreshCookieHint() {
  const storage = getStorage();

  if (!storage) {
    return;
  }

  removeStorageItem(storage, AUTH_REFRESH_COOKIE_HINT_STORAGE_KEY);
}

export function hasRefreshCookieHint() {
  const storage = getStorage();

  if (!storage) {
    return false;
  }

  try {
    return storage.getItem(AUTH_REFRESH_COOKIE_HINT_STORAGE_KEY) === REFRESH_COOKIE_HINT_VALUE;
  } catch {
    return false;
  }
}

export function readAccessToken() {
  return accessTokenInMemory;
}

export function saveAuthToken(token: AuthToken) {
  accessTokenInMemory = token.accessToken;
  userInMemory = token.user;
  clearPersistedTokenStorage();
  rememberRefreshCookieIssued();
}

export function clearAuthToken() {
  accessTokenInMemory = null;
  userInMemory = null;
  clearPersistedTokenStorage();
  clearRefreshCookieHint();
}

export function readCurrentUser(): User | null {
  return userInMemory;
}
