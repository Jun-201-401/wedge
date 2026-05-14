import type { ReportFinding } from './runReportViewModel';

export interface ReferenceBadgeViewModel {
  key: string;
  label: string;
  publisher: string;
  title: string;
  basisSummary: string;
  ariaLabel: string;
  isFallback: boolean;
}

const PENDING_REFERENCE_BADGE: ReferenceBadgeViewModel = {
  key: 'reference-pending',
  label: '근거 준비중',
  publisher: '외부 기준 배지 준비중',
  title: '분석 근거는 리포트 내용에 포함되어 있습니다',
  basisSummary: '이 항목의 외부 기준 배지는 아직 연결 준비 중입니다.',
  ariaLabel: '근거 준비중: 외부 기준 배지 준비중. 이 항목의 외부 기준 배지는 아직 연결 준비 중입니다.',
  isFallback: true,
};

export function referenceBadgesForFinding(finding: Pick<ReportFinding, 'references'> | null | undefined): ReferenceBadgeViewModel[] {
  const references = finding?.references ?? [];

  if (references.length === 0) {
    return [PENDING_REFERENCE_BADGE];
  }

  return references.map((reference, index) => ({
    key: `${reference.label}:${reference.url || index}`,
    label: reference.label,
    publisher: reference.publisher,
    title: reference.title,
    basisSummary: reference.basisSummary,
    ariaLabel: `${reference.label} 기준 근거: ${reference.publisher} ${reference.title}. ${reference.basisSummary}`,
    isFallback: false,
  }));
}

export function nextPinnedReferenceBadgeId(currentBadgeId: string | null, selectedBadgeId: string) {
  return currentBadgeId === selectedBadgeId ? null : selectedBadgeId;
}
