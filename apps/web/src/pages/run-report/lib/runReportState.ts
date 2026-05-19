import type { RunReportProjection } from '../../../entities/report';
import type { EvidencePacket, Run } from '../../../entities/run';
import { RUN_STATUS_LABEL } from '../../../entities/run';

export type RunReportResolution =
  | { kind: 'ready' }
  | { kind: 'loading'; title: string; message: string }
  | { kind: 'error'; title: string; message: string }
  | { kind: 'not-ready'; title: string; message: string }
  | { kind: 'api-pending'; title: string; message: string };

interface ResolveRunReportStateInput {
  isMockRun: boolean;
  isRunLoading: boolean;
  runLoadError: string;
  run: Run | null;
  isEvidenceLoading?: boolean;
  evidenceLoadError?: string;
  evidencePacket?: EvidencePacket | null;
  isReportLoading?: boolean;
  reportLoadError?: string;
  report?: RunReportProjection | null;
}

function hasReportEvidence(evidencePacket: EvidencePacket | null | undefined) {
  return Array.isArray(evidencePacket?.checkpoints) && evidencePacket.checkpoints.length > 0;
}

function canShowReportForRun(run: Run) {
  return run.status === 'COMPLETED' || (run.status === 'FAILED' && run.resultCompleteness === 'PARTIAL');
}

export function resolveRunReportState({
  isMockRun,
  isRunLoading,
  runLoadError,
  run,
  isEvidenceLoading = false,
  evidenceLoadError = '',
  evidencePacket = null,
  isReportLoading = false,
  reportLoadError = '',
  report = null,
}: ResolveRunReportStateInput): RunReportResolution {
  if (isMockRun) {
    return { kind: 'ready' };
  }

  if (isRunLoading) {
    return {
      kind: 'loading',
      title: '리포트 상태를 확인하는 중입니다',
      message: '실행 상태와 리포트 생성 가능 여부를 확인하고 있습니다.',
    };
  }

  if (runLoadError) {
    return {
      kind: 'error',
      title: '리포트 상태를 표시할 수 없습니다',
      message: runLoadError,
    };
  }

  if (!run) {
    return {
      kind: 'error',
      title: '실행 결과를 찾을 수 없습니다',
      message: '실행 상태를 확인할 수 없습니다. URL 또는 접근 권한을 확인한 뒤 다시 시도해주세요.',
    };
  }

  if (!canShowReportForRun(run)) {
    return {
      kind: 'not-ready',
      title: '리포트 준비 중입니다',
      message: `현재 실행 상태는 ${RUN_STATUS_LABEL[run.status]}입니다. 실행이 완료되면 결과 리포트를 확인할 수 있습니다.`,
    };
  }

  if (isReportLoading) {
    return {
      kind: 'loading',
      title: '서버 리포트 상태를 확인하는 중입니다',
      message: '분석 결과와 리포트 생성 가능 여부를 서버에서 확인하고 있습니다.',
    };
  }

  if (report?.reportStatus === 'READY') {
    return { kind: 'ready' };
  }

  if (report?.reportStatus === 'FAILED') {
    return {
      kind: 'error',
      title: '리포트 생성에 실패했습니다',
      message: report.errorMessage ?? '분석 리포트 생성 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
    };
  }

  if (report?.reportStatus === 'GENERATABLE') {
    return {
      kind: 'api-pending',
      title: '리포트 생성이 필요합니다',
      message: '분석이 완료됐습니다. 리포트를 생성해주세요.',
    };
  }

  if (report?.reportStatus === 'NOT_READY') {
    return {
      kind: 'api-pending',
      title: '리포트 준비 중',
      message: report.analysisStatus === 'NOT_STARTED'
        ? '아직 분석이 시작되지 않았습니다. 분석을 시작하면 수집된 근거를 바탕으로 리포트를 생성합니다.'
        : '분석이 진행 중입니다. 분석 완료 후 리포트를 생성할 수 있습니다.',
    };
  }

  if (isEvidenceLoading) {
    return {
      kind: 'loading',
      title: '리포트 근거를 불러오는 중입니다',
      message: '완료된 실행의 수집 근거를 리포트 형태로 변환하고 있습니다.',
    };
  }

  if (evidenceLoadError) {
    return {
      kind: 'error',
      title: '리포트 근거를 불러오지 못했습니다',
      message: evidenceLoadError,
    };
  }

  if (!hasReportEvidence(evidencePacket)) {
    return {
      kind: reportLoadError ? 'error' : 'api-pending',
      title: reportLoadError ? '리포트 상태를 불러오지 못했습니다' : '리포트 데이터 연결 대기 중입니다',
      message: reportLoadError || '실행은 완료됐지만 서버 리포트나 수집 근거가 아직 준비되지 않았습니다.',
    };
  }

  return { kind: 'ready' };
}
