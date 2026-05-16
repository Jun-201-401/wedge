import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { createPortal } from 'react-dom';

import { requestBlob } from '../../../api/http';
import { createAuthenticatedResourceCache } from '../../../shared/lib/authenticatedResourceCache';
import { useAuthenticatedResourceUrl } from '../../../shared/lib/authenticatedResourceUrl';
import { toSameOriginApiPath } from '../../../shared/lib/apiResourcePath';
import { HOME_PATH, RUNS_PATH } from '../../../shared/lib/appPaths';
import { formatDisplayUrl } from '../../../shared/lib/displayUrl';
import { useResizableTrailingPanel } from '../../../shared/lib/resizableTrailingPanel';
import { resolveActiveFinding, resolveLinkedFindingId } from '../lib/runReportInteractions';
import { referenceBadgesForFinding, type ReferenceBadgeViewModel } from '../lib/runReportReferences';
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
const RUN_REPORT_PREVIEW_CACHE_MAX_ENTRIES = 4;
const RUN_REPORT_PREVIEW_CACHE_MAX_BYTES = 50 * 1024 * 1024;

const REPORT_FLOW_STAGES = [
  { id: 'first', label: '첫 화면', shortLabel: '첫 화면' },
  { id: 'value', label: '가치 이해', shortLabel: '가치 이해' },
  { id: 'action', label: '다음 행동 선택', shortLabel: '행동 선택' },
] as const;

type ReportFlowStageId = (typeof REPORT_FLOW_STAGES)[number]['id'];

interface ReportHelpReference {
  label: string;
  source: string;
  summary: string;
  url: string;
}

interface ReportFlowHelpTerm {
  label: string;
  description: string;
  reference: ReportHelpReference;
}

const REPORT_FLOW_HELP_TERMS: ReportFlowHelpTerm[] = [
  {
    label: '전환 흐름',
    description:
      '페이지 방문부터 가입, 구매, 문의 같은 목표 행동까지 이어지는 전체 과정입니다.',
    reference: {
      label: 'Funnel exploration',
      source: 'Google Analytics',
      summary: '목표 행동까지 이어지는 단계를 나누어 봅니다.',
      url: 'https://support.google.com/analytics/answer/9327974?hl=en-GB',
    },
  },
  {
    label: '첫 화면',
    description:
      '서비스가 무엇인지, 어디서 시작해야 하는지 바로 보이는지 봅니다.',
    reference: {
      label: 'Start using a service',
      source: 'GOV.UK',
      summary: '서비스의 목적과 시작 지점이 바로 이해되는지 봅니다.',
      url: 'https://design-system.service.gov.uk/patterns/start-using-a-service/',
    },
  },
  {
    label: '가치 이해',
    description:
      '얻을 가치와 필요한 조건이 행동 전에 분명히 드러나는지 봅니다.',
    reference: {
      label: 'PR on Websites',
      source: 'NN/g',
      summary: '얻을 가치와 필요한 조건이 행동 전에 분명히 드러나는지 봅니다.',
      url: 'https://media.nngroup.com/media/reports/free/PR_on_Websites_3rd_Edition.pdf',
    },
  },
  {
    label: '다음 행동 선택',
    description:
      '다음에 누를 버튼이나 링크를 헷갈리지 않고 고를 수 있는지 봅니다.',
    reference: {
      label: 'Button Design',
      source: 'Baymard Institute',
      summary: '다음에 누를 버튼이나 링크가 분명한지 봅니다.',
      url: 'https://baymard.com/learn/button-design',
    },
  },
];

const REPORT_FLOW_HELP_STAGE_TERMS = REPORT_FLOW_HELP_TERMS.filter((item) => item.label !== '전환 흐름');

const REPORT_FLOW_HELP_SUMMARY =
  'Wedge는 사용자가 페이지를 보고 행동을 결정하는 과정을 세 단계로 나누어 확인합니다.';

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

function ReferenceChevronIcon() {
  return (
    <svg className="run-report-reference-summary__chevron-icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M7.5 5L12.5 10L7.5 15" />
    </svg>
  );
}

function FindingReferenceSummary({
  references,
  summaryId,
  isOpen,
  onToggle,
}: {
  references: ReferenceBadgeViewModel[];
  summaryId: string;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const panelId = `run-report-reference-detail-${summaryId.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  const visibleReferences = references.slice(0, 2);
  const hiddenReferenceCount = references.length - visibleReferences.length;

  if (references.length === 0) {
    return null;
  }

  return (
    <div className={`run-report-reference-summary${isOpen ? ' run-report-reference-summary--open' : ''}`}>
      <button
        type="button"
        className="run-report-reference-summary__trigger"
        aria-expanded={isOpen}
        aria-controls={panelId}
        onClick={(event) => {
          event.stopPropagation();
          onToggle();
        }}
      >
        <span className="run-report-reference-summary__label">참고 기준</span>
        <span className="run-report-reference-summary__copy">
          {references.length}개
        </span>
        <span className="run-report-reference-summary__chevron" aria-hidden="true">
          <ReferenceChevronIcon />
        </span>
      </button>
      <div
        id={panelId}
        className="run-report-reference-summary__panel"
        aria-hidden={!isOpen}
      >
        <div className="run-report-reference-summary__panel-inner">
          <ul>
            {visibleReferences.map((reference) => (
              <li key={reference.key}>
                <span>{reference.publisher}</span>
                <strong>{reference.title}</strong>
                <p>{reference.basisSummary}</p>
                <a href={reference.url} target="_blank" rel="noreferrer">근거 보기</a>
              </li>
            ))}
          </ul>
          {hiddenReferenceCount > 0 ? (
            <p className="run-report-reference-summary__more">외 {hiddenReferenceCount}개 기준은 리포트 원문에서 확인할 수 있습니다.</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function JudgementBasisCard({
  recommendation,
  finding,
}: {
  recommendation: ReportRecommendation;
  finding: ReportFinding | null;
}) {
  const references = referenceBadgesForFinding(finding);
  const [isOpen, setIsOpen] = useState(false);
  const hasReferences = references.length > 0;
  const toggleReferenceSummary = useCallback(() => {
    setIsOpen((current) => !current);
  }, []);
  const toggleReferencesFromJudgement = useCallback(() => {
    setIsOpen((current) => !current);
  }, []);

  return (
    <article
      className={`run-report-selected-action__detail-card${
        hasReferences ? ' run-report-selected-action__detail-card--reference' : ''
      }${isOpen ? ' run-report-selected-action__detail-card--reference-open' : ''}`}
      onClick={(event) => {
        if (!hasReferences) {
          return;
        }

        const target = event.target as HTMLElement;
        if (target.closest('a, button')) {
          return;
        }

        if (target.closest('.run-report-reference-summary')) {
          return;
        }

        toggleReferencesFromJudgement();
      }}
    >
      <span>판단 근거</span>
      <p>{recommendationReason(recommendation, finding)}</p>
      <FindingReferenceSummary
        references={references}
        summaryId={recommendation.id}
        isOpen={isOpen}
        onToggle={toggleReferenceSummary}
      />
    </article>
  );
}

function ReportFlowHelpButton() {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const [popoverPosition, setPopoverPosition] = useState<{ top: number; left: number } | null>(null);
  const [isPopoverVisible, setIsPopoverVisible] = useState(false);
  const [isReferencesOpen, setIsReferencesOpen] = useState(false);
  const isOpen = popoverPosition !== null;
  const instanceId = useId().replace(/[^a-zA-Z0-9_-]/g, '-');
  const popoverId = `run-report-flow-help-${instanceId}`;
  const referencesPanelId = `${popoverId}-references`;

  const updatePopoverPosition = useCallback(() => {
    const buttonElement = buttonRef.current;
    if (!buttonElement) {
      return;
    }

    const rect = buttonElement.getBoundingClientRect();
    const popoverWidth = 360;
    const estimatedPopoverHeight = 430;
    const viewportMargin = 14;
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const left = Math.min(
      Math.max(rect.right + 10, viewportMargin),
      Math.max(viewportMargin, viewportWidth - popoverWidth - viewportMargin),
    );
    const top = Math.min(
      rect.top - 12,
      Math.max(viewportMargin, viewportHeight - estimatedPopoverHeight - viewportMargin),
    );

    setPopoverPosition({
      top,
      left,
    });
  }, []);

  const closePopover = useCallback(() => {
    setIsPopoverVisible(false);

    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
    }

    closeTimerRef.current = window.setTimeout(() => {
      setPopoverPosition(null);
      setIsReferencesOpen(false);
      closeTimerRef.current = null;
    }, 180);
  }, []);

  const togglePopover = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (isOpen) {
      closePopover();
      return;
    }

    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }

    updatePopoverPosition();
  }, [closePopover, isOpen, updatePopoverPosition]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closePopover();
        buttonRef.current?.focus();
      }
    };

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && buttonRef.current?.contains(target)) {
        return;
      }

      const popover = document.getElementById(popoverId);
      if (target instanceof Node && popover?.contains(target)) {
        return;
      }

      closePopover();
    };

    const handleResize = () => updatePopoverPosition();
    const handleScroll = () => updatePopoverPosition();

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('resize', handleResize);
    window.addEventListener('scroll', handleScroll, true);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [closePopover, isOpen, popoverId, updatePopoverPosition]);

  useEffect(() => {
    if (isOpen) {
      updatePopoverPosition();
    }
  }, [isOpen, isReferencesOpen, updatePopoverPosition]);

  useEffect(() => {
    if (!isOpen) {
      setIsPopoverVisible(false);
      return undefined;
    }

    const animationFrame = window.requestAnimationFrame(() => {
      setIsPopoverVisible(true);
    });

    return () => window.cancelAnimationFrame(animationFrame);
  }, [isOpen]);

  useEffect(() => () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
    }
  }, []);

  const popover = popoverPosition && typeof document !== 'undefined'
    ? createPortal(
        <aside
          id={popoverId}
          className={`run-report-term-help__popover${isPopoverVisible ? ' run-report-term-help__popover--visible' : ''}`}
          role="dialog"
          aria-label="단계별 판단 기준 설명"
          style={{ top: popoverPosition.top, left: popoverPosition.left }}
        >
          <div className="run-report-term-help__header">
            <strong>단계별 판단 기준</strong>
            <p>{REPORT_FLOW_HELP_SUMMARY}</p>
          </div>
          <ol className="run-report-term-help__terms" aria-label="단계별 판단 기준">
            {REPORT_FLOW_HELP_STAGE_TERMS.map((item) => (
              <li key={item.label} className="run-report-term-help__term">
                <span>{item.label}</span>
                <p>{item.description}</p>
              </li>
            ))}
          </ol>
          <div className={`run-report-term-help__references${isReferencesOpen ? ' run-report-term-help__references--open' : ''}`}>
            <button
              type="button"
              className="run-report-term-help__references-trigger"
              aria-expanded={isReferencesOpen}
              aria-controls={referencesPanelId}
              onClick={(event) => {
                event.stopPropagation();
                setIsReferencesOpen((current) => !current);
              }}
            >
              <span className="run-report-term-help__references-label">기준 근거</span>
              <span className="run-report-term-help__references-copy">{REPORT_FLOW_HELP_TERMS.length}개</span>
              <span className="run-report-term-help__references-chevron" aria-hidden="true">
                <svg className="run-report-term-help__references-chevron-icon" viewBox="0 0 20 20" focusable="false">
                  <path d="M7.5 5L12.5 10L7.5 15" />
                </svg>
              </span>
            </button>
            <div
              id={referencesPanelId}
              className="run-report-term-help__references-panel"
              aria-hidden={!isReferencesOpen}
            >
              <div className="run-report-term-help__references-panel-inner">
                <div className="run-report-term-help__reference-list" aria-label="단계별 판단 기준 근거">
                  {REPORT_FLOW_HELP_TERMS.map((item) => (
                    <a
                      key={item.reference.url}
                      href={item.reference.url}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <strong>{item.label}</strong>
                      <span>{item.reference.source} · {item.reference.label}</span>
                      <p>{item.reference.summary}</p>
                    </a>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </aside>,
        document.body,
      )
    : null;

  return (
    <span className="run-report-term-help">
      <button
        ref={buttonRef}
        type="button"
        className="run-report-term-help__button"
        aria-label="단계별 판단 기준 설명 보기"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls={isOpen ? popoverId : undefined}
        onClick={togglePopover}
      >
        ?
      </button>
      {popover}
    </span>
  );
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
  const reportPreviewImageCache = useMemo(() => createAuthenticatedResourceCache({
    maxEntries: RUN_REPORT_PREVIEW_CACHE_MAX_ENTRIES,
    maxBytes: RUN_REPORT_PREVIEW_CACHE_MAX_BYTES,
    fetchBlob: requestBlob,
  }), [report.reportId]);
  const recommendations = report.recommendations;
  const topRecommendations = useMemo(
    () => recommendations.slice(0, TOP_RECOMMENDATION_COUNT),
    [recommendations],
  );
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
  const selectedEvidencePreviewCacheKey = selectedEvidencePreviewUrl ? toSameOriginApiPath(selectedEvidencePreviewUrl) : null;

  const topRecommendationPreviewCacheKeys = useMemo(() => {
    const urls = topRecommendations
      .map((recommendation) => linkedFinding(report.findings, recommendation))
      .flatMap((finding) => {
        if (!finding) {
          return [];
        }

        const previewUrl = previewUrlForFinding(finding, report.evidencePreviewUrl);
        const apiPath = previewUrl ? toSameOriginApiPath(previewUrl) : null;
        return apiPath ? [apiPath] : [];
      });

    return [...new Set(urls)];
  }, [report.evidencePreviewUrl, report.findings, topRecommendations]);

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

  const evidencePreviewUrl = useAuthenticatedResourceUrl(selectedEvidencePreviewUrl, reportPreviewImageCache);
  const isEvidencePreviewResolving = Boolean(
    selectedEvidencePreviewUrl &&
    selectedEvidencePreviewCacheKey &&
    !reportPreviewImageCache.peek(selectedEvidencePreviewCacheKey),
  );

  useEffect(() => () => {
    reportPreviewImageCache.clear();
  }, [reportPreviewImageCache]);

  useEffect(() => {
    void reportPreviewImageCache.prefetch(topRecommendationPreviewCacheKeys);
  }, [reportPreviewImageCache, topRecommendationPreviewCacheKeys]);

  useEffect(() => {
    setLoadedEvidencePreviewUrl(null);
  }, [evidencePreviewUrl, selectedEvidencePreviewUrl]);

  const handleEvidencePreviewImageLoad = useCallback(() => {
    setLoadedEvidencePreviewUrl(evidencePreviewUrl);
  }, [evidencePreviewUrl]);

  useEffect(() => {
    const preview = evidencePreviewRef.current;
    const markerTop = activeFinding?.highlight?.top;
    if (!preview || !markerTop || !evidencePreviewUrl || isEvidencePreviewResolving || loadedEvidencePreviewUrl !== evidencePreviewUrl) {
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
  }, [activeFinding?.id, activeFinding?.highlight?.top, evidencePreviewUrl, isEvidencePreviewResolving, loadedEvidencePreviewUrl]);

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
            <h1 id="run-report-title">
              <span>전환 흐름 리포트</span>
            </h1>
            <dl className="run-report-hero-context" aria-label="리포트 대상 정보">
              <div>
                <dt>분석 대상</dt>
                <dd title={report.targetUrl}>{targetUrlLabel}</dd>
              </div>
              <div>
                <dt>점검 흐름</dt>
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
                        <li key={recommendation.id} className="run-report-recommendation-tab-shell">
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
                      <h3>
                        <span>전환 흐름</span>
                        <ReportFlowHelpButton />
                      </h3>
                    </div>
                    <div className="run-report-stage-chips" aria-label="전환 단계">
                      <ol>
                        {flowNodes.map((node) => {
                          const isActive = node.id === activeFlowStageId;
                          const displayLabel = isActive ? node.label : node.shortLabel;

                          return (
                            <li key={node.id} className={isActive ? 'run-report-stage-chips__item--active' : undefined}>
                              <span
                                className={`run-report-stage-chip${isActive ? ' run-report-stage-chip--active' : ''}`}
                                aria-current={isActive ? 'step' : undefined}
                                title={node.label}
                              >
                                <span className="run-report-stage-chip__label">{displayLabel}</span>
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
                      <JudgementBasisCard
                        recommendation={selectedRecommendation}
                        finding={selectedRecommendationFinding}
                      />
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
