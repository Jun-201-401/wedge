import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { executeDiscovery } from "../src/discovery/index.ts";
import type { DiscoveryCheckpoint, DiscoveryExecuteMessage, DiscoveryFlowType, DiscoveryObservation } from "../src/shared/contracts.ts";
import { createRunnerTestConfig } from "./support.ts";

test("[Discovery] 페이지에서 CTA/가입폼/문의/가격/결제 후보 추천을 수집한다", async () => {
  const fixtureRoot = join(tmpdir(), `wedge-runner-discovery-${process.pid}-${Date.now()}`);
  await mkdir(fixtureRoot, { recursive: true });

  try {
    const fixturePath = join(fixtureRoot, "index.html");
    await writeFile(fixturePath, createDiscoveryFixtureHtml(), "utf8");
    await writeFile(join(fixtureRoot, "demo.html"), createDemoFixtureHtml(), "utf8");
    await writeFile(join(fixtureRoot, "pricing.html"), createPricingFixtureHtml(), "utf8");
    await writeFile(join(fixtureRoot, "checkout.html"), createCheckoutFixtureHtml(), "utf8");
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
    assertFlowDetected(result.detected_flow_types, "CONTACT");
    assertFlowDetected(result.detected_flow_types, "PRICING");
    assertFlowDetected(result.detected_flow_types, "PURCHASE_CHECKOUT");

    const landingRecommendation = result.scenario_recommendations.find(
      (recommendation) => recommendation.scenario_type === "LANDING_CTA"
    );
    assert.ok(landingRecommendation);
    assert.equal(landingRecommendation.recommendation_level, "HIGH");
    assert.ok(landingRecommendation.suggested_target);
    assert.equal(landingRecommendation.suggested_target.href_contains, "/signup");
    assert.ok(landingRecommendation.evidence_summary?.matched_signals.some((signal) => signal.source === "alt"));

    const signupRecommendation = result.scenario_recommendations.find(
      (recommendation) => recommendation.scenario_type === "SIGNUP_LEAD_FORM"
    );
    assert.ok(signupRecommendation?.suggested_target);
    assert.ok(
      signupRecommendation.suggested_target.selector === "#signup-form" ||
        signupRecommendation.suggested_target.placeholder === "Work email"
    );

    const contactRecommendation = result.scenario_recommendations.find(
      (recommendation) => recommendation.scenario_type === "CONTACT"
    );
    assert.ok(contactRecommendation?.suggested_target);
    assert.equal(contactRecommendation.recommendation_level, "HIGH");
    assert.ok(contactRecommendation.suggested_target.href_contains?.includes("demo"));
    assert.ok(contactRecommendation.reason.includes("Shallow navigation verified"));
    assert.ok(contactRecommendation.evidence_summary?.matched_signals.some((signal) => signal.source === "aria_label"));
    assert.ok(contactRecommendation.evidence_summary?.matched_signals.some((signal) => signal.source === "shallow_navigation"));
    assert.ok(contactRecommendation.evidence_summary?.limitations.includes("image_text_ocr_not_performed"));

    const checkoutRecommendation = result.scenario_recommendations.find(
      (recommendation) => recommendation.scenario_type === "PURCHASE_CHECKOUT"
    );
    assert.ok(checkoutRecommendation?.suggested_target?.href_contains?.includes("checkout"));

    const checkpoint = result.checkpoints[0] as DiscoveryCheckpoint | undefined;
    const observations = checkpoint?.observations ?? [];
    const shallowDestinations = shallowNavigationDestinations(observations);
    const formObservationData = observations
      .filter((observation) => observation.type === "form_candidate")
      .map((observation) => observation.data ?? {});
    assert.ok(observations.some((observation) => observation.type === "cta_candidate"));
    assert.ok(observations.some((observation) => observation.type === "form_candidate"));
    assert.ok(formObservationData.some((data) =>
      data.field_type === "select" &&
      data.label_text === "Plan" &&
      typeof data.form_field_text === "string" &&
      data.form_field_text.includes("Work email")
    ));
    assert.ok(formObservationData.some((data) =>
      data.field_type === "textarea" &&
      data.placeholder === "Tell us about your team"
    ));
    assert.ok(observations.some((observation) => observation.type === "contact_candidate"));
    assert.ok(observations.some((observation) => observation.type === "pricing_candidate"));
    assert.ok(shallowDestinations.some((destination) => destination.endsWith("/demo.html")));
    assert.ok(shallowDestinations.some((destination) => destination.endsWith("/pricing.html")));
    assert.ok(!shallowDestinations.some((destination) => destination.includes("checkout")));
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("[Discovery] DOM 앞쪽 노이즈가 많아도 보이는 CTA와 리드 form을 우선 수집한다", async () => {
  const fixtureRoot = join(tmpdir(), `wedge-runner-discovery-large-dom-${process.pid}-${Date.now()}`);
  await mkdir(fixtureRoot, { recursive: true });

  try {
    const fixturePath = join(fixtureRoot, "index.html");
    await writeFile(fixturePath, createLargeDomDiscoveryFixtureHtml(), "utf8");
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

    assertFlowDetected(result.detected_flow_types, "LANDING_CTA");
    assertFlowDetected(result.detected_flow_types, "SIGNUP_LEAD_FORM");

    const landingRecommendation = result.scenario_recommendations.find(
      (recommendation) => recommendation.scenario_type === "LANDING_CTA"
    );
    assert.ok(landingRecommendation?.suggested_target?.href_contains?.includes("signup"));

    const signupRecommendation = result.scenario_recommendations.find(
      (recommendation) => recommendation.scenario_type === "SIGNUP_LEAD_FORM"
    );
    assert.ok(signupRecommendation?.evidence_summary?.matched_signals.some((signal) => signal.source === "form_field"));
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("[Discovery] 입력 value는 추천 evidence나 observation에 저장하지 않는다", async () => {
  const fixtureRoot = join(tmpdir(), `wedge-runner-discovery-sensitive-${process.pid}-${Date.now()}`);
  await mkdir(fixtureRoot, { recursive: true });

  try {
    const fixturePath = join(fixtureRoot, "index.html");
    await writeFile(fixturePath, createSensitiveValueDiscoveryFixtureHtml(), "utf8");
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

    assertFlowDetected(result.detected_flow_types, "SIGNUP_LEAD_FORM");
    assert.ok(!JSON.stringify(result).includes("super-secret-user-value"));
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("[Discovery] shallow navigation skips checkout aliases without requesting them", async () => {
  const requestedPaths = new Map<string, number>();
  const server = await startFixtureServer(requestedPaths, {
    extraRootLinks: '<a href="/cart">Compare cart</a>'
  });

  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const result = await executeDiscovery({
      message: createDiscoveryExecuteMessage(`http://127.0.0.1:${address.port}/`),
      config: createRunnerTestConfig({
        browserName: "chromium",
        browserHeadless: true,
        browserLaunchTimeoutMs: 30_000,
        browserNavigationTimeoutMs: 30_000
      })
    });

    assert.equal(requestedPaths.get("/checkout") ?? 0, 0);
    assert.equal(requestedPaths.get("/cart") ?? 0, 0);
    const shallowDestinations = shallowNavigationDestinations(
      result.checkpoints[0]?.observations ?? []
    );
    assert.ok(shallowDestinations.some((destination) => destination.endsWith("/demo")));
    assert.ok(!shallowDestinations.some((destination) => destination.includes("checkout")));
  } finally {
    await closeServer(server);
  }
});

test("[Discovery] shallow navigation blocks unsafe redirects before checkout is requested", async () => {
  const requestedPaths = new Map<string, number>();
  const server = await startFixtureServer(requestedPaths, {
    pricingPath: "/pricing-redirect",
    pricingRedirectToCheckout: true
  });

  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const result = await executeDiscovery({
      message: createDiscoveryExecuteMessage(`http://127.0.0.1:${address.port}/`),
      config: createRunnerTestConfig({
        browserName: "chromium",
        browserHeadless: true,
        browserLaunchTimeoutMs: 30_000,
        browserNavigationTimeoutMs: 30_000
      })
    });

    assert.equal(requestedPaths.get("/pricing-redirect") ?? 0, 1);
    assert.equal(requestedPaths.get("/checkout") ?? 0, 0);
    const shallowDestinations = shallowNavigationDestinations(
      result.checkpoints[0]?.observations ?? []
    );
    assert.ok(!shallowDestinations.some((destination) => destination.includes("checkout")));
  } finally {
    await closeServer(server);
  }
});

test("[Discovery] shallow navigation blocks unsafe page-load side effects", async () => {
  const requestedPaths = new Map<string, number>();
  const server = await startFixtureServer(requestedPaths, {
    demoPath: "/demo-with-post",
    demoPostsCheckout: true
  });

  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const result = await executeDiscovery({
      message: createDiscoveryExecuteMessage(`http://127.0.0.1:${address.port}/`),
      config: createRunnerTestConfig({
        browserName: "chromium",
        browserHeadless: true,
        browserLaunchTimeoutMs: 30_000,
        browserNavigationTimeoutMs: 30_000
      })
    });

    assert.ok((requestedPaths.get("/demo-with-post") ?? 0) >= 1);
    assert.equal(requestedPaths.get("/checkout") ?? 0, 0);
    const shallowDestinations = shallowNavigationDestinations(
      result.checkpoints[0]?.observations ?? []
    );
    assert.ok(shallowDestinations.some((destination) => destination.endsWith("/demo-with-post")));
  } finally {
    await closeServer(server);
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
      <a class="primary-cta" href="/signup"><img alt="Start free" src="cta.png" /></a>
    </header>
    <main>
      <progress id="loading-progress" value="0.4" max="1"></progress>
      <section id="signup-form" aria-label="Signup form">
        <form>
          <input type="email" name="email" placeholder="Work email" />
          <input type="text" name="company" placeholder="Company" />
          <label for="plan">Plan</label>
          <select id="plan" name="plan">
            <option>Starter</option>
            <option>Pro</option>
          </select>
          <textarea name="message" placeholder="Tell us about your team"></textarea>
        </form>
      </section>
      <a class="sales-cta" href="demo.html" aria-label="Book a demo"></a>
      <section id="pricing" class="pricing-plans">
        <h2>Pricing plans</h2>
        <a class="pricing-link" href="pricing.html">See pricing</a>
        <a class="plan-cta" href="checkout.html">Choose Starter</a>
      </section>
    </main>
  </body>
</html>`;
}

function createLargeDomDiscoveryFixtureHtml(): string {
  const noise = Array.from({ length: 1_700 }, (_, index) =>
    `<div id="decorative-node-${index}" aria-label="Decorative content ${index}"></div>`
  ).join("\n");

  return `<!doctype html>
<html lang="en">
  <head><title>Large DOM Discovery Fixture</title></head>
  <body>
    <main>
      ${noise}
      <section class="hero">
        <p>Teams can start the onboarding flow from this first screen.</p>
        <a class="primary-action" href="/signup">Start free</a>
      </section>
      <section class="lead-capture">
        <p>Request a trial for your organization.</p>
        <form id="trial-request">
          <label for="work-email">Work email</label>
          <input id="work-email" type="email" name="email" />
          <label for="company-name">Company</label>
          <input id="company-name" type="text" name="company" />
          <button type="submit">Request trial</button>
        </form>
      </section>
    </main>
  </body>
</html>`;
}

function createSensitiveValueDiscoveryFixtureHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head><title>Sensitive Value Discovery Fixture</title></head>
  <body>
    <main>
      <form id="signup-form" aria-label="Signup form">
        <span id="safe-form-label">Signup form <textarea>email super-secret-user-value</textarea></span>
        <label for="email">Work email</label>
        <input id="email" type="email" name="email" value="super-secret-user-value" />
        <label for="password">Password</label>
        <input id="password" type="password" name="password" value="super-secret-user-value" />
        <label for="company">Company</label>
        <textarea id="company" name="company">email super-secret-user-value</textarea>
        <button type="submit" aria-labelledby="safe-form-label">Create account</button>
      </form>
    </main>
  </body>
</html>`;
}

function createDemoFixtureHtml(options: { postCheckoutOnLoad?: boolean } = {}): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <title>Book a demo</title>
    ${options.postCheckoutOnLoad ? "<script>fetch('/checkout', { method: 'POST' }).catch(() => undefined);</script>" : ""}
  </head>
  <body>
    <main>
      <h1>Talk to sales</h1>
      <form id="demo-form">
        <input type="email" name="email" placeholder="Work email" />
        <textarea name="message" placeholder="Tell us about your team"></textarea>
      </form>
    </main>
  </body>
</html>`;
}

function createPricingFixtureHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head><title>Pricing</title></head>
  <body>
    <main>
      <section id="pricing">
        <h1>Pricing plans</h1>
        <a href="checkout.html">Choose Starter</a>
      </section>
    </main>
  </body>
</html>`;
}

function createCheckoutFixtureHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head><title>Checkout</title></head>
  <body>
    <main>
      <section id="pricing">
        <h1>Pricing checkout</h1>
        <a href="checkout.html">Choose Starter</a>
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

function shallowNavigationDestinations(observations: DiscoveryObservation[]): string[] {
  return observations.flatMap((observation) => {
    return observation.data?.shallow_navigation?.destination_url
      ? [observation.data.shallow_navigation.destination_url]
      : [];
  });
}

interface FixtureServerOptions {
  demoPath?: string;
  demoPostsCheckout?: boolean;
  extraRootLinks?: string;
  pricingPath?: string;
  pricingRedirectToCheckout?: boolean;
}

async function startFixtureServer(
  requestedPaths: Map<string, number>,
  options: FixtureServerOptions = {}
): Promise<Server> {
  const demoPath = options.demoPath ?? "/demo";
  const pricingPath = options.pricingPath ?? "/pricing";

  const server = createServer((request, response) => {
    const path = request.url?.split("?")[0] ?? "/";
    requestedPaths.set(path, (requestedPaths.get(path) ?? 0) + 1);
    response.setHeader("content-type", "text/html; charset=utf-8");

    if (path === demoPath) {
      response.end(createDemoFixtureHtml({ postCheckoutOnLoad: options.demoPostsCheckout }));
      return;
    }

    if (path === pricingPath) {
      if (options.pricingRedirectToCheckout) {
        response.statusCode = 302;
        response.setHeader("location", "/checkout");
        response.end();
        return;
      }

      response.end(createPricingFixtureHtml());
      return;
    }

    if (path === "/checkout") {
      response.end(createCheckoutFixtureHtml());
      return;
    }

    if (path === "/cart") {
      response.end(createCheckoutFixtureHtml());
      return;
    }

    response.end(`<!doctype html>
<html lang="en">
  <head><title>HTTP Discovery Fixture</title></head>
  <body>
    <main>
      <a href="${demoPath}">Book a demo</a>
      <a href="${pricingPath}">See pricing</a>
      <a href="/checkout">Choose Starter</a>
      ${options.extraRootLinks ?? ""}
    </main>
  </body>
</html>`);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  return server;
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
