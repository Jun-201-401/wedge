import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('app bootstraps memory auth from refresh cookie and shares auth state with routes', () => {
  const app = fs.readFileSync(new URL('../../src/app/App.tsx', import.meta.url), 'utf8');
  const landing = fs.readFileSync(new URL('../../src/pages/landing/LandingPage.tsx', import.meta.url), 'utf8');
  const navigation = fs.readFileSync(new URL('../../src/shared/lib/navigation.ts', import.meta.url), 'utf8');

  assert.match(app, /import \{ ensureAuthSession \} from '..\/api\/auth'/);
  assert.match(app, /type AuthState = 'checking' \| 'authenticated' \| 'anonymous'/);
  assert.match(app, /ensureAuthSession\(\)\.then/);
  assert.match(app, /setAuthState\(isAuthenticated \? 'authenticated' : 'anonymous'\)/);
  assert.match(app, /<LoginPage isAuthenticated=\{isAuthenticated\} onAuthenticated=\{markAuthenticated\}/);
  assert.match(app, /<SignupPage isAuthenticated=\{isAuthenticated\} onAuthenticated=\{markAuthenticated\}/);
  assert.match(app, /const isAuthChecking = authState === 'checking'/);
  assert.match(app, /<LandingPage isAuthenticated=\{isAuthenticated\} isAuthChecking=\{isAuthChecking\}/);

  assert.match(landing, /interface LandingPageProps/);
  assert.match(landing, /!isAuthenticated && !isAuthChecking \? <a href=\{LOGIN_PATH\}>Login<\/a> : null/);
  assert.match(navigation, /window\.history\.replaceState\(null, '', path\)/);
  assert.match(navigation, /window\.dispatchEvent\(new PopStateEvent\('popstate'\)\)/);
});
