import test from 'node:test';
import assert from 'node:assert/strict';

import { getSafeAuthRedirectPath } from '../../src/pages/auth/lib/authRedirect';

test('getSafeAuthRedirectPath accepts same-origin app paths only', () => {
  const origin = 'https://wedge.example';

  assert.equal(getSafeAuthRedirectPath('', origin), '/create-analysis');
  assert.equal(getSafeAuthRedirectPath('?next=/runs/111?tab=live#top', origin), '/runs/111?tab=live#top');
  assert.equal(getSafeAuthRedirectPath('?next=https://wedge.example/runs/111', origin), '/runs/111');
});

test('getSafeAuthRedirectPath rejects external and backslash redirects', () => {
  const origin = 'https://wedge.example';

  assert.equal(getSafeAuthRedirectPath('?next=https://evil.example/runs/111', origin), '/create-analysis');
  assert.equal(getSafeAuthRedirectPath('?next=//evil.example/runs/111', origin), '/create-analysis');
  assert.equal(getSafeAuthRedirectPath('?next=%2F%5Cevil.example', origin), '/create-analysis');
  assert.equal(getSafeAuthRedirectPath('?next=/\\evil.example', origin), '/create-analysis');
});
