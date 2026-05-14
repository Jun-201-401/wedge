import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';

import { useAuthenticatedResourceUrl } from '../../../shared/lib/authenticatedResourceUrl';
import { HOME_PATH, RUNS_PATH } from '../../../shared/lib/appPaths';
import { formatDisplayUrl } from '../../../shared/lib/displayUrl';
import { useResizableTrailingPanel } from '../../../shared/lib/resizableTrailingPanel';
import { resolveActiveFinding, resolveLinkedFindingId } from '../lib/runReportInteractions';
import type { ReportFinding, ReportRecommendation, RunReportViewModel } from '../lib/runReportViewModel';
import '../styles/run-report-viewer.css';

interface RunReportViewerProps {
  report: RunReportViewModel;
  canDownloadReport?: boolean;
  isReportDownloading?: boolean;
  reportDownloadMessage?: string;
  onDownloadReport?: () => void;
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
const RUN_REPORT_INSIGHT_PANEL_DEFAULT_WIDTH = 576;
const RUN_REPORT_INSIGHT_PANEL_DEFAULT_RATIO = 0.4;
const RUN_REPORT_INSIGHT_PANEL_MIN_WIDTH = 384;
const RUN_REPORT_INSIGHT_PANEL_MAX_WIDTH = 704;
const RUN_REPORT_VISUAL_MIN_WIDTH = 560;
const RUN_REPORT_RESIZE_STEP = 24;
const RUN_REPORT_RESIZER_FALLBACK_WIDTH = 8;

const REPORT_FLOW_STAGES = [
  { id: 'first', label: '첫 화면', shortLabel: '첫 화면' },
  { id: 'value', label: '가치 판단', shortLabel: '가치' },
  { id: 'action', label: '행동 선택', shortLabel: '행동' },
] as const;

type ReportFlowStageId = (typeof REPORT_FLOW_STAGES)[number]['id'];

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

function toReportFlowStageId(value: string | null | undefined): ReportFlowStageId {
  const bucket = stageBucket(value);

  if (bucket === 'first' || bucket === 'value' || bucket === 'action') {
    return bucket;
  }

  return 'action';
}

function reportFlowStageLabel(value: string | null | undefined) {
  const flowStageId = toReportFlowStageId(value);
  return REPORT_FLOW_STAGES.find((stage) => stage.id === flowStageId)?.label ?? '행동 선택';
}

function resolveActiveFlowStageId(report: RunReportViewModel, finding: ReportFinding | null): ReportFlowStageId {
  if (finding) {
    return toReportFlowStageId(finding.stage);
  }

  const frictionNode = report.decisionNodes.find((node) => node.tone === 'friction');
  const fallbackNode = frictionNode ?? report.decisionNodes[0];
  return toReportFlowStageId(`${fallbackNode?.title ?? ''} ${fallbackNode?.code ?? ''}`);
}

function linkedFinding(findings: ReportFinding[], recommendation: ReportRecommendation | null) {
  const findingId = recommendation ? resolveLinkedFindingId(findings, recommendation.findingId) : null;
  return findingId ? findings.find((finding) => finding.id === findingId) ?? null : null;
}

function previewUrlForFinding(finding: ReportFinding, fallbackUrl: string | null | undefined) {
  return finding.previewImageUrl ?? fallbackUrl ?? null;
}

function recommendationReason(recommendation: ReportRecommendation, finding: ReportFinding | null) {
  return recommendation.rationale ?? finding?.summary ?? recommendation.expectedImpact;
}

function recommendationMeta(recommendation: ReportRecommendation, finding: ReportFinding | null) {
  const stage = finding ? reportFlowStageLabel(finding.stage) : '분석 결과';
  let signal = '판단 보강';

  if (finding?.severity === 'high') {
    signal = '전환 영향 큼';
  } else if (recommendation.effort.toLowerCase() === 'low' || recommendation.effort === '낮음') {
    signal = '빠른 수정';
  }

  return `${stage} · ${signal}`;
}

export function RunReportBrand() {
  return (
    <a href={HOME_PATH} className="run-report-brand" aria-label="Wedge 홈">
      <span>Wedge</span>
    </a>
  );
}

export function RunReportViewer({
  report,
  canDownloadReport = false,
  isReportDownloading = false,
  reportDownloadMessage = '',
  onDownloadReport,
}: RunReportViewerProps) {
  const reportLayoutRef = useRef<HTMLDivElement | null>(null);
  const evidencePreviewRef = useRef<HTMLDivElement | null>(null);
  const targetUrlLabel = formatDisplayUrl(report.targetUrl);
  const {
    panelWidth: insightPanelWidth,
    handleResizeKeyDown: handleInsightPanelResizeKeyDown,
    handleResizePointerDown: handleInsightPanelResizePointerDown,
    handleResizePointerMove: handleInsightPanelResizePointerMove,
  } = useResizableTrailingPanel(reportLayoutRef, {
    defaultWidth: RUN_REPORT_INSIGHT_PANEL_DEFAULT_WIDTH,
    defaultRatio: RUN_REPORT_INSIGHT_PANEL_DEFAULT_RATIO,
    minWidth: RUN_REPORT_INSIGHT_PANEL_MIN_WIDTH,
    maxWidth: RUN_REPORT_INSIGHT_PANEL_MAX_WIDTH,
    leadMinWidth: RUN_REPORT_VISUAL_MIN_WIDTH,
    resizeStep: RUN_REPORT_RESIZE_STEP,
    resizerFallbackWidth: RUN_REPORT_RESIZER_FALLBACK_WIDTH,
    resizerSelector: '.run-report-panel-resizer',
    resetKey: report.reportId,
  });
  const [hoveredFindingId, setHoveredFindingId] = useState<string | null>(null);
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(report.findings[0]?.id ?? null);
  const [selectedRecommendationId, setSelectedRecommendationId] = useState<string | null>(report.recommendations[0]?.id ?? null);
  const [isAllRecommendationsOpen, setIsAllRecommendationsOpen] = useState(false);
  const [loadedEvidencePreviewUrl, setLoadedEvidencePreviewUrl] = useState<string | null>(null);
  const recommendations = report.recommendations;
  const topRecommendations = recommendations.slice(0, TOP_RECOMMENDATION_COUNT);
  const hasMoreRecommendations = recommendations.length > TOP_RECOMMENDATION_COUNT;
  const selectedRecommendation = recommendations.find((recommendation) => recommendation.id === selectedRecommendationId) ?? recommendations[0] ?? null;
  const selectedRecommendationFinding = linkedFinding(report.findings, selectedRecommendation);
  const selectedRecommendationFindingId = selectedRecommendation
    ? resolveLinkedFindingId(report.findings, selectedRecommendation.findingId)
    : null;
  const activeFlowStageId = resolveActiveFlowStageId(report, selectedRecommendationFinding);
  const flowNodes = REPORT_FLOW_STAGES;
  const activeFinding = useMemo(() => {
    const activeId = hoveredFindingId ?? selectedFindingId;
    return resolveActiveFinding(report.findings, activeId);
  }, [hoveredFindingId, report.findings, selectedFindingId]);
  const activeFindingId = activeFinding?.id ?? null;

  const recommendationByFindingId = useMemo(() => {
    const map = new Map<string, ReportRecommendation>();
    for (const recommendation of recommendations) {
      if (recommendation.findingId && !map.has(recommendation.findingId)) {
        map.set(recommendation.findingId, recommendation);
      }
    }
    return map;
  }, [recommendations]);

  const hintedRecommendationId = useMemo(() => {
    if (!hoveredFindingId) {
      return null;
    }
    const recommendation = recommendationByFindingId.get(hoveredFindingId);
    return recommendation?.id ?? null;
  }, [hoveredFindingId, recommendationByFindingId]);

  const selectedEvidencePreviewUrl = activeFinding?.previewImageUrl ?? report.evidencePreviewUrl;

  const markerCandidates = useMemo(() => {
    if (!selectedEvidencePreviewUrl) {
      return report.findings.filter((finding) => finding.highlight !== null);
    }

    return report.findings.filter(
      (finding) =>
        finding.highlight !== null &&
        previewUrlForFinding(finding, report.evidencePreviewUrl) === selectedEvidencePreviewUrl,
    );
  }, [report.evidencePreviewUrl, report.findings, selectedEvidencePreviewUrl]);

  const selectFindingMarker = useCallback(
    (finding: ReportFinding) => {
      const linked = recommendationByFindingId.get(finding.id);
      if (!linked) {
        setSelectedFindingId(finding.id);
        return;
      }
      setSelectedRecommendationId(linked.id);
      setSelectedFindingId(finding.id);
    },
    [recommendationByFindingId],
  );

  const evidencePreviewUrl = useAuthenticatedResourceUrl(selectedEvidencePreviewUrl);
  const isEvidencePreviewResolving = Boolean(selectedEvidencePreviewUrl && !evidencePreviewUrl);

  useEffect(() => {
    setLoadedEvidencePreviewUrl(null);
  }, [evidencePreviewUrl]);

  const handleEvidencePreviewImageLoad = useCallback(() => {
    setLoadedEvidencePreviewUrl(evidencePreviewUrl);
  }, [evidencePreviewUrl]);

  useEffect(() => {
    const preview = evidencePreviewRef.current;
    const markerTop = activeFinding?.highlight?.top;
    if (!preview || !markerTop || !evidencePreviewUrl || loadedEvidencePreviewUrl !== evidencePreviewUrl) {
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
  }, [activeFinding?.id, activeFinding?.highlight?.top, evidencePreviewUrl, loadedEvidencePreviewUrl]);

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

  const frictionMarkers = isEvidencePreviewResolving
    ? null
    : markerCandidates.map((finding) => {
        const highlight = finding.highlight;
        if (!highlight) {
          return null;
        }
        const isActive = finding.id === activeFindingId;
        const markerClass = `run-report-friction-marker run-report-friction-marker--${finding.severity} ${
          isActive ? 'run-report-friction-marker--active' : 'run-report-friction-marker--inactive'
        }`;

        return (
          <button
            key={finding.id}
            type="button"
            className={markerClass}
            style={{
              top: highlight.top,
              left: highlight.left,
              width: highlight.width,
              height: highlight.height,
            }}
            onClick={() => selectFindingMarker(finding)}
            onMouseEnter={() => setHoveredFindingId(finding.id)}
            onMouseLeave={() => setHoveredFindingId(null)}
            onFocus={() => setHoveredFindingId(finding.id)}
            onBlur={() => setHoveredFindingId(null)}
            aria-label={`마찰 지점: ${finding.title}`}
            aria-pressed={isActive}
          >
            {isActive ? <span>{markerLabel(highlight.label)}</span> : null}
          </button>
        );
      });

  return (
    <div className="run-report-page">
      <div className="run-report-grid-bg" aria-hidden="true" />

      <header className="run-report-topbar" aria-label="Wedge 분석 리포트">
        <div className="run-report-topbar__left">
          <RunReportBrand />
        </div>

        <div className="run-report-topbar__right">
          <a href={RUNS_PATH} className="run-report-topbar__link run-report-topbar__link--secondary">실행 목록</a>
          <button
            type="button"
            className="run-report-topbar__export"
            disabled={!canDownloadReport || isReportDownloading}
            onClick={onDownloadReport}
            title={canDownloadReport ? '리포트를 Markdown 파일로 다운로드합니다' : '실제 생성된 서버 리포트에서 다운로드를 사용할 수 있습니다'}
          >
            {isReportDownloading ? '리포트 준비 중' : '리포트 다운로드'}
          </button>
        </div>
      </header>
      {reportDownloadMessage ? <p className="run-report-export-status" role="status">{reportDownloadMessage}</p> : null}

      <main className="run-report-shell" aria-labelledby="run-report-title">
        <header className="run-report-hero">
          <div className="run-report-hero__copy">
            <div className="run-report-hero__meta">
              <span className="run-report-tag">완료된 리포트</span>
            </div>
            <h1 id="run-report-title">전환 흐름 리포트</h1>
            <dl className="run-report-hero-context" aria-label="리포트 대상 정보">
              <div>
                <dt>분석 대상</dt>
                <dd title={report.targetUrl}>{targetUrlLabel}</dd>
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

        <div
          ref={reportLayoutRef}
          className="run-report-layout run-report-layout--resizable"
          style={{ '--run-report-insight-panel-width': `${insightPanelWidth}px` } as CSSProperties}
        >
          <section className="run-report-visual-panel" aria-label="분석 화면 미리보기">
            <article className="run-report-evidence-card">
              <div className="run-report-browser" aria-label="최근 화면 캡처">
                <div className="run-report-browser__header" aria-hidden="true">
                  <span />
                  <span />
                </div>
                <div
                  ref={evidencePreviewRef}
                  className={`run-report-evidence-preview${evidencePreviewUrl ? ' run-report-evidence-preview--image' : ''}${isEvidencePreviewResolving ? ' run-report-evidence-preview--resolving' : ''}`}
                  aria-label="분석 근거 화면 미리보기"
                >
                  {evidencePreviewUrl ? (
                    <div className="run-report-evidence-preview__canvas">
                      <img className="run-report-evidence-preview__image" src={evidencePreviewUrl} alt="실제 실행에서 수집된 화면" onLoad={handleEvidencePreviewImageLoad} />
                      {frictionMarkers}
                    </div>
                  ) : isEvidencePreviewResolving ? (
                    <div className="run-report-sr-only" role="status">근거 화면을 불러오는 중입니다.</div>
                  ) : (
                    <div className="run-report-evidence-preview__blank" aria-hidden="true" />
                  )}
                </div>
              </div>
            </article>
          </section>

          <button
            type="button"
            className="run-report-panel-resizer"
            aria-label="리포트 화면과 인사이트 패널 폭 조절"
            title="좌우로 드래그해서 패널 폭 조절"
            onKeyDown={handleInsightPanelResizeKeyDown}
            onPointerDown={handleInsightPanelResizePointerDown}
            onPointerMove={handleInsightPanelResizePointerMove}
          >
            <span aria-hidden="true" />
          </button>

          <aside className="run-report-insight-panel" aria-label="먼저 고칠 항목">
            <header className="run-report-insight-summary">
              <div className="run-report-insight-summary__label">
                <h2>먼저 고칠 항목</h2>
              </div>
              <p>
                {recommendations.length > 0
                  ? '개선 후보를 선택하면 진단과 관련 근거가 함께 바뀝니다.'
                  : '사용자가 지나간 단계에서 큰 전환 마찰이 발견되지 않았습니다.'}
              </p>
            </header>

            <section className="run-report-section run-report-section--priority" aria-labelledby="run-report-actions-title">
              <div className="run-report-section-heading">
                <h3 id="run-report-actions-title">개선 후보</h3>
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
                      const isHinted = !isSelected && hintedRecommendationId === recommendation.id;

                      return (
                        <li key={recommendation.id}>
                          <button
                            type="button"
                            className={`run-report-recommendation-tab${isSelected ? ' run-report-recommendation-tab--active' : ''}${isHinted ? ' run-report-recommendation-tab--hinted' : ''}`}
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
                          const isHinted = !isSelected && hintedRecommendationId === recommendation.id;
                          const metaParts = recommendationMeta(recommendation, relatedFinding).split(' · ');

                          return (
                            <button
                              key={recommendation.id}
                              type="button"
                              className={`run-report-all-recommendations__row${isSelected ? ' run-report-all-recommendations__row--active' : ''}${isHinted ? ' run-report-all-recommendations__row--hinted' : ''}`}
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
                    <div className="run-report-section-heading run-report-section-heading--compact">
                      <h3>전환 흐름</h3>
                    </div>
                    <div className="run-report-stage-chips" aria-label="전환 단계">
                      <ol>
                        {flowNodes.map((node) => {
                          const isActive = node.id === activeFlowStageId;

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

                  <div className="run-report-selected-action__body" key={selectedRecommendation.id}>
                    <div className="run-report-selected-action__summary">
                      <span>문제 요약</span>
                      <h2 id="run-report-selected-action-title">{selectedRecommendation.title}</h2>
                    </div>

                    <div className="run-report-selected-action__details">
                      <article className="run-report-selected-action__detail-card run-report-selected-action__detail-card--primary">
                        <span>개선 방향</span>
                        <p>{selectedRecommendation.detail}</p>
                      </article>
                      <article className="run-report-selected-action__detail-card">
                        <span>판단 근거</span>
                        <p>{recommendationReason(selectedRecommendation, selectedRecommendationFinding)}</p>
                      </article>
                    </div>
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
