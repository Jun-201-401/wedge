import test from 'node:test';
import assert from 'node:assert/strict';

import { getSafeHttpUrl, getSafeResourceUrl } from '../../src/shared/lib/safeUrl';

test('getSafeHttpUrl only allows absolute http and https URLs', () => {
  assert.equal(getSafeHttpUrl('https://example.com/path'), 'https://example.com/path');
  assert.equal(getSafeHttpUrl('http://example.com/path'), 'http://example.com/path');
  assert.equal(getSafeHttpUrl('javascript:alert(1)'), '');
  assert.equal(getSafeHttpUrl('data:text/html,hello'), '');
  assert.equal(getSafeHttpUrl('/api/runs/1'), '');
});

test('getSafeResourceUrl allows same-origin resource paths and safe absolute URLs', () => {
  assert.equal(getSafeResourceUrl('/api/runs/1/artifacts/2/content'), '/api/runs/1/artifacts/2/content');
  assert.equal(getSafeResourceUrl('https://cdn.example.com/a.png'), 'https://cdn.example.com/a.png');
  assert.equal(getSafeResourceUrl('//evil.example.com/a.png'), '');
  assert.equal(getSafeResourceUrl('javascript:alert(1)'), '');
  assert.equal(getSafeResourceUrl(null), '');
});
