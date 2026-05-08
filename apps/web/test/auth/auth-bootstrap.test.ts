import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('app bootstraps memory auth from refresh cookie and shares auth state with routes', () => {
  const app = fs.readFileSync(new URL('../../src/app/App.tsx', import.meta.url), 'utf8');
  const landing = fs.readFileSync(new URL('../../src/pages/landing/LandingPage.tsx', import.meta.url), 'utf8');
  const createAnalysis = fs.readFileSync(new URL('../../src/pages/create-analysis/CreateAnalysisPage.tsx', import.meta.url), 'utf8');
  const appCss = fs.readFileSync(new URL('../../src/app/App.css', import.meta.url), 'utf8');
  const navigation = fs.readFileSync(new URL('../../src/shared/lib/navigation.ts', import.meta.url), 'utf8');
  const globals = fs.readFileSync(new URL('../../src/app/styles/globals.css', import.meta.url), 'utf8');

  assert.match(app, /import \{ ensureAuthSession, getCurrentUser, logout \} from '..\/api\/auth'/);
  assert.match(app, /type AppAuthState/);
  assert.match(app, /ensureAuthSession\(\)\.then/);
  assert.match(app, /getCurrentUser\(\)/);
  assert.match(app, /readCurrentUser\(\)/);
  assert.match(app, /setCurrentUser\(response\.data\)/);
  assert.match(app, /await logout\(\)/);
  assert.match(app, /replaceAppPath\('\/'\)/);
  assert.match(app, /<LoginPage isAuthenticated=\{isAuthenticated\} onAuthenticated=\{markAuthenticated\}/);
  assert.match(app, /<SignupPage isAuthenticated=\{isAuthenticated\} onAuthenticated=\{markAuthenticated\}/);
  assert.match(app, /const isAuthChecking = authState === 'checking'/);
  assert.match(app, /resolveProtectedRouteGate\(route, authState\)/);
  assert.match(app, /const PROTECTED_ROUTE_LOADING_DELAY_MS = 220/);
  assert.match(app, /function useDelayedProtectedRouteLoading\(isLoading: boolean\)/);
  assert.match(app, /window\.setTimeout\([\s\S]*PROTECTED_ROUTE_LOADING_DELAY_MS/);
  assert.match(app, /window\.clearTimeout\(timeoutId\)/);
  assert.match(app, /function ProtectedRouteLoadingPage/);
  assert.match(app, /const shouldShowProtectedRouteLoading = useDelayedProtectedRouteLoading\(protectedRouteGate === 'loading'\)/);
  assert.match(app, /if \(protectedRouteGate === 'loading'\) \{[\s\S]*?shouldShowProtectedRouteLoading \? <ProtectedRouteLoadingPage \/> : null/);
  assert.match(app, /if \(protectedRouteGate === 'blocked'\)/);
  assert.match(app, /onLogout=\{handleCreateAnalysisLogout\}/);
  assert.match(app, /<RunsListPage currentUser=\{currentUser\} onLogout=\{handleLogout\} \/>/);

  assert.doesNotMatch(landing, /LOGIN_PATH/);
  assert.doesNotMatch(landing, />Login<\/a>/);
  assert.doesNotMatch(landing, />Logout<\/button>/);
  assert.match(createAnalysis, /interface CreateAnalysisPageProps/);
  assert.match(createAnalysis, /!isAuthenticated && !isAuthChecking \? \(\s*<a href=\{getLoginPathForCurrentCreateAnalysisState\(\)\}>Login<\/a>/);
  assert.match(createAnalysis, /isAuthenticated && onLogout \? \(\s*<button type="button" onClick=\{onLogout\}>Logout<\/button>/);
  assert.match(appCss, /\.app-route-loading\s*\{[\s\S]*?background: #fff/);
  assert.match(globals, /body \{[\s\S]*?background: #fff/);
  assert.match(globals, /#root \{[\s\S]*?background: #fff/);
  assert.match(navigation, /window\.history\.replaceState\(null, '', path\)/);
  assert.match(navigation, /window\.dispatchEvent\(new PopStateEvent\('popstate'\)\)/);
});
