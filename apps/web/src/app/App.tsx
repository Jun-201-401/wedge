import { useCallback, useEffect, useState } from 'react';

import { ensureAuthSession } from '../api/auth';
import { LoginPage, SignupPage } from '../pages/auth';
import { CreateAnalysisPage } from '../pages/create-analysis';
import { LandingPage } from '../pages/landing';
import { RunMonitorPage, RunReportPage } from '../pages';
import { resolveAppRoute } from './appRoute';

function getCurrentPath() {
  return window.location.pathname;
}

type AuthState = 'checking' | 'authenticated' | 'anonymous';

export function App() {
  const [currentPath, setCurrentPath] = useState(getCurrentPath);
  const [authState, setAuthState] = useState<AuthState>('checking');

  useEffect(() => {
    const handlePopState = () => setCurrentPath(getCurrentPath());

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    let isCancelled = false;

    ensureAuthSession().then((isAuthenticated) => {
      if (!isCancelled) {
        setAuthState(isAuthenticated ? 'authenticated' : 'anonymous');
      }
    });

    return () => {
      isCancelled = true;
    };
  }, []);

  const markAuthenticated = useCallback(() => {
    setAuthState('authenticated');
  }, []);

  const route = resolveAppRoute(currentPath);
  const isAuthenticated = authState === 'authenticated';
  const isAuthChecking = authState === 'checking';

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

  return <LandingPage isAuthenticated={isAuthenticated} isAuthChecking={isAuthChecking} />;
}
