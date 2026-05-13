import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertCheckoutAgentEvents,
  buildCreateAgentRunRequest,
  readConfig,
  startCheckoutFixture,
  validateConfig,
} from './real-agent-product-checkout-smoke.mjs';

const PROJECT_ID = '8f06dca8-9c4d-4f20-b1a8-1d5ee40a9923';

test('[real agent checkout smoke config] reads env and validates required project id', () => {
  const config = readConfig({
    WEDGE_AGENT_CHECKOUT_SMOKE_API_BASE_URL: 'http://localhost:8080/',
    WEDGE_AGENT_CHECKOUT_SMOKE_PROJECT_ID: PROJECT_ID,
    WEDGE_AGENT_CHECKOUT_SMOKE_TARGET_URL: 'https://example.test/product.html',
    WEDGE_AGENT_CHECKOUT_SMOKE_TIMEOUT_MS: '12345',
    WEDGE_AGENT_CHECKOUT_SMOKE_REQUIRE_EXPORT_ARTIFACT: 'false',
  });

  assert.equal(config.apiBaseUrl, 'http://localhost:8080');
  assert.equal(config.projectId, PROJECT_ID);
  assert.equal(config.targetUrl, 'https://example.test/product.html');
  assert.equal(config.timeoutMs, 12345);
  assert.equal(config.requireExportArtifact, false);
  assert.doesNotThrow(() => validateConfig(config));
});

test('[real agent checkout smoke config] rejects invalid target URLs', () => {
  const config = readConfig({
    WEDGE_AGENT_CHECKOUT_SMOKE_PROJECT_ID: PROJECT_ID,
    WEDGE_AGENT_CHECKOUT_SMOKE_TARGET_URL: 'file:///tmp/product.html',
  });

  assert.throws(() => validateConfig(config), /TARGET_URL/);
});

test('[real agent checkout smoke request] creates agent run body without ScenarioPlan', () => {
  const request = buildCreateAgentRunRequest({ projectId: PROJECT_ID }, 'https://example.test/product.html');

  assert.equal(request.projectId, PROJECT_ID);
  assert.equal(request.startUrl, 'https://example.test/product.html');
  assert.equal(request.devicePreset, 'desktop');
  assert.equal(request.scenarioTemplateVersionId, undefined);
  assert.equal(request.scenarioPlan, undefined);
  assert.equal(request.scenarioOverrides.mode, 'agent-product-checkout');
});

test('[real agent checkout smoke assertions] require add-to-cart, checkout, trace, and export', () => {
  const result = assertCheckoutAgentEvents([
    { eventType: 'AGENT_ACTION_COMPLETED', payload: { payload: { targetKey: 'https://example.test/product.html', finalUrl: 'https://example.test/product.html' } } },
    { eventType: 'AGENT_ACTION_COMPLETED', payload: { payload: { targetKey: '#add-to-cart', finalUrl: 'https://example.test/product.html' } } },
    { eventType: 'AGENT_ACTION_COMPLETED', payload: { payload: { targetKey: '#cart-link', finalUrl: 'https://example.test/cart.html' } } },
    { eventType: 'AGENT_ACTION_COMPLETED', payload: { payload: { targetKey: '#checkout-link', finalUrl: 'https://example.test/checkout.html' } } },
    { eventType: 'AGENT_TRACE_PERSISTED', payload: { payload: { scenarioPlanExportStatus: 'EXPORTED', scenarioPlanExportArtifactId: 'artifact-1' } } },
  ]);

  assert.deepEqual(result.completedTargetKeys, [
    'https://example.test/product.html',
    '#add-to-cart',
    '#cart-link',
    '#checkout-link',
  ]);
  assert.equal(result.tracePersisted, true);
  assert.equal(result.scenarioPlanExportStatus, 'EXPORTED');
});

test('[real agent checkout smoke assertions] reject final payment clicks', () => {
  assert.throws(
    () => assertCheckoutAgentEvents([
      { eventType: 'ACTION_COMPLETED', payload: { targetKey: '#add-to-cart', finalUrl: 'https://example.test/product.html' } },
      { eventType: 'ACTION_COMPLETED', payload: { targetKey: '#checkout-link', finalUrl: 'https://example.test/checkout.html' } },
      { eventType: 'ACTION_COMPLETED', payload: { targetKey: '#pay-now', finalUrl: 'https://example.test/checkout.html' } },
      { eventType: 'TRACE_PERSISTED', payload: { scenarioPlanExportStatus: 'EXPORTED', scenarioPlanExportArtifactId: 'artifact-1' } },
    ]),
    /final payment/
  );
});

test('[real agent checkout smoke fixture] serves product, cart, and checkout pages through runner host alias', async () => {
  const fixture = await startCheckoutFixture('runner.example.internal');
  try {
    assert.match(fixture.productUrl, /^http:\/\/runner\.example\.internal:\d+\/product\.html$/);
    const product = await fetch(`http://127.0.0.1:${fixture.port}/product.html`).then((response) => response.text());
    const cart = await fetch(`http://127.0.0.1:${fixture.port}/cart.html`).then((response) => response.text());
    const checkout = await fetch(`http://127.0.0.1:${fixture.port}/checkout.html`).then((response) => response.text());

    assert.match(product, /id="add-to-cart"/);
    assert.match(cart, /id="checkout-link"/);
    assert.match(checkout, /id="pay-now"/);
  } finally {
    await fixture.close();
  }
});
