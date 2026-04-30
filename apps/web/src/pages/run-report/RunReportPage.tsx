import { useEffect, useMemo, useState } from 'react';

import { getRun, getRunEvidencePacket } from '../../api/runs';
import type { EvidencePacket, Run } from '../../entities/run';
import { buildMockRunReportData, buildRunReportFromEvidence, RunReportBrand, RunReportViewer } from '../../features/report-viewer';
import { isMockRunId } from '../run-monitor/lib/runMonitorRoute';
import { resolveRunReportState } from './lib/runReportState';

interface RunReportPageProps {
  runId: string;
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

function RunReportStatePage({ runId, title, message }: { runId: string; title: string; message: string }) {
  return (
    <div className="run-report-page run-report-page--state">
      <div className="run-report-grid-bg" aria-hidden="true" />

      <header className="run-report-topbar" aria-label="Wedge run report">
        <div className="run-report-topbar__left">
          <RunReportBrand />
          <span className="run-report-topbar__divider" aria-hidden="true" />
          <div className="run-report-target-inline run-report-target-inline--optional">
            <span>Run</span>
            <strong>{runId}</strong>
          </div>
        </div>
        <div className="run-report-topbar__right">
          <a href="/create-analysis" className="run-report-topbar__link">새 분석</a>
        </div>
      </header>

      <main className="run-report-state-screen" aria-labelledby="run-report-state-title">
        <section className="run-report-state-card">
          <span>Report</span>
          <h1 id="run-report-state-title">{title}</h1>
          <p>{message}</p>
          <div className="run-report-state-card__actions">
            <a href={`/runs/${encodeURIComponent(runId)}`}>실시간 상태로 돌아가기</a>
            <a href="/create-analysis">새 분석 만들기</a>
          </div>
        </section>
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
  const report = useMemo(() => {
    if (isMockRun) {
      return buildMockRunReportData(runId, targetUrl, scenarioId);
    }

    if (!run || !evidencePacket) {
      return null;
    }

    return buildRunReportFromEvidence({ run, evidencePacket, scenarioId });
  }, [evidencePacket, isMockRun, run, runId, scenarioId, targetUrl]);

  useEffect(() => {
    if (isMockRun) {
      setRun(null);
      setEvidencePacket(null);
      setIsRunLoading(false);
      setIsEvidenceLoading(false);
      setRunLoadError('');
      setEvidenceLoadError('');
      return;
    }

    let isActive = true;

    async function loadRunForReport() {
      setIsRunLoading(true);
      setIsEvidenceLoading(false);
      setRunLoadError('');
      setEvidenceLoadError('');
      setEvidencePacket(null);

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

        setIsEvidenceLoading(true);

        try {
          const evidenceResponse = await getRunEvidencePacket(runId);

          if (!isActive) {
            return;
          }

          setEvidencePacket(evidenceResponse.data);
        } catch {
          if (!isActive) {
            return;
          }

          setEvidenceLoadError('Evidence Packet을 불러오지 못했습니다. Runner callback 저장이 완료됐는지 확인해주세요.');
        } finally {
          if (isActive) {
            setIsEvidenceLoading(false);
          }
        }
      } catch {
        if (!isActive) {
          return;
        }

        setRunLoadError('Run 상태를 불러오지 못했습니다. URL 또는 접근 권한을 확인한 뒤 다시 시도해주세요.');
        setIsRunLoading(false);
      }
    }

    void loadRunForReport();

    return () => {
      isActive = false;
    };
  }, [isMockRun, runId]);

  const reportState = resolveRunReportState({
    isMockRun,
    isRunLoading,
    runLoadError,
    run,
    isEvidenceLoading,
    evidenceLoadError,
    evidencePacket,
  });

  if (reportState.kind !== 'ready') {
    return <RunReportStatePage runId={runId} title={reportState.title} message={reportState.message} />;
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
