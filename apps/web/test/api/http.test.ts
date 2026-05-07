import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { requestBlob, requestJson, type ApiResponse } from '../../src/api/http';
import { clearAuthToken, readAccessToken, saveAuthToken } from '../../src/api/authSession';
import type { AuthToken } from '../../src/entities/auth';

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

const refreshedToken: AuthToken = {
  ...authToken,
  accessToken: 'fresh-access-token',
};

function apiResponse<T>(data: T, status = 200) {
  return new Response(JSON.stringify({ data, meta: { requestId: 'req_test' } }), {
    status,
    statusText: status === 200 ? 'OK' : 'Unauthorized',
    headers: { 'Content-Type': 'application/json' },
  });
}

test('web api client forwards memory bearer token and includes credentials for refresh cookies', () => {
  const source = fs.readFileSync(new URL('../../src/api/http.ts', import.meta.url), 'utf8');

  assert.match(source, /import \{ clearAuthToken, readAccessToken, saveAuthToken \} from '\.\/authSession'/);
  assert.match(source, /const accessToken = readAccessToken\(\)/);
  assert.match(source, /requestHeaders\.set\('Authorization', `Bearer \$\{accessToken\}`\)/);
  assert.match(source, /!requestHeaders\.has\('Authorization'\)/);
  assert.match(source, /credentials: requestOptions\.credentials \?\? 'include'/);
  assert.match(source, /const AUTH_REFRESH_PATH = '\/auth\/refresh'/);
  assert.match(source, /refreshAccessTokenPromise \?\?= refreshAccessToken\(\)\.finally/);
  assert.match(source, /saveAuthToken\(refreshed\.data\)/);
  assert.match(source, /export async function requestBlob/);
});

test('requestJson refreshes once and retries a protected request after 401', async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let runCalls = 0;

  clearAuthToken();
  saveAuthToken(authToken);
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });

    if (url === '/api/auth/refresh') {
      return apiResponse(refreshedToken);
    }

    runCalls += 1;
    return runCalls === 1
      ? apiResponse(null, 401)
      : apiResponse({ ok: true });
  }) as typeof fetch;

  try {
    const response = await requestJson<ApiResponse<{ ok: boolean }>>('/runs/one', {
      idempotencyKey: 'idem-run-start-1',
    });

    assert.deepEqual(response.data, { ok: true });
    assert.equal(readAccessToken(), refreshedToken.accessToken);
    assert.equal(calls.length, 3);
    assert.equal(calls[0].url, '/api/runs/one');
    assert.equal(calls[0].init?.credentials, 'include');
    assert.equal(new Headers(calls[0].init?.headers).get('Authorization'), 'Bearer access-token');
    assert.equal(new Headers(calls[0].init?.headers).get('Idempotency-Key'), 'idem-run-start-1');
    assert.equal(calls[1].url, '/api/auth/refresh');
    assert.equal(calls[1].init?.credentials, 'include');
    assert.equal(calls[2].url, '/api/runs/one');
    assert.equal(new Headers(calls[2].init?.headers).get('Authorization'), 'Bearer fresh-access-token');
    assert.equal(new Headers(calls[2].init?.headers).get('Idempotency-Key'), 'idem-run-start-1');
  } finally {
    globalThis.fetch = originalFetch;
    clearAuthToken();
  }
});

test('requestJson shares one refresh call for concurrent protected 401 responses', async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  let runCalls = 0;

  clearAuthToken();
  saveAuthToken(authToken);
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);

    if (url === '/api/auth/refresh') {
      return apiResponse(refreshedToken);
    }

    runCalls += 1;
    return runCalls <= 2
      ? apiResponse(null, 401)
      : apiResponse({ ok: true });
  }) as typeof fetch;

  try {
    const responses = await Promise.all([
      requestJson<ApiResponse<{ ok: boolean }>>('/runs/one'),
      requestJson<ApiResponse<{ ok: boolean }>>('/runs/two'),
    ]);

    assert.deepEqual(responses.map((response) => response.data), [{ ok: true }, { ok: true }]);
    assert.equal(calls.filter((url) => url === '/api/auth/refresh').length, 1);
    assert.equal(readAccessToken(), refreshedToken.accessToken);
  } finally {
    globalThis.fetch = originalFetch;
    clearAuthToken();
  }
});

test('requestJson clears memory token when refresh fails and does not refresh public auth endpoints', async () => {
  const originalFetch = globalThis.fetch;
  const protectedCalls: string[] = [];

  clearAuthToken();
  saveAuthToken(authToken);
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    protectedCalls.push(url);
    return apiResponse(null, 401);
  }) as typeof fetch;

  try {
    await assert.rejects(() => requestJson<ApiResponse<null>>('/runs/one'), /Wedge API request failed: 401/);
    assert.equal(protectedCalls.filter((url) => url === '/api/auth/refresh').length, 1);
    assert.equal(readAccessToken(), null);
  } finally {
    globalThis.fetch = originalFetch;
    clearAuthToken();
  }

  const publicCalls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    publicCalls.push(String(input));
    return apiResponse(null, 401);
  }) as typeof fetch;

  try {
    await assert.rejects(() => requestJson<ApiResponse<null>>('/auth/login', { method: 'POST' }), /Wedge API request failed: 401/);
    assert.deepEqual(publicCalls, ['/api/auth/login']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test('requestBlob forwards bearer token for protected artifact content', async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];

  clearAuthToken();
  saveAuthToken(authToken);
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response('image-bytes', {
      status: 200,
      headers: { 'Content-Type': 'image/png' },
    });
  }) as typeof fetch;

  try {
    const blob = await requestBlob('/runs/run-1/artifacts/artifact-1/content');

    assert.equal(blob.type, 'image/png');
    assert.equal(calls[0].url, '/api/runs/run-1/artifacts/artifact-1/content');
    assert.equal(new Headers(calls[0].init?.headers).get('Authorization'), 'Bearer access-token');
    assert.equal(calls[0].init?.credentials, 'include');
  } finally {
    globalThis.fetch = originalFetch;
    clearAuthToken();
  }
});

test('requestBlob refreshes once and retries protected artifact content after 401', async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let artifactCalls = 0;

  clearAuthToken();
  saveAuthToken(authToken);
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });

    if (url === '/api/auth/refresh') {
      return apiResponse(refreshedToken);
    }

    artifactCalls += 1;
    return artifactCalls === 1
      ? apiResponse(null, 401)
      : new Response('image-bytes', {
          status: 200,
          headers: { 'Content-Type': 'image/png' },
        });
  }) as typeof fetch;

  try {
    const blob = await requestBlob('/runs/run-1/artifacts/artifact-1/content');

    assert.equal(blob.type, 'image/png');
    assert.equal(calls.length, 3);
    assert.equal(calls[0].url, '/api/runs/run-1/artifacts/artifact-1/content');
    assert.equal(new Headers(calls[0].init?.headers).get('Authorization'), 'Bearer access-token');
    assert.equal(calls[1].url, '/api/auth/refresh');
    assert.equal(calls[2].url, '/api/runs/run-1/artifacts/artifact-1/content');
    assert.equal(new Headers(calls[2].init?.headers).get('Authorization'), 'Bearer fresh-access-token');
  } finally {
    globalThis.fetch = originalFetch;
    clearAuthToken();
  }
});
