import type { ScenarioAuthoringCandidate, ScenarioAuthoringJob } from '../../../entities/scenario-authoring';

const AUTHORABLE_SCENARIO_TYPES = new Set([
  'LANDING_CTA',
  'SIGNUP_LEAD_FORM',
  'PRICING',
  'PURCHASE_CHECKOUT',
  'CONTACT',
  'CONTENT_ONLY',
]);

export function createScenarioAuthoringIdempotencyKey(projectId: string, sourceDiscoveryId: string, scenarioType: string, depthId: string) {
  return `scenario-authoring:${projectId}:${sourceDiscoveryId}:${scenarioType}:${depthId}`.slice(0, 160);
}

export function selectScenarioAuthoringCandidate(job: ScenarioAuthoringJob): ScenarioAuthoringCandidate | null {
  return job.candidates.find((candidate) =>
    candidate.validation.schema_valid
      && candidate.validation.safety_valid
      && candidate.validation.fit_requirements_valid,
  ) ?? null;
}

export function readScenarioPlanString(scenarioPlan: Record<string, unknown>, key: string) {
  const value = scenarioPlan[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

export function requireConfirmedScenarioPlanStartUrl(scenarioPlan: Record<string, unknown>) {
  const startUrl = readScenarioPlanString(scenarioPlan, 'start_url');
  if (!startUrl) {
    throw new Error('Confirmed ScenarioPlan is missing start_url.');
  }
  return startUrl;
}

export function isScenarioAuthoringSupportedType(scenarioType: string) {
  return AUTHORABLE_SCENARIO_TYPES.has(scenarioType);
}
