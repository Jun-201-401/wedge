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

type RunStatusFilter = 'ALL' | 'ACTIVE' | 'COMPLETED' | 'FAILED';

const RUNS_LOAD_ERROR_MESSAGE = 'Run 목록을 불러오지 못했습니다. 로그인 상태와 API 서버 연결을 확인해주세요.';
const STATUS_FILTERS: Array<{ value: RunStatusFilter; label: string }> = [
  { value: 'ALL', label: '전체' },
  { value: 'ACTIVE', label: '실행 중' },
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

  if (status === 'RUNNING' || status === 'STARTING' || status === 'QUEUED' || status === 'STOP_REQUESTED') {
    return 'active';
  }

  return 'neutral';
}

function doesRunMatchStatusFilter(run: Run, statusFilter: RunStatusFilter) {
  if (statusFilter === 'ALL') {
    return true;
  }

  const statusTone = getStatusTone(run.status);

  if (statusFilter === 'ACTIVE') {
    return statusTone === 'active';
  }

  if (statusFilter === 'COMPLETED') {
    return statusTone === 'complete';
  }

  return statusTone === 'failed';
}

function filterRuns(runs: Run[], statusFilter: RunStatusFilter) {
  return runs
    .filter((run) => doesRunMatchStatusFilter(run, statusFilter))
    .sort((a, b) => getRunSortTime(b) - getRunSortTime(a));
}

function summarizeRuns(runs: Run[]) {
  return runs.reduce(
    (summary, run) => {
      const statusTone = getStatusTone(run.status);

      summary.total += 1;
      if (statusTone === 'active') {
        summary.active += 1;
      }
      if (statusTone === 'complete') {
        summary.completed += 1;
      }
      if (statusTone === 'failed') {
        summary.failed += 1;
      }

      return summary;
    },
    { total: 0, active: 0, completed: 0, failed: 0 },
  );
}

function getStatusFilterCount(summary: ReturnType<typeof summarizeRuns> | null, statusFilter: RunStatusFilter) {
  if (!summary) {
    return null;
  }

  if (statusFilter === 'ALL') {
    return summary.total;
  }

  if (statusFilter === 'ACTIVE') {
    return summary.active;
  }

  if (statusFilter === 'COMPLETED') {
    return summary.completed;
  }

  return summary.failed;
}

function formatRunUrlLabel(value: string) {
  const safeUrl = getSafeHttpUrl(value);

  if (!safeUrl) {
    return value;
  }

  try {
    const url = new URL(safeUrl);
    const host = url.hostname.replace(/^www\./, '');
    const path = url.pathname === '/' ? '' : url.pathname;

    return `${host}${path}${url.search}`;
  } catch {
    return value;
  }
}

function RunsListTopbar({ currentUser, onLogout }: RunsListPageProps) {
  return (
    <header className="runs-list-topbar" aria-label="Wedge runs">
      <div className="runs-list-topbar__left">
        <a href="/" className="runs-list-brand" aria-label="Wedge home">Wedge</a>
      </div>

      <div className="runs-list-topbar__right">
        {currentUser ? <span className="runs-list-user">{currentUser.displayName}</span> : null}
        {onLogout ? (
          <button type="button" className="runs-list-topbar__logout" onClick={onLogout}>로그아웃</button>
        ) : null}
      </div>
    </header>
  );
}

export function RunsListPage({ currentUser, onLogout }: RunsListPageProps) {
  const [state, setState] = useState<RunsListState>({ kind: 'loading' });
  const [statusFilter, setStatusFilter] = useState<RunStatusFilter>('ALL');

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
  const runSummary = useMemo(() => (state.kind === 'ready' ? summarizeRuns(state.runs) : null), [state]);

  return (
    <div className="runs-list-page">
      <div className="runs-list-grid-bg" aria-hidden="true" />
      <RunsListTopbar currentUser={currentUser} onLogout={onLogout} />

      <main className="runs-list-shell" aria-labelledby="runs-list-title">
        <section className="runs-list-hero">
          <div className="runs-list-hero__copy">
            <h1 id="runs-list-title">실행 목록</h1>
            <p>저장된 실행을 열어 실시간 상태와 근거 리포트로 이어갑니다.</p>
          </div>
          <a href={CREATE_ANALYSIS_PATH} className="runs-list-primary-action">새 분석 시작</a>
        </section>

        <section className="runs-list-card" aria-label="실행 목록">
          <div className="runs-list-card__header">
            <div className="runs-list-filters" aria-label="상태 필터">
              {STATUS_FILTERS.map((filter) => {
                const filterCount = getStatusFilterCount(runSummary, filter.value);

                return (
                  <button
                    key={filter.value}
                    type="button"
                    className={statusFilter === filter.value ? 'runs-list-filter runs-list-filter--active' : 'runs-list-filter'}
                    onClick={() => setStatusFilter(filter.value)}
                    aria-pressed={statusFilter === filter.value}
                  >
                    <span>{filter.label}</span>
                    {filterCount === null ? null : <strong>{filterCount}</strong>}
                  </button>
                );
              })}
            </div>

            {runSummary ? (
              <dl className="runs-list-summary" aria-label="실행 상태 요약">
                <div>
                  <dt>전체</dt>
                  <dd>{runSummary.total}</dd>
                </div>
                <div className="runs-list-summary__active">
                  <dt>실행 중</dt>
                  <dd>{runSummary.active}</dd>
                </div>
                <div>
                  <dt>완료</dt>
                  <dd>{runSummary.completed}</dd>
                </div>
                <div>
                  <dt>실패</dt>
                  <dd>{runSummary.failed}</dd>
                </div>
              </dl>
            ) : null}
          </div>

          {state.kind === 'loading' ? <p className="runs-list-state">Run 목록을 불러오는 중입니다.</p> : null}
          {state.kind === 'error' ? <p className="runs-list-state runs-list-state--error" role="alert">{state.message}</p> : null}
          {state.kind === 'ready' && visibleRuns.length === 0 ? (
            <p className="runs-list-state">표시할 실행이 없습니다. 새 분석을 시작하거나 다른 상태 필터를 선택해주세요.</p>
          ) : null}

          {visibleRuns.length > 0 ? (
            <div className="runs-list-table" role="table" aria-label="저장된 실행">
              <div className="runs-list-row runs-list-row--head" role="row">
                <span role="columnheader">실행</span>
                <span role="columnheader">상태</span>
                <span role="columnheader">대상 URL</span>
                <span role="columnheader">최근 시각</span>
                <span role="columnheader">열기</span>
              </div>

              {visibleRuns.map((run) => {
                const safeStartUrl = getSafeHttpUrl(run.startUrl);
                const startUrlLabel = formatRunUrlLabel(run.startUrl);
                const statusTone = getStatusTone(run.status);
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
                    <div role="cell" className="runs-list-status-cell">
                      <span className="runs-list-cell-label">상태</span>
                      <span className={`runs-list-status runs-list-status--${statusTone}`}>
                        {RUN_STATUS_LABEL[run.status]}
                      </span>
                    </div>
                    <span role="cell" className="runs-list-url-cell">
                      <span className="runs-list-cell-label">대상 URL</span>
                      {safeStartUrl ? (
                        <a
                          href={safeStartUrl}
                          className="runs-list-url"
                          target="_blank"
                          rel="noreferrer"
                          title={run.startUrl}
                          aria-label={`대상 URL 열기: ${run.startUrl}`}
                        >
                          {startUrlLabel}
                        </a>
                      ) : (
                        <span className="runs-list-url runs-list-url--disabled" title={run.startUrl}>{startUrlLabel}</span>
                      )}
                    </span>
                    <div role="cell" className="runs-list-date-cell">
                      <span className="runs-list-cell-label">최근 시각</span>
                      <span className="runs-list-date">{formatRunDate(getRunTimestamp(run))}</span>
                    </div>
                    <div role="cell" className="runs-list-actions">
                      <span className="runs-list-cell-label">열기</span>
                      <a href={`/runs/${encodeURIComponent(run.id)}`}>실시간 보기</a>
                      {run.status === 'COMPLETED' ? <a href={reportPath}>리포트</a> : null}
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
