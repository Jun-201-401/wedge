export type RunStatus =
  | 'CREATED'
  | 'QUEUED'
  | 'STARTING'
  | 'RUNNING'
  | 'STOP_REQUESTED'
  | 'STOPPED'
  | 'COMPLETED'
  | 'FAILED';

export type AnalysisStatus = 'NOT_STARTED' | 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED';

export type ResultCompleteness = 'NONE' | 'PARTIAL' | 'FINAL';

export type DevicePreset = 'desktop' | 'tablet' | 'mobile';

export interface LatestSnapshot {
  artifactId: string;
  url: string;
  capturedAt: string;
}

export interface Run {
  id: string;
  type: 'run';
  projectId: string;
  name: string;
  triggerSource: 'WEB' | 'MCP' | 'INTERNAL_AGENT' | 'API';
  startUrl: string;
  goal?: string | null;
  devicePreset: DevicePreset;
  scenarioTemplateVersionId?: string | null;
  status: RunStatus;
  resultCompleteness: ResultCompleteness;
  analysisStatus: AnalysisStatus;
  currentStepOrder?: number | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  failureCode?: string | null;
  failureMessage?: string | null;
  latestSnapshot?: LatestSnapshot | null;
}


export type RunStepStatus = 'PENDING' | 'RUNNING' | 'PASSED' | 'FAILED' | 'SKIPPED' | 'BLOCKED' | 'STOPPED';

export interface RunStep {
  id: string;
  runId: string;
  stepOrder: number;
  stepKey: string;
  stepName: string;
  stepType: string;
  status: RunStepStatus;
  startedAt?: string | null;
  finishedAt?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}

export interface RunEvent {
  id: string;
  runId: string;
  stepId?: string | null;
  stepKey?: string | null;
  eventType: string;
  eventSource: string;
  payload: Record<string, unknown>;
  occurredAt: string;
}

export interface RunCreateRequest {
  projectId: string;
  name: string;
  startUrl: string;
  goal?: string | null;
  devicePreset: DevicePreset;
  scenarioTemplateVersionId?: string | null;
  scenarioOverrides?: Record<string, unknown>;
  scenarioPlan?: Record<string, unknown>;
}

export interface RunActionRequest {
  reason?: string | null;
}

export interface RunArtifact {
  id: string;
  runId: string;
  stepId?: string | null;
  stepKey?: string | null;
  artifactType: string;
  bucket: string;
  key: string;
  mimeType: string;
  width?: number | null;
  height?: number | null;
  sizeBytes: number;
  sha256?: string | null;
  url?: string | null;
  contentUrl?: string | null;
  createdAt?: string | null;
}

export interface LatestCheckpoint {
  checkpointId: string;
  stepId?: string | null;
  stage?: string | null;
  url?: string | null;
  capturedAt?: string | null;
  durationMs?: number | null;
  observationCount: number;
  artifactRefCount: number;
}

export interface RunEvidenceCounts {
  checkpointCount: number;
  observationCount: number;
  artifactCount: number;
}

export interface RunLive {
  runId: string;
  status: RunStatus;
  currentStepOrder?: number | null;
  currentAction?: string | null;
  latestFrame?: LatestSnapshot | null;
  latestCheckpoint?: LatestCheckpoint | null;
  latestArtifact?: RunArtifact | null;
  evidenceCounts?: RunEvidenceCounts | null;
}

export interface EvidenceObservation {
  observation_id: string;
  type: string;
  stage: string;
  source: string[];
  data: Record<string, unknown>;
  confidence?: number | null;
}

export interface EvidenceCheckpoint {
  checkpoint_id: string;
  step_id?: string | null;
  primaryStage: string;
  trigger: Record<string, unknown>;
  settle: Record<string, unknown>;
  state: Record<string, unknown>;
  observations: EvidenceObservation[];
  deltas: Record<string, unknown>[];
  artifact_refs: string[];
}

export interface EvidenceArtifact {
  artifact_id: string;
  type: string;
  uri: string;
  signed_url?: string | null;
  mime_type?: string | null;
  size_bytes?: number | null;
  metadata?: Record<string, unknown>;
}

export interface EvidencePacket {
  schema_version?: string;
  execution_type?: 'DISCOVERY' | 'RUN' | string;
  run_id?: string | null;
  discovery_id?: string | null;
  url?: string;
  final_url?: string | null;
  scenario?: Record<string, unknown>;
  environment?: Record<string, unknown>;
  checkpoints: EvidenceCheckpoint[];
  aggregate_signals?: Record<string, unknown>;
  scenario_fit?: Record<string, unknown> | null;
  artifacts: EvidenceArtifact[];
  collection_notes?: string[];
}

export interface AnalysisRequestResponse {
  analysisJobId: string;
  runId: string;
  status: 'QUEUED';
  analysisType: 'PRIMARY';
  evidencePacketId: string;
  evidencePacketIncluded: boolean;
  checkpointCount: number;
  artifactCount: number;
}

export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  CREATED: '생성됨',
  QUEUED: '대기 중',
  STARTING: '시작 중',
  RUNNING: '실행 중',
  STOP_REQUESTED: '중지 요청됨',
  STOPPED: '중지됨',
  COMPLETED: '완료',
  FAILED: '실패',
};

export const ANALYSIS_STATUS_LABEL: Record<AnalysisStatus, string> = {
  NOT_STARTED: '분석 전',
  QUEUED: '분석 대기 중',
  RUNNING: '분석 중',
  COMPLETED: '분석 완료',
  FAILED: '분석 실패',
};
