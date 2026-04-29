import type { ApiResponse, RequestOptions } from './http';
import { requestJson } from './http';
import { clearAuthToken, readAccessToken, saveAuthToken } from './authSession';
import type { AuthToken, LoginRequest, SignupRequest, User } from '../entities/auth';

async function requestAuthToken(path: string, options: RequestOptions) {
  const response = await requestJson<ApiResponse<AuthToken>>(path, options);
  saveAuthToken(response.data);
  return response;
}

export function signup(request: SignupRequest, options?: RequestOptions) {
  return requestAuthToken('/auth/signup', {
    ...options,
    method: 'POST',
    body: JSON.stringify(request),
  });
}

export function login(request: LoginRequest, options?: RequestOptions) {
  return requestAuthToken('/auth/login', {
    ...options,
    method: 'POST',
    body: JSON.stringify(request),
  });
}

export function refreshToken(options?: RequestOptions) {
  return requestAuthToken('/auth/refresh', {
    ...options,
    method: 'POST',
  });
}

let ensureAuthSessionPromise: Promise<boolean> | null = null;

export async function ensureAuthSession(options?: RequestOptions) {
  if (readAccessToken()) {
    return true;
  }

  ensureAuthSessionPromise ??= refreshToken(options)
    .then(() => true)
    .catch(() => {
      clearAuthToken();
      return false;
    })
    .finally(() => {
      ensureAuthSessionPromise = null;
    });

  return ensureAuthSessionPromise;
}

export async function logout(options?: RequestOptions) {
  try {
    return await requestJson<ApiResponse<null>>('/auth/logout', {
      ...options,
      method: 'POST',
    });
  } finally {
    clearAuthToken();
  }
}

export function getCurrentUser(options?: RequestOptions) {
  return requestJson<ApiResponse<User>>('/auth/me', options);
}

export const authApi = {
  signup,
  login,
  refreshToken,
  ensureAuthSession,
  logout,
  getCurrentUser,
};
