import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('login page uses the auth card design and calls login', () => {
  const source = fs.readFileSync(new URL('../../src/pages/auth/LoginPage.tsx', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../../src/pages/auth/AuthPage.css', import.meta.url), 'utf8');

  assert.match(source, /import \{ login \} from '..\/..\/api\/auth'/);
  assert.match(source, /import \{ replaceAppPath \} from '..\/..\/shared\/lib\/navigation'/);
  assert.match(source, /className="auth-page"/);
  assert.match(source, /className="auth-card"/);
  assert.match(source, /className="auth-card__title" id="login-title">Wedge/);
  assert.doesNotMatch(source, /auth-card__brand/);
  assert.doesNotMatch(source, /auth-card__wedge-badge/);
  assert.doesNotMatch(source, /Account access/);
  assert.doesNotMatch(source, /다시 Wedge로 이어서 시작하기/);
  assert.doesNotMatch(source, /Wedge 계정으로 로그인합니다/);
  assert.doesNotMatch(source, /발급된 access token/);
  assert.match(source, /type="email"/);
  assert.match(source, /autoComplete="current-password"/);
  assert.match(source, /await login\(\{ email: email\.trim\(\), password \}\)/);
  assert.match(source, /getSafeAuthRedirectPath\(window\.location\.search, window\.location\.origin\)/);
  assert.match(source, /onAuthenticated\?\.\(\)/);
  assert.match(source, /replaceAppPath\(redirectPath\)/);
  assert.doesNotMatch(source, /window\.location\.assign\(redirectPath\)/);
  assert.match(source, /href=\{SIGNUP_PATH\}/);

  assert.match(css, /\.auth-page::before/);
  assert.match(css, /\.auth-card\s*\{[\s\S]*?border-radius: 1\.75rem/);
  assert.match(css, /\.auth-card__title\s*\{[\s\S]*?color: #7dd3fc/);
  assert.match(css, /\.auth-card__submit\s*\{[\s\S]*?background: #334155/);
  assert.match(css, /\.auth-card__submit:disabled\s*\{[^}]*cursor: not-allowed/);
  assert.doesNotMatch(css, /\.auth-card__submit:disabled\s*\{[^}]*opacity/);
  assert.match(css, /font-family: 'Pretendard Variable', Pretendard, 'Inter', sans-serif/);
});

test('signup page validates account fields and calls signup', () => {
  const source = fs.readFileSync(new URL('../../src/pages/auth/SignupPage.tsx', import.meta.url), 'utf8');

  assert.match(source, /import \{ signup \} from '..\/..\/api\/auth'/);
  assert.match(source, /import \{ replaceAppPath \} from '..\/..\/shared\/lib\/navigation'/);
  assert.match(source, /className="auth-card__title" id="signup-title">Wedge/);
  assert.doesNotMatch(source, /auth-card__brand/);
  assert.doesNotMatch(source, /Create account/);
  assert.doesNotMatch(source, /Wedge 계정 만들기/);
  assert.doesNotMatch(source, /새 Wedge 계정을 만듭니다/);
  assert.doesNotMatch(source, /발급된 토큰/);
  assert.match(source, /name="displayName"/);
  assert.match(source, /minLength=\{2\}/);
  assert.match(source, /maxLength=\{120\}/);
  assert.match(source, /minLength=\{8\}/);
  assert.match(source, /maxLength=\{100\}/);
  assert.match(source, /await signup\(\{ displayName: displayName\.trim\(\), email: email\.trim\(\), password \}\)/);
  assert.match(source, /onAuthenticated\?\.\(\)/);
  assert.match(source, /replaceAppPath\(redirectPath\)/);
  assert.match(source, /href=\{LOGIN_PATH\}/);
});
