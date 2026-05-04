export * from './auth';
export * from './authSession';
export * from './http';
export * from './reports';
export * from './runs';

import { authApi } from './auth';
import { reportsApi } from './reports';
import { runsApi } from './runs';

export const api = {
  auth: authApi,
  reports: reportsApi,
  runs: runsApi,
} as const;
