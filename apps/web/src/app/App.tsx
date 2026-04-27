import { useEffect, useState } from 'react';

import { CreateAnalysisPage } from '../pages/create-analysis';
import { LandingPage } from '../pages/landing';
import { RunMonitorPage, RunReportPage } from '../pages';
import { resolveAppRoute } from './appRoute';

function getCurrentPath() {
  return window.location.pathname;
}

export function App() {
  const [currentPath, setCurrentPath] = useState(getCurrentPath);

  useEffect(() => {
    const handlePopState = () => setCurrentPath(getCurrentPath());

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const route = resolveAppRoute(currentPath);

  if (route.kind === 'run-report') {
    return <RunReportPage runId={route.runId} />;
  }

  if (route.kind === 'run-monitor') {
    return <RunMonitorPage runId={route.runId} />;
  }

  if (route.kind === 'create-analysis') {
    return <CreateAnalysisPage />;
  }

  return <LandingPage />;
}
