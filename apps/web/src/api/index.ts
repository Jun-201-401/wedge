export * from './auth';
export * from './authSession';
export * from './http';
export * from './discoveries';
export * from './reports';
export * from './runs';
export * from './scenario-authoring';

import { authApi } from './auth';
import { discoveriesApi } from './discoveries';
import { reportsApi } from './reports';
import { runsApi } from './runs';
import { scenarioAuthoringApi } from './scenario-authoring';

export const api = {
  auth: authApi,
  discoveries: discoveriesApi,
  reports: reportsApi,
  runs: runsApi,
  scenarioAuthoring: scenarioAuthoringApi,
} as const;
