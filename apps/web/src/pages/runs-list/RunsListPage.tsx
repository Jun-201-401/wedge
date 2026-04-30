import { useEffect, useMemo, useState } from 'react';

import { listRuns } from '../../api/runs';
import type { Run, RunStatus, User } from '../../entities';
import { RUN_STATUS_LABEL } from '../../entities';
import { CREATE_ANALYSIS_PATH } from '../../shared/lib/appPaths';
import { getSafeHttpUrl } from '../../shared/lib/safeUrl';
import { buildRunReportPath } from '../run-report/lib/runReportRoute';
import './RunsListPage.css';

interface RunsListPageProps {
  currentUser?: User | null;
  onLogout?: () => void;
}

type RunsListState =
  | { kind: 'loading' }
  | { kind: 'ready'; runs: Run[] }
  | { kind: 'error'; message: string };

const RUNS_LOAD_ERROR_MESSAGE = 'Run 목록을 불러오지 못했습니다. 로그인 상태와 API 서버 연결을 확인해주세요.';
const STATUS_FILTERS: Array<{ value: RunStatus | 'ALL'; label: string }> = [
  { value: 'ALL', label: '전체' },
  { value: 'RUNNING', label: '실행 중' },
  { value: 'COMPLETED', label: '완료' },
  { value: 'FAILED', label: '실패' },
];

function formatRunDate(value?: string | null) {
  if (!value) {
    return '아직 기록 없음';
  }

  return new Intl.DateTimeFormat('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}


function getRunTimestamp(run: Run) {
  return run.finishedAt ?? run.startedAt ?? null;
}

function getRunSortTime(run: Run) {
  const timestamp = getRunTimestamp(run);
  return timestamp ? new Date(timestamp).getTime() : 0;
}

function getStatusTone(status: RunStatus) {
  if (status === 'COMPLETED') {
    return 'complete';
  }

  if (status === 'FAILED' || status === 'STOPPED') {
    return 'failed';
  }

  if (status === 'RUNNING' || status === 'STARTING' || status === 'QUEUED') {
    return 'active';
  }

  return 'neutral';
}

function filterRuns(runs: Run[], statusFilter: RunStatus | 'ALL') {
  return runs
    .filter((run) => statusFilter === 'ALL' || run.status === statusFilter)
    .sort((a, b) => getRunSortTime(b) - getRunSortTime(a));
}

function RunsListTopbar({ currentUser, onLogout }: RunsListPageProps) {
  return (
    <header className="runs-list-topbar" aria-label="Wedge runs">
      <div className="runs-list-topbar__left">
        <a href="/" className="runs-list-brand" aria-label="Wedge home">Wedge</a>
        <span className="runs-list-topbar__divider" aria-hidden="true" />
        <strong>Runs</strong>
      </div>

      <div className="runs-list-topbar__right">
        {currentUser ? <span className="runs-list-user">{currentUser.displayName}</span> : null}
        <a href={CREATE_ANALYSIS_PATH} className="runs-list-topbar__link">새 분석</a>
        {onLogout ? (
          <button type="button" className="runs-list-topbar__logout" onClick={onLogout}>로그아웃</button>
        ) : null}
      </div>
    </header>
  );
}

export function RunsListPage({ currentUser, onLogout }: RunsListPageProps) {
  const [state, setState] = useState<RunsListState>({ kind: 'loading' });
  const [statusFilter, setStatusFilter] = useState<RunStatus | 'ALL'>('ALL');

  useEffect(() => {
    let isActive = true;

    async function loadRuns() {
      setState({ kind: 'loading' });

      try {
        const response = await listRuns();
        if (isActive) {
          setState({ kind: 'ready', runs: response.data });
        }
      } catch {
        if (isActive) {
          setState({ kind: 'error', message: RUNS_LOAD_ERROR_MESSAGE });
        }
      }
    }

    void loadRuns();

    return () => {
      isActive = false;
    };
  }, []);

  const visibleRuns = useMemo(() => {
    if (state.kind !== 'ready') {
      return [];
    }

    return filterRuns(state.runs, statusFilter);
  }, [state, statusFilter]);

  return (
    <div className="runs-list-page">
      <div className="runs-list-grid-bg" aria-hidden="true" />
      <RunsListTopbar currentUser={currentUser} onLogout={onLogout} />

      <main className="runs-list-shell" aria-labelledby="runs-list-title">
        <section className="runs-list-hero">
          <div>
            <span>API-backed runs</span>
            <h1 id="runs-list-title">실제 Run 목록</h1>
            <p>백엔드에 저장된 실행을 열어 live monitor와 evidence report로 이어갑니다.</p>
          </div>
          <a href={CREATE_ANALYSIS_PATH}>새 분석 시작</a>
        </section>

        <section className="runs-list-card" aria-label="Run 목록">
          <div className="runs-list-filters" aria-label="상태 필터">
            {STATUS_FILTERS.map((filter) => (
              <button
                key={filter.value}
                type="button"
                className={statusFilter === filter.value ? 'runs-list-filter runs-list-filter--active' : 'runs-list-filter'}
                onClick={() => setStatusFilter(filter.value)}
                aria-pressed={statusFilter === filter.value}
              >
                {filter.label}
              </button>
            ))}
          </div>

          {state.kind === 'loading' ? <p className="runs-list-state">Run 목록을 불러오는 중입니다.</p> : null}
          {state.kind === 'error' ? <p className="runs-list-state runs-list-state--error" role="alert">{state.message}</p> : null}
          {state.kind === 'ready' && visibleRuns.length === 0 ? (
            <p className="runs-list-state">표시할 Run이 없습니다. 새 분석을 시작하거나 다른 상태 필터를 선택해주세요.</p>
          ) : null}

          {visibleRuns.length > 0 ? (
            <div className="runs-list-table" role="table" aria-label="저장된 Run">
              <div className="runs-list-row runs-list-row--head" role="row">
                <span role="columnheader">Run</span>
                <span role="columnheader">상태</span>
                <span role="columnheader">대상 URL</span>
                <span role="columnheader">최근 시각</span>
                <span role="columnheader">열기</span>
              </div>

              {visibleRuns.map((run) => {
                const safeStartUrl = getSafeHttpUrl(run.startUrl);
                const reportPath = buildRunReportPath(run.id, {
                  submittedUrl: run.startUrl,
                  scenarioId: 'landing-cta',
                  depthId: 'hero-only',
                });

                return (
                  <article key={run.id} className="runs-list-row" role="row">
                    <div role="cell" className="runs-list-run-cell">
                      <strong>{run.name}</strong>
                      <span>{run.id}</span>
                    </div>
                    <div role="cell">
                      <span className={`runs-list-status runs-list-status--${getStatusTone(run.status)}`}>
                        {RUN_STATUS_LABEL[run.status]}
                      </span>
                    </div>
                    <span role="cell" className="runs-list-url-cell">
                      {safeStartUrl ? (
                        <a href={safeStartUrl} className="runs-list-url" target="_blank" rel="noreferrer">
                          {run.startUrl}
                        </a>
                      ) : (
                        <span className="runs-list-url runs-list-url--disabled">{run.startUrl}</span>
                      )}
                    </span>
                    <span role="cell" className="runs-list-date">{formatRunDate(getRunTimestamp(run))}</span>
                    <div role="cell" className="runs-list-actions">
                      <a href={`/runs/${encodeURIComponent(run.id)}`}>Monitor</a>
                      {run.status === 'COMPLETED' ? <a href={reportPath}>Report</a> : null}
                    </div>
                  </article>
                );
              })}
            </div>
          ) : null}
        </section>
      </main>
    </div>
  );
}
