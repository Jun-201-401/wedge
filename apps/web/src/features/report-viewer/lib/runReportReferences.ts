import type { ReportFinding } from './runReportViewModel';

export interface ReferenceBadgeViewModel {
  key: string;
  label: string;
  publisher: string;
  title: string;
  basisSummary: string;
  url: string;
  ariaLabel: string;
}

function referencePublisherLabel(publisher: string | null | undefined, index: number) {
  const trimmed = publisher?.trim();
  return trimmed || `출처${index + 1}`;
}

export function referenceBadgesForFinding(finding: Pick<ReportFinding, 'references'> | null | undefined): ReferenceBadgeViewModel[] {
  const references = finding?.references ?? [];

  return references.map((reference, index) => {
    const publisherLabel = referencePublisherLabel(reference.publisher, index);

    return {
      key: `${reference.label}:${reference.url || index}`,
      label: reference.label,
      publisher: publisherLabel,
      title: reference.title,
      basisSummary: reference.basisSummary,
      url: reference.url,
      ariaLabel: `${reference.label} 기준 근거: ${publisherLabel} ${reference.title}. ${reference.basisSummary}`,
    };
  });
}
