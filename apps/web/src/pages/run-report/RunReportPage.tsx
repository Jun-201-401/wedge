import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { createRunReportExport, downloadReportExport, generateRunReport, getReport, getRunReport } from '../../api/reports';
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
  type ReportDownloadFormat,
} from '../../features/report-viewer';
import { CREATE_ANALYSIS_PATH } from '../../shared/lib/appPaths';
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
const REPORT_LOAD_FALLBACK_NOTICE = '서버 리포트를 불러오지 못해 수집된 근거로 임시 리포트를 구성합니다.';
const EVIDENCE_LOAD_ERROR_MESSAGE = '수집 근거를 불러오지 못했습니다. 실행 결과 저장이 완료됐는지 확인해주세요.';
const RUN_LOAD_ERROR_MESSAGE = '실행 상태를 불러오지 못했습니다. URL 또는 접근 권한을 확인한 뒤 다시 시도해주세요.';
const GENERATE_REPORT_PENDING_MESSAGE = '리포트 생성 요청 중입니다.';
const GENERATE_REPORT_SUCCESS_MESSAGE = '리포트 생성 요청이 완료됐습니다.';
const GENERATE_REPORT_ERROR_MESSAGE = '리포트 생성 요청에 실패했습니다. 잠시 후 다시 시도해주세요.';
const REQUEST_ANALYSIS_PENDING_MESSAGE = '분석 요청 중입니다.';
const REQUEST_ANALYSIS_SUCCESS_MESSAGE = '분석 요청이 접수됐습니다. 분석이 완료되면 리포트를 생성할 수 있습니다.';
const REQUEST_ANALYSIS_ERROR_MESSAGE = '분석 요청에 실패했습니다. 실행 상태 또는 접근 권한을 확인해주세요.';
const REPORT_EXPORT_PENDING_MESSAGE_BY_FORMAT: Record<ReportDownloadFormat, string> = {
  MARKDOWN: 'Markdown 파일을 준비하고 있습니다.',
  PDF: 'PDF 파일을 준비하고 있습니다.',
};
const REPORT_EXPORT_SUCCESS_MESSAGE_BY_FORMAT: Record<ReportDownloadFormat, string> = {
  MARKDOWN: 'Markdown 파일 다운로드를 시작했습니다.',
  PDF: 'PDF 파일 다운로드를 시작했습니다.',
};
const REPORT_EXPORT_ERROR_MESSAGE = '파일을 만들지 못했습니다. 다시 시도해주세요.';
const REPORT_EXPORT_SUCCESS_VISIBLE_MS = 2600;
const REPORT_EXPORT_DISMISS_ANIMATION_MS = 180;

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

function safeReportFilename(runId: string, format: ReportDownloadFormat) {
  const extension = format === 'PDF' ? 'pdf' : 'md';
  return `wedge-report-${runId.replace(/[^a-zA-Z0-9_-]/g, '-')}.${extension}`;
}

function triggerBrowserDownload(blob: Blob, filename: string) {
  if (typeof document === 'undefined') {
    return;
  }

  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
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

      <header className="run-report-topbar" aria-label="Wedge 실행 리포트">
        <div className="run-report-topbar__left">
          <RunReportBrand />
        </div>
        <div className="run-report-topbar__right">
          <a href={CREATE_ANALYSIS_PATH} className="run-report-topbar__link">새 분석</a>
        </div>
      </header>

      <main className="run-report-state-screen" aria-labelledby="run-report-state-title">
        <section className="run-report-state-card">
          <div className="run-report-state-card__header" aria-label="리포트 진행 상태">
            <span>분석 상태</span>
          </div>
          <h1 id="run-report-state-title">{title}</h1>
          <p>{message}</p>
          <div className="run-report-state-card__actions">
            {action}
            <a href={`/runs/${encodeURIComponent(runId)}`}>실시간 상태로 돌아가기</a>
          </div>
          <dl className="run-report-state-card__meta">
            <div>
              <dt>분석 번호</dt>
              <dd>{runId}</dd>
            </div>
          </dl>
        </section>
      </main>
    </div>
  );
}

function RunReportLoadingShell({ title }: { title: string }) {
  return (
    <div className="run-report-page run-report-page--loading" aria-busy="true">
      <span className="run-report-sr-only" role="status">{title}</span>
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
  const [reportExportActionState, setReportExportActionState] = useState<ReportActionState>(IDLE_REPORT_ACTION_STATE);
  const [isReportExportToastDismissing, setIsReportExportToastDismissing] = useState(false);
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
      setReportExportActionState(IDLE_REPORT_ACTION_STATE);
      setIsReportExportToastDismissing(false);
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
      setReportExportActionState(IDLE_REPORT_ACTION_STATE);
      setIsReportExportToastDismissing(false);

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

  useEffect(() => {
    if (reportExportActionState.kind !== 'success') {
      setIsReportExportToastDismissing(false);
      return undefined;
    }

    const visibleTimeoutId = window.setTimeout(() => {
      setIsReportExportToastDismissing(true);
    }, REPORT_EXPORT_SUCCESS_VISIBLE_MS);
    const clearTimeoutId = window.setTimeout(() => {
      setReportExportActionState(IDLE_REPORT_ACTION_STATE);
      setIsReportExportToastDismissing(false);
    }, REPORT_EXPORT_SUCCESS_VISIBLE_MS + REPORT_EXPORT_DISMISS_ANIMATION_MS);

    return () => {
      window.clearTimeout(visibleTimeoutId);
      window.clearTimeout(clearTimeoutId);
    };
  }, [reportExportActionState.kind, reportExportActionState.message]);

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

  const canDownloadReport = !isMockRun
    && reportProjection?.reportStatus === 'READY'
    && Boolean(reportProjection.reportId)
    && Boolean(reportProjection.analysisJobId);

  const handleDownloadReport = async (format: ReportDownloadFormat) => {
    if (!canDownloadReport || reportExportActionState.kind === 'pending') {
      return;
    }

    setIsReportExportToastDismissing(false);
    setReportExportActionState({ kind: 'pending', message: REPORT_EXPORT_PENDING_MESSAGE_BY_FORMAT[format] });

    try {
      const exportResponse = await createRunReportExport(runId, {
        format,
        analysisJobId: reportProjection?.analysisJobId ?? null,
      });
      const reportBlob = await downloadReportExport(exportResponse.data.downloadUrl);
      triggerBrowserDownload(reportBlob, safeReportFilename(runId, format));
      setReportExportActionState({ kind: 'success', message: REPORT_EXPORT_SUCCESS_MESSAGE_BY_FORMAT[format] });
    } catch {
      setIsReportExportToastDismissing(false);
      setReportExportActionState({ kind: 'error', message: REPORT_EXPORT_ERROR_MESSAGE });
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
      return <RunReportLoadingShell title={reportState.title} />;
    }

    const message = reportActionState.message
      ? `${reportState.message} ${reportActionState.message}`
      : reportState.message;
    return (
      <RunReportStatePage
        runId={runId}
        title={reportState.title}
        message={message}
        action={stateAction}
      />
    );
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

  return (
    <RunReportViewer
      report={report}
      canDownloadReport={canDownloadReport}
      isReportDownloading={reportExportActionState.kind === 'pending'}
      reportDownloadKind={reportExportActionState.kind === 'idle' ? 'pending' : reportExportActionState.kind}
      isReportDownloadDismissing={isReportExportToastDismissing}
      reportDownloadMessage={reportExportActionState.message}
      onDownloadReport={handleDownloadReport}
    />
  );
}
