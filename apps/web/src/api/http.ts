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

const DEFAULT_API_BASE_URL = '/api';

function readAccessToken() {
  if (typeof window === 'undefined') {
    return null;
  }

  return window.localStorage.getItem('wedge.accessToken') ?? window.localStorage.getItem('accessToken');
}

export async function requestJson<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { idempotencyKey, headers, ...requestOptions } = options;
  const requestHeaders = new Headers(headers);

  if (idempotencyKey) {
    requestHeaders.set('Idempotency-Key', idempotencyKey);
  }

  const accessToken = readAccessToken();
  if (accessToken && !requestHeaders.has('Authorization')) {
    requestHeaders.set('Authorization', `Bearer ${accessToken}`);
  }

  if (requestOptions.body && !requestHeaders.has('Content-Type')) {
    requestHeaders.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${DEFAULT_API_BASE_URL}${path}`, {
    ...requestOptions,
    headers: requestHeaders,
  });

  if (!response.ok) {
    throw new Error(`Wedge API request failed: ${response.status} ${response.statusText}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}
