import assert from 'node:assert/strict';
import test from 'node:test';

import { formatDisplayUrl } from '../../src/shared/lib/displayUrl';

const LONG_RENAULT_URL = 'https://www.renault.co.kr/ko/side/app_testdrive.jsp?h_mcode=K602&h_carsel=Koleos&bannerUrl=a_navertd_KOLEOS_MAY_SALES_A_26-05_&bannerSeq=1&utm_medium=display&utm_source=navertd&utm_campaign=kr-r-l-newcar-koleos-may-05-2026-os-naver-dis-na-26-05&utm_content=contextual-none-none-1p-pa-none-dis_nat-multi_devices-pros-na-na-a-A&CAMPAIGN=kr-r-l-newcar-koleos-may-05-2026-os-naver-dis-na-26-05&ORIGIN=display';

test('formatDisplayUrl keeps user-facing URLs short without losing the destination cue', () => {
  assert.equal(formatDisplayUrl(LONG_RENAULT_URL), 'renault.co.kr/ko/side/app_testdrive.jsp?…');
  assert.equal(formatDisplayUrl('https://www.example.com/'), 'example.com');
  assert.equal(formatDisplayUrl('https://example.com/pricing'), 'example.com/pricing');
});

test('formatDisplayUrl truncates invalid or unusually long values in the middle', () => {
  assert.equal(formatDisplayUrl('not-a-url-but-still-a-very-long-user-visible-value', 24), 'not-a-url-but-st…e-value');
});
