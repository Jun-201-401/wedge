import { useEffect, useMemo, useRef, useState } from 'react';

import { useAuthenticatedResourceUrl } from '../../../shared/lib/authenticatedResourceUrl';
import { RUNS_PATH } from '../../../shared/lib/appPaths';
import { resolveActiveFinding, resolveLinkedFindingId } from '../lib/runReportInteractions';
import type { RunReportViewModel } from '../lib/runReportViewModel';
import '../styles/run-report-viewer.css';

interface RunReportViewerProps {
  report: RunReportViewModel;
}

function formatIssueCount(issueCount: number) {
  return String(issueCount).padStart(2, '0');
}

function severityLabel(severity: string) {
  return {
    high: '높음',
    medium: '보통',
    low: '낮음',
  }[severity] ?? '보통';
}

function formatConfidence(confidence: number) {
  return `${Math.round(confidence * 100)}%`;
}

function formatRecommendationPriority(priority: string) {
  return priority.replace(/^NUDGE\s*#\s*/i, '개선 ');
}

function effortLabel(effort: string) {
  return {
    high: '높음',
    medium: '보통',
    low: '낮음',
  }[effort.toLowerCase()] ?? effort;
}

function markerLabel(label: string) {
  return {
    'EVIDENCE POINT': '근거 지점',
    CHECKPOINT: '점검 지점',
    'FOLLOW-UP': '추가 확인',
    'REPORT FINDING': '마찰 지점',
    'DECISION POINT': '판단 지점',
    'NUDGE TARGET': '개선 지점',
    'EVIDENCE TARGET': '근거 대상',
  }[label] ?? label;
}

export function RunReportBrand() {
  return (
    <a href="/" className="run-report-brand" aria-label="Wedge 홈">
      <span>Wedge</span>
    </a>
  );
}

export function RunReportViewer({ report }: RunReportViewerProps) {
  const evidencePreviewRef = useRef<HTMLDivElement | null>(null);
  const [hoveredFindingId, setHoveredFindingId] = useState<string | null>(null);
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(report.findings[0]?.id ?? null);
  const [selectedRecommendationId, setSelectedRecommendationId] = useState<string | null>(report.recommendations[0]?.id ?? null);
  const [isFullFindingListOpen, setIsFullFindingListOpen] = useState(false);
  const topFindings = report.findings.slice(0, 3);
  const recommendations = report.recommendations.slice(0, 3);
  const hiddenFindingCount = Math.max(0, report.findings.length - topFindings.length);
  const selectedRecommendation = recommendations.find((recommendation) => recommendation.id === selectedRecommendationId) ?? recommendations[0] ?? null;
  const selectedRecommendationFindingId = selectedRecommendation
    ? resolveLinkedFindingId(report.findings, selectedRecommendation.findingId)
    : null;
  const selectedRecommendationFinding = resolveActiveFinding(report.findings, selectedRecommendationFindingId);
  const activeFinding = useMemo(() => {
    const activeId = hoveredFindingId ?? selectedFindingId;
    return resolveActiveFinding(report.findings, activeId);
  }, [hoveredFindingId, report.findings, selectedFindingId]);
  const activeFindingId = activeFinding?.id ?? null;
  const selectedEvidencePreviewUrl = activeFinding?.previewImageUrl ?? report.evidencePreviewUrl;
  const evidencePreviewUrl = useAuthenticatedResourceUrl(selectedEvidencePreviewUrl);
  const isEvidencePreviewResolving = Boolean(selectedEvidencePreviewUrl && !evidencePreviewUrl);
  const browserModeLabel = isEvidencePreviewResolving ? '캡처 로딩' : evidencePreviewUrl ? '페이지 캡처' : '모의 프리뷰';

  useEffect(() => {
    const preview = evidencePreviewRef.current;
    const markerTop = activeFinding?.highlight?.top;
    if (!preview || !markerTop || !evidencePreviewUrl) {
      return;
    }

    const topRatio = Number.parseFloat(markerTop) / 100;
    if (!Number.isFinite(topRatio)) {
      return;
    }

    const maxScrollTop = preview.scrollHeight - preview.clientHeight;
    if (maxScrollTop <= 0) {
      return;
    }

    const targetScrollTop = Math.max(
      0,
      Math.min(maxScrollTop, preview.scrollHeight * topRatio - preview.clientHeight * 0.35),
    );
    preview.scrollTo({ top: targetScrollTop, behavior: 'smooth' });
  }, [activeFinding?.id, activeFinding?.highlight?.top, evidencePreviewUrl]);

  useEffect(() => {
    if (recommendations.length === 0) {
      setSelectedRecommendationId(null);
    } else if (!selectedRecommendationId || !recommendations.some((recommendation) => recommendation.id === selectedRecommendationId)) {
      setSelectedRecommendationId(recommendations[0].id);
    }
  }, [recommendations, selectedRecommendationId]);

  useEffect(() => {
    if (report.findings.length === 0) {
      setSelectedFindingId(null);
      setIsFullFindingListOpen(false);
      return;
    }

    if (selectedRecommendationFindingId && report.findings.some((finding) => finding.id === selectedRecommendationFindingId)) {
      setSelectedFindingId(selectedRecommendationFindingId);
      return;
    }

    if (!selectedFindingId || !report.findings.some((finding) => finding.id === selectedFindingId)) {
      setSelectedFindingId(report.findings[0].id);
    }
  }, [report.findings, selectedFindingId, selectedRecommendationFindingId]);

  return (
    <div className="run-report-page">
      <div className="run-report-grid-bg" aria-hidden="true" />

      <header className="run-report-topbar" aria-label="Wedge 분석 리포트">
        <div className="run-report-topbar__left">
          <RunReportBrand />
        </div>

        <div className="run-report-topbar__right">
          <a href={RUNS_PATH} className="run-report-topbar__link run-report-topbar__link--secondary">실행 목록</a>
          <button type="button" className="run-report-topbar__export" disabled title="리포트 내보내기 기능 준비 중">내보내기 · 준비 중</button>
        </div>
      </header>

      <main className="run-report-shell" aria-labelledby="run-report-title">
        <header className="run-report-hero">
          <div className="run-report-hero__copy">
            <div className="run-report-hero__meta">
              <span className="run-report-tag">분석 완료</span>
            </div>
            <h1 id="run-report-title">CTA 전환 마찰 분석</h1>
            <dl className="run-report-hero-context" aria-label="리포트 대상 정보">
              <div>
                <dt>분석 대상</dt>
                <dd>{report.targetUrl}</dd>
              </div>
              <div>
                <dt>점검 시나리오</dt>
                <dd>{report.scenarioLabel}</dd>
              </div>
            </dl>
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
          <section className="run-report-visual-panel" aria-label="분석 화면 미리보기">
            <article className="run-report-evidence-card">
              <div className="run-report-browser" aria-label="최근 화면 캡처">
                <div className="run-report-browser__bar">
                  <div className="run-report-browser__dots" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </div>
                  <div className="run-report-browser__address">{report.targetUrl}</div>
                  <span className="run-report-browser__mode-pill">{browserModeLabel}</span>
                </div>

                <div
                  ref={evidencePreviewRef}
                  className={`run-report-evidence-preview${evidencePreviewUrl ? ' run-report-evidence-preview--image' : ''}${isEvidencePreviewResolving ? ' run-report-evidence-preview--resolving' : ''}`}
                  aria-label="분석 근거 화면 미리보기"
                >
                  {evidencePreviewUrl ? (
                    <div className="run-report-evidence-preview__canvas">
                      <img className="run-report-evidence-preview__image" src={evidencePreviewUrl} alt="실제 실행에서 수집된 화면" />
                      {activeFinding?.highlight && !isEvidencePreviewResolving ? (
                        <div
                          className={`run-report-friction-marker run-report-friction-marker--${activeFinding.severity}`}
                          style={{
                            top: activeFinding.highlight.top,
                            left: activeFinding.highlight.left,
                            width: activeFinding.highlight.width,
                            height: activeFinding.highlight.height,
                          }}
                        >
                          <span>{markerLabel(activeFinding.highlight.label)}</span>
                        </div>
                      ) : null}
                    </div>
                  ) : isEvidencePreviewResolving ? (
                    <div className="run-report-sr-only" role="status">근거 화면을 불러오는 중입니다.</div>
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
                  {!evidencePreviewUrl && activeFinding?.highlight && !isEvidencePreviewResolving ? (
                    <div
                      className={`run-report-friction-marker run-report-friction-marker--${activeFinding.severity}`}
                      style={{
                        top: activeFinding.highlight.top,
                        left: activeFinding.highlight.left,
                        width: activeFinding.highlight.width,
                        height: activeFinding.highlight.height,
                      }}
                    >
                      <span>{markerLabel(activeFinding.highlight.label)}</span>
                    </div>
                  ) : null}
                </div>
              </div>
            </article>
          </section>

          <aside className="run-report-insight-panel" aria-label="우선 개선 제안과 전환 흐름 진단">
            <header className="run-report-insight-summary">
              <span>분석 리포트</span>
              <h2>{recommendations.length > 0 ? '우선 고칠 항목부터 확인하세요' : '이번 실행에서 바로 고칠 항목은 없습니다'}</h2>
              <p>
                {recommendations.length > 0
                  ? '전환을 막을 가능성이 큰 권장 수정을 먼저 정리했습니다.'
                  : '아래 전환 흐름 진단에서 각 단계의 관찰 결과를 확인할 수 있습니다.'}
              </p>
            </header>

            <section className="run-report-section run-report-section--priority" aria-labelledby="run-report-nudge-title">
              <div className="run-report-section-heading">
                <h2 id="run-report-nudge-title">우선 개선 제안</h2>
              </div>

              {selectedRecommendation ? (
                <article
                  className="run-report-primary-nudge"
                  onMouseEnter={() => setHoveredFindingId(selectedRecommendationFindingId)}
                  onMouseLeave={() => setHoveredFindingId(null)}
                >
                  <div className="run-report-primary-nudge__eyebrow">
                    <strong>{formatRecommendationPriority(selectedRecommendation.priority)}</strong>
                    <span>권장 수정</span>
                  </div>
                  <h3>{selectedRecommendation.title}</h3>
                  <p>{selectedRecommendation.detail}</p>
                  <dl className="run-report-primary-nudge__meta">
                    <div>
                      <dt>기대 효과</dt>
                      <dd>{selectedRecommendation.expectedImpact}</dd>
                    </div>
                    <div>
                      <dt>적용 난이도</dt>
                      <dd>{effortLabel(selectedRecommendation.effort)}</dd>
                    </div>
                    <div>
                      <dt>관련 단계</dt>
                      <dd>{selectedRecommendationFinding?.stage ?? '분석 결과'}</dd>
                    </div>
                    <div>
                      <dt>판단 신뢰도</dt>
                      <dd>{selectedRecommendationFinding ? formatConfidence(selectedRecommendationFinding.confidence) : '확인 중'}</dd>
                    </div>
                  </dl>
                </article>
              ) : (
                <div className="run-report-nudge-empty" role="status">
                  <strong>현재 우선 수정할 항목은 없습니다</strong>
                  <p>이번 실행에서는 전환을 크게 막는 마찰이 발견되지 않았습니다.</p>
                </div>
              )}

              {recommendations.length > 1 ? (
                <div className="run-report-next-nudges" onMouseLeave={() => setHoveredFindingId(null)}>
                  <h3>다음 개선 제안</h3>
                  <ol>
                    {recommendations.map((recommendation) => {
                      const relatedFindingId = resolveLinkedFindingId(report.findings, recommendation.findingId);
                      const relatedFinding = resolveActiveFinding(report.findings, relatedFindingId);

                      return (
                        <li key={recommendation.id}>
                          <button
                            type="button"
                            aria-pressed={selectedRecommendation?.id === recommendation.id}
                            onClick={() => {
                              setSelectedRecommendationId(recommendation.id);
                              if (relatedFindingId) {
                                setSelectedFindingId(relatedFindingId);
                              }
                            }}
                            onFocus={() => {
                              if (relatedFindingId) {
                                setHoveredFindingId(relatedFindingId);
                              }
                            }}
                            onMouseEnter={() => setHoveredFindingId(relatedFindingId)}
                          >
                            <span>{formatRecommendationPriority(recommendation.priority)}</span>
                            <strong>{recommendation.title}</strong>
                            <small>{relatedFinding?.stage ?? '분석 결과'} · {effortLabel(recommendation.effort)}</small>
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                </div>
              ) : null}
            </section>

            <section className="run-report-section run-report-section--reason" aria-labelledby="run-report-reason-title">
              <div className="run-report-section-heading">
                <h2 id="run-report-reason-title">왜 필요한가요?</h2>
              </div>

              {selectedRecommendationFinding ? (
                <article
                  className={`run-report-reason-card run-report-reason-card--${selectedRecommendationFinding.severity}`}
                  onMouseEnter={() => setHoveredFindingId(selectedRecommendationFinding.id)}
                  onMouseLeave={() => setHoveredFindingId(null)}
                >
                  <h3>{selectedRecommendationFinding.title}</h3>
                  <p>{selectedRecommendation?.rationale ?? selectedRecommendationFinding.summary}</p>
                  <dl>
                    <div>
                      <dt>관련 단계</dt>
                      <dd>{selectedRecommendationFinding.stage}</dd>
                    </div>
                    <div>
                      <dt>영향도</dt>
                      <dd>{severityLabel(selectedRecommendationFinding.severity)}</dd>
                    </div>
                    <div>
                      <dt>근거</dt>
                      <dd>{selectedRecommendationFinding.evidenceCount}개</dd>
                    </div>
                  </dl>
                </article>
              ) : (
                <div className="run-report-reason-empty" role="status">
                  <strong>연결된 마찰 근거가 없습니다</strong>
                  <p>개선 제안은 전체 분석 요약을 바탕으로 표시됩니다.</p>
                </div>
              )}

              {selectedRecommendation?.validationQuestion ? (
                <aside className="run-report-validation-check">
                  <span>수정 후 확인할 것</span>
                  <p>{selectedRecommendation.validationQuestion}</p>
                </aside>
              ) : null}
            </section>

            <section className="run-report-section run-report-section--top-findings" aria-labelledby="run-report-top-findings-title">
              <div className="run-report-section-heading">
                <h2 id="run-report-top-findings-title">관련 마찰 근거</h2>
              </div>

              {topFindings.length > 0 ? (
                <ol className="run-report-top-finding-list" onMouseLeave={() => setHoveredFindingId(null)}>
                  {topFindings.map((finding, index) => (
                    <li key={finding.id} className={`run-report-top-finding-card run-report-top-finding-card--${finding.severity}`}>
                      <button
                        type="button"
                        className="run-report-top-finding-card__button"
                        aria-pressed={activeFindingId === finding.id}
                        onClick={() => {
                          setSelectedFindingId(finding.id);
                          const linkedRecommendation = recommendations.find((recommendation) => (
                            resolveLinkedFindingId(report.findings, recommendation.findingId) === finding.id
                          ));
                          if (linkedRecommendation) {
                            setSelectedRecommendationId(linkedRecommendation.id);
                          }
                        }}
                        onFocus={() => setHoveredFindingId(finding.id)}
                        onMouseEnter={() => setHoveredFindingId(finding.id)}
                      >
                        <div className="run-report-top-finding-card__meta">
                          <span>#{String(index + 1).padStart(2, '0')}</span>
                          <strong>{severityLabel(finding.severity)}</strong>
                        </div>
                        <h3>{finding.title}</h3>
                        <p>{finding.summary}</p>
                        <dl>
                          <div>
                            <dt>구간</dt>
                            <dd>{finding.stage}</dd>
                          </div>
                          <div>
                            <dt>신뢰도</dt>
                            <dd>{formatConfidence(finding.confidence)}</dd>
                          </div>
                          <div>
                            <dt>근거</dt>
                            <dd>{finding.evidenceCount}</dd>
                          </div>
                        </dl>
                      </button>
                    </li>
                  ))}
                </ol>
              ) : (
                <div className="run-report-top-finding-empty" role="status">
                  <strong>주요 마찰 근거가 없습니다</strong>
                  <p>이번 분석에서는 우선순위로 표시할 마찰 근거가 발견되지 않았습니다.</p>
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
                    <ol className="run-report-finding-full-list" aria-label="전체 마찰 지점 목록">
                      {report.findings.map((finding, index) => (
                        <li key={finding.id}>
                          <button
                            type="button"
                            className="run-report-finding-row"
                            aria-pressed={activeFindingId === finding.id}
                            onClick={() => setSelectedFindingId(finding.id)}
                            onFocus={() => setHoveredFindingId(finding.id)}
                            onMouseEnter={() => setHoveredFindingId(finding.id)}
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

            <section className="run-report-section" aria-labelledby="run-report-decision-title">
              <div className="run-report-section-heading">
                <h2 id="run-report-decision-title">전환 흐름 진단</h2>
              </div>

              <ol className="run-report-decision-map">
                {report.decisionNodes.map((node, nodeIndex) => (
                  <li key={node.id} className={`run-report-decision-node run-report-decision-node--${node.tone}`}>
                      {nodeIndex < report.decisionNodes.length - 1 ? (
                        <div className="run-report-decision-node__rail" aria-hidden="true">
                          <div className="run-report-decision-node__rail-base" />
                          <div className="run-report-decision-node__rail-signal" />
                        </div>
                      ) : null}

                      <div className="run-report-decision-node__node-wrap">
                        <div className="run-report-decision-node__badge" aria-hidden="true">{node.code}</div>
                      </div>

                      <div className="run-report-decision-node__body">
                        <h3>{node.title}</h3>
                        <p>{node.summary}</p>
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
