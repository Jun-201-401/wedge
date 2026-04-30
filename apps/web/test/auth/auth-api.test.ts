import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('auth api mirrors cookie-backed Spring auth endpoints and stores no refresh token', () => {
  const source = fs.readFileSync(new URL('../../src/api/auth.ts', import.meta.url), 'utf8');
  const model = fs.readFileSync(new URL('../../src/entities/auth/model.ts', import.meta.url), 'utf8');
  const session = fs.readFileSync(new URL('../../src/api/authSession.ts', import.meta.url), 'utf8');
  const contract = fs.readFileSync(new URL('../../../../packages/contracts/openapi/wedge_openapi.yaml', import.meta.url), 'utf8');

  assert.match(source, /requestAuthToken\('\/auth\/signup'/);
  assert.match(source, /requestAuthToken\('\/auth\/login'/);
  assert.match(source, /requestAuthToken\('\/auth\/refresh', \{\n\s+\.\.\.options,\n\s+method: 'POST',\n\s+\}\)/);
  assert.doesNotMatch(source, /RefreshRequest/);
  assert.doesNotMatch(source, /refreshToken:\s*string/);
  assert.match(source, /function requestAuthToken/);
  assert.match(source, /saveAuthToken\(response\.data\)/);
  assert.match(source, /export async function ensureAuthSession/);
  assert.match(source, /readAccessToken\(\)/);
  assert.match(source, /refreshToken\(options\)/);
  assert.match(source, /ensureAuthSessionPromise \?\?= refreshToken\(options\)/);
  assert.doesNotMatch(source, /saveIssuedAuthToken/);
  assert.doesNotMatch(model, /refreshToken:\s*string/);
  assert.doesNotMatch(session, /setItem\([^\n]*AUTH_REFRESH_TOKEN_STORAGE_KEY/);
  assert.match(session, /removeStorageItem\(storage, AUTH_REFRESH_TOKEN_STORAGE_KEY\)/);
  assert.match(contract, /summary: Rotate refresh cookie and issue a new access token/);
  assert.match(contract, /name: wedge_refresh_token/);
  assert.match(contract, /in: cookie/);
  assert.match(contract, /Path=\/api\/auth/);
  assert.doesNotMatch(contract, /RefreshRequest:/);
});
