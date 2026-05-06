export * from './auth';
export * from './discovery';
export * from './report';
export * from './run';

export const entities = {
  auth: 'auth',
  discovery: 'discovery',
  report: 'report',
  run: 'run',
} as const;
