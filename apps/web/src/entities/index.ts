export * from './auth';
export * from './report';
export * from './run';

export const entities = {
  auth: 'auth',
  report: 'report',
  run: 'run',
} as const;
