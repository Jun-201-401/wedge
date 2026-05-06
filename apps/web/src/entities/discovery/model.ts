import type { DevicePreset } from '../run';

export type DiscoveryStatus = 'CREATED' | 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELED' | 'EXPIRED';

export type ScenarioRecommendationLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'NOT_AVAILABLE';

export type DiscoveryScenarioType =
  | 'LANDING_CTA'
  | 'SIGNUP_LEAD_FORM'
  | 'PRICING'
  | 'PURCHASE_CHECKOUT'
  | 'CONTACT'
  | 'CONTENT_ONLY'
  | 'CUSTOM_GUIDED';

export interface DiscoveryViewport {
  width: number;
  height: number;
}

export interface CreateDiscoveryRequest {
  projectId: string;
  url: string;
  devicePreset: DevicePreset;
  viewport?: DiscoveryViewport;
}

export interface DiscoverySummary {
  detectedFlowTypes?: DiscoveryScenarioType[];
  missingFlowTypes?: DiscoveryScenarioType[];
  primaryCtaCount?: number;
  formCandidateCount?: number;
  pricingEntrypointCount?: number;
  checkoutEntrypointCount?: number;
  [key: string]: unknown;
}

export interface ScenarioRecommendation {
  recommendationId?: string | null;
  scenarioType: DiscoveryScenarioType;
  recommendationLevel: ScenarioRecommendationLevel;
  confidence: number;
  reason: string;
  evidenceRefs: string[];
  suggestedStartUrl?: string | null;
  suggestedTarget?: Record<string, unknown> | null;
}

export interface Discovery {
  discoveryId: string;
  status: DiscoveryStatus;
  inputUrl?: string | null;
  finalUrl?: string | null;
  summary?: DiscoverySummary | null;
  scenarioRecommendations?: ScenarioRecommendation[];
  createdAt?: string | null;
  completedAt?: string | null;
  failureCode?: string | null;
  failureMessage?: string | null;
}
