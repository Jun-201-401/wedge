import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { createAuthenticatedResourceCache } from '../../src/shared/lib/authenticatedResourceCache';

function imageBlob(bytes: number) {
  return new Blob([new Uint8Array(bytes)], { type: 'image/png' });
}

test('authenticated resource cache shares pending requests and reuses object URLs', async () => {
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  const requestedUrls: string[] = [];

  URL.createObjectURL = ((blob: Blob) => `blob:cached-${blob.size}`) as typeof URL.createObjectURL;
  URL.revokeObjectURL = (() => undefined) as typeof URL.revokeObjectURL;

  const cache = createAuthenticatedResourceCache({
    maxEntries: 3,
    maxBytes: 10_000,
    fetchBlob: async (url) => {
      requestedUrls.push(url);
      return imageBlob(123);
    },
  });

  try {
    const [first, second] = await Promise.all([
      cache.resolve('/runs/run-1/artifacts/a/content'),
      cache.resolve('/runs/run-1/artifacts/a/content'),
    ]);

    assert.equal(first, 'blob:cached-123');
    assert.equal(second, first);
    assert.deepEqual(requestedUrls, ['/runs/run-1/artifacts/a/content']);
    assert.equal(cache.get('/runs/run-1/artifacts/a/content'), first);
  } finally {
    cache.clear();
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  }
});

test('authenticated resource cache evicts least recently used entries by maxEntries', async () => {
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  const revokedUrls: string[] = [];
  let objectUrlIndex = 0;

  URL.createObjectURL = (() => `blob:entry-${++objectUrlIndex}`) as typeof URL.createObjectURL;
  URL.revokeObjectURL = ((url: string) => {
    revokedUrls.push(url);
  }) as typeof URL.revokeObjectURL;

  const cache = createAuthenticatedResourceCache({
    maxEntries: 2,
    maxBytes: 10_000,
    fetchBlob: async () => imageBlob(100),
  });

  try {
    const first = await cache.resolve('/runs/run-1/artifacts/a/content');
    const second = await cache.resolve('/runs/run-1/artifacts/b/content');
    assert.equal(cache.get('/runs/run-1/artifacts/a/content'), first);

    const third = await cache.resolve('/runs/run-1/artifacts/c/content');

    assert.equal(second, 'blob:entry-2');
    assert.equal(third, 'blob:entry-3');
    assert.equal(cache.get('/runs/run-1/artifacts/a/content'), first);
    assert.equal(cache.get('/runs/run-1/artifacts/b/content'), null);
    assert.deepEqual(revokedUrls, [second]);
  } finally {
    cache.clear();
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  }
});

test('authenticated resource cache evicts old entries by maxBytes', async () => {
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  const revokedUrls: string[] = [];
  let objectUrlIndex = 0;

  URL.createObjectURL = (() => `blob:bytes-${++objectUrlIndex}`) as typeof URL.createObjectURL;
  URL.revokeObjectURL = ((url: string) => {
    revokedUrls.push(url);
  }) as typeof URL.revokeObjectURL;

  const sizes = new Map([
    ['/runs/run-1/artifacts/a/content', 60],
    ['/runs/run-1/artifacts/b/content', 60],
  ]);
  const cache = createAuthenticatedResourceCache({
    maxEntries: 3,
    maxBytes: 100,
    fetchBlob: async (url) => imageBlob(sizes.get(url) ?? 10),
  });

  try {
    const first = await cache.resolve('/runs/run-1/artifacts/a/content');
    const second = await cache.resolve('/runs/run-1/artifacts/b/content');

    assert.equal(first, 'blob:bytes-1');
    assert.equal(second, 'blob:bytes-2');
    assert.equal(cache.get('/runs/run-1/artifacts/a/content'), null);
    assert.equal(cache.get('/runs/run-1/artifacts/b/content'), second);
    assert.deepEqual(revokedUrls, [first]);
  } finally {
    cache.clear();
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  }
});

test('authenticated resource cache clear revokes all ready object URLs', async () => {
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  const revokedUrls: string[] = [];
  let objectUrlIndex = 0;

  URL.createObjectURL = (() => `blob:clear-${++objectUrlIndex}`) as typeof URL.createObjectURL;
  URL.revokeObjectURL = ((url: string) => {
    revokedUrls.push(url);
  }) as typeof URL.revokeObjectURL;

  const cache = createAuthenticatedResourceCache({
    maxEntries: 3,
    maxBytes: 10_000,
    fetchBlob: async () => imageBlob(100),
  });

  try {
    const first = await cache.resolve('/runs/run-1/artifacts/a/content');
    const second = await cache.resolve('/runs/run-1/artifacts/b/content');

    cache.clear();

    assert.deepEqual(revokedUrls, [first, second]);
    assert.equal(cache.get('/runs/run-1/artifacts/a/content'), null);
    assert.equal(cache.get('/runs/run-1/artifacts/b/content'), null);
  } finally {
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  }
});

test('authenticated resource cache does not keep failed requests', async () => {
  const cache = createAuthenticatedResourceCache({
    maxEntries: 3,
    maxBytes: 10_000,
    fetchBlob: async () => {
      throw new Error('network failed');
    },
  });

  await assert.rejects(() => cache.resolve('/runs/run-1/artifacts/a/content'), /network failed/);

  assert.equal(cache.get('/runs/run-1/artifacts/a/content'), null);
});

test('authenticated resource cache drops pending results after clear', async () => {
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  let createObjectUrlCalls = 0;
  let resolveBlob!: (blob: Blob) => void;

  URL.createObjectURL = (() => {
    createObjectUrlCalls += 1;
    return 'blob:stale';
  }) as typeof URL.createObjectURL;
  URL.revokeObjectURL = (() => undefined) as typeof URL.revokeObjectURL;

  const cache = createAuthenticatedResourceCache({
    maxEntries: 3,
    maxBytes: 10_000,
    fetchBlob: () => new Promise<Blob>((resolve) => {
      resolveBlob = resolve;
    }),
  });

  try {
    const pending = cache.resolve('/runs/run-1/artifacts/a/content');
    cache.clear();
    resolveBlob(imageBlob(100));

    await assert.rejects(() => pending, /cleared/);
    assert.equal(createObjectUrlCalls, 0);
    assert.equal(cache.get('/runs/run-1/artifacts/a/content'), null);
  } finally {
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  }
});

test('authenticated resource hook can resolve protected image urls through a scoped cache', () => {
  const source = fs.readFileSync(
    new URL('../../src/shared/lib/authenticatedResourceUrl.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /AuthenticatedResourceCache/);
  assert.match(source, /cache\?\.get\(apiPath\)/);
  assert.match(source, /cache\.resolve\(apiPath\)/);
  assert.match(source, /const cachedUrl = cache\?\.get\(apiPath\)/);
});
