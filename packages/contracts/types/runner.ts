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
    allowed_external_origins?: string[];
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
  artifact_policy?: AgentArtifactPolicy;
  steps: ScenarioStep[];
}

export type AgentGoalType = "CHECKOUT_ENTRY_VERIFICATION";

export interface AgentBudget {
  max_steps: number;
  max_duration_ms: number;
  max_recovery_attempts?: number;
  max_same_page_attempts?: number;
  max_external_redirects?: number;
}

export interface AgentObservationBudget {
  max_candidates?: number;
  max_visible_text_chars?: number;
  max_nearby_text_chars_per_candidate?: number;
  max_dom_snapshot_bytes?: number;
  max_ax_tree_bytes?: number;
  max_artifacts_per_run?: number;
  max_artifact_bytes_per_run?: number;
}

export interface AgentAllowedNavigation {
  allow_external_navigation: boolean;
  allowed_origins?: string[];
  allowed_checkout_redirect_origins?: string[];
}

export interface AgentProductSelectionPolicy {
  mode: "PROVIDED_OR_OBVIOUS_ONLY";
  provided_product_url?: string | null;
  required_option_strategy?: "FIRST_AVAILABLE";
  allow_quantity_change?: boolean;
  max_add_to_cart_attempts?: number;
}

export interface AgentRiskPolicy {
  allow_checkout_navigation: boolean;
  allow_cart_mutation: boolean;
  allow_shipping_form_entry: boolean;
  allow_payment_info_entry: boolean;
  allow_final_payment_submit: boolean;
  allow_final_order_commit: boolean;
  allow_destructive_action: boolean;
  allow_external_message_send: boolean;
}

export interface AgentTestData {
  email?: string | null;
  name?: string | null;
  phone?: string | null;
  shipping_address?: Record<string, unknown> | null;
  postal_code?: string | null;
  country?: string | null;
  coupon_code?: string | null;
  sandbox_payment?: Record<string, unknown> | null;
}

export interface AgentArtifactPolicy {
  capture_screenshots?: boolean;
  capture_dom_snapshots?: boolean;
  capture_ax_tree?: boolean;
  capture_trace?: boolean;
}

export interface AgentReplayHintStep {
  step_id?: string;
  stage?: ScenarioStage;
  description?: string;
  action: ScenarioAction;
  settle_strategy?: SettleStrategy;
  target_key?: string | null;
  confidence?: number;
}

export interface AgentReplayHints {
  source_trace_id?: string | null;
  source_plan_id?: string | null;
  steps: AgentReplayHintStep[];
}

export type AgentEventType =
  | "PRE_DECISION_VERIFIED"
  | "DECISION_MADE"
  | "POLICY_CHECKED"
  | "ACTION_COMPLETED"
  | "ACTION_FAILED"
  | "GOAL_VERIFIED"
  | "TRACE_PERSISTED";

export type AgentOutcomeStatus = "RUNNING" | "SUCCESS" | "POLICY_BLOCKED" | "BLOCKED" | "FAILED" | "EXHAUSTED";
export type AgentFinalOutcome = AgentOutcomeStatus;
export type AgentOutcomeCategory = AgentOutcomeStatus;

export type AgentRiskClass =
  | "LOW"
  | "EXTERNAL_NAVIGATION"
  | "CHECKOUT_NAVIGATION"
  | "CART_MUTATION"
  | "SHIPPING_FORM_ENTRY"
  | "PAYMENT_INFO_ENTRY"
  | "PAYMENT_COMMIT"
  | "DESTRUCTIVE_ACTION"
  | "EXTERNAL_MESSAGE_SEND";

export type AgentPolicyDecision = "ALLOW" | "BLOCK";

export interface AgentPolicyResult {
  allowed: boolean;
  reason: string;
  riskClass: AgentRiskClass;
}

export interface AgentOutcome {
  status: AgentOutcomeStatus;
  reason: string;
}

export type AgentVerificationOutcome =
  | "CONTINUE"
  | "SUCCESS"
  | "BLOCKED_LOGIN"
  | "BLOCKED_CAPTCHA"
  | "POLICY_BLOCKED"
  | "EXHAUSTED";

export interface AgentVerificationResult {
  satisfied: boolean;
  terminal: boolean;
  outcome: AgentVerificationOutcome;
  reason: string;
  confidence: number;
  phase: "pre_decision" | "post_action";
}

export type AgentDecisionKind = "act" | "checkpoint" | "finish";

export interface AgentReplayHintLocatorRecipe {
  strategy: string;
  selector?: string;
  role?: string;
  text?: string;
  frame_id?: string;
  confidence: number;
}

export interface AgentDecisionReplayHint {
  candidate_fingerprint?: string | null;
  locator_recipe?: AgentReplayHintLocatorRecipe[];
}

export interface AgentDecision {
  kind: AgentDecisionKind;
  description: string;
  reason: string;
  confidence: number;
  action: ScenarioAction;
  settleStrategy: SettleStrategy;
  stage: ScenarioStage;
  targetKey?: string | null;
  replayHint?: AgentDecisionReplayHint;
  metadata?: Record<string, unknown>;
}

export interface AgentObservationCandidateSummary {
  candidateId: string;
  candidateFingerprint: string;
  role: string | null;
  tag: string;
  text: string;
  inputType?: string | null;
  labelText?: string | null;
  placeholder?: string | null;
  name?: string | null;
  required?: boolean;
  disabled?: boolean;
  isFormControl?: boolean;
  clickable: boolean;
  isCtaCandidate: boolean;
  isPrimaryLike: boolean;
  frameId: string | null;
  shadowRoot: boolean;
  hrefOrigin?: string | null;
  hrefPathHint?: string | null;
  riskHint: string | null;
  bounds: InteractiveComponentBounds;
  visibility?: InteractiveComponentVisibility;
  layout?: InteractiveComponentLayout;
}

export interface AgentObservationFormControlSummary {
  controlKey: string;
  controlType: "field" | "select";
  hasValue: boolean;
}

export interface AgentObservationPageSignals {
  visitedUrlCount: number;
  consoleErrorCount: number;
  networkErrorCount: number;
  breadcrumbCount: number;
  toastCount: number;
  visiblePriceCount: number;
  productCardCount: number;
  cartCount: number | null;
  hasLoginWallSignal: boolean;
  hasCaptchaSignal: boolean;
  hasPaymentOrCommitSignal: boolean;
}

export interface AgentObservation {
  finalUrl: string;
  title: string;
  candidateCount: number;
  visibleTextSample?: string[];
  candidates?: AgentObservationCandidateSummary[];
  formControls?: AgentObservationFormControlSummary[];
  pageSignals?: AgentObservationPageSignals;
  artifactRefs?: string[];
}

export interface AgentTurnTrace {
  turn: number;
  observation: AgentObservation;
  preDecisionVerification: AgentVerificationResult;
  decision?: AgentDecision;
  policy?: AgentPolicyResult;
  actionResult?: {
    actionType: ScenarioAction["type"];
    finalUrl: string;
    completed: boolean;
  };
  postActionVerification?: AgentVerificationResult;
}

export interface AgentTrace {
  schema_version: "0.1";
  task_id: string;
  attempt_id: string;
  attempt_index: number;
  run_id: string;
  turns: AgentTurnTrace[];
  outcome: AgentOutcome;
}

export interface AgentTraceRequest {
  trace: AgentTrace;
}

export interface AgentTask {
  schema_version: "0.1";
  task_id: string;
  attempt_id: string;
  attempt_index: number;
  idempotency_key?: string;
  run_id: string;
  project_id: string;
  goal_type: AgentGoalType;
  goal?: string;
  start_url: string;
  environment: ScenarioPlan["environment"];
  budget: AgentBudget;
  observation_budget?: AgentObservationBudget;
  allowed_navigation: AgentAllowedNavigation;
  product_selection_policy?: AgentProductSelectionPolicy;
  risk_policy: AgentRiskPolicy;
  test_data?: AgentTestData;
  artifact_policy?: AgentArtifactPolicy;
  replay_hints?: AgentReplayHints;
}

export interface AgentExecuteMessage {
  messageId: string;
  messageType: "agent.execute.request";
  schemaVersion: string;
  createdAt: string;
  producer: string;
  correlationId?: string;
  idempotencyKey?: string;
  payload: {
    agentTask: AgentTask;
  };
}

export interface RunArtifactPolicy extends AgentArtifactPolicy {
  captureScreenshot?: boolean;
  captureScreenshots?: boolean;
  captureDomSnapshot?: boolean;
  captureDomSnapshots?: boolean;
  captureAxTree?: boolean;
  captureTrace?: boolean;
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
    artifactPolicy?: RunArtifactPolicy;
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

export type AgentCallbackEventType =
  | "PRE_DECISION_VERIFIED"
  | "DECISION_MADE"
  | "POLICY_CHECKED"
  | "ACTION_COMPLETED"
  | "ACTION_FAILED"
  | "GOAL_VERIFIED"
  | "TRACE_PERSISTED";

export interface AgentEvent {
  eventId: string;
  taskId: string;
  attemptId: string;
  turn?: number;
  eventType: AgentCallbackEventType;
  occurredAt: string;
  payload: Record<string, unknown>;
}

export interface AgentEventBatch {
  events: AgentEvent[];
}

export interface AgentTraceCallbackPayload {
  taskId: string;
  attemptId: string;
  occurredAt: string;
  trace: Record<string, unknown>;
  traceArtifact?: Artifact;
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

export interface InteractiveComponentVisibility {
  visible: boolean;
  in_viewport: boolean;
  above_fold: boolean;
  area_px: number;
  viewport_coverage_ratio: number;
}

export interface InteractiveComponentLayout {
  center_x: number;
  center_y: number;
  viewport_position: "inside" | "partially_inside" | "above" | "below" | "left" | "right";
  css_position?: string | null;
  z_index?: string | null;
  is_fixed?: boolean;
  is_sticky?: boolean;
  overlay_candidate?: boolean;
}

export interface InteractiveComponentObservationItem {
  text: string;
  selector: string | null;
  role: string | null;
  href?: string | null;
  input_type?: string | null;
  label_text?: string | null;
  placeholder?: string | null;
  name?: string | null;
  required?: boolean;
  disabled?: boolean;
  is_form_control?: boolean;
  frame_id?: string | null;
  shadow_root?: boolean;
  tag: string;
  clickable: boolean;
  clicked_in_scenario: boolean;
  is_cta_candidate: boolean;
  is_primary_like: boolean;
  bounds: InteractiveComponentBounds;
  visibility?: InteractiveComponentVisibility;
  layout?: InteractiveComponentLayout;
}

export interface VisibleTextBlockObservationItem {
  text: string;
  tag: string;
  role?: string | null;
  is_heading: boolean;
  bounds: InteractiveComponentBounds;
  visibility: InteractiveComponentVisibility;
}

export interface DomVisibilitySummary {
  visible_text_block_count: number;
  heading_count: number;
  link_count: number;
  button_count: number;
  form_control_count: number;
  required_field_count: number;
  disabled_control_count: number;
  cta_candidate_count: number;
}

export interface LayoutVisibilitySummary {
  viewport_width: number;
  viewport_height: number;
  scroll_y: number;
  interactive_component_count: number;
  above_fold_interactive_count: number;
  primary_like_component_count: number;
  fixed_or_sticky_count: number;
  overlay_candidate_count: number;
  max_z_index: number | null;
}

export interface AxTreeSummary {
  node_count: number;
  ignored_node_count: number;
  named_node_count: number;
  interactive_role_count: number;
  form_control_role_count: number;
  heading_count: number;
  landmark_count: number;
  button_count: number;
  link_count: number;
  focusable_count: number;
  role_counts: Record<string, number>;
  root_role?: string | null;
  truncated?: boolean;
}

export interface AxTreeObservation {
  observation_id: string;
  type: "ax_tree";
  stage: ScenarioStage;
  source: ["accessibility"];
  confidence: number;
  ax_artifact_id: string;
  summary: AxTreeSummary;
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

export interface JourneyActionRawObservation {
  observation_id: string;
  type: "journey_action_raw";
  stage: ScenarioStage;
  source: ("scenario_log" | "dom" | "browser" | "network" | "screenshot")[];
  confidence: number;
  step_order: number;
  step_key: string;
  action_type: ScenarioActionType;
  clicked_text?: string | null;
  clicked_selector?: string | null;
  element_role?: string | null;
  element_text?: string | null;
  aria_label?: string | null;
  url_before: string;
  url_after: string;
  title_before: string;
  title_after: string;
  breadcrumb_before?: string[];
  breadcrumb_after?: string[];
  cart_count_before?: number | null;
  cart_count_after?: number | null;
  toast_text?: string[];
  visible_price?: string[];
  visible_product_image?: Record<string, unknown>[];
  add_to_cart_like_button?: boolean;
  dom_changed: boolean;
  network_result?: Record<string, unknown>[];
  settle_status: "settled" | "timeout" | "failed";
  screenshot_artifact_id?: string | null;
  bbox?: InteractiveComponentBounds | null;
  matched_product_card?: MatchedProductCardSignal | null;
}

export interface MatchedProductCardSignal {
  element_text: string;
  clicked_selector: string | null;
  visible_price: string | null;
  visible_product_image: boolean;
  bbox: InteractiveComponentBounds;
  match_reason: "selector_exact" | "selector_related" | "text_overlap" | "bbox_overlap";
  match_confidence: number;
}

export interface ProductCardObservation {
  observation_id: string;
  type: "product_card";
  stage: "VALUE";
  source: ("dom" | "layout" | "screenshot")[];
  confidence: number;
  cards: Record<string, unknown>[];
}

export type ProductDetailEvidence =
  | "matched_product_card"
  | "url_changed"
  | "title_changed"
  | "breadcrumb_changed"
  | "price_visible"
  | "product_image_visible"
  | "goal_action_candidate_visible"
  | "dom_changed";

export interface ProductDetailSignalObservation {
  observation_id: string;
  type: "product_detail_signal";
  stage: ScenarioStage;
  source: ("scenario_log" | "dom" | "browser" | "screenshot")[];
  confidence: number;
  step_order: number;
  step_key: string;
  action_type: ScenarioActionType;
  clicked_text?: string | null;
  clicked_selector?: string | null;
  matched_product_card: MatchedProductCardSignal;
  url_before: string;
  url_after: string;
  title_before: string;
  title_after: string;
  breadcrumb_before: string[];
  breadcrumb_after: string[];
  visible_price: string[];
  visible_product_image: Record<string, unknown>[];
  goal_action_candidate_count: number;
  add_to_cart_like_button_count: number;
  dom_changed: boolean;
  screenshot_artifact_id?: string | null;
  evidence: ProductDetailEvidence[];
}

export interface GoalActionCandidateObservation {
  observation_id: string;
  type: "goal_action_candidate";
  stage: "CTA";
  source: ("dom" | "layout")[];
  confidence: number;
  candidates: Record<string, unknown>[];
}

export type GoalActionSuccessEvidence =
  | "cart_count_increased"
  | "toast_present"
  | "network_success"
  | "url_changed"
  | "dom_changed";

export interface GoalActionResultObservation {
  observation_id: string;
  type: "goal_action_result";
  stage: ScenarioStage;
  source: ("scenario_log" | "dom" | "browser" | "network")[];
  confidence: number;
  step_order: number;
  step_key: string;
  action_type: ScenarioActionType;
  clicked_text?: string | null;
  clicked_selector?: string | null;
  url_before: string;
  url_after: string;
  goal_action_like: boolean;
  success_evidence: GoalActionSuccessEvidence[];
  result: JourneyGoalActionResultSignal;
  matched_product_card?: MatchedProductCardSignal | null;
}

export interface CategoryFilterSignalObservation {
  observation_id: string;
  type: "category_filter_signal";
  stage: ScenarioStage;
  source: ("scenario_log" | "dom" | "browser")[];
  confidence: number;
  step_order: number;
  step_key: string;
  action_type: ScenarioActionType;
  clicked_text?: string | null;
  clicked_selector?: string | null;
  url_before: string;
  url_after: string;
  breadcrumb_before: string[];
  breadcrumb_after: string[];
  selected_filter_before: Record<string, unknown>[];
  selected_filter_after: Record<string, unknown>[];
  search_query_before: string | null;
  search_query_after: string | null;
  filter_changed: boolean;
  search_submitted: boolean;
  category_url_changed: boolean;
}

export type JourneyIntentCandidate =
  | "product_discovery"
  | "category_changed"
  | "filter_changed"
  | "search_submitted"
  | "goal_action"
  | "navigation"
  | "other";

export interface JourneyGoalActionResultSignal {
  action_attempted: boolean;
  add_to_cart_like_button: boolean;
  cart_count_delta: number | null;
  toast_present: boolean;
  url_changed: boolean;
  dom_changed: boolean;
  network_success: boolean;
  settle_status: "settled" | "timeout" | "failed";
}

export interface DepthFromDiscoveryObservation {
  observation_id: string;
  type: "depth_from_discovery";
  stage: ScenarioStage;
  source: ("scenario_log" | "dom" | "browser" | "network")[];
  confidence: number;
  step_order: number;
  step_key: string;
  action_type: ScenarioActionType;
  discovery_step_order: number;
  discovery_step_key: string;
  discovery_stage: ScenarioStage;
  discovery_url: string;
  depth_from_discovery: number;
  intent_candidate: JourneyIntentCandidate;
  is_detour_candidate: boolean;
  category_changed: boolean;
  filter_changed: boolean;
  search_submitted: boolean;
  goal_action_result: JourneyGoalActionResultSignal;
  current_url: string;
  current_product_card_count: number;
  product_card_count_at_discovery: number;
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
    /**
     * True when runner execution stopped at a planned safety stop condition or
     * after an explicit stop request. Planned scenario stops still complete the
     * run; only a prior STOP_REQUESTED run becomes STOPPED.
     */
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
