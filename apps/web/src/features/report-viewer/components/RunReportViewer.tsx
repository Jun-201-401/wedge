import { useEffect, useMemo, useState } from 'react';
import { useAuthenticatedResourceUrl } from '../../../shared/lib/authenticatedResourceUrl';
import type { ReportFinding, RunReportViewModel } from '../lib/runReportViewModel';
import '../styles/run-report-viewer.css';

interface RunReportViewerProps {
  report: RunReportViewModel;
}

function formatIssueCount(issueCount: number) {
  return String(issueCount).padStart(2, '0');
}

function severityLabel(severity: string) {
  return {
    high: 'High',
    medium: 'Medium',
    low: 'Low',
  }[severity] ?? 'Medium';
}

function formatConfidence(confidence: number) {
  return `${Math.round(confidence * 100)}%`;
}

function selectedFindingFrom(findings: ReportFinding[], selectedFindingId: string | null) {
  return findings.find((finding) => finding.id === selectedFindingId) ?? findings[0] ?? null;
}

export function RunReportBrand() {
  return (
    <a href="/" className="run-report-brand" aria-label="Wedge home">
      <span>Wedge</span>
    </a>
  );
}

export function RunReportViewer({ report }: RunReportViewerProps) {
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(report.findings[0]?.id ?? null);
  const [isFullFindingListOpen, setIsFullFindingListOpen] = useState(false);
  const topFindings = report.findings.slice(0, 3);
  const selectedFinding = useMemo(
    () => selectedFindingFrom(report.findings, selectedFindingId),
    [report.findings, selectedFindingId],
  );
  const hiddenFindingCount = Math.max(0, report.findings.length - topFindings.length);
  const selectedEvidencePreviewUrl = selectedFinding?.previewImageUrl ?? report.evidencePreviewUrl;
  const evidencePreviewUrl = useAuthenticatedResourceUrl(selectedEvidencePreviewUrl);

  useEffect(() => {
    if (report.findings.length === 0) {
      setSelectedFindingId(null);
      setIsFullFindingListOpen(false);
      return;
    }

    if (!selectedFindingFrom(report.findings, selectedFindingId)) {
      setSelectedFindingId(report.findings[0].id);
    }
  }, [report.findings, selectedFindingId]);

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
            <section className="run-report-section run-report-section--top-findings" aria-labelledby="run-report-top-findings-title">
              <div className="run-report-section-heading">
                <h2 id="run-report-top-findings-title">Top Priority Findings</h2>
                <span aria-hidden="true" />
              </div>

              {topFindings.length > 0 ? (
                <ol className="run-report-top-finding-list">
                  {topFindings.map((finding, index) => (
                    <li key={finding.id} className={`run-report-top-finding-card run-report-top-finding-card--${finding.severity}`}>
                      <button
                        type="button"
                        className="run-report-top-finding-card__button"
                        aria-pressed={selectedFinding?.id === finding.id}
                        onClick={() => setSelectedFindingId(finding.id)}
                      >
                        <div className="run-report-top-finding-card__meta">
                          <span>#{String(index + 1).padStart(2, '0')}</span>
                          <strong>{severityLabel(finding.severity)}</strong>
                        </div>
                        <h3>{finding.title}</h3>
                        <p>{finding.summary}</p>
                        <dl>
                          <div>
                            <dt>Stage</dt>
                            <dd>{finding.stage}</dd>
                          </div>
                          <div>
                            <dt>Confidence</dt>
                            <dd>{formatConfidence(finding.confidence)}</dd>
                          </div>
                          <div>
                            <dt>Evidence</dt>
                            <dd>{finding.evidenceCount}</dd>
                          </div>
                        </dl>
                      </button>
                    </li>
                  ))}
                </ol>
              ) : (
                <div className="run-report-top-finding-empty" role="status">
                  <strong>우선순위 이슈 없음</strong>
                  <p>이번 분석에서는 상위 3개로 표시할 마찰 지점이 발견되지 않았습니다.</p>
                </div>
              )}

              {hiddenFindingCount > 0 ? (
                <div className="run-report-finding-more">
                  <button
                    type="button"
                    onClick={() => setIsFullFindingListOpen((value) => !value)}
                    aria-expanded={isFullFindingListOpen}
                  >
                    {isFullFindingListOpen ? '전체 문제 접기' : `나머지 ${hiddenFindingCount}개 더보기`}
                  </button>

                  {isFullFindingListOpen ? (
                    <ol className="run-report-finding-full-list" aria-label="전체 finding 목록">
                      {report.findings.map((finding, index) => (
                        <li key={finding.id}>
                          <button
                            type="button"
                            className="run-report-finding-row"
                            aria-pressed={selectedFinding?.id === finding.id}
                            onClick={() => setSelectedFindingId(finding.id)}
                          >
                            <span>#{String(index + 1).padStart(2, '0')}</span>
                            <strong>{finding.title}</strong>
                            <small>{finding.stage} · {formatConfidence(finding.confidence)}</small>
                          </button>
                        </li>
                      ))}
                    </ol>
                  ) : null}
                </div>
              ) : null}
            </section>

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
                    <h3>Problem: {selectedFinding?.title ?? '발견된 마찰이 없습니다'}</h3>
                    <p>관련 지점: {selectedFinding?.evidenceLabel ?? '추가 근거 없음'}</p>
                  </div>
                  <div>
                    <span>Confidence</span>
                    <strong>{selectedFinding ? formatConfidence(selectedFinding.confidence) : '0%'}</strong>
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
                  {selectedFinding ? (
                    <div
                      className={`run-report-friction-marker run-report-friction-marker--${selectedFinding.severity}`}
                      style={{
                        top: selectedFinding.highlight.top,
                        left: selectedFinding.highlight.left,
                        width: selectedFinding.highlight.width,
                        height: selectedFinding.highlight.height,
                      }}
                    >
                      <span>{selectedFinding.highlight.label}</span>
                    </div>
                  ) : null}
                  <div className="run-report-evidence-preview__caption">
                    <p>{selectedFinding?.summary ?? '이번 흐름에서는 우선 조치가 필요한 마찰을 찾지 못했습니다.'}</p>
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
