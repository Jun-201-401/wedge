import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';

import { generateRunReport, getRunReport } from '../../api/reports';
import { handleSpaNavigationClick, replaceAppPath } from '../../shared/lib/navigation';
import { useAuthenticatedResourceUrl } from '../../shared/lib/authenticatedResourceUrl';
import { formatDisplayUrl } from '../../shared/lib/displayUrl';
import { deleteRun, requestRunAnalysis, stopRun } from '../../api/runs';
import type { RunReportProjection } from '../../entities/report';
import type { EvidencePacket, RunEvidenceCounts } from '../../entities/run';
import { RUN_STATUS_LABEL } from '../../entities/run';
import {
  buildApiEventLogs,
  buildApiEventTimeline,
  buildApiSnapshotLogs,
  buildApiStepTimeline,
  buildMockRunMonitorData,
  canRequestRunDelete,
  canRequestRunStop,
  findEvidenceScreenshotArtifact,
  getApiCheckpoint,
  getApiProgressPercent,
  getCurrentRunReportProjection,
  getDepthLabel,
  getDevicePresetLabel,
  getStatusTone,
  getStepStatusLabel,
  RUN_MONITOR_REFRESH_INTERVAL_MS,
  resolveRunMonitorReportCtaState,
  shouldRefreshRunReport,
  type RunStatusTone,
  type StepStatus,
  useRunMonitorState,
} from '../../features/run-monitor';
import { getScenarioLabel } from '../../shared';
import { RUNS_PATH } from '../../shared/lib/appPaths';
import { buildRunReportPath } from '../run-report/lib/runReportRoute';
import { isMockRunId } from './lib/runMonitorRoute';
import './RunMonitorPage.css';

interface RunMonitorPageProps {
  runId: string;
}

type MonitorActionState = {
  kind: 'idle' | 'pending' | 'success' | 'error';
  message: string;
};

const IDLE_MONITOR_ACTION_STATE: MonitorActionState = { kind: 'idle', message: '' };
const REPORT_STATUS_LOAD_ERROR_MESSAGE = '리포트 상태를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.';
const GENERATE_REPORT_PENDING_MESSAGE = '리포트 준비 중입니다.';
const GENERATE_REPORT_SUCCESS_MESSAGE = '리포트 준비가 완료됐습니다.';
const GENERATE_REPORT_ERROR_MESSAGE = '리포트를 준비하지 못했습니다. 잠시 후 다시 시도해주세요.';
const REQUEST_ANALYSIS_PENDING_MESSAGE = '분석 요청 중입니다.';
const REQUEST_ANALYSIS_SUCCESS_MESSAGE = '분석 요청이 접수됐습니다. 분석이 완료되면 리포트를 자동으로 준비합니다.';
const REQUEST_ANALYSIS_ERROR_MESSAGE = '분석 요청에 실패했습니다. Run 상태 또는 접근 권한을 확인해주세요.';
const PREPARE_REPORT_PENDING_LABEL = '리포트 준비 중';
const RUN_MONITOR_PANEL_DEFAULT_WIDTH = 448;
const RUN_MONITOR_PANEL_MIN_WIDTH = 336;
const RUN_MONITOR_PANEL_MAX_WIDTH = 640;
const RUN_MONITOR_CAPTURE_MIN_WIDTH = 560;
const RUN_MONITOR_RESIZE_STEP = 24;

function readQueryParam(name: string) {
  if (typeof window === 'undefined') {
    return null;
  }

  return new URLSearchParams(window.location.search).get(name);
}

function getFallbackUrl() {
  return readQueryParam('url') ?? 'https://example.com/';
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getResizablePanelBounds(cockpit: HTMLDivElement | null) {
  if (!cockpit) {
    return {
      min: RUN_MONITOR_PANEL_MIN_WIDTH,
      max: RUN_MONITOR_PANEL_MAX_WIDTH,
    };
  }

  const availableWidth = cockpit.getBoundingClientRect().width;
  const maxByCaptureWidth = Math.max(RUN_MONITOR_PANEL_MIN_WIDTH, availableWidth - RUN_MONITOR_CAPTURE_MIN_WIDTH);

  return {
    min: RUN_MONITOR_PANEL_MIN_WIDTH,
    max: Math.min(RUN_MONITOR_PANEL_MAX_WIDTH, maxByCaptureWidth),
  };
}

function StepNode({ status }: { status: StepStatus }) {
  if (status === 'complete') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className="run-monitor-step__check" aria-hidden="true">
        <path d="M19.5 6.5 9 17 4.5 12.5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  if (status === 'active') {
    return <span className="run-monitor-step__active-dot" aria-hidden="true" />;
  }

  if (status === 'failed') {
    return <span className="run-monitor-step__fail" aria-hidden="true">!</span>;
  }

  return <span className="run-monitor-step__dot" aria-hidden="true" />;
}

function RunMonitorTopbar() {
  return (
    <header className="run-monitor-topbar" aria-label="Wedge navigation">
      <div className="run-monitor-topbar__left">
        <a href="/" className="run-monitor-brand" aria-label="Wedge home">
          <span>Wedge</span>
        </a>
      </div>

      <nav className="run-monitor-topbar__right" aria-label="주요 이동">
        <a href={RUNS_PATH} className="run-monitor-topbar__link run-monitor-topbar__link--secondary">실행 목록</a>
        <a href="/create-analysis" className="run-monitor-topbar__link run-monitor-topbar__link--primary">새 분석</a>
      </nav>
    </header>
  );
}

interface RunContextBarProps {
  runId: string;
  targetUrl: string;
  statusTone?: RunStatusTone;
  statusLabel?: string;
  deviceLabel: string;
  actions?: ReactNode;
}

function RunContextBar({ runId, targetUrl, statusTone, statusLabel, deviceLabel, actions }: RunContextBarProps) {
  const targetUrlLabel = formatDisplayUrl(targetUrl);

  return (
    <section className="run-monitor-run-context" aria-label="현재 Run 정보">
      <div className="run-monitor-run-context__meta">
        <div className="run-monitor-target-inline run-monitor-target-inline--target">
          <span>대상</span>
          <strong title={targetUrl}>{targetUrlLabel}</strong>
        </div>
        <div className="run-monitor-target-inline run-monitor-target-inline--optional">
          <span>디바이스</span>
          <strong>{deviceLabel}</strong>
        </div>
        <div className="run-monitor-target-inline run-monitor-target-inline--id">
          <span>실행 ID</span>
          <strong>{runId}</strong>
        </div>
      </div>

      <div className="run-monitor-run-context__actions">
        {statusTone && statusLabel && (
          <div className={`run-monitor-status run-monitor-status--${statusTone}`} aria-label={`실행 상태 ${statusLabel}`}>
            <span className="run-monitor-status__dot" aria-hidden="true" />
            <span>{statusLabel}</span>
          </div>
        )}
        {actions}
      </div>
    </section>
  );
}

function RunLifecycleActions({
  canStop,
  canDelete,
  isPending,
  onStop,
  onDelete,
}: {
  canStop: boolean;
  canDelete: boolean;
  isPending: boolean;
  onStop: () => void;
  onDelete: () => void;
}) {
  if (!canStop && !canDelete) {
    return null;
  }

  return (
    <div className="run-monitor-lifecycle-actions" aria-label="Run 제어">
      {canStop ? (
        <button type="button" onClick={onStop} disabled={isPending}>
          {isPending ? '요청 중' : '중지'}
        </button>
      ) : null}
      {canDelete ? (
        <button type="button" onClick={onDelete} disabled={isPending}>
          {isPending ? '처리 중' : '삭제'}
        </button>
      ) : null}
    </div>
  );
}

function RunMonitorStatePage({ title, message }: { title: string; message: string }) {
  return (
    <div className="run-monitor-page">
      <div className="run-monitor-grid-bg" aria-hidden="true" />
      <RunMonitorTopbar />

      <main className="run-monitor-state-screen" aria-labelledby="run-monitor-state-title">
        <section className="run-monitor-state-card">
          <span className="run-monitor-state-card__badge">실시간 Trace</span>
          <h1 id="run-monitor-state-title">{title}</h1>
          <p>{message}</p>
          <a href="/create-analysis">새 분석 만들기</a>
        </section>
      </main>
    </div>
  );
}

function RunMonitorSkeletonLine({ className = '' }: { className?: string }) {
  const skeletonClassName = className ? `run-monitor-skeleton-line ${className}` : 'run-monitor-skeleton-line';
  return <span className={skeletonClassName} aria-hidden="true" />;
}

function RunMonitorLoadingShell({ runId, targetUrl }: { runId: string; targetUrl: string }) {
  return (
    <div className="run-monitor-page run-monitor-page--loading" aria-busy="true">
      <div className="run-monitor-grid-bg" aria-hidden="true" />

      <RunMonitorTopbar />

      <main className="run-monitor-workspace" aria-labelledby="run-monitor-title">
        <RunContextBar
          runId={runId}
          targetUrl={targetUrl}
          deviceLabel="확인 중"
        />

        <div className="run-monitor-cockpit">
          <section className="run-monitor-simulation" aria-labelledby="run-monitor-title">
            <span className="run-monitor-sr-only" role="status">실제 실행 데이터를 연결하고 있습니다.</span>

            <div className="run-monitor-simulation__header">
              <div className="run-monitor-section-title">
                <h1 id="run-monitor-title">실시간 시뮬레이션</h1>
                <span aria-hidden="true" />
                <RunMonitorSkeletonLine className="run-monitor-skeleton-line--checkpoint" />
              </div>
            </div>

            <div className="run-monitor-browser" aria-hidden="true">
              <div className="run-monitor-browser__bar">
                <div className="run-monitor-browser__dots">
                  <span />
                  <span />
                  <span />
                </div>
              </div>

              <div className="run-monitor-browser__stage run-monitor-browser__stage--skeleton" />
            </div>
          </section>

          <aside className="run-monitor-analysis-panel" aria-hidden="true">
            <section className="run-monitor-progress-panel">
              <div className="run-monitor-panel-heading">
                <h2>전체 진행률</h2>
                <RunMonitorSkeletonLine className="run-monitor-skeleton-line--metric" />
              </div>
              <div className="run-monitor-progress__track run-monitor-progress__track--skeleton">
                <span />
              </div>
            </section>

            <section className="run-monitor-live-insight">
              <div className="run-monitor-live-insight__label">
                <span />
                <h2>분석 상태</h2>
              </div>
              <div className="run-monitor-live-insight__card run-monitor-live-insight__card--skeleton">
                <RunMonitorSkeletonLine className="run-monitor-skeleton-line--title" />
                <RunMonitorSkeletonLine />
                <RunMonitorSkeletonLine className="run-monitor-skeleton-line--short" />
              </div>
            </section>

            <div className="run-monitor-panel-scroll">
              <section className="run-monitor-context run-monitor-context--skeleton">
                <h2>실행 정보</h2>
                <dl>
                  {[0, 1, 2, 3].map((item) => (
                    <div key={item}>
                      <dt><RunMonitorSkeletonLine className="run-monitor-skeleton-line--label" /></dt>
                      <dd><RunMonitorSkeletonLine /></dd>
                    </div>
                  ))}
                </dl>
              </section>

              <section className="run-monitor-timeline">
                <h2>시나리오 경로</h2>
                <ol className="run-monitor-timeline__list">
                  {[0, 1, 2].map((item) => (
                    <li key={item} className="run-monitor-step run-monitor-step--skeleton">
                      <div className="run-monitor-step__node" />
                      <div className="run-monitor-step__content">
                        <RunMonitorSkeletonLine className="run-monitor-skeleton-line--title" />
                        <RunMonitorSkeletonLine />
                      </div>
                    </li>
                  ))}
                </ol>
              </section>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}

interface EvidenceSummaryStats {
  checkpointCount: number;
  observationCount: number;
  artifactCount: number;
}

function getEvidenceSummaryStats(
  evidencePacket: EvidencePacket | null,
  liveCounts: RunEvidenceCounts | null | undefined,
): EvidenceSummaryStats | null {
  if (evidencePacket) {
    return {
      checkpointCount: evidencePacket.checkpoints.length,
      observationCount: evidencePacket.checkpoints.reduce((count, checkpoint) => count + checkpoint.observations.length, 0),
      artifactCount: evidencePacket.artifacts.length,
    };
  }

  if (liveCounts) {
    return {
      checkpointCount: liveCounts.checkpointCount,
      observationCount: liveCounts.observationCount,
      artifactCount: liveCounts.artifactCount,
    };
  }

  return null;
}

function EvidenceCollectionSummary({
  stats,
  isLoading,
  errorMessage,
}: {
  stats: EvidenceSummaryStats | null;
  isLoading: boolean;
  errorMessage: string;
}) {
  if (!stats && !isLoading && !errorMessage) {
    return null;
  }

  return (
    <div className="run-monitor-evidence-summary" aria-label="수집 상태 요약">
      <span>수집</span>
      {stats ? (
        <dl>
          <div>
            <dt>체크</dt>
            <dd>{stats.checkpointCount}</dd>
          </div>
          <div>
            <dt>신호</dt>
            <dd>{stats.observationCount}</dd>
          </div>
          <div>
            <dt>자료</dt>
            <dd>{stats.artifactCount}</dd>
          </div>
        </dl>
      ) : (
        <p>{isLoading ? '수집 상태 확인 중' : errorMessage}</p>
      )}
    </div>
  );
}

export function RunMonitorPage({ runId }: RunMonitorPageProps) {
  const fallbackUrl = getFallbackUrl();
  const scenarioLabel = getScenarioLabel(readQueryParam('scenario'));
  const depthLabel = getDepthLabel(readQueryParam('depth'));
  const mockData = useMemo(() => buildMockRunMonitorData(runId, fallbackUrl, scenarioLabel), [fallbackUrl, runId, scenarioLabel]);
  const isMockRun = isMockRunId(runId);
  const {
    run,
    live,
    isApiFallback,
    hasRealRunSnapshot,
    isRealRunLoading,
    apiLoadError,
    evidencePacket,
    isEvidenceLoading,
    evidenceLoadError,
    runSteps,
    isStepLoading,
    stepLoadError,
    runEvents,
    isEventLoading,
    eventLoadError,
  } = useRunMonitorState(runId, mockData, isMockRun);
  const [runActionState, setRunActionState] = useState<{ kind: 'idle' | 'pending' | 'success' | 'error'; message: string }>({
    kind: 'idle',
    message: '',
  });
  const [reportProjection, setReportProjection] = useState<RunReportProjection | null>(null);
  const [isReportStatusLoading, setIsReportStatusLoading] = useState(false);
  const [reportStatusError, setReportStatusError] = useState('');
  const [reportActionState, setReportActionState] = useState<MonitorActionState>(IDLE_MONITOR_ACTION_STATE);
  const activeRouteRunIdRef = useRef(runId);
  const autoReportAnalysisRunIdRef = useRef<string | null>(null);
  const autoReportGenerationRunIdRef = useRef<string | null>(null);
  const isMonitorMountedRef = useRef(false);
  const cockpitRef = useRef<HTMLDivElement | null>(null);
  const [analysisPanelWidth, setAnalysisPanelWidth] = useState(RUN_MONITOR_PANEL_DEFAULT_WIDTH);

  useEffect(() => {
    isMonitorMountedRef.current = true;

    return () => {
      isMonitorMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    activeRouteRunIdRef.current = runId;
    autoReportAnalysisRunIdRef.current = null;
    autoReportGenerationRunIdRef.current = null;
  }, [runId]);

  const canApplyReportResponse = useCallback((responseRunId: string) => {
    return isMonitorMountedRef.current && activeRouteRunIdRef.current === responseRunId;
  }, []);

  const currentReportProjection = useMemo(
    () => getCurrentRunReportProjection(reportProjection, run.id),
    [reportProjection, run.id],
  );
  const shouldRefreshCurrentReport = shouldRefreshRunReport(currentReportProjection)
    || (
      currentReportProjection?.reportStatus === 'NOT_READY'
      && currentReportProjection.analysisStatus === 'NOT_STARTED'
      && autoReportAnalysisRunIdRef.current === run.id
    );

  const generateReportForRun = useCallback((requestedRunId: string) => {
    setReportActionState({ kind: 'pending', message: GENERATE_REPORT_PENDING_MESSAGE });
    void generateRunReport(requestedRunId)
      .then((response) => {
        if (!canApplyReportResponse(requestedRunId)) {
          return;
        }

        setReportProjection(response.data);
        setReportStatusError('');
        setReportActionState({ kind: 'success', message: GENERATE_REPORT_SUCCESS_MESSAGE });
      })
      .catch(() => {
        if (!canApplyReportResponse(requestedRunId)) {
          return;
        }

        setReportActionState({ kind: 'error', message: GENERATE_REPORT_ERROR_MESSAGE });
      });
  }, [canApplyReportResponse]);

  const requestAnalysisForRun = useCallback((requestedRunId: string) => {
    setReportActionState({ kind: 'pending', message: REQUEST_ANALYSIS_PENDING_MESSAGE });
    void requestRunAnalysis(requestedRunId)
      .then(() => getRunReport(requestedRunId))
      .then((response) => {
        if (!canApplyReportResponse(requestedRunId)) {
          return;
        }

        setReportProjection(response.data);
        setReportStatusError('');
        setReportActionState({ kind: 'success', message: REQUEST_ANALYSIS_SUCCESS_MESSAGE });
      })
      .catch(() => {
        if (!canApplyReportResponse(requestedRunId)) {
          return;
        }

        setReportActionState({ kind: 'error', message: REQUEST_ANALYSIS_ERROR_MESSAGE });
      });
  }, [canApplyReportResponse]);

  useEffect(() => {
    if (isMockRun || run.status !== 'COMPLETED' || run.id !== runId) {
      setReportProjection(null);
      setIsReportStatusLoading(false);
      setReportStatusError('');
      setReportActionState(IDLE_MONITOR_ACTION_STATE);
      return;
    }

    let isActive = true;

    async function loadReportStatus() {
      setIsReportStatusLoading(true);
      setReportStatusError('');
      setReportActionState(IDLE_MONITOR_ACTION_STATE);

      try {
        const response = await getRunReport(run.id);

        if (!isActive || !canApplyReportResponse(run.id)) {
          return;
        }

        setReportProjection(response.data);
        setReportStatusError('');
      } catch {
        if (!isActive || !canApplyReportResponse(run.id)) {
          return;
        }

        setReportProjection(null);
        setReportStatusError(REPORT_STATUS_LOAD_ERROR_MESSAGE);
      } finally {
        if (isActive && canApplyReportResponse(run.id)) {
          setIsReportStatusLoading(false);
        }
      }
    }

    void loadReportStatus();

    return () => {
      isActive = false;
    };
  }, [canApplyReportResponse, isMockRun, run.id, run.status, runId]);

  useEffect(() => {
    if (isMockRun || run.status !== 'COMPLETED' || run.id !== runId || !shouldRefreshCurrentReport) {
      return;
    }

    let isActive = true;
    const refreshTimerId = window.setTimeout(() => {
      void getRunReport(run.id)
        .then((response) => {
          if (!isActive || !canApplyReportResponse(run.id)) {
            return;
          }

          setReportProjection(response.data);
          setReportStatusError('');
        })
        .catch(() => {
          if (!isActive || !canApplyReportResponse(run.id)) {
            return;
          }

          setReportStatusError(REPORT_STATUS_LOAD_ERROR_MESSAGE);
        });
    }, RUN_MONITOR_REFRESH_INTERVAL_MS);

    return () => {
      isActive = false;
      window.clearTimeout(refreshTimerId);
    };
  }, [canApplyReportResponse, currentReportProjection, isMockRun, run.id, run.status, runId, shouldRefreshCurrentReport]);

  useEffect(() => {
    if (
      isMockRun
      || run.status !== 'COMPLETED'
      || run.id !== runId
      || currentReportProjection?.reportStatus !== 'NOT_READY'
      || currentReportProjection.analysisStatus !== 'NOT_STARTED'
      || reportActionState.kind === 'pending'
      || autoReportAnalysisRunIdRef.current === run.id
    ) {
      return;
    }

    autoReportAnalysisRunIdRef.current = run.id;
    requestAnalysisForRun(run.id);
  }, [
    currentReportProjection?.analysisStatus,
    currentReportProjection?.reportStatus,
    isMockRun,
    reportActionState.kind,
    requestAnalysisForRun,
    run.id,
    run.status,
    runId,
  ]);

  useEffect(() => {
    if (
      isMockRun
      || run.status !== 'COMPLETED'
      || run.id !== runId
      || currentReportProjection?.reportStatus !== 'GENERATABLE'
      || reportActionState.kind === 'pending'
      || autoReportGenerationRunIdRef.current === run.id
    ) {
      return;
    }

    autoReportGenerationRunIdRef.current = run.id;
    generateReportForRun(run.id);
  }, [currentReportProjection?.reportStatus, generateReportForRun, isMockRun, reportActionState.kind, run.id, run.status, runId]);

  const updateAnalysisPanelWidth = useCallback((nextWidth: number) => {
    const bounds = getResizablePanelBounds(cockpitRef.current);
    setAnalysisPanelWidth(clampNumber(nextWidth, bounds.min, bounds.max));
  }, []);

  const updateAnalysisPanelWidthFromPointer = useCallback((clientX: number) => {
    const cockpit = cockpitRef.current;

    if (!cockpit) {
      return;
    }

    const rect = cockpit.getBoundingClientRect();
    updateAnalysisPanelWidth(rect.right - clientX);
  }, [updateAnalysisPanelWidth]);

  const handleAnalysisPanelResizePointerDown = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    updateAnalysisPanelWidthFromPointer(event.clientX);
  }, [updateAnalysisPanelWidthFromPointer]);

  const handleAnalysisPanelResizePointerMove = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    if (event.buttons !== 1) {
      return;
    }

    updateAnalysisPanelWidthFromPointer(event.clientX);
  }, [updateAnalysisPanelWidthFromPointer]);

  const handleAnalysisPanelResizeKeyDown = useCallback((event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      updateAnalysisPanelWidth(analysisPanelWidth + RUN_MONITOR_RESIZE_STEP);
      return;
    }

    if (event.key === 'ArrowRight') {
      event.preventDefault();
      updateAnalysisPanelWidth(analysisPanelWidth - RUN_MONITOR_RESIZE_STEP);
      return;
    }

    if (event.key === 'Home') {
      event.preventDefault();
      updateAnalysisPanelWidth(RUN_MONITOR_PANEL_DEFAULT_WIDTH);
      return;
    }

    if (event.key === 'End') {
      event.preventDefault();
      updateAnalysisPanelWidth(RUN_MONITOR_PANEL_MAX_WIDTH);
    }
  }, [analysisPanelWidth, updateAnalysisPanelWidth]);

  const evidenceScreenshotUrl = findEvidenceScreenshotArtifact(evidencePacket)?.uri ?? null;
  const snapshotUrl = live.latestFrame?.url ?? run.latestSnapshot?.url ?? evidenceScreenshotUrl;
  const authenticatedSnapshotUrl = useAuthenticatedResourceUrl(snapshotUrl);

  if (isRealRunLoading) {
    return <RunMonitorLoadingShell runId={runId} targetUrl={fallbackUrl} />;
  }

  if (apiLoadError && !isApiFallback && !hasRealRunSnapshot) {
    return <RunMonitorStatePage title="실시간 상태를 표시할 수 없습니다" message={apiLoadError} />;
  }

  const statusTone = getStatusTone(live.status);
  const statusLabel = RUN_STATUS_LABEL[live.status];
  const progressPercent = isApiFallback ? mockData.progressPercent : getApiProgressPercent(live);
  const currentCheckpoint = isApiFallback ? (live.currentAction ?? mockData.currentCheckpoint) : getApiCheckpoint(live);
  const traceModeLabel = isApiFallback ? '모의 실행' : '실제 실행 상태';
  const reportCtaState = resolveRunMonitorReportCtaState({
    isMockRun,
    report: currentReportProjection,
    isLoading: isReportStatusLoading,
    errorMessage: reportStatusError,
  });
  const reportPath = reportCtaState.canOpenReport
    ? buildRunReportPath(run.id, {
        submittedUrl: run.startUrl,
        scenarioId: readQueryParam('scenario') ?? 'landing-cta',
        depthId: readQueryParam('depth') ?? 'hero-only',
      })
    : null;
  const visibleSteps = isApiFallback ? mockData.steps : buildApiEventTimeline(run, live, runEvents, runSteps);
  const visibleLogs = isApiFallback ? mockData.logs : buildApiEventLogs(run, live, runEvents);
  const deviceLabel = getDevicePresetLabel(run.devicePreset);
  const evidenceStats = getEvidenceSummaryStats(evidencePacket, live.evidenceCounts);
  const timelineNote = isApiFallback
    ? '예시 실행 경로입니다. 실제 실행이 시작되면 수집한 단계로 교체됩니다.'
    : eventLoadError || (isEventLoading && runEvents.length === 0)
      ? (eventLoadError || '확인 경로를 불러오는 중입니다.')
      : runEvents.length > 0
        ? '실제 실행 이벤트를 바탕으로 확인한 경로입니다.'
        : stepLoadError || (isStepLoading && runSteps.length === 0)
          ? (stepLoadError || '확인 단계를 불러오는 중입니다.')
          : '실제 실행 단계 상태를 바탕으로 확인한 경로입니다.';
  const isRunActionPending = runActionState.kind === 'pending';
  const canStopCurrentRun = !isMockRun && canRequestRunStop(live.status);
  const canDeleteCurrentRun = !isMockRun && canRequestRunDelete(live.status);
  const isReportActionPending = reportActionState.kind === 'pending';
  const canGenerateReport = !isMockRun && reportCtaState.kind === 'generate';
  const canRequestAnalysis = !isMockRun && reportCtaState.kind === 'request-analysis';

  const openReport = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!reportPath) {
      return;
    }

    handleSpaNavigationClick(event, reportPath);
  };

  const requestStopRun = () => {
    if (!canStopCurrentRun || isRunActionPending) {
      return;
    }

    setRunActionState({ kind: 'pending', message: 'Run 중지 요청을 보내는 중입니다.' });
    void stopRun(run.id, { reason: 'user_requested_from_monitor' })
      .then(() => {
        setRunActionState({ kind: 'success', message: 'Run 중지 요청을 보냈습니다. 상태가 갱신될 때까지 잠시 기다려주세요.' });
      })
      .catch(() => {
        setRunActionState({ kind: 'error', message: 'Run 중지 요청에 실패했습니다. 권한 또는 API 서버 상태를 확인해주세요.' });
      });
  };

  const requestDeleteRun = () => {
    if (!canDeleteCurrentRun || isRunActionPending) {
      return;
    }

    if (!window.confirm('이 Run을 삭제할까요? 삭제 후 실행 목록으로 이동합니다.')) {
      return;
    }

    setRunActionState({ kind: 'pending', message: 'Run 삭제 요청을 보내는 중입니다.' });
    void deleteRun(run.id)
      .then(() => {
        replaceAppPath(RUNS_PATH);
      })
      .catch(() => {
        setRunActionState({ kind: 'error', message: 'Run 삭제에 실패했습니다. 권한 또는 API 서버 상태를 확인해주세요.' });
      });
  };

  const retryGenerateReport = () => {
    if (!canGenerateReport || isReportActionPending) {
      return;
    }

    autoReportGenerationRunIdRef.current = run.id;
    generateReportForRun(run.id);
  };

  const retryRequestAnalysisForReport = () => {
    if (!canRequestAnalysis || isReportActionPending) {
      return;
    }

    autoReportAnalysisRunIdRef.current = run.id;
    requestAnalysisForRun(run.id);
  };

  const reportActionMessage = reportActionState.message ? (
    <p className={`run-monitor-report-cta__status run-monitor-report-cta__status--${reportActionState.kind}`} role="status">
      {reportActionState.message}
    </p>
  ) : null;
  let reportCtaStatusLabel = '준비 중';
  if (reportPath) {
    reportCtaStatusLabel = '준비됨';
  } else if (isReportActionPending) {
    reportCtaStatusLabel = canRequestAnalysis ? '요청 중' : '준비 중';
  } else if (reportActionState.kind === 'error' && canRequestAnalysis) {
    reportCtaStatusLabel = '확인 필요';
  } else if (reportActionState.kind === 'error' && canGenerateReport) {
    reportCtaStatusLabel = '확인 필요';
  } else if (canGenerateReport) {
    reportCtaStatusLabel = '준비 중';
  } else if (canRequestAnalysis) {
    reportCtaStatusLabel = '요청 중';
  } else if (reportCtaState.kind === 'waiting' || reportCtaState.kind === 'loading') {
    reportCtaStatusLabel = '대기 중';
  } else if (reportCtaState.kind === 'failed' || reportCtaState.kind === 'error') {
    reportCtaStatusLabel = '확인 필요';
  }

  let reportCtaActionLabel = '대기 중';
  if (reportPath) {
    reportCtaActionLabel = '리포트 열기';
  } else if (canGenerateReport) {
    reportCtaActionLabel = reportActionState.kind === 'error' ? '다시 시도' : PREPARE_REPORT_PENDING_LABEL;
  } else if (canRequestAnalysis) {
    reportCtaActionLabel = reportActionState.kind === 'error' ? '다시 시도' : PREPARE_REPORT_PENDING_LABEL;
  }

  const reportCtaAction = reportPath ? (
    <span className="run-monitor-report-cta__open-label">{reportCtaActionLabel}</span>
  ) : canGenerateReport && reportActionState.kind === 'error' ? (
    <button type="button" onClick={retryGenerateReport} disabled={isReportActionPending}>
      {reportCtaActionLabel}
    </button>
  ) : canRequestAnalysis && reportActionState.kind === 'error' ? (
    <button type="button" onClick={retryRequestAnalysisForReport} disabled={isReportActionPending}>
      {reportCtaActionLabel}
    </button>
  ) : (
    <span className="run-monitor-report-cta__passive-label">{reportCtaActionLabel}</span>
  );
  const reportCtaCardClassName = 'run-monitor-live-insight__card run-monitor-live-insight__card--report run-monitor-report-cta';
  const reportCtaContent = (
    <>
      <div className="run-monitor-report-cta__state">
        <span>{reportCtaState.eyebrow}</span>
        <b>{reportCtaStatusLabel}</b>
      </div>
      <strong>분석 결과 리포트</strong>
      <p>{reportCtaState.message}</p>
      <div className="run-monitor-report-cta__footer">
        <EvidenceCollectionSummary
          stats={evidenceStats}
          isLoading={isEvidenceLoading}
          errorMessage={evidenceLoadError}
        />
        {reportActionMessage}
        <div className="run-monitor-report-cta__actions">
          {reportCtaAction}
        </div>
      </div>
    </>
  );

  return (
    <div className="run-monitor-page">
      <div className="run-monitor-grid-bg" aria-hidden="true" />

      <RunMonitorTopbar />

      <main className="run-monitor-workspace" aria-labelledby="run-monitor-title">
        <RunContextBar
          runId={run.id}
          targetUrl={run.startUrl}
          statusTone={statusTone}
          statusLabel={statusLabel}
          deviceLabel={deviceLabel}
          actions={(
            <RunLifecycleActions
              canStop={canStopCurrentRun}
              canDelete={canDeleteCurrentRun}
              isPending={isRunActionPending}
              onStop={requestStopRun}
              onDelete={requestDeleteRun}
            />
          )}
        />

        <div
          ref={cockpitRef}
          className="run-monitor-cockpit run-monitor-cockpit--resizable"
          style={{ '--run-monitor-analysis-panel-width': `${analysisPanelWidth}px` } as CSSProperties}
        >
          <section className="run-monitor-simulation" aria-labelledby="run-monitor-title">
            {runActionState.message ? (
              <p className={`run-monitor-action-message run-monitor-action-message--${runActionState.kind}`} role="status">
                {runActionState.message}
              </p>
            ) : null}

            <div className="run-monitor-simulation__header">
              <div className="run-monitor-section-title">
                <h1 id="run-monitor-title">실시간 시뮬레이션</h1>
                <span aria-hidden="true" />
                <p>{currentCheckpoint}</p>
              </div>
            </div>

            {apiLoadError && (
              <p className="run-monitor-api-warning" role="status">
                {apiLoadError}
              </p>
            )}

            <div className="run-monitor-browser" aria-label="최근 화면 캡처">
              <div className="run-monitor-browser__bar">
                <div className="run-monitor-browser__dots" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </div>
              </div>

              <div className={authenticatedSnapshotUrl ? 'run-monitor-browser__stage run-monitor-browser__stage--snapshot' : 'run-monitor-browser__stage'}>
                {authenticatedSnapshotUrl ? (
                  <img className="run-monitor-browser__image" src={authenticatedSnapshotUrl} alt="최근 캡처된 분석 화면" />
                ) : isApiFallback ? (
                  <div className="run-monitor-browser__mock-content">
                    <div className="run-monitor-agent-pointer" aria-hidden="true" />
                    <div className="run-monitor-scan-line" aria-hidden="true" />

                    <div className="run-monitor-mock-site">
                      <div className="run-monitor-mock-site__nav">
                        <div className="run-monitor-mock-site__logo" />
                        <div className="run-monitor-mock-site__links">
                          <span />
                          <span />
                          <strong />
                        </div>
                      </div>

                      <div className="run-monitor-mock-site__hero">
                        <p>{mockData.previewSubtitle}</p>
                        <h2>{mockData.previewTitle}</h2>
                        <span className="run-monitor-mock-site__copy" />
                        <span className="run-monitor-mock-site__copy run-monitor-mock-site__copy--short" />
                        <div className="run-monitor-detection-target">
                          <span className="run-monitor-mock-cta">{mockData.previewCallToAction}</span>
                          <div className="run-monitor-detection-box" aria-hidden="true">
                            <span>분석 대상</span>
                          </div>
                        </div>
                      </div>

                      <div className="run-monitor-mock-site__cards" aria-hidden="true">
                        <article>
                          <span />
                          <strong />
                          <p />
                          <p />
                        </article>
                        <article>
                          <span />
                          <strong />
                          <p />
                          <p />
                        </article>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="run-monitor-browser__empty-state">
                    <span aria-hidden="true" />
                    <strong>화면 캡처 대기 중</strong>
                    <p>분석 화면이 준비되면 이 영역에서 바로 확인할 수 있습니다.</p>
                  </div>
                )}
              </div>
            </div>
          </section>

          <button
            type="button"
            className="run-monitor-panel-resizer"
            aria-label="캡처 화면과 분석 메뉴 폭 조절"
            title="좌우로 드래그해서 패널 폭 조절"
            onKeyDown={handleAnalysisPanelResizeKeyDown}
            onPointerDown={handleAnalysisPanelResizePointerDown}
            onPointerMove={handleAnalysisPanelResizePointerMove}
          >
            <span aria-hidden="true" />
          </button>

          <aside className="run-monitor-analysis-panel" aria-label="실시간 분석 상태">
          <section className="run-monitor-progress-panel" aria-labelledby="run-progress-title">
            <div className="run-monitor-panel-heading">
              <h2 id="run-progress-title">전체 진행률</h2>
              <strong>{progressPercent}%</strong>
            </div>
            <div
              className="run-monitor-progress__track"
              role="progressbar"
              aria-label={`진행률 ${progressPercent}%`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progressPercent}
            >
              <span style={{ width: `${progressPercent}%` }} />
            </div>
          </section>

          <section className="run-monitor-live-insight" aria-labelledby="live-insight-title">
            <div className="run-monitor-live-insight__label">
              <span aria-hidden="true" />
              <h2 id="live-insight-title">{reportCtaState.titleLabel}</h2>
            </div>
            {reportCtaState.kind !== 'hidden' ? (
              reportPath ? (
                <a
                  className={`${reportCtaCardClassName} run-monitor-report-cta--clickable`}
                  href={reportPath}
                  onClick={openReport}
                >
                  {reportCtaContent}
                </a>
              ) : (
                <div className={reportCtaCardClassName}>
                  {reportCtaContent}
                </div>
              )
            ) : (
              <div className="run-monitor-live-insight__card">
                <strong>{currentCheckpoint}</strong>
                <p>선택한 흐름을 준비하고 있습니다. 곧 근거 수집을 시작합니다.</p>
                <EvidenceCollectionSummary
                  stats={evidenceStats}
                  isLoading={isEvidenceLoading}
                  errorMessage={evidenceLoadError}
                />
              </div>
            )}
          </section>

          <div className="run-monitor-panel-scroll">
            <section className="run-monitor-context" aria-label="실행 정보">
              <h2>실행 정보</h2>
              <dl>
                <div>
                  <dt>선택한 흐름</dt>
                  <dd>{run.goal ?? run.name}</dd>
                </div>
                <div>
                  <dt>확인 범위</dt>
                  <dd>{depthLabel}</dd>
                </div>
                <div>
                  <dt>디바이스</dt>
                  <dd>{deviceLabel}</dd>
                </div>
                <div>
                  <dt>실행 모드</dt>
                  <dd>{traceModeLabel}</dd>
                </div>
              </dl>
            </section>

            <section className="run-monitor-timeline" aria-labelledby="step-timeline-title">
              <h2 id="step-timeline-title">시나리오 경로</h2>
              <p className="run-monitor-placeholder-note">{timelineNote}</p>
              <ol className="run-monitor-timeline__list">
                {visibleSteps.map((step) => (
                  <li key={step.id} className={`run-monitor-step run-monitor-step--${step.status}`} aria-current={step.status === 'active' ? 'step' : undefined}>
                    <div className="run-monitor-step__node">
                      <StepNode status={step.status} />
                    </div>
                    <div className="run-monitor-step__content">
                      <span className="run-monitor-sr-only">{getStepStatusLabel(step.status)}</span>
                      <div className="run-monitor-step__head">
                        <h3>{step.label}</h3>
                        <span className="run-monitor-step__status">{getStepStatusLabel(step.status)}</span>
                      </div>
                      <p>{step.detail}</p>
                      <time>{step.timestamp}</time>
                    </div>
                  </li>
                ))}
              </ol>
            </section>

            <section className="run-monitor-log" aria-labelledby="action-log-title">
              <h2 id="action-log-title">진행 요약</h2>
              <ul className="run-monitor-log__list">
                {visibleLogs.map((log) => (
                  <li key={log.id} className={`run-monitor-log__item run-monitor-log__item--${log.tone}`}>
                    <span className="run-monitor-log__dot" aria-hidden="true" />
                    <span className="run-monitor-log__message">{log.message}</span>
                    <time>{log.time}</time>
                  </li>
                ))}
              </ul>
            </section>
          </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
