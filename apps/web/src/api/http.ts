import { clearAuthToken, readAccessToken, saveAuthToken } from './authSession';
import type { AuthToken } from '../entities/auth';

export interface ApiMeta {
  requestId: string;
  correlationId?: string | null;
  nextCursor?: string | null;
  hasMore?: boolean | null;
}

export interface ApiResponse<T> {
  data: T;
  meta: ApiMeta;
}

export interface AckResponse {
  data: Record<string, unknown> | null;
  meta: ApiMeta;
}

export interface RequestOptions extends RequestInit {
  idempotencyKey?: string;
}

interface ApiErrorEnvelope {
  error?: {
    code?: unknown;
    message?: unknown;
    details?: unknown;
  };
}

export interface ApiFieldValidationError {
  field: string;
}

export class WedgeApiError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly code: string | null;
  readonly details: unknown;
  readonly responseBody: unknown;

  constructor(response: Response, apiError: ApiErrorEnvelope['error'] | null, responseBody: unknown) {
    const code = typeof apiError?.code === 'string' ? apiError.code : null;
    const apiMessage = typeof apiError?.message === 'string' ? apiError.message : null;
    const codeSuffix = code ? ` (${code}${apiMessage ? `: ${apiMessage}` : ''})` : '';
    super(`Wedge API request failed: ${response.status} ${response.statusText}${codeSuffix}`);
    this.name = 'WedgeApiError';
    this.status = response.status;
    this.statusText = response.statusText;
    this.code = code;
    this.details = apiError?.details;
    this.responseBody = responseBody;
  }
}

const DEFAULT_API_BASE_URL = '/api';
const AUTH_REFRESH_PATH = '/auth/refresh';
const AUTH_PUBLIC_PATHS = new Set(['/auth/signup', '/auth/login', AUTH_REFRESH_PATH]);

function createRequestHeaders(headers: HeadersInit | undefined, body: BodyInit | null | undefined, idempotencyKey?: string) {
  const requestHeaders = new Headers(headers);

  if (idempotencyKey) {
    requestHeaders.set('Idempotency-Key', idempotencyKey);
  }

  const accessToken = readAccessToken();
  if (accessToken && !requestHeaders.has('Authorization')) {
    requestHeaders.set('Authorization', `Bearer ${accessToken}`);
  }

  if (body && !requestHeaders.has('Content-Type')) {
    requestHeaders.set('Content-Type', 'application/json');
  }

  return requestHeaders;
}

function shouldRefreshAfterUnauthorized(path: string) {
  return !AUTH_PUBLIC_PATHS.has(path);
}

let refreshAccessTokenPromise: Promise<boolean> | null = null;

async function refreshAccessToken() {
  const response = await fetch(`${DEFAULT_API_BASE_URL}${AUTH_REFRESH_PATH}`, {
    method: 'POST',
    credentials: 'include',
  });

  if (!response.ok) {
    clearAuthToken();
    return false;
  }

  const refreshed = (await response.json()) as ApiResponse<AuthToken>;
  saveAuthToken(refreshed.data);
  return true;
}

function refreshAccessTokenOnce() {
  refreshAccessTokenPromise ??= refreshAccessToken().finally(() => {
    refreshAccessTokenPromise = null;
  });
  return refreshAccessTokenPromise;
}

async function requestWithRefresh(
  path: string,
  request: RequestInit,
  headers: HeadersInit | undefined,
  body: BodyInit | null | undefined,
  idempotencyKey?: string,
) {
  let response = await fetch(`${DEFAULT_API_BASE_URL}${path}`, request);

  if (response.status === 401 && shouldRefreshAfterUnauthorized(path) && await refreshAccessTokenOnce()) {
    response = await fetch(`${DEFAULT_API_BASE_URL}${path}`, {
      ...request,
      headers: createRequestHeaders(headers, body, idempotencyKey),
    });
  }

  return response;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readApiError(body: unknown) {
  if (!isRecord(body) || !isRecord(body.error)) {
    return null;
  }
  return body.error as ApiErrorEnvelope['error'];
}

export function readApiValidationFields(details: unknown): ApiFieldValidationError[] {
  if (!isRecord(details) || !Array.isArray(details.fields)) {
    return [];
  }

  return details.fields.flatMap((fieldError) => {
    if (!isRecord(fieldError) || typeof fieldError.field !== 'string') {
      return [];
    }

    return [{ field: fieldError.field }];
  });
}

async function createApiError(response: Response) {
  let responseBody: unknown = null;

  try {
    responseBody = await response.json();
  } catch {
    responseBody = null;
  }

  return new WedgeApiError(response, readApiError(responseBody), responseBody);
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw await createApiError(response);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export async function requestJson<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { idempotencyKey, headers, ...requestOptions } = options;
  const body = requestOptions.body ?? null;
  const request = {
    ...requestOptions,
    credentials: requestOptions.credentials ?? 'include',
    headers: createRequestHeaders(headers, body, idempotencyKey),
  } satisfies RequestInit;

  const response = await requestWithRefresh(path, request, headers, body, idempotencyKey);

  return parseJsonResponse<T>(response);
}

export async function requestBlob(path: string, options: RequestOptions = {}): Promise<Blob> {
  const { idempotencyKey, headers, ...requestOptions } = options;
  const body = requestOptions.body ?? null;
  const request = {
    ...requestOptions,
    credentials: requestOptions.credentials ?? 'include',
    headers: createRequestHeaders(headers, body, idempotencyKey),
  } satisfies RequestInit;

  const response = await requestWithRefresh(path, request, headers, body, idempotencyKey);

  if (!response.ok) {
    throw await createApiError(response);
  }

  return response.blob();
}
