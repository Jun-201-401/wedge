import { getScenarioLabel } from '../../../shared';
import type { Run, RunLive } from '../../../entities/run';

export type StepStatus = 'complete' | 'active' | 'pending' | 'failed';
export type LogTone = 'info' | 'success' | 'warning';

export interface RunStepItem {
  id: string;
  label: string;
  detail: string;
  status: StepStatus;
  timestamp: string;
}

export interface RunActionLog {
  id: string;
  time: string;
  message: string;
  tone: LogTone;
}

export interface MockRunMonitorData {
  run: Run;
  live: RunLive;
  progressPercent: number;
  currentCheckpoint: string;
  previewTitle: string;
  previewSubtitle: string;
  previewCallToAction: string;
  steps: RunStepItem[];
  logs: RunActionLog[];
}

export function buildMockRunMonitorData(runId: string, startUrl: string, scenarioLabel: string): MockRunMonitorData {
  const now = new Date().toISOString();

  return {
    run: {
      id: runId,
      type: 'run',
      projectId: 'demo-project',
      name: scenarioLabel,
      triggerSource: 'WEB',
      startUrl,
      goal: scenarioLabel,
      devicePreset: 'desktop',
      scenarioTemplateVersionId: 'scenario-template-live-site-trace',
      status: 'RUNNING',
      resultCompleteness: 'PARTIAL',
      analysisStatus: 'RUNNING',
      currentStepOrder: 4,
      startedAt: now,
      finishedAt: null,
      failureCode: null,
      failureMessage: null,
      latestSnapshot: null,
    },
    live: {
      runId,
      status: 'RUNNING',
      currentStepOrder: 4,
      currentAction: '주요 CTA 클릭 후 도착 화면 확인 중',
      latestFrame: null,
      latestCheckpoint: {
        checkpointId: `${runId}-checkpoint-cta`,
        stepId: 'cta-candidates',
        stage: 'cta_candidate_scan',
        url: startUrl,
        capturedAt: now,
        durationMs: 1420,
        observationCount: 2,
        artifactRefCount: 2,
      },
      evidenceCounts: {
        checkpointCount: 2,
        observationCount: 4,
        artifactCount: 2,
      },
    },
    progressPercent: 64,
    currentCheckpoint: '주요 CTA 클릭 후 도착 화면 확인 중',
    previewTitle: 'Make your value clear above the fold',
    previewSubtitle: 'Hero section · 주요 CTA 감지',
    previewCallToAction: 'Start free trial',
    steps: [
      {
        id: 'queued',
        label: 'Run 대기열 등록',
        detail: '분석 요청을 생성하고 실행 대기열에 등록했습니다.',
        status: 'complete',
        timestamp: '10:41:02',
      },
      {
        id: 'open-page',
        label: '브라우저 열기',
        detail: '대상 URL을 열고 첫 응답을 확인했습니다.',
        status: 'complete',
        timestamp: '10:41:06',
      },
      {
        id: 'capture-hero',
        label: '첫 화면 캡처',
        detail: '첫 화면 메시지와 주요 영역을 캡처했습니다.',
        status: 'complete',
        timestamp: '10:41:09',
      },
      {
        id: 'cta-candidates',
        label: 'CTA 후보 감지',
        detail: 'Primary CTA와 navigation CTA 후보를 비교하고 있습니다.',
        status: 'active',
        timestamp: '10:41:13',
      },
      {
        id: 'cta-click',
        label: '주요 CTA 클릭',
        detail: '선택한 CTA 클릭 후 도착 화면의 맥락을 확인합니다.',
        status: 'pending',
        timestamp: '대기 중',
      },
      {
        id: 'form-discovery',
        label: 'Form 탐색',
        detail: '입력 form, pricing, contact 후보를 찾습니다.',
        status: 'pending',
        timestamp: '대기 중',
      },
      {
        id: 'summary',
        label: '요약 생성',
        detail: '수집된 근거를 우선순위와 리포트 초안으로 정리합니다.',
        status: 'pending',
        timestamp: '대기 중',
      },
    ],
    logs: [
      { id: 'log-1', time: '10:41:02', message: '대상 페이지를 열고 있습니다', tone: 'info' },
      { id: 'log-2', time: '10:41:06', message: '첫 화면을 캡처했습니다', tone: 'success' },
      { id: 'log-3', time: '10:41:09', message: '주요 CTA 후보를 확인했습니다', tone: 'success' },
      { id: 'log-4', time: '10:41:13', message: '선택한 목표와 CTA 흐름을 비교하고 있습니다', tone: 'info' },
      { id: 'log-5', time: '10:41:16', message: '다음 근거 수집을 기다리고 있습니다', tone: 'warning' },
    ],
  };
}
