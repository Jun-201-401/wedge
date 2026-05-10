import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveActiveFinding, resolveLinkedFindingId } from '../../src/features/report-viewer/lib/runReportInteractions';
import type { ReportFinding } from '../../src/features/report-viewer/lib/runReportViewModel';

const findings: ReportFinding[] = [
  {
    id: 'finding-1',
    order: 1,
    severity: 'high',
    issueId: 'ISSUE-1',
    stage: 'CTA',
    title: 'CTA contrast',
    summary: 'CTA needs stronger contrast.',
    evidenceLabel: 'Hero CTA',
    evidenceCount: 1,
    confidence: 0.86,
    priorityScore: 90,
    evidenceRefs: ['cp_001.obs_001'],
    recommendation: 'Increase contrast.',
    highlight: null,
  },
  {
    id: 'finding-2',
    order: 2,
    severity: 'medium',
    issueId: 'ISSUE-2',
    stage: 'TRUST',
    title: 'Trust signal',
    summary: 'Trust copy is delayed.',
    evidenceLabel: 'Proof area',
    evidenceCount: 1,
    confidence: 0.74,
    priorityScore: 72,
    evidenceRefs: ['cp_002.obs_002'],
    recommendation: 'Move trust copy earlier.',
    highlight: null,
  },
];

test('report nudge interactions only link valid finding ids', () => {
  assert.equal(resolveLinkedFindingId(findings, 'finding-2'), 'finding-2');
  assert.equal(resolveLinkedFindingId(findings, 'missing-finding'), null);
  assert.equal(resolveLinkedFindingId(findings, null), null);
  assert.equal(resolveLinkedFindingId(findings, undefined), null);
});

test('report active finding falls back to the first finding without inventing nudge links', () => {
  assert.equal(resolveActiveFinding(findings, 'finding-2')?.id, 'finding-2');
  assert.equal(resolveActiveFinding(findings, 'missing-finding')?.id, 'finding-1');
  assert.equal(resolveActiveFinding([], 'missing-finding'), null);
});
