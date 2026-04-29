import type { AuthToken, User } from '../entities/auth';

export const AUTH_ACCESS_TOKEN_STORAGE_KEY = 'wedge.accessToken';
export const AUTH_REFRESH_TOKEN_STORAGE_KEY = 'wedge.refreshToken';
export const AUTH_USER_STORAGE_KEY = 'wedge.user';
export const LEGACY_ACCESS_TOKEN_STORAGE_KEY = 'accessToken';

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

function clearPersistedAuthStorage() {
  const storage = getStorage();

  if (!storage) {
    return;
  }

  removeStorageItem(storage, AUTH_ACCESS_TOKEN_STORAGE_KEY);
  removeStorageItem(storage, AUTH_REFRESH_TOKEN_STORAGE_KEY);
  removeStorageItem(storage, AUTH_USER_STORAGE_KEY);
  removeStorageItem(storage, LEGACY_ACCESS_TOKEN_STORAGE_KEY);
}

export function readAccessToken() {
  return accessTokenInMemory;
}

export function saveAuthToken(token: AuthToken) {
  accessTokenInMemory = token.accessToken;
  userInMemory = token.user;
  clearPersistedAuthStorage();
}

export function clearAuthToken() {
  accessTokenInMemory = null;
  userInMemory = null;
  clearPersistedAuthStorage();
}

export function readCurrentUser(): User | null {
  return userInMemory;
}
