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

export interface DiscoveryScenarioRecommendation {
  scenario_type: DiscoveryFlowType;
  recommendation_level: DiscoveryRecommendationLevel;
  confidence: number;
  reason: string;
  evidence_refs: string[];
  suggested_start_url?: string | null;
  suggested_target?: TargetDescriptorMap | null;
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
  checkpoints: Record<string, unknown>[];
  detected_flow_types: DiscoveryFlowType[];
  missing_flow_types?: DiscoveryFlowType[];
  flow_candidates?: DiscoveryFlowCandidate[];
  scenario_recommendations: DiscoveryScenarioRecommendation[];
  collection_notes?: string[];
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
}
