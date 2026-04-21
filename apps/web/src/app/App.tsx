import { useEffect, useState } from 'react';

import { CreateAnalysisPage } from '../pages/create-analysis';
import { LandingPage } from '../pages/landing';
import { pages } from '../pages';

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

  if (currentPath === pages.createAnalysis.path) {
    return <CreateAnalysisPage />;
  }

  return <LandingPage />;
}
