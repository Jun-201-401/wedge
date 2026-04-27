import { useMemo } from 'react';

import type { EvidencePacket } from '../../entities/run';
import { RUN_STATUS_LABEL } from '../../entities/run';
import {
  buildApiSnapshotLogs,
  buildApiSnapshotSteps,
  buildMockRunMonitorData,
  findEvidenceScreenshotArtifact,
  getApiCheckpoint,
  getApiProgressPercent,
  getCheckpointArtifacts,
  getDepthLabel,
  getDevicePresetLabel,
  getEvidenceArtifactHref,
  getEvidenceArtifactLabel,
  getEvidenceCheckpointTitle,
  getEvidenceObservationSummary,
  getScenarioLabel,
  getStatusTone,
  getStepStatusLabel,
  type RunStatusTone,
  type StepStatus,
  useRunMonitorState,
} from '../../features/run-monitor';
import { isMockRunId } from './lib/runMonitorRoute';
import './RunMonitorPage.css';

interface RunMonitorPageProps {
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

interface RunMonitorTopbarProps {
  runId: string;
  targetUrl?: string;
  statusTone?: RunStatusTone;
  statusLabel?: string;
}

function RunMonitorTopbar({ runId, targetUrl, statusTone, statusLabel }: RunMonitorTopbarProps) {
  return (
    <header className="run-monitor-topbar" aria-label="Wedge run monitor">
      <div className="run-monitor-topbar__left">
        <a href="/" className="run-monitor-brand" aria-label="Wedge home">
          <span>Wedge</span>
        </a>
        <span className="run-monitor-topbar__divider" aria-hidden="true" />
        {targetUrl && (
          <div className="run-monitor-target-inline">
            <span>대상</span>
            <strong>{targetUrl}</strong>
          </div>
        )}
        <div className="run-monitor-target-inline run-monitor-target-inline--optional">
          <span>Run</span>
          <strong>{runId}</strong>
        </div>
      </div>

      <div className="run-monitor-topbar__right">
        {statusTone && statusLabel && (
          <div className={`run-monitor-status run-monitor-status--${statusTone}`} aria-label={`실행 상태 ${statusLabel}`}>
            <span className="run-monitor-status__dot" aria-hidden="true" />
            <span>{statusLabel}</span>
          </div>
        )}
        <a href="/create-analysis" className="run-monitor-stop-link">새 분석</a>
      </div>
    </header>
  );
}

function RunMonitorStatePage({ runId, title, message }: { runId: string; title: string; message: string }) {
  return (
    <div className="run-monitor-page">
      <div className="run-monitor-grid-bg" aria-hidden="true" />
      <RunMonitorTopbar runId={runId} />

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

function EvidencePanel({
  evidencePacket,
  isEvidenceLoading,
  evidenceLoadError,
}: {
  evidencePacket: EvidencePacket | null;
  isEvidenceLoading: boolean;
  evidenceLoadError: string;
}) {
  if (isEvidenceLoading) {
    return (
      <section className="run-monitor-evidence" aria-labelledby="evidence-title">
        <h2 id="evidence-title">Evidence Packet</h2>
        <p className="run-monitor-evidence__status">Runner evidence를 불러오는 중입니다.</p>
      </section>
    );
  }

  if (!evidencePacket) {
    return (
      <section className="run-monitor-evidence" aria-labelledby="evidence-title">
        <h2 id="evidence-title">Evidence Packet</h2>
        <p className="run-monitor-evidence__status">
          {evidenceLoadError || 'Runner evidence가 도착하면 checkpoint, artifact, observation이 표시됩니다.'}
        </p>
      </section>
    );
  }

  return (
    <section className="run-monitor-evidence" aria-labelledby="evidence-title">
      <div className="run-monitor-evidence__heading">
        <h2 id="evidence-title">Evidence Packet</h2>
        <span>{evidencePacket.checkpoints.length} checkpoints</span>
      </div>

      <div className="run-monitor-evidence__cards">
        {evidencePacket.checkpoints.map((checkpoint, index) => {
          const checkpointArtifacts = getCheckpointArtifacts(checkpoint, evidencePacket.artifacts);

          return (
            <article key={checkpoint.checkpoint_id} className="run-monitor-evidence-card">
              <div className="run-monitor-evidence-card__head">
                <strong>{getEvidenceCheckpointTitle(checkpoint, index)}</strong>
                <span>{checkpoint.primaryStage}</span>
              </div>

              <dl className="run-monitor-evidence-card__meta">
                <div>
                  <dt>Settle</dt>
                  <dd>{String(checkpoint.settle.status ?? 'unknown')}</dd>
                </div>
                <div>
                  <dt>Artifacts</dt>
                  <dd>{checkpointArtifacts.length}</dd>
                </div>
              </dl>

              {checkpointArtifacts.length > 0 && (
                <div className="run-monitor-evidence-card__artifacts">
                  <h3>Artifacts</h3>
                  <ul>
                    {checkpointArtifacts.map((artifact) => (
                      <li key={artifact.artifact_id}>
                        <a href={getEvidenceArtifactHref(artifact)} target="_blank" rel="noreferrer">
                          {getEvidenceArtifactLabel(artifact)}
                        </a>
                        <span>{artifact.mime_type ?? artifact.type}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="run-monitor-evidence-card__observations">
                <h3>Observations</h3>
                {checkpoint.observations.length > 0 ? (
                  <ul>
                    {checkpoint.observations.map((observation) => (
                      <li key={observation.observation_id}>
                        <strong>{observation.type}</strong>
                        <span>{getEvidenceObservationSummary(observation)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>Observation이 아직 없습니다.</p>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
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
  } = useRunMonitorState(runId, mockData, isMockRun);

  if (isRealRunLoading) {
    return (
      <RunMonitorStatePage
        runId={runId}
        title="Run 상태를 불러오는 중입니다"
        message="실제 실행 데이터와 최신 화면 캡처를 연결하고 있습니다."
      />
    );
  }

  if (apiLoadError && !isApiFallback && !hasRealRunSnapshot) {
    return <RunMonitorStatePage runId={runId} title="실시간 상태를 표시할 수 없습니다" message={apiLoadError} />;
  }

  const statusTone = getStatusTone(live.status);
  const statusLabel = RUN_STATUS_LABEL[live.status];
  const progressPercent = isApiFallback ? mockData.progressPercent : getApiProgressPercent(live);
  const currentCheckpoint = isApiFallback ? (live.currentAction ?? mockData.currentCheckpoint) : getApiCheckpoint(live);
  const evidenceScreenshotUrl = findEvidenceScreenshotArtifact(evidencePacket)?.uri ?? null;
  const snapshotUrl = live.latestFrame?.url ?? run.latestSnapshot?.url ?? evidenceScreenshotUrl;
  const traceModeLabel = isApiFallback ? '모의 실행' : 'API 상태 스냅샷';
  const visibleSteps = isApiFallback ? mockData.steps : buildApiSnapshotSteps(run, live);
  const visibleLogs = isApiFallback ? mockData.logs : buildApiSnapshotLogs(run, live);
  const timelineNote = isApiFallback
    ? '모의 실행 화면 · 실제 step API 연동 시 교체됩니다.'
    : 'API 스냅샷 · 실제 step/log API 연동 전까지 run/live 상태만 표시합니다.';

  return (
    <div className="run-monitor-page">
      <div className="run-monitor-grid-bg" aria-hidden="true" />

      <RunMonitorTopbar runId={run.id} targetUrl={run.startUrl} statusTone={statusTone} statusLabel={statusLabel} />

      <main className="run-monitor-cockpit" aria-labelledby="run-monitor-title">
        <section className="run-monitor-simulation" aria-labelledby="run-monitor-title">
          <div className="run-monitor-simulation__header">
            <div className="run-monitor-section-title">
              <h1 id="run-monitor-title">실시간 시뮬레이션</h1>
              <span aria-hidden="true" />
              <p>{currentCheckpoint}</p>
            </div>
            <span className="run-monitor-viewport-label">1440px 뷰포트</span>
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
              <div className="run-monitor-browser__address">{run.startUrl}</div>
              <span className="run-monitor-browser__mode-pill">{isApiFallback ? '모의 프리뷰' : '실제 캡처'}</span>
            </div>

            <div className="run-monitor-browser__stage">
              {snapshotUrl ? (
                <img className="run-monitor-browser__image" src={snapshotUrl} alt="최근 캡처된 분석 화면" />
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
                  <p>실제 run에서 latestFrame 또는 latestSnapshot이 도착하면 이 영역에 표시됩니다.</p>
                </div>
              )}
            </div>
          </div>
        </section>

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
              <h2 id="live-insight-title">현재 체크포인트</h2>
            </div>
            <div className="run-monitor-live-insight__card">
              <strong>{currentCheckpoint}</strong>
              <p>
                선택한 <span>{run.goal ?? run.name}</span> 흐름에서 화면 위계와 전환 마찰 근거를 수집하고 있습니다.
              </p>
            </div>
          </section>

          <div className="run-monitor-panel-scroll">
            {!isApiFallback && (
              <EvidencePanel
                evidencePacket={evidencePacket}
                isEvidenceLoading={isEvidenceLoading}
                evidenceLoadError={evidenceLoadError}
              />
            )}

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
                  <dd>{getDevicePresetLabel(run.devicePreset)}</dd>
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
                        <time>{step.timestamp}</time>
                      </div>
                      <p>{step.detail}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </section>

            <section className="run-monitor-log" aria-labelledby="action-log-title">
              <h2 id="action-log-title">작업 로그</h2>
              <ul className="run-monitor-log__list">
                {visibleLogs.map((log) => (
                  <li key={log.id} className={`run-monitor-log__item run-monitor-log__item--${log.tone}`}>
                    <time>{log.time}</time>
                    <span>{log.message}</span>
                  </li>
                ))}
              </ul>
            </section>
          </div>

        </aside>
      </main>
    </div>
  );
}
