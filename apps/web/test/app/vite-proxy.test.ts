import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('vite dev proxy defaults to the same local API server and keeps explicit overrides', () => {
  const source = fs.readFileSync(new URL('../../vite.config.ts', import.meta.url), 'utf8');

  assert.match(source, /const defaultApiProxyTarget = 'http:\/\/localhost:8080'/);
  assert.match(source, /process\.env\.VITE_API_PROXY_TARGET \?\? defaultApiProxyTarget/);
  assert.doesNotMatch(source, /runsInWsl \? 'http:\/\/host\.docker\.internal:8080'/);
});
