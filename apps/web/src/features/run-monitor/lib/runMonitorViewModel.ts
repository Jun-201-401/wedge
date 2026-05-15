import type {
  EvidenceArtifact,
  EvidenceCheckpoint,
  EvidenceObservation,
  EvidencePacket,
  Run,
  RunEvent,
  RunLive,
  RunStep,
  RunStatus,
} from '../../../entities/run';
import { RUN_STATUS_LABEL } from '../../../entities/run';
import type { RunReportProjection } from '../../../entities/report';
import type { RunActionLog, RunStepItem, StepStatus } from './runMonitorMock';

export type RunStatusTone = 'complete' | 'failed' | 'queued' | 'running' | 'stopping';
export type RunMonitorReportCtaKind = 'open' | 'generate' | 'request-analysis' | 'waiting' | 'failed' | 'loading' | 'error' | 'hidden';

export interface RunMonitorReportCtaState {
  kind: RunMonitorReportCtaKind;
  canOpenReport: boolean;
  titleLabel: '리포트 준비 완료' | '현재 체크포인트';
  eyebrow: '다음 화면' | '리포트 상태';
  message: string;
}

export const RUN_MONITOR_REFRESH_INTERVAL_MS = 5000;

const EVIDENCE_ARTIFACT_LABELS: Record<string, string> = {
  console_log: '콘솔 로그',
  dom_snapshot: 'DOM 스냅샷',
  screenshot: '스크린샷',
};

const RUN_EVENT_USER_SUMMARIES: Record<string, string> = {
  STEP_STARTED: '다음 화면 흐름을 확인하고 있습니다',
  ACTION_EXECUTED: '화면에서 필요한 동작을 실행했습니다',
  STEP_COMPLETED: '확인을 마쳤습니다',
  STEP_BLOCKED: '안전 조건에 따라 여기서 멈췄습니다',
  STEP_FAILED: '확인이 막혔습니다',
  CONSOLE_ERROR: '페이지 스크립트 오류를 감지했습니다',
  NETWORK_ERROR: '페이지 요청 실패를 감지했습니다',
  ISSUE_SIGNAL_DETECTED: '개선이 필요한 신호를 발견했습니다',
  AGENT_PRE_DECISION_VERIFIED: '다음 판단에 필요한 조건을 확인했습니다',
  AGENT_DECISION_MADE: '다음 행동 방향을 정했습니다',
  AGENT_POLICY_CHECKED: '실행 전 안전 조건을 확인했습니다',
  AGENT_ACTION_COMPLETED: '계획한 동작을 완료했습니다',
  AGENT_ACTION_FAILED: '계획한 동작이 완료되지 않았습니다',
  AGENT_GOAL_VERIFIED: '목표 달성 여부를 확인했습니다',
  AGENT_TRACE_PERSISTED: '실행 근거를 저장했습니다',
};

const RUN_EVENT_ACTION_SUMMARIES: Record<string, string> = {
  click: '버튼이나 링크 반응을 확인했습니다',
  fill: '입력 흐름을 확인했습니다',
  goto: '다음 화면으로 이동했습니다',
  navigate: '다음 화면으로 이동했습니다',
};

const RUN_EVENT_TIMELINE_LABELS: Record<string, string> = {
  STEP_STARTED: '화면 흐름 확인 중',
  ACTION_EXECUTED: '화면 동작 확인',
  STEP_COMPLETED: '확인 완료',
  STEP_BLOCKED: '안전 중단',
  STEP_FAILED: '확인 막힘',
  CONSOLE_ERROR: '스크립트 오류 감지',
  NETWORK_ERROR: '요청 실패 감지',
  ISSUE_SIGNAL_DETECTED: '개선 신호 발견',
  AGENT_PRE_DECISION_VERIFIED: '조건 확인',
  AGENT_DECISION_MADE: '다음 행동 결정',
  AGENT_POLICY_CHECKED: '안전 조건 확인',
  AGENT_ACTION_COMPLETED: '동작 완료',
  AGENT_ACTION_FAILED: '동작 막힘',
  AGENT_GOAL_VERIFIED: '목표 확인',
  AGENT_TRACE_PERSISTED: '근거 저장',
};

const RUN_STEP_TYPE_DETAILS: Record<string, string> = {
  GOTO: '대상 화면을 열고 있습니다',
  CLICK: '버튼이나 링크 반응을 확인하고 있습니다',
  FILL: '입력 흐름을 확인하고 있습니다',
  ASSERT: '화면 상태를 확인하고 있습니다',
  WAIT: '화면 응답을 기다리고 있습니다',
};

function getRunEventStatus(eventType: string): StepStatus {
  if (eventType === 'STEP_FAILED' || eventType === 'STEP_BLOCKED' || eventType === 'CONSOLE_ERROR' || eventType === 'NETWORK_ERROR' || eventType === 'AGENT_ACTION_FAILED') {
    return 'failed';
  }

  if (
    eventType === 'STEP_STARTED' ||
    eventType === 'STEP_COMPLETED' ||
    eventType === 'ACTION_EXECUTED' ||
    eventType === 'ISSUE_SIGNAL_DETECTED' ||
    eventType.startsWith('AGENT_')
  ) {
    return 'complete';
  }

  return 'pending';
}

function getRunEventLogTone(eventType: string): RunActionLog['tone'] {
  const status = getRunEventStatus(eventType);
  return status === 'failed' ? 'warning' : status === 'complete' ? 'success' : 'info';
}

function readPayloadString(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  if (typeof value !== 'string') {
    return null;
  }

  const text = value.trim();
  return text || null;
}

function getRunEventUserSummary(event: RunEvent) {
  const failureCode = readPayloadString(event.payload, 'failureCode');
  const actionType = readPayloadString(event.payload, 'actionType')?.toLowerCase();

  if (event.eventType === 'STEP_BLOCKED') {
    return '위험하거나 범위를 벗어난 이동이라 안전하게 멈췄습니다';
  }

  if (event.eventType === 'STEP_FAILED' && failureCode === 'RUNNER_TIMEOUT') {
    return '응답이 지연되어 확인이 막혔습니다';
  }

  if (event.eventType === 'ACTION_EXECUTED' && actionType && RUN_EVENT_ACTION_SUMMARIES[actionType]) {
    return RUN_EVENT_ACTION_SUMMARIES[actionType];
  }

  return RUN_EVENT_USER_SUMMARIES[event.eventType] ?? '실행 상태가 업데이트되었습니다';
}

function getRunEventTimelineLabel(event: RunEvent) {
  return RUN_EVENT_TIMELINE_LABELS[event.eventType] ?? '상태 업데이트';
}

function getRunEventTimestamp(event: RunEvent) {
  return formatRunStartedAt(event.occurredAt);
}

function sortRunEvents(events: RunEvent[]) {
  return events
    .slice()
    .sort((left, right) => {
      const occurredAtDiff = new Date(left.occurredAt).getTime() - new Date(right.occurredAt).getTime();
      return occurredAtDiff !== 0 ? occurredAtDiff : left.id.localeCompare(right.id);
    });
}

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
    return '실행 대기열 준비 중';
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

export function getFailureCodeLabel(failureCode?: string | null) {
  if (failureCode === 'RUNNER_TIMEOUT') {
    return '시간 초과';
  }

  if (failureCode === 'RUN_START_FAILED') {
    return '시작 실패';
  }

  if (failureCode === 'RUN_REQUEST_FAILED') {
    return '요청 실패';
  }

  if (failureCode === 'RUNNER_EXECUTION_FAILED') {
    return '진행 실패';
  }

  return failureCode ?? '실패';
}

function getRunStepStatus(status: RunStep['status']): StepStatus {
  if (status === 'PASSED') {
    return 'complete';
  }

  if (status === 'RUNNING') {
    return 'active';
  }

  if (status === 'FAILED' || status === 'BLOCKED' || status === 'STOPPED') {
    return 'failed';
  }

  return 'pending';
}

function getRunStepTimestamp(step: RunStep) {
  if (step.finishedAt) {
    return formatRunStartedAt(step.finishedAt);
  }

  if (step.startedAt) {
    return formatRunStartedAt(step.startedAt);
  }

  return '대기 중';
}

function getRunStepDetail(step: RunStep) {
  if (step.status === 'FAILED') {
    const failureLabel = getFailureCodeLabel(step.errorCode);
    return step.errorCode === 'RUNNER_TIMEOUT'
      ? '응답이 지연되어 확인이 막혔습니다.'
      : `${failureLabel}로 확인이 막혔습니다.`;
  }

  if (step.status === 'RUNNING') {
    return RUN_STEP_TYPE_DETAILS[step.stepType] ?? '화면 흐름을 확인하고 있습니다.';
  }

  if (step.status === 'PASSED') {
    return '확인을 마쳤습니다.';
  }

  return '곧 확인할 예정입니다.';
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
      label: '실행 상태 확인',
      detail: `${RUN_STATUS_LABEL[live.status]} 상태를 확인했습니다.`,
      status: live.status === 'FAILED' ? 'failed' : 'complete',
      timestamp: formatRunStartedAt(run.startedAt),
    },
    {
      id: 'api-current-checkpoint',
      label: currentOrder ? `체크포인트 ${currentOrder}` : '체크포인트 대기',
      detail: getApiCheckpoint(live),
      status: getApiCheckpointStatus(live.status),
      timestamp: '상태 확인',
    },
    {
      id: 'api-step-adapter',
      label: '확인 경로 준비',
      detail: '실행 단계가 저장되면 확인 경로를 표시합니다.',
      status: live.status === 'COMPLETED' || live.status === 'FAILED' || live.status === 'STOPPED' ? 'complete' : 'pending',
      timestamp: '대기 중',
    },
  ];
}

export function buildApiStepTimeline(run: Run, live: RunLive, steps: RunStep[]): RunStepItem[] {
  if (steps.length === 0) {
    return buildApiSnapshotSteps(run, live);
  }

  return steps
    .slice()
    .sort((left, right) => left.stepOrder - right.stepOrder)
    .map((step) => ({
      id: step.id,
      label: step.stepName,
      detail: getRunStepDetail(step),
      status: getRunStepStatus(step.status),
      timestamp: getRunStepTimestamp(step),
    }));
}

export function buildApiEventTimeline(run: Run, live: RunLive, events: RunEvent[], steps: RunStep[]): RunStepItem[] {
  if (events.length === 0) {
    return buildApiStepTimeline(run, live, steps);
  }

  return sortRunEvents(events).map((event) => ({
    id: event.id,
    label: getRunEventTimelineLabel(event),
    detail: getRunEventUserSummary(event),
    status: getRunEventStatus(event.eventType),
    timestamp: getRunEventTimestamp(event),
  }));
}

export function buildApiEventLogs(run: Run, live: RunLive, events: RunEvent[]): RunActionLog[] {
  if (events.length === 0) {
    return buildApiSnapshotLogs(run, live);
  }

  return sortRunEvents(events).map((event) => ({
    id: `event-log-${event.id}`,
    time: getRunEventTimestamp(event),
    message: getRunEventUserSummary(event),
    tone: getRunEventLogTone(event.eventType),
  }));
}

export function buildApiSnapshotLogs(run: Run, live: RunLive): RunActionLog[] {
  const logs: RunActionLog[] = [
    {
      id: 'api-log-run',
      time: formatRunStartedAt(run.startedAt),
      message: '실행 상태를 불러왔습니다',
      tone: 'success',
    },
    {
      id: 'api-log-live',
      time: '현재',
      message: getApiCheckpoint(live),
      tone: live.status === 'FAILED' || live.status === 'STOP_REQUESTED' ? 'warning' : 'info',
    },
  ];

  if (run.status === 'FAILED') {
    logs.push({
      id: 'api-log-run-failure',
      time: run.finishedAt ? formatRunStartedAt(run.finishedAt) : '현재',
      message: run.failureMessage
        ? `${getFailureCodeLabel(run.failureCode)}: ${run.failureMessage}`
        : `${getFailureCodeLabel(run.failureCode)}로 Run이 실패했습니다.`,
      tone: 'warning',
    });
  }

  return logs;
}

export function canOpenRunReport(isMockRun: boolean, run?: Run, evidencePacket?: EvidencePacket | null) {
  if (isMockRun) {
    return true;
  }

  return run?.status === 'COMPLETED' && (evidencePacket?.checkpoints.length ?? 0) > 0;
}

export function getCurrentRunReportProjection(report: RunReportProjection | null, runId: string) {
  return report?.runId === runId ? report : null;
}

export function resolveRunMonitorReportCtaState({
  isMockRun,
  report,
  isLoading,
  errorMessage,
}: {
  isMockRun: boolean;
  report: RunReportProjection | null;
  isLoading: boolean;
  errorMessage: string;
}): RunMonitorReportCtaState {
  if (isMockRun || report?.reportStatus === 'READY') {
    return {
      kind: 'open',
      canOpenReport: true,
      titleLabel: '리포트 준비 완료',
      eyebrow: '다음 화면',
      message: '수집된 근거를 바탕으로 발견된 신호와 개선안을 확인합니다.',
    };
  }

  if (errorMessage) {
    return {
      kind: 'error',
      canOpenReport: false,
      titleLabel: '현재 체크포인트',
      eyebrow: '리포트 상태',
      message: errorMessage,
    };
  }

  if (isLoading) {
    return {
      kind: 'loading',
      canOpenReport: false,
      titleLabel: '현재 체크포인트',
      eyebrow: '리포트 상태',
      message: '리포트 상태 확인 중입니다.',
    };
  }

  if (report?.reportStatus === 'GENERATABLE') {
    return {
      kind: 'generate',
      canOpenReport: false,
      titleLabel: '현재 체크포인트',
      eyebrow: '리포트 상태',
      message: '분석 결과가 준비되었습니다. 리포트를 준비하는 중입니다. 완료되면 바로 확인할 수 있습니다.',
    };
  }

  if (report?.reportStatus === 'NOT_READY') {
    return {
      kind: report.analysisStatus === 'NOT_STARTED' ? 'request-analysis' : 'waiting',
      canOpenReport: false,
      titleLabel: '현재 체크포인트',
      eyebrow: '리포트 상태',
      message: report.analysisStatus === 'NOT_STARTED'
        ? '분석을 요청하고 있습니다. 완료되면 리포트를 자동으로 준비합니다.'
        : '분석 결과를 기다리는 중입니다. 완료되면 리포트를 자동으로 준비합니다.',
    };
  }

  if (report?.reportStatus === 'FAILED') {
    return {
      kind: 'failed',
      canOpenReport: false,
      titleLabel: '현재 체크포인트',
      eyebrow: '리포트 상태',
      message: report.errorMessage ?? '리포트를 준비하지 못했습니다. 분석 상태를 확인해주세요.',
    };
  }

  return {
    kind: 'hidden',
    canOpenReport: false,
    titleLabel: '현재 체크포인트',
    eyebrow: '리포트 상태',
    message: '',
  };
}

export function canRequestRunStop(status: RunStatus) {
  return status === 'CREATED' || status === 'QUEUED' || status === 'STARTING' || status === 'RUNNING';
}

export function canRequestRunDelete(status: RunStatus) {
  return status === 'COMPLETED' || status === 'FAILED' || status === 'STOPPED';
}

export function shouldRefreshRunLive(status: RunStatus) {
  return status === 'CREATED' || status === 'QUEUED' || status === 'STARTING' || status === 'RUNNING' || status === 'STOP_REQUESTED';
}

export function shouldRefreshRunReport(report: RunReportProjection | null) {
  return report?.reportStatus === 'NOT_READY' && report.analysisStatus !== 'NOT_STARTED';
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
