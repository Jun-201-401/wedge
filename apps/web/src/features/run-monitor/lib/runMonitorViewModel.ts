import type {
  EvidenceArtifact,
  EvidenceCheckpoint,
  EvidenceObservation,
  EvidencePacket,
  Run,
  RunLive,
  RunStatus,
} from '../../../entities/run';
import { RUN_STATUS_LABEL } from '../../../entities/run';
import type { RunActionLog, RunStepItem, StepStatus } from './runMonitorMock';

export type RunStatusTone = 'complete' | 'failed' | 'queued' | 'running' | 'stopping';

export const RUN_MONITOR_REFRESH_INTERVAL_MS = 5000;

const EVIDENCE_ARTIFACT_LABELS: Record<string, string> = {
  console_log: '콘솔 로그',
  dom_snapshot: 'DOM 스냅샷',
  screenshot: '스크린샷',
};

export function getDepthLabel(depth: string | null) {
  if (depth === 'next-screen') {
    return '다음 화면까지 보기';
  }

  if (depth === 'form-depth') {
    return 'Form까지 보기';
  }

  return '첫 화면만 보기';
}

export function getDevicePresetLabel(devicePreset: Run['devicePreset']) {
  if (devicePreset === 'mobile') {
    return '모바일';
  }

  if (devicePreset === 'tablet') {
    return '태블릿';
  }

  return '데스크톱';
}

export function getStatusTone(status: RunStatus): RunStatusTone {
  if (status === 'COMPLETED') {
    return 'complete';
  }

  if (status === 'FAILED' || status === 'STOPPED') {
    return 'failed';
  }

  if (status === 'STOP_REQUESTED') {
    return 'stopping';
  }

  if (status === 'QUEUED' || status === 'CREATED') {
    return 'queued';
  }

  return 'running';
}

export function getStepStatusLabel(status: StepStatus) {
  if (status === 'complete') {
    return '완료';
  }

  if (status === 'active') {
    return '진행 중';
  }

  if (status === 'failed') {
    return '실패';
  }

  return '대기 중';
}

function getStepProgressPercent(currentStepOrder?: number | null) {
  return currentStepOrder ? Math.min(95, Math.max(18, currentStepOrder * 14)) : 35;
}

export function getApiProgressPercent(live: RunLive) {
  if (live.status === 'COMPLETED') {
    return 100;
  }

  if (live.status === 'FAILED' || live.status === 'STOPPED') {
    return 100;
  }

  if (live.status === 'RUNNING' || live.status === 'STARTING' || live.status === 'STOP_REQUESTED') {
    return getStepProgressPercent(live.currentStepOrder);
  }

  if (live.status === 'QUEUED') {
    return 12;
  }

  return 5;
}

export function getApiCheckpoint(live: RunLive) {
  if (live.currentAction) {
    return live.currentAction;
  }

  if (live.status === 'COMPLETED') {
    return '분석 실행이 완료되었습니다';
  }

  if (live.status === 'FAILED') {
    return '분석 실행이 실패했습니다';
  }

  if (live.status === 'STOP_REQUESTED') {
    return '중지 요청을 처리 중입니다';
  }

  if (live.status === 'STOPPED') {
    return '분석 실행이 중지되었습니다';
  }

  if (live.status === 'QUEUED' || live.status === 'CREATED') {
    return '실행 대기열에서 준비 중입니다';
  }

  return '최신 체크포인트를 기다리는 중입니다';
}

function getApiCheckpointStatus(status: RunStatus): StepStatus {
  if (status === 'COMPLETED') {
    return 'complete';
  }

  if (status === 'FAILED' || status === 'STOPPED') {
    return 'failed';
  }

  return 'active';
}

export function formatRunStartedAt(startedAt?: string | null) {
  if (!startedAt) {
    return '방금 전';
  }

  return new Intl.DateTimeFormat('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(startedAt));
}

export function buildApiSnapshotSteps(run: Run, live: RunLive): RunStepItem[] {
  const currentOrder = live.currentStepOrder ?? run.currentStepOrder;

  return [
    {
      id: 'api-run-state',
      label: 'Run 상태 확인',
      detail: `API에서 ${RUN_STATUS_LABEL[live.status]} 상태를 확인했습니다.`,
      status: live.status === 'FAILED' ? 'failed' : 'complete',
      timestamp: formatRunStartedAt(run.startedAt),
    },
    {
      id: 'api-current-checkpoint',
      label: currentOrder ? `체크포인트 ${currentOrder}` : '체크포인트 대기',
      detail: getApiCheckpoint(live),
      status: getApiCheckpointStatus(live.status),
      timestamp: 'API 스냅샷',
    },
    {
      id: 'api-step-adapter',
      label: 'Step 타임라인 준비',
      detail: '실제 step/log API 연동 전까지 run/live 스냅샷만 표시합니다.',
      status: live.status === 'COMPLETED' || live.status === 'FAILED' || live.status === 'STOPPED' ? 'complete' : 'pending',
      timestamp: '대기 중',
    },
  ];
}

export function buildApiSnapshotLogs(run: Run, live: RunLive): RunActionLog[] {
  return [
    {
      id: 'api-log-run',
      time: formatRunStartedAt(run.startedAt),
      message: `Run ${run.id} 상태를 API에서 불러왔습니다.`,
      tone: 'success',
    },
    {
      id: 'api-log-live',
      time: '현재',
      message: getApiCheckpoint(live),
      tone: live.status === 'FAILED' || live.status === 'STOP_REQUESTED' ? 'warning' : 'info',
    },
  ];
}

export function canOpenRunReport(isMockRun: boolean) {
  // Real report/evidence payloads are not connected yet. Keep the CTA limited to
  // explicit mock/demo runs so completed API runs do not navigate to a dead-end report page.
  return isMockRun;
}

export function shouldRefreshRunLive(status: RunStatus) {
  return status === 'CREATED' || status === 'QUEUED' || status === 'STARTING' || status === 'RUNNING' || status === 'STOP_REQUESTED';
}

export function findEvidenceScreenshotArtifact(evidencePacket: EvidencePacket | null): EvidenceArtifact | null {
  if (!evidencePacket) {
    return null;
  }

  return evidencePacket.artifacts.find((artifact) => artifact.type === 'screenshot') ?? null;
}

export function getEvidenceArtifactLabel(artifact: EvidenceArtifact) {
  return EVIDENCE_ARTIFACT_LABELS[artifact.type] ?? artifact.type;
}

export function getEvidenceCheckpointTitle(checkpoint: EvidenceCheckpoint, index: number) {
  const stepId = checkpoint.step_id ? ` · ${checkpoint.step_id}` : '';
  return `Checkpoint ${index + 1}${stepId}`;
}

export function getEvidenceObservationSummary(observation: EvidenceObservation) {
  const target = readString(observation.data.target);
  const text = readString(observation.data.text);
  const message = readString(observation.data.message);
  const fieldKey = readString(observation.data.field_key);
  return target ?? text ?? message ?? fieldKey ?? observation.type;
}

export function getCheckpointArtifacts(checkpoint: EvidenceCheckpoint, artifacts: EvidenceArtifact[]) {
  const artifactIds = new Set(checkpoint.artifact_refs.map(normalizeArtifactRef));
  return artifacts.filter((artifact) => artifactIds.has(artifact.artifact_id));
}

function normalizeArtifactRef(ref: string) {
  return ref.startsWith('artifact:') ? ref.slice('artifact:'.length) : ref;
}

function readString(value: unknown) {
  if (typeof value !== 'string') {
    return null;
  }

  const text = value.trim();
  return text || null;
}
