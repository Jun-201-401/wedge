import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('web api client forwards stored bearer token when available', () => {
  const source = fs.readFileSync(new URL('../../src/api/http.ts', import.meta.url), 'utf8');

  assert.match(source, /window\.localStorage\.getItem\('wedge\.accessToken'\)/);
  assert.match(source, /window\.localStorage\.getItem\('accessToken'\)/);
  assert.match(source, /requestHeaders\.set\('Authorization', `Bearer \$\{accessToken\}`\)/);
  assert.match(source, /!requestHeaders\.has\('Authorization'\)/);
});
