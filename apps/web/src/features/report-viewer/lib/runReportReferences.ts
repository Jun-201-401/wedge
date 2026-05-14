import type { ReportFinding } from './runReportViewModel';

export interface ReferenceBadgeViewModel {
  key: string;
  label: string;
  publisher: string;
  title: string;
  basisSummary: string;
  ariaLabel: string;
}

export const MAX_VISIBLE_REFERENCE_BADGES = 0;
const PREVIEW_REFERENCE_BADGE_COUNT = 5;

function referencePublisherLabel(publisher: string | null | undefined, index: number) {
  const trimmed = publisher?.trim();
  return trimmed || `출처${index + 1}`;
}

export function referenceBadgesForFinding(finding: Pick<ReportFinding, 'references'> | null | undefined): ReferenceBadgeViewModel[] {
  const references = finding?.references ?? [];

  if (references.length === 0) {
    return Array.from({ length: PREVIEW_REFERENCE_BADGE_COUNT }, (_, index) => {
      const publisherLabel = referencePublisherLabel(null, index);

      return {
        key: `reference-preview-${index + 1}`,
        label: `[${publisherLabel}]`,
        publisher: publisherLabel,
        title: '출처 표시 확인용 임시값',
        basisSummary: 'Analyzer reference가 연결되면 실제 출처와 근거 요약으로 대체됩니다.',
        ariaLabel: `${publisherLabel} 기준 근거 확인용 임시값. Analyzer reference가 연결되면 실제 출처와 근거 요약으로 대체됩니다.`,
      };
    });
  }

  return references.map((reference, index) => {
    const publisherLabel = referencePublisherLabel(reference.publisher, index);

    return {
      key: `${reference.label}:${reference.url || index}`,
      label: `[${publisherLabel}]`,
      publisher: publisherLabel,
      title: reference.title,
      basisSummary: reference.basisSummary,
      ariaLabel: `${reference.label} 기준 근거: ${publisherLabel} ${reference.title}. ${reference.basisSummary}`,
    };
  });
}

export function splitReferenceBadges(
  badges: ReferenceBadgeViewModel[],
  visibleLimit = MAX_VISIBLE_REFERENCE_BADGES,
) {
  return {
    visible: badges.slice(0, visibleLimit),
    overflow: badges.slice(visibleLimit),
  };
}

export function nextPinnedReferenceBadgeId(currentBadgeId: string | null, selectedBadgeId: string) {
  return currentBadgeId === selectedBadgeId ? null : selectedBadgeId;
}

export function nextPinnedReferenceOverflowId(currentOverflowId: string | null, selectedOverflowId: string) {
  return currentOverflowId === selectedOverflowId ? null : selectedOverflowId;
}
