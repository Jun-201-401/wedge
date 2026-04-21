import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeAnalysisUrl } from '../../src/pages/create-analysis/lib/createAnalysisUrl';

test('normalizeAnalysisUrl preserves explicit http and https URLs', () => {
  assert.equal(normalizeAnalysisUrl('https://example.com/path'), 'https://example.com/path');
  assert.equal(normalizeAnalysisUrl('http://example.com'), 'http://example.com/');
});

test('normalizeAnalysisUrl adds https for domain input', () => {
  assert.equal(normalizeAnalysisUrl('example.com'), 'https://example.com/');
});

test('normalizeAnalysisUrl supports localhost development URLs', () => {
  assert.equal(normalizeAnalysisUrl('localhost:3000'), 'https://localhost:3000/');
});

test('normalizeAnalysisUrl rejects empty, non-http, and unlikely host input', () => {
  assert.equal(normalizeAnalysisUrl(''), null);
  assert.equal(normalizeAnalysisUrl('ftp://example.com'), null);
  assert.equal(normalizeAnalysisUrl('abc'), null);
  assert.equal(normalizeAnalysisUrl('https://'), null);
});
