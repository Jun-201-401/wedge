import { useCallback, useEffect, useState } from 'react';

import { ensureAuthSession, getCurrentUser, logout } from '../api/auth';
import { readCurrentUser, saveCurrentUser } from '../api/authSession';
import type { User } from '../entities';
import { CreateAnalysisPage, LandingPage, LoginPage, RunMonitorPage, RunReportPage, RunsListPage, SignupPage } from '../pages';
import { HOME_PATH } from '../shared/lib/appPaths';
import { replaceAppPath } from '../shared/lib/navigation';
import { resolveAppRoute, resolveProtectedRouteGate, type AppAuthState } from './appRoute';
import './App.css';

const PROTECTED_ROUTE_LOADING_DELAY_MS = 220;

function getCurrentPath() {
  return window.location.pathname;
}

function useDelayedProtectedRouteLoading(isLoading: boolean) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (!isLoading) {
      setIsVisible(false);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setIsVisible(true);
    }, PROTECTED_ROUTE_LOADING_DELAY_MS);

    return () => window.clearTimeout(timeoutId);
  }, [isLoading]);

  return isVisible;
}

function ProtectedRouteLoadingPage() {
  return (
    <main className="app-route-loading" aria-labelledby="app-route-loading-title">
      <section className="app-route-loading__card" role="status" aria-live="polite">
        <span className="app-route-loading__eyebrow">
          <span className="app-route-loading__dot" aria-hidden="true" />
          Session check
        </span>
        <h1 id="app-route-loading-title">접근 권한을 확인하고 있습니다</h1>
        <p>Run 화면을 열기 전에 로그인 세션을 확인하는 중입니다.</p>
      </section>
    </main>
  );
}

export function App() {
  const [currentPath, setCurrentPath] = useState(getCurrentPath);
  const [authState, setAuthState] = useState<AppAuthState>('checking');
  const [currentUser, setCurrentUser] = useState<User | null>(null);

  useEffect(() => {
    const handlePopState = () => setCurrentPath(getCurrentPath());

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    let isCancelled = false;

    ensureAuthSession().then(async (isAuthenticated) => {
      if (!isAuthenticated) {
        if (!isCancelled) {
          setCurrentUser(null);
          setAuthState('anonymous');
        }
        return;
      }

      try {
        const response = await getCurrentUser();
        saveCurrentUser(response.data);
        if (!isCancelled) {
          setCurrentUser(response.data);
          setAuthState('authenticated');
        }
      } catch {
        const cachedUser = readCurrentUser();
        if (!isCancelled) {
          setCurrentUser(cachedUser);
          setAuthState(cachedUser ? 'authenticated' : 'anonymous');
        }
      }
    });

    return () => {
      isCancelled = true;
    };
  }, []);

  const markAuthenticated = useCallback(() => {
    setCurrentUser(readCurrentUser());
    setAuthState('authenticated');
  }, []);

  const handleLogout = useCallback(async () => {
    try {
      await logout();
    } finally {
      setCurrentUser(null);
      setAuthState('anonymous');
      replaceAppPath(HOME_PATH);
    }
  }, []);

  const route = resolveAppRoute(currentPath);
  const isAuthenticated = authState === 'authenticated';
  const isAuthChecking = authState === 'checking';
  const protectedRouteGate = resolveProtectedRouteGate(route, authState);
  const shouldShowProtectedRouteLoading = useDelayedProtectedRouteLoading(protectedRouteGate === 'loading');
  const createAnalysisPage = (
    <CreateAnalysisPage
      isAuthenticated={isAuthenticated}
      isAuthChecking={isAuthChecking}
      onLogout={handleLogout}
    />
  );

  useEffect(() => {
    if (protectedRouteGate === 'blocked') {
      replaceAppPath(HOME_PATH);
    }
  }, [protectedRouteGate]);

  if (protectedRouteGate === 'loading') {
    return shouldShowProtectedRouteLoading ? <ProtectedRouteLoadingPage /> : null;
  }

  if (protectedRouteGate === 'blocked') {
    return null;
  }

  if (route.kind === 'run-report') {
    return <RunReportPage runId={route.runId} />;
  }

  if (route.kind === 'run-monitor') {
    return <RunMonitorPage runId={route.runId} />;
  }

  if (route.kind === 'login') {
    return <LoginPage isAuthenticated={isAuthenticated} onAuthenticated={markAuthenticated} />;
  }

  if (route.kind === 'signup') {
    return <SignupPage isAuthenticated={isAuthenticated} onAuthenticated={markAuthenticated} />;
  }

  if (route.kind === 'create-analysis') {
    return createAnalysisPage;
  }

  if (route.kind === 'runs-list') {
    return <RunsListPage currentUser={currentUser} onLogout={handleLogout} />;
  }

  return <LandingPage />;
}
