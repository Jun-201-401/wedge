export { CreateAnalysisPage } from './create-analysis';
export { LandingPage } from './landing';

export const pages = {
  createAnalysis: {
    id: 'create-analysis',
    path: '/create-analysis',
  },
  home: {
    id: 'landing',
    path: '/',
  },
} as const;
