import { useAuthenticatedResourceUrl } from '../../../shared/lib/authenticatedResourceUrl';
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
  const primaryFinding = report.findings[0] ?? null;
  const evidencePreviewUrl = useAuthenticatedResourceUrl(report.evidencePreviewUrl);

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
          <div className="run-report-main-column">
            <section className="run-report-section run-report-section--priority" aria-labelledby="run-report-nudge-title">
              <div className="run-report-section-heading">
                <h2 id="run-report-nudge-title">Recommended Nudge</h2>
                <span aria-hidden="true" />
              </div>

              <div className="run-report-nudge-list">
                {report.recommendations.slice(0, 2).map((recommendation) => (
                  <article key={recommendation.id} className="run-report-nudge-card">
                    <div className="run-report-nudge-card__eyebrow">
                      <span aria-hidden="true">+</span>
                      <strong>{recommendation.priority}</strong>
                    </div>
                    <h3>{recommendation.title}</h3>
                    <p>{recommendation.detail}</p>
                    <dl>
                      <div>
                        <dt>Expected Impact</dt>
                        <dd>{recommendation.expectedImpact}</dd>
                      </div>
                      <div>
                        <dt>Difficulty</dt>
                        <dd>{recommendation.effort}</dd>
                      </div>
                    </dl>
                  </article>
                ))}
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

            <section className="run-report-section run-report-evidence-detail" aria-labelledby="run-report-evidence-title">
              <div className="run-report-section-heading run-report-section-heading--plain">
                <h2 id="run-report-evidence-title">Evidence Details</h2>
              </div>

              <article className="run-report-evidence-card">
                <div className="run-report-evidence-card__head">
                  <div>
                    <h3>Problem: {primaryFinding?.title ?? '발견된 마찰이 없습니다'}</h3>
                    <p>관련 지점: {primaryFinding?.evidenceLabel ?? '추가 근거 없음'}</p>
                  </div>
                  <div>
                    <span>Confidence</span>
                    <strong>{primaryFinding ? `${Math.round(primaryFinding.confidence * 100)}%` : '0%'}</strong>
                  </div>
                </div>

                <div className="run-report-evidence-preview" aria-label="분석 근거 화면 축약 미리보기">
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
                  {primaryFinding ? (
                    <div
                      className={`run-report-friction-marker run-report-friction-marker--${primaryFinding.severity}`}
                      style={{
                        top: primaryFinding.highlight.top,
                        left: primaryFinding.highlight.left,
                        width: primaryFinding.highlight.width,
                        height: primaryFinding.highlight.height,
                      }}
                    >
                      <span>{primaryFinding.highlight.label}</span>
                    </div>
                  ) : null}
                  <div className="run-report-evidence-preview__caption">
                    <p>{primaryFinding?.summary ?? '이번 흐름에서는 우선 조치가 필요한 마찰을 찾지 못했습니다.'}</p>
                  </div>
                </div>
              </article>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
