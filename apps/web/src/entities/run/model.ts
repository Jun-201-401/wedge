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
  scenarioTemplateVersionId: string;
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

export interface RunCreateRequest {
  projectId: string;
  name: string;
  startUrl: string;
  goal?: string | null;
  devicePreset: DevicePreset;
  scenarioTemplateVersionId: string;
  scenarioOverrides?: Record<string, unknown>;
  scenarioPlan: Record<string, unknown>;
}

export interface RunActionRequest {
  reason?: string | null;
}

export interface RunLive {
  runId: string;
  status: RunStatus;
  currentStepOrder?: number | null;
  currentAction?: string | null;
  latestFrame?: LatestSnapshot | null;
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
