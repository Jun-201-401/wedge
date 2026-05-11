import { useEffect, useMemo, useRef, useState } from 'react';

import { useAuthenticatedResourceUrl } from '../../../shared/lib/authenticatedResourceUrl';
import { RUNS_PATH } from '../../../shared/lib/appPaths';
import { resolveActiveFinding, resolveLinkedFindingId } from '../lib/runReportInteractions';
import type { ReportDecisionNode, ReportFinding, ReportRecommendation, RunReportViewModel } from '../lib/runReportViewModel';
import '../styles/run-report-viewer.css';

interface RunReportViewerProps {
  report: RunReportViewModel;
}

function formatIssueCount(issueCount: number) {
  return String(issueCount).padStart(2, '0');
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

const TOP_RECOMMENDATION_COUNT = 3;

function normalizeStageLabel(value: string | null | undefined) {
  return (value ?? '').replace(/[\s/·_-]/g, '').toLowerCase();
}

function stageBucket(value: string | null | undefined) {
  const normalized = normalizeStageLabel(value);

  if (/첫|first|view|보기|발견/.test(normalized)) {
    return 'first';
  }

  if (/가치|신뢰|이해|trust|value|비교/.test(normalized)) {
    return 'value';
  }

  if (/행동|cta|전환|선택|입력|input|commit/.test(normalized)) {
    return 'action';
  }

  return normalized || 'unknown';
}

function resolveActiveFlowNodeId(nodes: ReportDecisionNode[], finding: ReportFinding | null) {
  if (nodes.length === 0) {
    return null;
  }

  if (!finding) {
    return nodes.find((node) => node.tone === 'friction')?.id ?? nodes[0].id;
  }

  const findingBucket = stageBucket(finding.stage);
  const titleMatch = nodes.find((node) => stageBucket(node.title) === findingBucket);

  if (titleMatch) {
    return titleMatch.id;
  }

  const codeMatch = nodes.find((node) => stageBucket(node.code) === findingBucket);
  return codeMatch?.id ?? nodes.find((node) => node.tone === 'friction')?.id ?? nodes[0].id;
}

function flowNodeLabel(node: ReportDecisionNode, index: number) {
  const bucket = stageBucket(node.title);

  if (bucket === 'first') {
    return '첫 화면 발견';
  }

  if (bucket === 'value') {
    return /신뢰|trust/.test(normalizeStageLabel(`${node.code} ${node.title}`)) ? '신뢰 형성' : '가치 이해';
  }

  if (bucket === 'action') {
    return '행동 선택';
  }

  return ['첫 화면', '가치 판단', '행동 선택'][index] ?? node.title;
}

function shortFlowNodeLabel(label: string) {
  return {
    '첫 화면 발견': '첫 화면',
    '가치 이해': '가치',
    '신뢰 형성': '신뢰',
    '행동 선택': '행동',
    '가치 판단': '가치',
  }[label] ?? label.replace(/\s+/g, '');
}

function linkedFinding(findings: ReportFinding[], recommendation: ReportRecommendation | null) {
  const findingId = recommendation ? resolveLinkedFindingId(findings, recommendation.findingId) : null;
  return findingId ? findings.find((finding) => finding.id === findingId) ?? null : null;
}

function recommendationReason(recommendation: ReportRecommendation, finding: ReportFinding | null) {
  return recommendation.rationale ?? finding?.summary ?? recommendation.expectedImpact;
}

function recommendationProblem(recommendation: ReportRecommendation, finding: ReportFinding | null) {
  return recommendation.rationale ?? finding?.summary ?? '사용자가 다음 행동을 판단하는 데 필요한 정보가 부족합니다.';
}

function recommendationMeta(recommendation: ReportRecommendation, finding: ReportFinding | null) {
  const stage = finding?.stage ?? '분석 결과';
  let signal = '판단 보강';

  if (finding?.severity === 'high') {
    signal = '전환 영향 큼';
  } else if (recommendation.effort.toLowerCase() === 'low' || recommendation.effort === '낮음') {
    signal = '빠른 수정';
  }

  return `${stage} · ${signal}`;
}

function recommendationLocationLabel(finding: ReportFinding | null) {
  return finding?.evidenceLabel ?? finding?.title ?? '화면 근거 확인';
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
  const [isAllRecommendationsOpen, setIsAllRecommendationsOpen] = useState(false);
  const recommendations = report.recommendations;
  const topRecommendations = recommendations.slice(0, TOP_RECOMMENDATION_COUNT);
  const hasMoreRecommendations = recommendations.length > TOP_RECOMMENDATION_COUNT;
  const selectedRecommendation = recommendations.find((recommendation) => recommendation.id === selectedRecommendationId) ?? recommendations[0] ?? null;
  const selectedRecommendationFinding = linkedFinding(report.findings, selectedRecommendation);
  const selectedRecommendationFindingId = selectedRecommendation
    ? resolveLinkedFindingId(report.findings, selectedRecommendation.findingId)
    : null;
  const activeFlowNodeId = resolveActiveFlowNodeId(report.decisionNodes, selectedRecommendationFinding);
  const flowNodes = report.decisionNodes.map((node, index) => {
    const label = flowNodeLabel(node, index);

    return {
      id: node.id,
      label,
      shortLabel: shortFlowNodeLabel(label),
    };
  });
  const activeFinding = useMemo(() => {
    const activeId = hoveredFindingId ?? selectedFindingId;
    return resolveActiveFinding(report.findings, activeId);
  }, [hoveredFindingId, report.findings, selectedFindingId]);
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

  function selectRecommendation(recommendation: ReportRecommendation) {
    const findingId = resolveLinkedFindingId(report.findings, recommendation.findingId);
    setSelectedRecommendationId(recommendation.id);

    if (findingId) {
      setSelectedFindingId(findingId);
    }
  }

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

          <aside className="run-report-insight-panel" aria-label="먼저 고칠 항목">
            <header className="run-report-insight-summary">
              <span>먼저 고칠 항목</span>
              <h2>{recommendations.length > 0 ? '개선 후보를 선택해 화면 근거를 확인하세요' : '이번 실행에서 바로 고칠 항목은 없습니다'}</h2>
              <p>
                {recommendations.length > 0
                  ? '상단 후보를 선택하면 오른쪽 진단과 왼쪽 화면 위치가 함께 바뀝니다.'
                  : '사용자가 지나간 단계에서 큰 전환 마찰이 발견되지 않았습니다.'}
              </p>
            </header>

            <section className="run-report-section run-report-section--priority" aria-labelledby="run-report-actions-title">
              <div className="run-report-section-heading">
                <h2 id="run-report-actions-title">개선 후보 선택</h2>
              </div>

              {recommendations.length === 0 ? (
                <div className="run-report-nudge-empty" role="status">
                  <strong>현재 우선 수정할 항목은 없습니다</strong>
                  <p>이번 실행에서는 전환을 크게 막는 마찰이 발견되지 않았습니다.</p>
                </div>
              ) : (
                <div className="run-report-recommendation-picker" onMouseLeave={() => setHoveredFindingId(null)}>
                  <ol className="run-report-recommendation-tabs">
                    {topRecommendations.map((recommendation, index) => {
                      const relatedFinding = linkedFinding(report.findings, recommendation);
                      const relatedFindingId = relatedFinding?.id ?? null;
                      const isSelected = selectedRecommendationId === recommendation.id;

                      return (
                        <li key={recommendation.id}>
                          <button
                            type="button"
                            className={`run-report-recommendation-tab${isSelected ? ' run-report-recommendation-tab--active' : ''}`}
                            aria-pressed={isSelected}
                            onClick={() => selectRecommendation(recommendation)}
                            onFocus={() => setHoveredFindingId(relatedFindingId)}
                            onMouseEnter={() => setHoveredFindingId(relatedFindingId)}
                          >
                            <span className="run-report-recommendation-tab__rank">{index + 1}</span>
                            <span className="run-report-recommendation-tab__copy">
                              <strong>{recommendation.title}</strong>
                              <small>{recommendationReason(recommendation, relatedFinding)}</small>
                            </span>
                            <span className="run-report-recommendation-tab__meta">
                              {recommendationMeta(recommendation, relatedFinding)}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ol>

                  {hasMoreRecommendations ? (
                    <div className="run-report-all-recommendations">
                      <button
                        type="button"
                        className="run-report-all-recommendations__toggle"
                        aria-expanded={isAllRecommendationsOpen}
                        aria-controls="run-report-all-recommendations-panel"
                        onClick={() => setIsAllRecommendationsOpen((isOpen) => !isOpen)}
                      >
                        전체 후보 {recommendations.length}개 보기
                      </button>
                      <div
                        id="run-report-all-recommendations-panel"
                        className={`run-report-all-recommendations__panel${isAllRecommendationsOpen ? ' run-report-all-recommendations__panel--open' : ''}`}
                        aria-hidden={!isAllRecommendationsOpen}
                      >
                        {recommendations.map((recommendation, index) => {
                          const relatedFinding = linkedFinding(report.findings, recommendation);
                          const relatedFindingId = relatedFinding?.id ?? null;
                          const isSelected = selectedRecommendationId === recommendation.id;
                          const metaParts = recommendationMeta(recommendation, relatedFinding).split(' · ');

                          return (
                            <button
                              key={recommendation.id}
                              type="button"
                              className={`run-report-all-recommendations__row${isSelected ? ' run-report-all-recommendations__row--active' : ''}`}
                              tabIndex={isAllRecommendationsOpen ? 0 : -1}
                              onClick={() => selectRecommendation(recommendation)}
                              onFocus={() => setHoveredFindingId(relatedFindingId)}
                              onMouseEnter={() => setHoveredFindingId(relatedFindingId)}
                            >
                              <span>{index + 1}</span>
                              <strong>{recommendation.title}</strong>
                              <small>{metaParts[1] ?? metaParts[0]}</small>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
            </section>

            {selectedRecommendation ? (
              <section className="run-report-section run-report-section--selected-recommendation" aria-labelledby="run-report-selected-action-title">
                <div className="run-report-selected-action" onMouseLeave={() => setHoveredFindingId(null)}>
                  <div className="run-report-stage-group">
                    <span className="run-report-stage-group__title">전환 단계</span>
                    <div className="run-report-stage-chips" aria-label="전환 단계">
                      <ol>
                        {flowNodes.map((node) => {
                          const isActive = node.id === activeFlowNodeId;

                          return (
                            <li key={node.id} className={isActive ? 'run-report-stage-chips__item--active' : undefined}>
                              <span
                                className={`run-report-stage-chip${isActive ? ' run-report-stage-chip--active' : ''}`}
                                aria-current={isActive ? 'step' : undefined}
                                title={node.label}
                              >
                                {isActive ? node.label : node.shortLabel}
                              </span>
                            </li>
                          );
                        })}
                      </ol>
                    </div>
                  </div>

                  <h2 id="run-report-selected-action-title">{selectedRecommendation.title}</h2>
                  <div className="run-report-selected-action__reason">
                    <strong>전환이 끊기는 지점입니다</strong>
                    <p>{recommendationReason(selectedRecommendation, selectedRecommendationFinding)}</p>
                  </div>

                  <span className="run-report-selected-action__location">
                    화면 위치 <strong>{recommendationLocationLabel(selectedRecommendationFinding)}</strong>
                  </span>

                  <div className="run-report-selected-action__steps">
                    <article>
                      <span>1</span>
                      <strong>문제</strong>
                      <p>{recommendationProblem(selectedRecommendation, selectedRecommendationFinding)}</p>
                    </article>
                    <article>
                      <span>2</span>
                      <strong>바꿀 것</strong>
                      <p>{selectedRecommendation.detail}</p>
                    </article>
                    <article>
                      <span>3</span>
                      <strong>확인할 신호</strong>
                      <p>{selectedRecommendation.validationQuestion ?? selectedRecommendation.expectedImpact}</p>
                    </article>
                  </div>
                </div>
              </section>
            ) : null}
          </aside>
        </div>
      </main>
    </div>
  );
}
