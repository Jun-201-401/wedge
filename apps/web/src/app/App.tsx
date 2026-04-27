import { useEffect, useState } from 'react';

import { CreateAnalysisPage } from '../pages/create-analysis';
import { LandingPage } from '../pages/landing';
import { RunMonitorPage, pages } from '../pages';
import { getRunIdFromPath } from '../pages/run-monitor/lib/runMonitorRoute';

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

  const runId = getRunIdFromPath(currentPath);

  if (runId) {
    return <RunMonitorPage runId={runId} />;
  }

  if (currentPath === pages.createAnalysis.path) {
    return <CreateAnalysisPage />;
  }

  return <LandingPage />;
}
