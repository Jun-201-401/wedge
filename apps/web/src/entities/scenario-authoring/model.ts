import type { DiscoveryScenarioType, ScenarioRecommendationLevel } from '../discovery';

export type ScenarioAuthoringStatus = 'CREATED' | 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELED' | 'EXPIRED';

export type ScenarioAuthoringProviderType =
  | 'CODEX'
  | 'CLAUDE_CODE'
  | 'INTERNAL_LLM'
  | 'RULE_BASED'
  | 'SERVICE_ACCOUNT'
  | 'OTHER';

export interface ScenarioAuthoringProviderPolicyRequest {
  providerOrder?: ScenarioAuthoringProviderType[];
  timeoutMs?: number;
  fallbackAllowed?: boolean;
  approvalRequired?: boolean;
}

export interface ScenarioAuthoringSelectedRecommendation {
  recommendationId?: string | null;
  scenarioType: DiscoveryScenarioType;
  recommendationLevel: ScenarioRecommendationLevel;
  confidence: number;
  evidenceRefs: string[];
  suggestedStartUrl?: string | null;
  suggestedTarget?: Record<string, unknown> | null;
}

export interface ScenarioAuthoringJobCreateRequest {
  projectId: string;
  sourceDiscoveryId: string;
  selectedRecommendationId?: string | null;
  requestedGoal: string;
  preferredScenarioType?: DiscoveryScenarioType;
  selectedRecommendation?: ScenarioAuthoringSelectedRecommendation | null;
  constraints?: Record<string, unknown>;
  providerPolicy?: ScenarioAuthoringProviderPolicyRequest;
}

export interface ScenarioAuthoringConfirmRequest {
  candidateId: string;
}

export interface ScenarioAuthoringValidationIssue {
  code: string;
  message: string;
  path?: string | null;
  evidence_refs?: string[];
}

export interface ScenarioAuthoringValidation {
  schema_valid: boolean;
  safety_valid: boolean;
  fit_requirements_valid: boolean;
  errors: ScenarioAuthoringValidationIssue[];
  warnings: ScenarioAuthoringValidationIssue[];
}

export interface ScenarioAuthoringProviderTraceEntry {
  provider_type: ScenarioAuthoringProviderType;
  provider_name: string;
  provider_version?: string | null;
  model_or_agent?: string | null;
  status: 'STARTED' | 'SUCCEEDED' | 'FAILED' | 'TIMED_OUT' | 'SKIPPED';
  confidence?: number | null;
  fallback_reason?: string | null;
  started_at: string;
  finished_at?: string | null;
}

export interface ScenarioAuthoringCandidate {
  candidate_id: string;
  scenario_plan: Record<string, unknown>;
  confidence: number;
  rationale: string;
  evidence_refs: string[];
  source_recommendation_refs?: string[];
  validation: ScenarioAuthoringValidation;
}

export interface ScenarioAuthoringJob {
  schemaVersion: '0.5';
  authoringJobId: string;
  status: ScenarioAuthoringStatus;
  projectId: string;
  sourceDiscoveryId: string;
  correlationId?: string | null;
  candidateCount: number;
  providerOrder: ScenarioAuthoringProviderType[];
  input: Record<string, unknown>;
  providerPolicy: Record<string, unknown>;
  providerTrace: ScenarioAuthoringProviderTraceEntry[];
  candidates: ScenarioAuthoringCandidate[];
  validation: ScenarioAuthoringValidation;
  provenance: Record<string, unknown>;
  failure?: Record<string, unknown> | null;
  confirmedCandidateId?: string | null;
  confirmedBy?: string | null;
  confirmedAt?: string | null;
  materializedRunId?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  expiresAt?: string | null;
}

export interface ScenarioAuthoringConfirmResponse {
  authoringJob: ScenarioAuthoringJob;
  confirmedCandidate: ScenarioAuthoringCandidate;
}
