import test from 'node:test';
import assert from 'node:assert/strict';

import { toSameOriginApiPath } from '../../src/shared/lib/apiResourcePath';

test('toSameOriginApiPath normalizes same-origin api resources only', () => {
  assert.equal(toSameOriginApiPath('/api/runs/1/artifacts/2/content'), '/runs/1/artifacts/2/content');
  assert.equal(toSameOriginApiPath('/runs/1/artifacts/2/content'), '/runs/1/artifacts/2/content');
  assert.equal(toSameOriginApiPath('http://localhost/api/runs/1/artifacts/2/content?download=1'), '/runs/1/artifacts/2/content?download=1');
  assert.equal(toSameOriginApiPath('https://example.com/api/runs/1/artifacts/2/content'), null);
  assert.equal(toSameOriginApiPath('javascript:alert(1)'), null);
});
