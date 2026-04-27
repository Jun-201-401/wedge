import type { Run } from '../../../entities/run';
import { RUN_STATUS_LABEL } from '../../../entities/run';

export type RunReportResolution =
  | { kind: 'mock-ready' }
  | { kind: 'loading'; title: string; message: string }
  | { kind: 'error'; title: string; message: string }
  | { kind: 'not-ready'; title: string; message: string }
  | { kind: 'api-pending'; title: string; message: string };

interface ResolveRunReportStateInput {
  isMockRun: boolean;
  isRunLoading: boolean;
  runLoadError: string;
  run: Run | null;
}

export function resolveRunReportState({
  isMockRun,
  isRunLoading,
  runLoadError,
  run,
}: ResolveRunReportStateInput): RunReportResolution {
  if (isMockRun) {
    return { kind: 'mock-ready' };
  }

  if (isRunLoading) {
    return {
      kind: 'loading',
      title: '리포트 상태를 확인하는 중입니다',
      message: '실제 Run 상태와 리포트 생성 가능 여부를 확인하고 있습니다.',
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
      title: 'Run을 찾을 수 없습니다',
      message: 'Run 상태를 확인할 수 없습니다. URL 또는 접근 권한을 확인한 뒤 다시 시도해주세요.',
    };
  }

  if (run.status !== 'COMPLETED' || run.analysisStatus !== 'COMPLETED') {
    return {
      kind: 'not-ready',
      title: '리포트 준비 중입니다',
      message: `현재 Run 상태는 ${RUN_STATUS_LABEL[run.status]}입니다. 분석이 완료되면 결과 리포트를 확인할 수 있습니다.`,
    };
  }

  return {
    kind: 'api-pending',
    title: '리포트 데이터 연결 대기 중입니다',
    message: 'Run은 완료됐지만 실제 report/evidence API가 아직 연결되지 않아 mock 결과를 표시하지 않습니다.',
  };
}
