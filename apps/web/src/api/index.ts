export * from './auth';
export * from './authSession';
export * from './http';
export * from './discoveries';
export * from './reports';
export * from './runs';

import { authApi } from './auth';
import { discoveriesApi } from './discoveries';
import { reportsApi } from './reports';
import { runsApi } from './runs';

export const api = {
  auth: authApi,
  discoveries: discoveriesApi,
  reports: reportsApi,
  runs: runsApi,
} as const;
