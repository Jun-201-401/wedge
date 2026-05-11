export * from './auth';
export * from './discovery';
export * from './report';
export * from './run';
export * from './scenario-authoring';

export const entities = {
  auth: 'auth',
  discovery: 'discovery',
  report: 'report',
  run: 'run',
  scenarioAuthoring: 'scenario-authoring',
} as const;
