import { useMemo, useState } from 'react';

import { useAuthenticatedResourceUrl } from '../../../shared/lib/authenticatedResourceUrl';
import { resolveActiveFinding, resolveLinkedFindingId } from '../lib/runReportInteractions';
import type { RunReportViewModel } from '../lib/runReportViewModel';
import '../styles/run-report-viewer.css';

interface RunReportViewerProps {
  report: RunReportViewModel;
}

function formatIssueCount(issueCount: number) {
  return String(issueCount).padStart(2, '0');
}

export function RunReportBrand() {
  return (
    <a href="/" className="run-report-brand" aria-label="Wedge home">
      <span>Wedge</span>
    </a>
  );
}

export function RunReportViewer({ report }: RunReportViewerProps) {
  const [hoveredFindingId, setHoveredFindingId] = useState<string | null>(null);
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(report.findings[0]?.id ?? null);
  const evidencePreviewUrl = useAuthenticatedResourceUrl(report.evidencePreviewUrl);
  const recommendations = report.recommendations.slice(0, 3);
  const activeFinding = useMemo(() => {
    const activeId = hoveredFindingId ?? selectedFindingId;
    return resolveActiveFinding(report.findings, activeId);
  }, [hoveredFindingId, report.findings, selectedFindingId]);
  const activeFindingId = activeFinding?.id ?? null;
  const highlightSourceLabel = activeFinding?.highlight.source === 'fallback' ? '추정 영역' : '실측 영역';

  return (
    <div className="run-report-page">
      <div className="run-report-grid-bg" aria-hidden="true" />

      <header className="run-report-topbar" aria-label="Wedge analysis report">
        <div className="run-report-topbar__left">
          <RunReportBrand />
          <span className="run-report-topbar__divider" aria-hidden="true" />
          <div className="run-report-target-inline run-report-target-inline--optional">
            <span>Report ID:</span>
            <strong>{report.reportId}</strong>
          </div>
        </div>

        <div className="run-report-topbar__right">
          <button type="button" className="run-report-topbar__ghost" disabled title="PDF export API 연결 대기 중">Export PDF · 준비 중</button>
          <button type="button" className="run-report-topbar__share" disabled title="Share report API 연결 대기 중">Share Report · 준비 중</button>
        </div>
      </header>

      <main className="run-report-shell" aria-labelledby="run-report-title">
        <header className="run-report-hero">
          <div className="run-report-hero__copy">
            <span className="run-report-tag">분석 완료</span>
            <h1 id="run-report-title">
              랜딩 페이지 <span>CTA 전환 마찰 리포트</span>
            </h1>
            <p>
              Target: <strong>{report.targetUrl}</strong>
              <span aria-hidden="true">•</span>
              시나리오: {report.scenarioLabel}
            </p>
            {report.sourceNotice ? <p className="run-report-hero__notice" role="status">{report.sourceNotice}</p> : null}
          </div>

          <dl className="run-report-hero-stats" aria-label="리포트 요약 지표">
            <div>
              <dt>총 단계</dt>
              <dd>{report.totalSteps}</dd>
            </div>
            <div>
              <dt>마찰 지점</dt>
              <dd className="run-report-hero-stats__danger">{formatIssueCount(report.issueCount)}</dd>
            </div>
            <div>
              <dt>소요 시간</dt>
              <dd>{report.durationLabel}</dd>
            </div>
          </dl>
        </header>

        <div className="run-report-layout">
          <section className="run-report-visual-panel" aria-labelledby="run-report-evidence-title">
            <div className="run-report-section-heading run-report-section-heading--plain">
              <h2 id="run-report-evidence-title">Evidence Screen</h2>
            </div>

            <article className="run-report-evidence-card">
              <div className="run-report-evidence-card__head">
                <div>
                  <h3>{activeFinding?.title ?? '발견된 마찰이 없습니다'}</h3>
                  <p>관련 지점: {activeFinding?.evidenceLabel ?? '추가 근거 없음'}</p>
                </div>
                <div>
                  <span>Confidence</span>
                  <strong>{activeFinding ? `${Math.round(activeFinding.confidence * 100)}%` : '0%'}</strong>
                </div>
              </div>

              <div className="run-report-evidence-preview" aria-label="분석 근거 화면 미리보기">
                {evidencePreviewUrl ? (
                  <img className="run-report-evidence-preview__image" src={evidencePreviewUrl} alt="실제 실행에서 수집된 evidence 화면" />
                ) : (
                  <div className="run-report-evidence-preview__site">
                    <div className="run-report-evidence-preview__nav" aria-hidden="true">
                      <span />
                      <span />
                      <span />
                    </div>
                    <div className="run-report-evidence-preview__hero">
                      <small>{report.heroSubtitle}</small>
                      <strong>{report.heroTitle}</strong>
                      <button type="button">{report.heroCallToAction}</button>
                    </div>
                  </div>
                )}
                {activeFinding ? (
                  <div
                    className={`run-report-friction-marker run-report-friction-marker--${activeFinding.severity}`}
                    style={{
                      top: activeFinding.highlight.top,
                      left: activeFinding.highlight.left,
                      width: activeFinding.highlight.width,
                      height: activeFinding.highlight.height,
                    }}
                  >
                    <span>{activeFinding.highlight.label}</span>
                  </div>
                ) : null}
              </div>

              <div className="run-report-evidence-card__summary">
                <span>{activeFinding ? `${activeFinding.issueId} · ${highlightSourceLabel}` : 'NO ISSUE'}</span>
                <p>{activeFinding?.summary ?? '이번 흐름에서는 우선 조치가 필요한 마찰을 찾지 못했습니다.'}</p>
              </div>
            </article>
          </section>

          <aside className="run-report-insight-panel" aria-label="Nudge and finding details">
            <section className="run-report-section run-report-section--priority" aria-labelledby="run-report-nudge-title">
              <div className="run-report-section-heading">
                <h2 id="run-report-nudge-title">Recommended Nudge</h2>
                <span aria-hidden="true" />
              </div>

              <div className="run-report-nudge-list" onMouseLeave={() => setHoveredFindingId(null)}>
                {recommendations.map((recommendation) => {
                  const relatedFindingId = resolveLinkedFindingId(report.findings, recommendation.findingId);
                  const isActive = relatedFindingId === activeFindingId;
                  const isSelected = relatedFindingId === selectedFindingId;

                  return (
                    <button
                      key={recommendation.id}
                      type="button"
                      className={`run-report-nudge-card${isActive ? ' run-report-nudge-card--active' : ''}`}
                      aria-pressed={isSelected}
                      onBlur={() => setHoveredFindingId(null)}
                      onClick={() => {
                        if (relatedFindingId) {
                          setSelectedFindingId(relatedFindingId);
                        }
                      }}
                      onFocus={() => {
                        if (relatedFindingId) {
                          setSelectedFindingId(relatedFindingId);
                        }
                      }}
                      onMouseEnter={() => setHoveredFindingId(relatedFindingId)}
                    >
                      <span className="run-report-nudge-card__eyebrow">
                        <span aria-hidden="true">+</span>
                        <strong>{recommendation.priority}</strong>
                      </span>
                      <span className="run-report-nudge-card__title">{recommendation.title}</span>
                      <span className="run-report-nudge-card__detail">{recommendation.detail}</span>
                      <span className="run-report-nudge-card__meta">
                        <span>
                          <small>Expected Impact</small>
                          <strong>{recommendation.expectedImpact}</strong>
                        </span>
                        <span>
                          <small>Difficulty</small>
                          <strong>{recommendation.effort}</strong>
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="run-report-section" aria-labelledby="run-report-decision-title">
              <div className="run-report-section-heading">
                <h2 id="run-report-decision-title">Decision Map</h2>
                <span aria-hidden="true" />
              </div>

              <ol className="run-report-decision-map">
                {report.decisionNodes.map((node) => (
                  <li key={node.id} className={`run-report-decision-node run-report-decision-node--${node.tone}`}>
                    <div className="run-report-decision-node__badge">{node.code}</div>
                    <div className="run-report-decision-node__body">
                      <h3>{node.title}</h3>
                      <p>{node.summary}</p>
                      {node.tags.length > 0 ? (
                        <div className="run-report-decision-node__tags">
                          {node.tags.map((tag) => <span key={tag}>{tag}</span>)}
                        </div>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          </aside>
        </div>
      </main>
    </div>
  );
}
