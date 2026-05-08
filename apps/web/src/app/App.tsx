import { useCallback, useEffect, useState } from 'react';

import { ensureAuthSession, getCurrentUser, logout } from '../api/auth';
import { readCurrentUser, saveCurrentUser } from '../api/authSession';
import type { User } from '../entities';
import { CreateAnalysisPage, LandingPage, LoginPage, RunMonitorPage, RunReportPage, RunsListPage, SignupPage } from '../pages';
import { replaceAppPath } from '../shared/lib/navigation';
import { resolveAppRoute } from './appRoute';

function getCurrentPath() {
  return window.location.pathname;
}

type AuthState = 'checking' | 'authenticated' | 'anonymous';

export function App() {
  const [currentPath, setCurrentPath] = useState(getCurrentPath);
  const [authState, setAuthState] = useState<AuthState>('checking');
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
      replaceAppPath('/');
    }
  }, []);

  const route = resolveAppRoute(currentPath);
  const isAuthenticated = authState === 'authenticated';
  const isAuthChecking = authState === 'checking';
  const isRealRunRoute = (route.kind === 'run-report' || route.kind === 'run-monitor') && !route.runId.startsWith('mock-');
  const isProtectedRoute = isRealRunRoute || route.kind === 'runs-list';

  if (isProtectedRoute && !isAuthenticated) {
    return (
      <LandingPage
        isAuthenticated={false}
        isAuthChecking={isAuthChecking}
        onLogout={handleLogout}
      />
    );
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
    return <CreateAnalysisPage />;
  }

  if (route.kind === 'runs-list') {
    return <RunsListPage currentUser={currentUser} onLogout={handleLogout} />;
  }

  return (
    <LandingPage
      isAuthenticated={isAuthenticated}
      isAuthChecking={isAuthChecking}
      onLogout={handleLogout}
    />
  );
}
