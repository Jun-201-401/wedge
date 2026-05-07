export type ScenarioStage = "FIRST_VIEW" | "VALUE" | "CTA" | "INPUT" | "COMMIT";

export type ScenarioActionType =
  | "goto"
  | "click"
  | "fill"
  | "select"
  | "scroll"
  | "hover"
  | "wait_for"
  | "checkpoint"
  | "stop_when";

export type SettleStrategyType =
  | "network_idle"
  | "locator_visible"
  | "response"
  | "url_change"
  | "spinner_hidden"
  | "item_count_change"
  | "fixed_short"
  | "none";

export interface TargetDescriptorMap {
  role?: string;
  text?: string;
  text_any?: string[];
  label?: string;
  label_any?: string[];
  placeholder?: string;
  placeholder_any?: string[];
  name?: string;
  name_any?: string[];
  href_contains?: string;
  selector?: string;
  selector_any?: string[];
  url?: string;
  [key: string]: unknown;
}

export type TargetDescriptor = string | null | TargetDescriptorMap;

export interface ScenarioAction {
  type: ScenarioActionType;
  target?: TargetDescriptor;
  value?: unknown;
  options?: Record<string, unknown>;
}

export interface SettleStrategy {
  type: SettleStrategyType;
  timeout_ms: number;
  target?: TargetDescriptor;
  url_includes?: string;
  method?: string;
  status?: number;
  expected_count?: number;
  min_count?: number;
  max_count?: number;
  count_delta?: number;
  [key: string]: unknown;
}

export interface ScenarioStep {
  step_id: string;
  stage: ScenarioStage;
  description: string;
  action: ScenarioAction;
  settle_strategy: SettleStrategy;
  checkpoint: boolean;
  stop_condition?: Record<string, unknown>;
}

export interface ScenarioPlan {
  schema_version: string;
  plan_id: string;
  scenario_type: "template" | "custom_compiled";
  template_key?: string;
  goal: string;
  start_url: string;
  source_discovery_id?: string | null;
  environment: {
    device: "desktop" | "mobile" | "tablet";
    viewport: {
      width: number;
      height: number;
    };
    locale: string;
    timezone: string;
    geolocation?: Record<string, unknown> | null;
    permissions?: string[];
    auth_state: "anonymous" | "test_account" | "stored_state";
    [key: string]: unknown;
  };
  safety: {
    allow_external_navigation: boolean;
    allow_payment_commit: boolean;
    allow_destructive_action: boolean;
    use_synthetic_inputs: boolean;
    stop_before_real_payment?: boolean;
  };
  fit_requirements?: {
    required_flow_type: DiscoveryFlowType;
    required_entrypoint_types: DiscoveryEntrypointType[];
    fallback_allowed: boolean;
    minimum_confidence?: number;
    required_evidence_refs?: string[];
  } | null;
  steps: ScenarioStep[];
}

export interface RunExecuteMessage {
  messageId: string;
  messageType: "run.execute.request";
  schemaVersion: string;
  createdAt: string;
  producer: string;
  correlationId?: string;
  idempotencyKey?: string;
  payload: {
    runId: string;
    projectId: string;
    triggerSource?: "WEB" | "MCP" | "INTERNAL_AGENT" | "API";
    startUrl: string;
    goal: string;
    devicePreset: "desktop" | "tablet" | "mobile";
    scenarioTemplateVersionId: string;
    scenarioOverrides?: Record<string, unknown>;
    scenarioPlan: ScenarioPlan;
    artifactPolicy?: Record<string, unknown>;
  };
}

export type DiscoveryFlowType =
  | "LANDING_CTA"
  | "SIGNUP_LEAD_FORM"
  | "PRICING"
  | "PURCHASE_CHECKOUT"
  | "CONTACT"
  | "CONTENT_ONLY";

export type DiscoveryEntrypointType =
  | "cta"
  | "form"
  | "pricing"
  | "checkout"
  | "cart"
  | "signup"
  | "contact"
  | "content";

export type DiscoveryRecommendationLevel = "HIGH" | "MEDIUM" | "LOW" | "NOT_AVAILABLE";

export interface DiscoveryExecutePayload {
  discoveryId: string;
  projectId: string;
  triggerSource?: "WEB" | "MCP" | "INTERNAL_AGENT" | "API";
  url: string;
  devicePreset: "desktop" | "tablet" | "mobile";
  viewport: {
    width: number;
    height: number;
  };
  maxDurationMs: number;
  maxScrollCount: number;
}

export interface DiscoveryExecuteMessage {
  messageId: string;
  messageType: "discovery.execute.request";
  schemaVersion: string;
  createdAt: string;
  producer: string;
  correlationId?: string;
  idempotencyKey?: string;
  payload: DiscoveryExecutePayload;
}

export interface DiscoveryEntrypointCandidate {
  entrypoint_type: DiscoveryEntrypointType;
  label: string;
  url?: string | null;
  selector?: string | null;
  confidence: number;
  evidence_refs: string[];
}

export interface DiscoveryFlowCandidate {
  flow_type: DiscoveryFlowType;
  confidence: number;
  evidence_refs: string[];
  entrypoint_candidates: DiscoveryEntrypointCandidate[];
  reason: string;
}

export type DiscoveryEvidenceSignalSource =
  | "text"
  | "aria_label"
  | "aria_labelled_by_text"
  | "label_text"
  | "alt"
  | "title"
  | "href"
  | "selector"
  | "name"
  | "placeholder"
  | "form_field"
  | "shallow_navigation";

export interface DiscoveryEvidenceSignal {
  signal_id: string;
  source: DiscoveryEvidenceSignalSource;
  signal_type: string;
  value: string;
  evidence_ref?: string | null;
  weight?: number;
}

export interface DiscoveryEvidenceSummary {
  matched_signals: DiscoveryEvidenceSignal[];
  missing_signals: string[];
  limitations: string[];
}

export interface DiscoveryScenarioRecommendation {
  scenario_type: DiscoveryFlowType;
  recommendation_level: DiscoveryRecommendationLevel;
  confidence: number;
  reason: string;
  evidence_refs: string[];
  evidence_summary?: DiscoveryEvidenceSummary | null;
  suggested_start_url?: string | null;
  suggested_target?: TargetDescriptorMap | null;
}

export interface DiscoveryShallowNavigationVerification {
  status: "verified";
  destination_url: string;
  title?: string;
}

export interface DiscoveryObservationData {
  shallow_navigation?: DiscoveryShallowNavigationVerification;
  [key: string]: unknown;
}

export interface DiscoveryObservation {
  observation_id?: string;
  type?: string;
  stage?: string;
  source?: string[];
  data?: DiscoveryObservationData;
  confidence?: number;
  [key: string]: unknown;
}

export interface DiscoveryCheckpoint {
  checkpoint_id?: string;
  stage?: string;
  state?: Record<string, unknown>;
  observations?: DiscoveryObservation[];
  artifact_refs?: string[];
  [key: string]: unknown;
}

export interface SiteDiscoveryResult {
  schema_version: string;
  discovery_id: string;
  input_url: string;
  final_url: string;
  environment: {
    device: "desktop" | "mobile" | "tablet";
    viewport: {
      width: number;
      height: number;
    };
    locale: string;
    timezone: string;
    [key: string]: unknown;
  };
  checkpoints: DiscoveryCheckpoint[];
  detected_flow_types: DiscoveryFlowType[];
  missing_flow_types?: DiscoveryFlowType[];
  flow_candidates?: DiscoveryFlowCandidate[];
  scenario_recommendations: DiscoveryScenarioRecommendation[];
  collection_notes?: string[];
}

export type ScenarioAuthoringStatus =
  | "CREATED"
  | "QUEUED"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELED"
  | "EXPIRED";

export type ScenarioAuthoringProviderType =
  | "CODEX"
  | "CLAUDE_CODE"
  | "INTERNAL_LLM"
  | "RULE_BASED"
  | "SERVICE_ACCOUNT"
  | "OTHER";

export interface ScenarioAuthoringSelectedRecommendation {
  recommendation_id?: string | null;
  scenario_type: DiscoveryFlowType;
  recommendation_level: DiscoveryRecommendationLevel;
  confidence: number;
  evidence_refs: string[];
  evidence_summary?: DiscoveryEvidenceSummary | null;
  suggested_start_url?: string | null;
  suggested_target?: TargetDescriptorMap | null;
}

export interface ScenarioAuthoringInput {
  site_discovery_result: SiteDiscoveryResult;
  requested_goal: string;
  preferred_scenario_type?: DiscoveryFlowType;
  selected_recommendation?: ScenarioAuthoringSelectedRecommendation | null;
  constraints?: Record<string, unknown>;
  environment: ScenarioPlan["environment"];
  safety: ScenarioPlan["safety"];
}

export interface ScenarioAuthoringProviderPolicy {
  allowed_provider_types: ScenarioAuthoringProviderType[];
  provider_order: ScenarioAuthoringProviderType[];
  timeout_ms: number;
  fallback_allowed: boolean;
  approval_required: boolean;
  max_attempts?: number;
}

export interface ScenarioAuthoringProviderTraceEntry {
  provider_type: ScenarioAuthoringProviderType;
  provider_name: string;
  provider_version?: string | null;
  model_or_agent?: string | null;
  status: "STARTED" | "SUCCEEDED" | "FAILED" | "TIMED_OUT" | "SKIPPED";
  confidence?: number | null;
  fallback_reason?: string | null;
  started_at: string;
  finished_at?: string | null;
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

export interface ScenarioAuthoringCandidate {
  candidate_id: string;
  scenario_plan: ScenarioPlan;
  confidence: number;
  rationale: string;
  evidence_refs: string[];
  source_recommendation_refs?: string[];
  validation: ScenarioAuthoringValidation;
}

export interface ScenarioAuthoringProvenance {
  source_discovery_id?: string;
  source_recommendation_refs?: string[];
  source_evidence_refs: string[];
  prompt_version?: string | null;
  input_summary?: string;
  generated_at: string;
}

export interface ScenarioAuthoringFailure {
  failure_code: string;
  failure_message: string;
  provider_type?: ScenarioAuthoringProviderType;
}

export interface ScenarioAuthoringJob {
  schema_version: "0.5";
  authoring_job_id: string;
  project_id: string;
  source_discovery_id: string;
  correlation_id?: string;
  idempotency_key?: string | null;
  status: ScenarioAuthoringStatus;
  input: ScenarioAuthoringInput;
  provider_policy: ScenarioAuthoringProviderPolicy;
  provider_trace?: ScenarioAuthoringProviderTraceEntry[];
  candidates?: ScenarioAuthoringCandidate[];
  validation: ScenarioAuthoringValidation;
  provenance: ScenarioAuthoringProvenance;
  failure?: ScenarioAuthoringFailure | null;
  created_at: string;
  updated_at: string;
  expires_at?: string | null;
}


export interface DiscoverySummaryPayload {
  detectedFlowTypes: DiscoveryFlowType[];
  missingFlowTypes: DiscoveryFlowType[];
  primaryCtaCount: number;
  formCandidateCount: number;
  pricingEntrypointCount: number;
  checkoutEntrypointCount: number;
  scenarioRecommendations: Array<{
    recommendationId?: string | null;
    scenarioType: DiscoveryFlowType;
    recommendationLevel: DiscoveryRecommendationLevel;
    confidence: number;
    reason: string;
    evidenceRefs: string[];
    evidenceSummary?: DiscoveryEvidenceSummary | null;
    suggestedStartUrl?: string | null;
    suggestedTarget?: TargetDescriptorMap | null;
  }>;
}

export interface DiscoveryAcceptedPayload {
  eventId: string;
  workerId: string;
  acceptedAt: string;
  browserSessionId: string;
}

export interface DiscoveryFinishedPayload {
  eventId: string;
  workerId: string;
  finishedAt: string;
  finalUrl: string;
  summary: DiscoverySummaryPayload;
}

export interface DiscoveryFailedPayload {
  eventId: string;
  workerId: string;
  failedAt: string;
  failureCode: string;
  failureMessage: string;
}

export interface DiscoveryCheckpointRequest {
  eventId: string;
  workerId: string;
  checkpoint: Checkpoint;
  artifacts: Record<string, unknown>[];
  observations: Record<string, unknown>[];
}

export interface RunnerAcceptedPayload {
  workerId: string;
  acceptedAt: string;
  browserSessionId: string;
}

export interface StepEvent {
  eventId: string;
  stepOrder: number;
  eventType:
    | "STEP_STARTED"
    | "ACTION_EXECUTED"
    | "STEP_COMPLETED"
    | "STEP_FAILED"
    | "CONSOLE_ERROR"
    | "NETWORK_ERROR"
    | "ISSUE_SIGNAL_DETECTED";
  occurredAt: string;
  payload: Record<string, unknown>;
  stepKey: string;
}

export interface StepEventBatch {
  events: StepEvent[];
}

export interface Artifact {
  artifactId: string;
  artifactType:
    | "FRAME"
    | "SCREENSHOT"
    | "DOM_SNAPSHOT"
    | "AX_TREE"
    | "TRACE"
    | "HAR"
    | "CONSOLE_LOG"
    | "REPORT_PDF"
    | "REPORT_MARKDOWN"
    | "REPORT_HTML"
    | "REPORT_JSON"
    | "OTHER";
  bucket: string;
  key: string;
  mimeType: string;
  width?: number;
  height?: number;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
  stepKey: string;
}

export interface ArtifactBatch {
  artifacts: Artifact[];
}

export interface Checkpoint {
  checkpointId: string;
  stepKey: string;
  stage: ScenarioStage;
  trigger: Record<string, unknown>;
  settle: {
    strategy: string;
    durationMs: number;
    status: "settled" | "timeout" | "failed";
    [key: string]: unknown;
  };
  state: Record<string, unknown>;
  observations: Record<string, unknown>[];
  deltas: Record<string, unknown>[];
  artifactRefs: string[];
}

export interface InteractiveComponentBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  unit: "css_px" | "screenshot_px" | "viewport_ratio";
}

export interface InteractiveComponentObservationItem {
  text: string;
  selector: string | null;
  role: string | null;
  tag: string;
  clickable: boolean;
  clicked_in_scenario: boolean;
  is_cta_candidate: boolean;
  is_primary_like: boolean;
  bounds: InteractiveComponentBounds;
}

export interface InteractiveComponentsObservation {
  observation_id: string;
  type: "interactive_components";
  stage: "CTA";
  source: ("dom" | "layout" | "screenshot")[];
  confidence: number;
  primary_like_component_count: number;
  components: InteractiveComponentObservationItem[];
}

export interface RunnerCheckpointsRequest {
  checkpoints: Checkpoint[];
}

export interface RunnerFinishedPayload {
  workerId: string;
  executionFinishedAt: string;
  summary: {
    completedStepCount: number;
    failedStepCount: number;
    stopped: boolean;
  };
}

export interface RunnerFailedPayload {
  workerId: string;
  failedAt: string;
  failureCode: string;
  failureMessage: string;
  resultCompleteness: "NONE" | "PARTIAL" | "FINAL";
  summary?: {
    completedStepCount: number;
    failedStepCount: number;
    stopped: boolean;
  };
}
