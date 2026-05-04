import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { executeDiscovery } from "../src/discovery/index.ts";
import type { DiscoveryExecuteMessage, DiscoveryFlowType } from "../src/shared/contracts.ts";
import { createRunnerTestConfig } from "./support.ts";

test("[Discovery] 페이지에서 CTA/가입폼/가격/결제 후보 추천을 수집한다", async () => {
  const fixtureRoot = join(tmpdir(), `wedge-runner-discovery-${process.pid}-${Date.now()}`);
  await mkdir(fixtureRoot, { recursive: true });

  try {
    const fixturePath = join(fixtureRoot, "index.html");
    await writeFile(fixturePath, createDiscoveryFixtureHtml(), "utf8");
    const fixtureUrl = pathToFileURL(fixturePath).toString();

    const result = await executeDiscovery({
      message: createDiscoveryExecuteMessage(fixtureUrl),
      config: createRunnerTestConfig({
        browserName: "chromium",
        browserHeadless: true,
        browserLaunchTimeoutMs: 30_000,
        browserNavigationTimeoutMs: 30_000
      })
    });

    assert.equal(result.schema_version, "0.5");
    assert.equal(result.input_url, fixtureUrl);
    assert.equal(result.discovery_id, "20000000-0000-4000-8000-000000000011");
    assertFlowDetected(result.detected_flow_types, "LANDING_CTA");
    assertFlowDetected(result.detected_flow_types, "SIGNUP_LEAD_FORM");
    assertFlowDetected(result.detected_flow_types, "PRICING");
    assertFlowDetected(result.detected_flow_types, "PURCHASE_CHECKOUT");

    const landingRecommendation = result.scenario_recommendations.find(
      (recommendation) => recommendation.scenario_type === "LANDING_CTA"
    );
    assert.ok(landingRecommendation);
    assert.equal(landingRecommendation.recommendation_level, "HIGH");
    assert.ok(landingRecommendation.suggested_target);
    assert.equal(landingRecommendation.suggested_target.href_contains, "/signup");

    const signupRecommendation = result.scenario_recommendations.find(
      (recommendation) => recommendation.scenario_type === "SIGNUP_LEAD_FORM"
    );
    assert.ok(signupRecommendation?.suggested_target);
    assert.ok(
      signupRecommendation.suggested_target.selector === "#signup-form" ||
        signupRecommendation.suggested_target.placeholder === "Work email"
    );

    const checkoutRecommendation = result.scenario_recommendations.find(
      (recommendation) => recommendation.scenario_type === "PURCHASE_CHECKOUT"
    );
    assert.ok(checkoutRecommendation?.suggested_target?.href_contains?.includes("checkout"));

    const checkpoint = result.checkpoints[0] as { observations?: Array<{ type?: string }> } | undefined;
    const observations = checkpoint?.observations ?? [];
    assert.ok(observations.some((observation) => observation.type === "cta_candidate"));
    assert.ok(observations.some((observation) => observation.type === "form_candidate"));
    assert.ok(observations.some((observation) => observation.type === "pricing_candidate"));
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

function createDiscoveryExecuteMessage(url: string): DiscoveryExecuteMessage {
  return {
    messageId: "20000000-0000-4000-8000-000000000001",
    messageType: "discovery.execute.request",
    schemaVersion: "0.5",
    createdAt: "2026-04-30T00:00:00.000Z",
    producer: "api-server",
    correlationId: "20000000-0000-4000-8000-000000000002",
    idempotencyKey: "discovery:20000000-0000-4000-8000-000000000001",
    payload: {
      discoveryId: "20000000-0000-4000-8000-000000000011",
      projectId: "8f06dca8-9c4d-4f20-b1a8-1d5ee40a9923",
      triggerSource: "WEB",
      url,
      devicePreset: "desktop",
      viewport: {
        width: 1440,
        height: 900
      },
      maxDurationMs: 5_000,
      maxScrollCount: 1
    }
  };
}

function createDiscoveryFixtureHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head><title>Discovery MVP Fixture</title></head>
  <body>
    <header>
      <a class="primary-cta" href="/signup">Start free</a>
    </header>
    <main>
      <section id="signup-form" aria-label="Signup form">
        <form>
          <input type="email" name="email" placeholder="Work email" />
          <input type="text" name="company" placeholder="Company" />
        </form>
      </section>
      <section id="pricing" class="pricing-plans">
        <h2>Pricing plans</h2>
        <a class="plan-cta" href="checkout.html">Choose Starter</a>
      </section>
    </main>
  </body>
</html>`;
}

function assertFlowDetected(detectedFlowTypes: DiscoveryFlowType[], expectedFlowType: DiscoveryFlowType): void {
  assert.ok(
    detectedFlowTypes.includes(expectedFlowType),
    `expected ${expectedFlowType} in detected flows: ${detectedFlowTypes.join(", ")}`
  );
}
