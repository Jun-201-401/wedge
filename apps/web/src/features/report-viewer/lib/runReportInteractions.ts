import type { ReportFinding } from './runReportViewModel';

export function resolveLinkedFindingId(findings: ReportFinding[], findingId: string | null | undefined) {
  if (!findingId) {
    return null;
  }

  return findings.some((finding) => finding.id === findingId) ? findingId : null;
}

export function resolveActiveFinding(findings: ReportFinding[], findingId: string | null | undefined) {
  if (!findingId) {
    return findings[0] ?? null;
  }

  return findings.find((finding) => finding.id === findingId) ?? findings[0] ?? null;
}
