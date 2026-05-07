import test from 'node:test';
import assert from 'node:assert/strict';

import { createDiscoveryIdempotencyKey, isDiscoveryBusy } from '../../src/pages/create-analysis/lib/discoveryPreflight';

const projectId = '8f06dca8-9c4d-4f20-b1a8-1d5ee40a9923';

test('createDiscoveryIdempotencyKey creates a fresh bounded key for each explicit discovery submit', () => {
  const firstKey = createDiscoveryIdempotencyKey(projectId, 'https://example.com/pricing?utm=demo');
  const secondKey = createDiscoveryIdempotencyKey(projectId, 'https://example.com/pricing?utm=demo');
  const otherUrlKey = createDiscoveryIdempotencyKey(projectId, 'https://example.com/contact');

  assert.notEqual(firstKey, secondKey);
  assert.notEqual(firstKey, otherUrlKey);
  assert.ok(firstKey.length <= 160);
  assert.match(firstKey, /^create-analysis-discovery:/);
});

test('isDiscoveryBusy gates duplicate create requests while discovery is active', () => {
  assert.equal(isDiscoveryBusy('creating'), true);
  assert.equal(isDiscoveryBusy('polling'), true);
  assert.equal(isDiscoveryBusy('completed'), false);
  assert.equal(isDiscoveryBusy('failed'), false);
});
