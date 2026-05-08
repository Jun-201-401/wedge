import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { generateRunReport, getReport, getRunReport } from '../../api/reports';
import { getRun, getRunEvidencePacket, listRunArtifacts, requestRunAnalysis } from '../../api/runs';
import type { ReportDetail, RunReportProjection } from '../../entities/report';
import type { EvidencePacket, Run } from '../../entities/run';
import {
  buildMockRunReportData,
  buildRunReportFromApi,
  buildRunReportFromEvidence,
  hydrateEvidenceArtifacts,
  RunReportBrand,
  RunReportViewer,
  selectLatestScreenshotPreviewUrl,
} from '../../features/report-viewer';
import { isMockRunId } from '../run-monitor/lib/runMonitorRoute';
import { resolveRunReportState } from './lib/runReportState';

interface RunReportPageProps {
  runId: string;
}

type ReportActionState = {
  kind: 'idle' | 'pending' | 'success' | 'error';
  message: string;
};

const IDLE_REPORT_ACTION_STATE: ReportActionState = { kind: 'idle', message: '' };
const REPORT_LOAD_FALLBACK_NOTICE = '서버 리포트 상태를 불러오지 못했습니다. Evidence Packet fallback을 시도합니다.';
const EVIDENCE_LOAD_ERROR_MESSAGE = 'Evidence Packet을 불러오지 못했습니다. Runner callback 저장이 완료됐는지 확인해주세요.';
const RUN_LOAD_ERROR_MESSAGE = 'Run 상태를 불러오지 못했습니다. URL 또는 접근 권한을 확인한 뒤 다시 시도해주세요.';
const GENERATE_REPORT_PENDING_MESSAGE = '리포트 생성 요청 중입니다.';
const GENERATE_REPORT_SUCCESS_MESSAGE = '리포트 생성 요청이 완료됐습니다.';
const GENERATE_REPORT_ERROR_MESSAGE = '리포트 생성 요청에 실패했습니다. 잠시 후 다시 시도해주세요.';
const REQUEST_ANALYSIS_PENDING_MESSAGE = '분석 요청 중입니다.';
const REQUEST_ANALYSIS_SUCCESS_MESSAGE = '분석 요청이 접수됐습니다. 분석이 완료되면 리포트를 생성할 수 있습니다.';
const REQUEST_ANALYSIS_ERROR_MESSAGE = '분석 요청에 실패했습니다. Run 상태 또는 접근 권한을 확인해주세요.';

async function fetchRunReportPreviewUrl(runId: string) {
  const artifactsResponse = await listRunArtifacts(runId);
  return selectLatestScreenshotPreviewUrl(artifactsResponse.data);
}

function readQueryParam(name: string) {
  if (typeof window === 'undefined') {
    return null;
  }

  return new URLSearchParams(window.location.search).get(name);
}

function getFallbackUrl() {
  return readQueryParam('url') ?? 'https://example.com/';
}

function RunReportStatePage({
  runId,
  title,
  message,
  action,
}: {
  runId: string;
  title: string;
  message: string;
  action?: ReactNode;
}) {
  return (
    <div className="run-report-page run-report-page--state">
      <div className="run-report-grid-bg" aria-hidden="true" />

      <header className="run-report-topbar" aria-label="Wedge run report">
        <div className="run-report-topbar__left">
          <RunReportBrand />
        </div>
        <div className="run-report-topbar__right">
          <a href="/create-analysis" className="run-report-topbar__link">새 분석</a>
        </div>
      </header>

      <main className="run-report-state-screen" aria-labelledby="run-report-state-title">
        <section className="run-report-state-card">
          <span>리포트</span>
          <h1 id="run-report-state-title">{title}</h1>
          <p>{message}</p>
          <div className="run-report-state-card__actions">
            {action}
            <a href={`/runs/${encodeURIComponent(runId)}`}>실시간 상태로 돌아가기</a>
          </div>
          <dl className="run-report-state-card__meta">
            <div>
              <dt>Run ID</dt>
              <dd>{runId}</dd>
            </div>
          </dl>
        </section>
      </main>
    </div>
  );
}

function RunReportSkeletonLine({ className = '' }: { className?: string }) {
  const skeletonClassName = className ? `run-report-skeleton-line ${className}` : 'run-report-skeleton-line';
  return <span className={skeletonClassName} aria-hidden="true" />;
}

function RunReportLoadingShell({ runId, title }: { runId: string; title: string }) {
  return (
    <div className="run-report-page run-report-page--loading" aria-busy="true">
      <div className="run-report-grid-bg" aria-hidden="true" />

      <header className="run-report-topbar" aria-label="Wedge analysis report">
        <div className="run-report-topbar__left">
          <RunReportBrand />
          <span className="run-report-topbar__divider" aria-hidden="true" />
          <div className="run-report-target-inline run-report-target-inline--optional">
            <span>Run</span>
            <strong>{runId}</strong>
          </div>
        </div>

        <div className="run-report-topbar__right">
          <button type="button" className="run-report-topbar__ghost" disabled>Export PDF · 준비 중</button>
          <button type="button" className="run-report-topbar__share" disabled>Share Report · 준비 중</button>
        </div>
      </header>

      <main className="run-report-shell" aria-labelledby="run-report-title">
        <header className="run-report-hero">
          <div className="run-report-hero__copy">
            <span className="run-report-tag">Report</span>
            <h1 id="run-report-title">
              랜딩 페이지 <span>CTA 전환 마찰 리포트</span>
            </h1>
            <p>
              Target: <strong>확인 중</strong>
              <span aria-hidden="true">•</span>
              시나리오: 확인 중
            </p>
            <p className="run-report-loading-status" role="status">{title}</p>
          </div>

          <dl className="run-report-hero-stats run-report-hero-stats--skeleton" aria-hidden="true">
            <div>
              <dt>총 단계</dt>
              <dd>00</dd>
            </div>
            <div>
              <dt>마찰 지점</dt>
              <dd className="run-report-hero-stats__danger">00</dd>
            </div>
            <div>
              <dt>소요 시간</dt>
              <dd>--</dd>
            </div>
          </dl>
        </header>

        <div className="run-report-layout" aria-hidden="true">
          <section className="run-report-visual-panel">
            <div className="run-report-section-heading run-report-section-heading--plain">
              <h2>Evidence Screen</h2>
            </div>

            <article className="run-report-evidence-card run-report-evidence-card--skeleton">
              <div className="run-report-evidence-card__head">
                <div>
                  <RunReportSkeletonLine className="run-report-skeleton-line--title" />
                  <RunReportSkeletonLine className="run-report-skeleton-line--short" />
                </div>
                <div>
                  <span>Confidence</span>
                  <RunReportSkeletonLine className="run-report-skeleton-line--score" />
                </div>
              </div>

              <div className="run-report-evidence-preview run-report-evidence-preview--skeleton" />

              <div className="run-report-evidence-card__summary">
                <RunReportSkeletonLine className="run-report-skeleton-line--short" />
                <RunReportSkeletonLine />
              </div>
            </article>
          </section>

          <aside className="run-report-insight-panel">
            <section className="run-report-section run-report-section--top-findings">
              <div className="run-report-section-heading">
                <h2>Top Priority Findings</h2>
                <span />
              </div>
              <ol className="run-report-top-finding-list run-report-top-finding-list--skeleton">
                {[0, 1, 2].map((item) => (
                  <li key={item} className="run-report-top-finding-card">
                    <div className="run-report-top-finding-card__button run-report-top-finding-card__button--skeleton">
                      <RunReportSkeletonLine className="run-report-skeleton-line--short" />
                      <RunReportSkeletonLine className="run-report-skeleton-line--title" />
                      <RunReportSkeletonLine />
                    </div>
                  </li>
                ))}
              </ol>
            </section>

            <section className="run-report-section run-report-section--priority">
              <div className="run-report-section-heading">
                <h2>Recommended Nudge</h2>
                <span />
              </div>
              <div className="run-report-nudge-list">
                <div className="run-report-nudge-card run-report-nudge-card--skeleton">
                  <RunReportSkeletonLine className="run-report-skeleton-line--title" />
                  <RunReportSkeletonLine />
                  <RunReportSkeletonLine className="run-report-skeleton-line--short" />
                </div>
              </div>
            </section>
          </aside>
        </div>
      </main>
    </div>
  );
}

export function RunReportPage({ runId }: RunReportPageProps) {
  const targetUrl = getFallbackUrl();
  const scenarioId = readQueryParam('scenario');
  const isMockRun = isMockRunId(runId);
  const [run, setRun] = useState<Run | null>(null);
  const [isRunLoading, setIsRunLoading] = useState(!isMockRun);
  const [runLoadError, setRunLoadError] = useState('');
  const [evidencePacket, setEvidencePacket] = useState<EvidencePacket | null>(null);
  const [isEvidenceLoading, setIsEvidenceLoading] = useState(false);
  const [evidenceLoadError, setEvidenceLoadError] = useState('');
  const [reportProjection, setReportProjection] = useState<RunReportProjection | null>(null);
  const [reportDetail, setReportDetail] = useState<ReportDetail | null>(null);
  const [reportPreviewUrl, setReportPreviewUrl] = useState<string | null>(null);
  const [isReportLoading, setIsReportLoading] = useState(false);
  const [reportLoadError, setReportLoadError] = useState('');
  const [reportActionState, setReportActionState] = useState<ReportActionState>(IDLE_REPORT_ACTION_STATE);
  const report = useMemo(() => {
    if (isMockRun) {
      return buildMockRunReportData(runId, targetUrl, scenarioId);
    }

    if (run && reportProjection?.reportStatus === 'READY') {
      return buildRunReportFromApi({ run, report: reportProjection, detail: reportDetail, fallbackPreviewUrl: reportPreviewUrl, scenarioId });
    }

    if (!run || !evidencePacket) {
      return null;
    }

    const fallbackReport = buildRunReportFromEvidence({ run, evidencePacket, scenarioId });
    return reportLoadError ? { ...fallbackReport, sourceNotice: reportLoadError } : fallbackReport;
  }, [evidencePacket, isMockRun, reportDetail, reportLoadError, reportPreviewUrl, reportProjection, run, runId, scenarioId, targetUrl]);

  useEffect(() => {
    if (isMockRun) {
      setRun(null);
      setEvidencePacket(null);
      setIsRunLoading(false);
      setIsEvidenceLoading(false);
      setRunLoadError('');
      setEvidenceLoadError('');
      setReportProjection(null);
      setReportDetail(null);
      setReportPreviewUrl(null);
      setIsReportLoading(false);
      setReportLoadError('');
      setReportActionState(IDLE_REPORT_ACTION_STATE);
      return;
    }

    let isActive = true;

    async function loadRunForReport() {
      setIsRunLoading(true);
      setIsEvidenceLoading(false);
      setRunLoadError('');
      setEvidenceLoadError('');
      setEvidencePacket(null);
      setReportProjection(null);
      setReportDetail(null);
      setReportPreviewUrl(null);
      setIsReportLoading(false);
      setReportLoadError('');
      setReportActionState(IDLE_REPORT_ACTION_STATE);

      try {
        const response = await getRun(runId);

        if (!isActive) {
          return;
        }

        const nextRun = response.data;
        setRun(nextRun);
        setIsRunLoading(false);

        if (nextRun.status !== 'COMPLETED') {
          return;
        }

        setIsReportLoading(true);

        try {
          const reportResponse = await getRunReport(runId);

          if (!isActive) {
            return;
          }

          setReportProjection(reportResponse.data);
          setReportLoadError('');
        } catch {
          if (!isActive) {
            return;
          }

          setReportLoadError(REPORT_LOAD_FALLBACK_NOTICE);
          setIsEvidenceLoading(true);

          try {
            const evidenceResponse = await getRunEvidencePacket(runId);

            if (!isActive) {
              return;
            }

            let nextEvidencePacket = evidenceResponse.data;

            try {
              const artifactsResponse = await listRunArtifacts(runId);
              nextEvidencePacket = hydrateEvidenceArtifacts(nextEvidencePacket, artifactsResponse.data);
            } catch {
              // Artifact list is a preview/download enhancement; the EvidencePacket is sufficient for fallback report rendering.
            }

            if (isActive) {
              setEvidencePacket(nextEvidencePacket);
              setEvidenceLoadError('');
            }
          } catch {
            if (!isActive) {
              return;
            }

            setEvidenceLoadError(EVIDENCE_LOAD_ERROR_MESSAGE);
          } finally {
            if (isActive) {
              setIsEvidenceLoading(false);
            }
          }
        } finally {
          if (isActive) {
            setIsReportLoading(false);
          }
        }
      } catch {
        if (!isActive) {
          return;
        }

        setRunLoadError(RUN_LOAD_ERROR_MESSAGE);
        setIsRunLoading(false);
      }
    }

    void loadRunForReport();

    return () => {
      isActive = false;
    };
  }, [isMockRun, runId]);

  useEffect(() => {
    if (isMockRun || reportProjection?.reportStatus !== 'READY') {
      setReportPreviewUrl(null);
      return undefined;
    }

    let isActive = true;
    setReportPreviewUrl(null);

    void fetchRunReportPreviewUrl(runId)
      .then((previewUrl) => {
        if (isActive) {
          setReportPreviewUrl(previewUrl);
        }
      })
      .catch(() => {
        // Preview images are an enhancement; keep the report usable if artifacts cannot be listed.
        if (isActive) {
          setReportPreviewUrl(null);
        }
      });

    return () => {
      isActive = false;
    };
  }, [isMockRun, reportProjection?.reportId, reportProjection?.reportStatus, reportProjection?.updatedAt, runId]);

  useEffect(() => {
    if (isMockRun || reportProjection?.reportStatus !== 'READY' || !reportProjection.reportId) {
      setReportDetail(null);
      return undefined;
    }

    let isActive = true;
    setReportDetail(null);

    void getReport(reportProjection.reportId)
      .then((response) => {
        if (isActive) {
          setReportDetail(response.data);
        }
      })
      .catch(() => {
        if (isActive) {
          setReportDetail(null);
        }
      });

    return () => {
      isActive = false;
    };
  }, [isMockRun, reportProjection?.reportId, reportProjection?.reportStatus]);

  const reportState = resolveRunReportState({
    isMockRun,
    isRunLoading,
    runLoadError,
    run,
    isEvidenceLoading,
    evidenceLoadError,
    evidencePacket,
    isReportLoading,
    reportLoadError,
    report: reportProjection,
  });

  const refreshRunReport = async () => {
    const reportResponse = await getRunReport(runId);
    setReportProjection(reportResponse.data);
    setReportLoadError('');
  };

  const handleGenerateReport = async () => {
    if (reportActionState.kind === 'pending') {
      return;
    }

    setReportActionState({ kind: 'pending', message: GENERATE_REPORT_PENDING_MESSAGE });

    try {
      const response = await generateRunReport(runId);
      setReportProjection(response.data);
      setReportActionState({ kind: 'success', message: GENERATE_REPORT_SUCCESS_MESSAGE });
    } catch {
      setReportActionState({ kind: 'error', message: GENERATE_REPORT_ERROR_MESSAGE });
    }
  };

  const handleRequestAnalysis = async () => {
    if (reportActionState.kind === 'pending') {
      return;
    }

    setReportActionState({ kind: 'pending', message: REQUEST_ANALYSIS_PENDING_MESSAGE });

    try {
      await requestRunAnalysis(runId);
      await refreshRunReport();
      setReportActionState({ kind: 'success', message: REQUEST_ANALYSIS_SUCCESS_MESSAGE });
    } catch {
      setReportActionState({ kind: 'error', message: REQUEST_ANALYSIS_ERROR_MESSAGE });
    }
  };

  const stateAction = (() => {
    if (reportProjection?.reportStatus === 'GENERATABLE') {
      return (
        <button type="button" onClick={handleGenerateReport} disabled={reportActionState.kind === 'pending'}>
          {reportActionState.kind === 'pending' ? '생성 중' : '리포트 생성'}
        </button>
      );
    }

    if (reportProjection?.reportStatus === 'NOT_READY' && reportProjection.analysisStatus === 'NOT_STARTED') {
      return (
        <button type="button" onClick={handleRequestAnalysis} disabled={reportActionState.kind === 'pending'}>
          {reportActionState.kind === 'pending' ? '요청 중' : '분석 시작'}
        </button>
      );
    }

    return null;
  })();

  if (reportState.kind !== 'ready') {
    if (reportState.kind === 'loading') {
      return <RunReportLoadingShell runId={runId} title={reportState.title} />;
    }

    const message = reportActionState.message
      ? `${reportState.message} ${reportActionState.message}`
      : reportState.message;
    return <RunReportStatePage runId={runId} title={reportState.title} message={message} action={stateAction} />;
  }

  if (!report) {
    return (
      <RunReportStatePage
        runId={runId}
        title="리포트 상태를 표시할 수 없습니다"
        message="모의 리포트 데이터를 구성할 수 없습니다."
      />
    );
  }

  return <RunReportViewer report={report} />;
}
