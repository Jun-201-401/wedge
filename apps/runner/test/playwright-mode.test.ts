import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createPlaywrightSessionFactory } from "../src/browser/playwright/index.ts";
import { createCapturePipeline } from "../src/capture/index.ts";
import { executeScenario } from "../src/scenario/executor/index.ts";
import { executeScenarioStep } from "../src/scenario/executor/step-executor.ts";
import { createArtifactStore } from "../src/storage/index.ts";
import { registerAgentWorker } from "../src/worker/agent-worker.ts";
import { exportAgentTraceToScenarioPlan } from "../src/agent/trace-export.ts";
import type { AgentTrace } from "../src/agent/trace.ts";
import type {
  AgentEvent,
  AgentTask,
  AgentTraceCallbackPayload,
  Artifact,
  Checkpoint,
  ScenarioAction,
  ScenarioPlan,
  ScenarioStage,
  ScenarioStep
} from "../src/shared/contracts.ts";
import { createMinimalPlan, createRunnerTestConfig, createStubCallbackClient } from "./support.ts";

test("[Playwright 실제 실행] goto/fill/select를 수행하고 실제 screenshot과 DOM snapshot을 캡처한다", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "wedge-runner-playwright-site-"));
  const artifactsRoot = await mkdtemp(join(tmpdir(), "wedge-runner-playwright-artifacts-"));
  let session: Awaited<ReturnType<ReturnType<typeof createPlaywrightSessionFactory>["createSession"]>> | undefined;

  try {
    const { formUrl } = await createFixtureSite(fixtureRoot);
    const plan = createPlaywrightPlan(formUrl);
    const browserFactory = createPlaywrightBrowserFactory(artifactsRoot);

    session = await browserFactory.createSession({
      runId: "run-playwright-form",
      plan
    });

    await executeGotoStep(session, formUrl, "step_goto_form");

    await session.execute(
      {
        type: "fill",
        target: {
          label: "Email"
        },
        value: "test@example.com"
      },
      createStep({
        step_id: "step_fill_email",
        stage: "INPUT",
        description: "fill email field",
        action: {
          type: "fill",
          target: {
            label: "Email"
          },
          value: "test@example.com"
        }
      })
    );

    await session.execute(
      {
        type: "select",
        target: {
          label: "Plan"
        },
        value: "pro"
      },
      createStep({
        step_id: "step_select_plan",
        stage: "INPUT",
        description: "select plan option",
        action: {
          type: "select",
          target: {
            label: "Plan"
          },
          value: "pro"
        }
      })
    );

    const snapshot = session.snapshot();
    const capturedArtifacts = await session.captureArtifacts();

    assert.equal(snapshot.finalUrl, formUrl);
    assert.equal(snapshot.fields.Email, "test@example.com");
    assert.equal(snapshot.selectedOptions.Plan, "pro");
    assert.deepEqual(snapshot.visitedUrls, [formUrl]);
    assert.equal(capturedArtifacts.screenshot?.mimeType, "image/png");
    assert.equal(capturedArtifacts.screenshot?.fileExtension, "png");
    assert.ok((capturedArtifacts.screenshot?.contentBase64.length ?? 0) > 0);
    const screenshotBuffer = Buffer.from(capturedArtifacts.screenshot?.contentBase64 ?? "", "base64");
    const screenshotDimensions = readPngDimensions(screenshotBuffer);
    assert.equal(capturedArtifacts.screenshot?.width, screenshotDimensions.width);
    assert.equal(capturedArtifacts.screenshot?.height, screenshotDimensions.height);
    assert.ok((capturedArtifacts.screenshot?.height ?? 0) > plan.environment.viewport.height);
    assert.deepEqual(
      screenshotBuffer.subarray(0, 8),
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    );
    assert.equal(capturedArtifacts.domSnapshot?.mimeType, "text/html");
    assert.ok(capturedArtifacts.domSnapshot?.content.includes("Runner Playwright Form"));
    assert.ok(capturedArtifacts.domSnapshot?.content.includes('id="email"'));
    assert.ok(capturedArtifacts.domSnapshot?.content.includes('id="plan"'));
  } finally {
    await session?.close();
    await rm(fixtureRoot, { recursive: true, force: true });
    await rm(artifactsRoot, { recursive: true, force: true });
  }
});

test("[Playwright 실제 실행] select value가 없으면 option label 매칭으로 선택한다", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "wedge-runner-playwright-site-"));
  const artifactsRoot = await mkdtemp(join(tmpdir(), "wedge-runner-playwright-artifacts-"));
  let session: Awaited<ReturnType<ReturnType<typeof createPlaywrightSessionFactory>["createSession"]>> | undefined;

  try {
    const { formUrl } = await createFixtureSite(fixtureRoot);
    const browserFactory = createPlaywrightBrowserFactory(artifactsRoot);

    session = await browserFactory.createSession({
      runId: "run-playwright-select-label",
      plan: createPlaywrightPlan(formUrl)
    });

    await executeGotoStep(session, formUrl, "step_goto_select_label");

    await session.execute(
      {
        type: "select",
        target: {
          label: "Plan"
        },
        value: "Starter"
      },
      createStep({
        step_id: "step_select_plan_by_label",
        stage: "INPUT",
        description: "select plan option by visible label",
        action: {
          type: "select",
          target: {
            label: "Plan"
          },
          value: "Starter"
        }
      })
    );

    const snapshot = session.snapshot();
    assert.equal(snapshot.selectedOptions.Plan, "Starter");
  } finally {
    await session?.close();
    await rm(fixtureRoot, { recursive: true, force: true });
    await rm(artifactsRoot, { recursive: true, force: true });
  }
});

test("[Playwright 실제 실행] scroll 액션 후 snapshot에 scroll position을 반영한다", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "wedge-runner-playwright-site-"));
  const artifactsRoot = await mkdtemp(join(tmpdir(), "wedge-runner-playwright-artifacts-"));
  let session: Awaited<ReturnType<ReturnType<typeof createPlaywrightSessionFactory>["createSession"]>> | undefined;

  try {
    const { formUrl } = await createFixtureSite(fixtureRoot);
    const browserFactory = createPlaywrightBrowserFactory(artifactsRoot);

    session = await browserFactory.createSession({
      runId: "run-playwright-scroll",
      plan: createPlaywrightPlan(formUrl)
    });

    await executeGotoStep(session, formUrl, "step_open_scroll_fixture");

    await session.execute(
      {
        type: "scroll",
        value: 720
      },
      createStep({
        step_id: "step_scroll_fixture",
        stage: "VALUE",
        description: "scroll the fixture page",
        action: {
          type: "scroll",
          value: 720
        }
      })
    );

    const snapshot = session.snapshot();

    assert.equal(snapshot.lastAction?.type, "scroll");
    assert.ok(snapshot.scrollY >= 600);
  } finally {
    await session?.close();
    await rm(fixtureRoot, { recursive: true, force: true });
    await rm(artifactsRoot, { recursive: true, force: true });
  }
});

test("[Playwright 실제 실행] click target이 링크일 때 목적지 페이지로 이동한다", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "wedge-runner-playwright-site-"));
  const artifactsRoot = await mkdtemp(join(tmpdir(), "wedge-runner-playwright-artifacts-"));
  let session: Awaited<ReturnType<ReturnType<typeof createPlaywrightSessionFactory>["createSession"]>> | undefined;

  try {
    const { formUrl, doneUrl } = await createFixtureSite(fixtureRoot);
    const browserFactory = createPlaywrightBrowserFactory(artifactsRoot);

    session = await browserFactory.createSession({
      runId: "run-playwright-click",
      plan: createPlaywrightPlan(formUrl)
    });

    await executeGotoStep(session, formUrl);

    await session.execute(
      {
        type: "click",
        target: {
          role: "link",
          text: "Continue"
        }
      },
      createStep({
        step_id: "step_click_continue",
        stage: "CTA",
        description: "click continue link",
        action: {
          type: "click",
          target: {
            role: "link",
            text: "Continue"
          }
        }
      })
    );

    await session.settle({
      type: "network_idle",
      timeout_ms: 3_000
    });

    const snapshot = session.snapshot();

    assert.equal(snapshot.finalUrl, doneUrl);
    assert.equal(snapshot.title, "Runner Done");
    assert.deepEqual(snapshot.visitedUrls, [formUrl, doneUrl]);
  } finally {
    await session?.close();
    await rm(fixtureRoot, { recursive: true, force: true });
    await rm(artifactsRoot, { recursive: true, force: true });
  }
});

test("[안전 정책] destructive click target은 locator click 전에 차단한다", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "wedge-runner-playwright-site-"));
  const artifactsRoot = await mkdtemp(join(tmpdir(), "wedge-runner-playwright-artifacts-"));
  let session: Awaited<ReturnType<ReturnType<typeof createPlaywrightSessionFactory>["createSession"]>> | undefined;

  try {
    const { formUrl } = await createFixtureSite(fixtureRoot);
    const browserFactory = createPlaywrightBrowserFactory(artifactsRoot);

    session = await browserFactory.createSession({
      runId: "run-playwright-block-destructive-click",
      plan: createPlaywrightPlan(formUrl)
    });

    await executeGotoStep(session, formUrl, "step_open_destructive_fixture");

    await assert.rejects(
      () =>
        session!.execute(
          {
            type: "click",
            target: {
              role: "button",
              text: "Delete account"
            }
          },
          createStep({
            step_id: "step_click_delete_account",
            stage: "CTA",
            description: "attempt destructive action",
            action: {
              type: "click",
              target: {
                role: "button",
                text: "Delete account"
              }
            }
          })
        ),
      /Scenario safety forbids destructive click targets/
    );

    const snapshot = session.snapshot();
    const capturedArtifacts = await session.captureArtifacts();
    assert.equal(snapshot.finalUrl, formUrl);
    assert.ok(!capturedArtifacts.domSnapshot?.content.includes('data-destructive-clicked="true"'));
  } finally {
    await session?.close();
    await rm(fixtureRoot, { recursive: true, force: true });
    await rm(artifactsRoot, { recursive: true, force: true });
  }
});

test("[Playwright 실제 실행] hover로 생긴 DOM 변화를 wait_for가 관찰한다", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "wedge-runner-playwright-site-"));
  const artifactsRoot = await mkdtemp(join(tmpdir(), "wedge-runner-playwright-artifacts-"));
  let session: Awaited<ReturnType<ReturnType<typeof createPlaywrightSessionFactory>["createSession"]>> | undefined;

  try {
    const { formUrl } = await createFixtureSite(fixtureRoot);
    const browserFactory = createPlaywrightBrowserFactory(artifactsRoot);

    session = await browserFactory.createSession({
      runId: "run-playwright-hover-wait",
      plan: createPlaywrightPlan(formUrl)
    });

    await executeGotoStep(session, formUrl);

    await session.execute(
      {
        type: "hover",
        target: {
          selector: "#hover-target"
        }
      },
      createStep({
        step_id: "step_hover_target",
        stage: "VALUE",
        description: "hover the async reveal target",
        action: {
          type: "hover",
          target: {
            selector: "#hover-target"
          }
        }
      })
    );

    await session.execute(
      {
        type: "wait_for",
        target: {
          selector: "#hover-result"
        },
        options: {
          state: "visible",
          timeout_ms: 2_000
        }
      },
      createStep({
        step_id: "step_wait_for_result",
        stage: "VALUE",
        description: "wait for hover result to become visible",
        action: {
          type: "wait_for",
          target: {
            selector: "#hover-result"
          },
          options: {
            state: "visible",
            timeout_ms: 2_000
          }
        }
      })
    );

    const snapshot = session.snapshot();
    const capturedArtifacts = await session.captureArtifacts();

    assert.equal(snapshot.finalUrl, formUrl);
    assert.equal(snapshot.lastAction?.type, "wait_for");
    assert.equal(snapshot.lastAction?.target, "selector=#hover-result");
    assert.ok(capturedArtifacts.domSnapshot?.content.includes('data-hover-state="hovered"'));
    assert.ok(capturedArtifacts.domSnapshot?.content.includes("Hover complete"));
  } finally {
    await session?.close();
    await rm(fixtureRoot, { recursive: true, force: true });
    await rm(artifactsRoot, { recursive: true, force: true });
  }
});

test("[Playwright 실제 실행] locator/url 조건 없는 wait_for는 실행 전에 거부한다", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "wedge-runner-playwright-site-"));
  const artifactsRoot = await mkdtemp(join(tmpdir(), "wedge-runner-playwright-artifacts-"));
  let session: Awaited<ReturnType<ReturnType<typeof createPlaywrightSessionFactory>["createSession"]>> | undefined;

  try {
    const { formUrl } = await createFixtureSite(fixtureRoot);
    const browserFactory = createPlaywrightBrowserFactory(artifactsRoot);

    session = await browserFactory.createSession({
      runId: "run-playwright-wait-for-failure",
      plan: createPlaywrightPlan(formUrl)
    });

    await executeGotoStep(session, formUrl);

    await assert.rejects(
      () =>
        session!.execute(
          {
            type: "wait_for",
            target: {
              selector: "#missing-target"
            },
            options: {
              state: "visible",
              timeout_ms: 100
            }
          },
          createStep({
            step_id: "step_wait_for_missing_target",
            stage: "VALUE",
            description: "wait for a missing target",
            action: {
              type: "wait_for",
              target: {
                selector: "#missing-target"
              },
              options: {
                state: "visible",
                timeout_ms: 100
              }
            }
          })
        ),
      /Unable to satisfy wait_for action/
    );
  } finally {
    await session?.close();
    await rm(fixtureRoot, { recursive: true, force: true });
    await rm(artifactsRoot, { recursive: true, force: true });
  }
});

test("[MVP 랜딩 CTA] 첫 화면 checkpoint 후 CTA 클릭과 도착 화면 checkpoint까지 실행한다", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "wedge-runner-mvp-site-"));
  const artifactsRoot = await mkdtemp(join(tmpdir(), "wedge-runner-mvp-artifacts-"));

  try {
    const { homeUrl } = await createMvpFixtureSite(fixtureRoot);
    const result = await executeRealScenarioPlan({
      runId: "run-mvp-landing-cta",
      plan: createMvpLandingCtaPlan(homeUrl),
      artifactsRoot
    });

    assert.equal(result.execution.summary.completedStepCount, 5);
    assert.equal(result.execution.summary.stopped, false);
    assert.equal(result.execution.delivery.status, "DELIVERY_COMPLETE");
    assert.ok(result.snapshot.finalUrl.includes("#signup-form"));
    assert.deepEqual(result.checkpointStepKeys, [
      "landing_001_goto",
      "landing_002_first_view_checkpoint",
      "landing_005_cta_destination_checkpoint"
    ]);

    const firstViewCheckpoint = findCheckpoint(result.checkpoints, "landing_002_first_view_checkpoint");
    const interactiveComponents = findObservation(firstViewCheckpoint, "interactive_components");
    const components = readRecordArray(interactiveComponents, "components");
    const primaryComponents = components.filter((component) => component.is_primary_like === true);
    const startFreeComponent = components.find((component) => component.text === "Start free");

    assert.equal(interactiveComponents.stage, "CTA");
    assert.equal(interactiveComponents.primary_like_component_count, primaryComponents.length);
    assert.equal(primaryComponents.length, 1);
    assert.equal(startFreeComponent?.selector, "#hero-cta");
    assert.equal(startFreeComponent?.role, "link");
    assert.equal(startFreeComponent?.is_cta_candidate, true);
    assert.equal(startFreeComponent?.is_primary_like, true);
    assert.equal(readString(startFreeComponent?.bounds, "unit"), "css_px");
    assert.ok(readPositiveNumber(startFreeComponent?.bounds, "width") > 0);
    assert.ok(readPositiveNumber(startFreeComponent?.bounds, "height") > 0);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
    await rm(artifactsRoot, { recursive: true, force: true });
  }
});

test("[MVP 가입폼] 폼까지 이동해 synthetic 입력/플랜 선택을 수행하고 제출 전 중단한다", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "wedge-runner-mvp-site-"));
  const artifactsRoot = await mkdtemp(join(tmpdir(), "wedge-runner-mvp-artifacts-"));

  try {
    const { homeUrl } = await createMvpFixtureSite(fixtureRoot);
    const result = await executeRealScenarioPlan({
      runId: "run-mvp-signup-form",
      plan: createMvpSignupFormPlan(homeUrl),
      artifactsRoot
    });

    assert.equal(result.execution.summary.completedStepCount, 9);
    assert.equal(result.execution.summary.stopped, true);
    assert.equal(result.execution.delivery.status, "DELIVERY_COMPLETE");
    assert.equal(result.snapshot.fields["Work email"], "test+wedge@example.com");
    assert.equal(result.snapshot.fields.company, "Wedge Test Company");
    assert.equal(result.snapshot.selectedOptions.Plan, "starter");
    assert.ok(!result.domSnapshots.some((snapshot) => snapshot.includes('data-form-submitted="true"')));
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
    await rm(artifactsRoot, { recursive: true, force: true });
  }
});

test("[Agent Checkout Smoke] 실제 Playwright 경로에서 장바구니, 카트, checkout 진입 후 결제 전 중단한다", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "wedge-runner-agent-smoke-site-"));
  const artifactsRoot = await mkdtemp(join(tmpdir(), "wedge-runner-agent-smoke-artifacts-"));

  try {
    const { productUrl } = await createAgentCheckoutFixtureSite(fixtureRoot);
    const result = await executeRealAgentTask({
      task: createAgentCheckoutTask(productUrl),
      artifactsRoot
    });

    assert.equal(result.execution.summary.completedStepCount, 4);
    assert.equal(result.execution.summary.stopped, false);
    assert.equal(result.execution.delivery.status, "DELIVERY_COMPLETE");
    assert.equal(result.execution.trace.outcome.status, "SUCCESS");
    assert.ok(result.snapshot.finalUrl.endsWith("/checkout.html"));
    assert.deepEqual(result.actionCompletedTargets, [
      productUrl,
      "#add-to-cart",
      "#cart-link",
      "#checkout-link"
    ]);
    assert.ok(result.agentEvents.some((event) => event.eventType === "TRACE_PERSISTED"));
    assert.equal(result.agentTraces.length, 1);
    assert.equal(result.traceArtifacts.length, 1);
    assert.equal(result.traceArtifacts[0].artifactType, "TRACE");
    assert.ok(!result.actionCompletedTargets.includes("#pay-now"));
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
    await rm(artifactsRoot, { recursive: true, force: true });
  }
});

test("[Agent Trace Export Replay] export된 ScenarioPlan은 replay_hint locator로 static Runner에서 재생된다", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "wedge-runner-agent-export-replay-site-"));
  const artifactsRoot = await mkdtemp(join(tmpdir(), "wedge-runner-agent-export-replay-artifacts-"));

  try {
    const { productUrl } = await createAgentCheckoutFixtureSite(fixtureRoot);
    const task = createAgentCheckoutTask(productUrl);
    const traceExport = exportAgentTraceToScenarioPlan({
      task,
      trace: createReplayHintOnlyCheckoutTrace(task, productUrl),
      exportedAt: "2026-05-08T00:00:00.000Z"
    });

    assert.equal(traceExport.status, "EXPORTED");
    assert.ok(traceExport.scenario_plan);
    assert.ok(
      traceExport.scenario_plan.steps
        .filter((step) => step.action.type === "click")
        .every((step) => typeof step.action.options?.replay_hint === "object")
    );

    const result = await executeRealScenarioPlan({
      runId: "run-agent-export-replay",
      plan: traceExport.scenario_plan,
      artifactsRoot
    });

    assert.equal(result.execution.summary.failedStepCount, 0);
    assert.equal(result.execution.summary.stopped, true);
    assert.ok(result.snapshot.finalUrl.endsWith("/checkout.html"));
    assert.ok(!result.domSnapshots.some((snapshot) => snapshot.includes('data-payment-committed="true"')));
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
    await rm(artifactsRoot, { recursive: true, force: true });
  }
});

test("[Agent Login Blocker Smoke] 실제 Playwright 경로에서 로그인 벽을 decision 전에 감지한다", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "wedge-runner-agent-blocker-site-"));
  const artifactsRoot = await mkdtemp(join(tmpdir(), "wedge-runner-agent-blocker-artifacts-"));

  try {
    const { blockerUrl } = await createAgentBlockerFixtureSite(fixtureRoot, {
      fileName: "account.html",
      title: "Account login required",
      heading: "Login required",
      body: "Please log in to continue to checkout."
    });
    const result = await executeRealAgentTask({
      task: createAgentCheckoutTask(blockerUrl),
      artifactsRoot
    });

    assert.equal(result.execution.summary.completedStepCount, 1);
    assert.equal(result.execution.summary.stopped, true);
    assert.equal(result.execution.trace.outcome.status, "BLOCKED");
    assert.equal(result.execution.trace.turns.at(-1)?.preDecisionVerification?.outcome, "BLOCKED_LOGIN");
    assert.deepEqual(result.actionCompletedTargets, [blockerUrl]);
    assert.equal(result.traceArtifacts.length, 1);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
    await rm(artifactsRoot, { recursive: true, force: true });
  }
});

test("[Agent CAPTCHA Blocker Smoke] 실제 Playwright 경로에서 CAPTCHA 벽을 decision 전에 감지한다", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "wedge-runner-agent-challenge-site-"));
  const artifactsRoot = await mkdtemp(join(tmpdir(), "wedge-runner-agent-challenge-artifacts-"));

  try {
    const { blockerUrl } = await createAgentBlockerFixtureSite(fixtureRoot, {
      fileName: "gate.html",
      title: "Verify you are human - CAPTCHA",
      heading: "Security check",
      body: "Complete the CAPTCHA before checkout can continue."
    });
    const result = await executeRealAgentTask({
      task: createAgentCheckoutTask(blockerUrl),
      artifactsRoot
    });

    assert.equal(result.execution.summary.completedStepCount, 1);
    assert.equal(result.execution.summary.stopped, true);
    assert.equal(result.execution.trace.outcome.status, "BLOCKED");
    assert.equal(result.execution.trace.turns.at(-1)?.preDecisionVerification?.outcome, "BLOCKED_CAPTCHA");
    assert.deepEqual(result.actionCompletedTargets, [blockerUrl]);
    assert.equal(result.traceArtifacts.length, 1);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
    await rm(artifactsRoot, { recursive: true, force: true });
  }
});

test("[Agent Iframe Payment Blocker Smoke] iframe 내부 최종 결제 후보를 decision 전에 감지한다", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "wedge-runner-agent-iframe-payment-site-"));
  const artifactsRoot = await mkdtemp(join(tmpdir(), "wedge-runner-agent-iframe-payment-artifacts-"));

  try {
    const { checkoutUrl } = await createAgentIframePaymentFixtureSite(fixtureRoot);
    const result = await executeRealAgentTask({
      task: createAgentCheckoutTask(checkoutUrl),
      artifactsRoot
    });

    assert.equal(result.execution.summary.completedStepCount, 1);
    assert.equal(result.execution.summary.stopped, true);
    assert.equal(result.execution.trace.outcome.status, "POLICY_BLOCKED");
    assert.equal(result.execution.trace.turns.at(-1)?.preDecisionVerification?.outcome, "POLICY_BLOCKED");
    assert.match(result.execution.trace.turns.at(-1)?.preDecisionVerification?.reason ?? "", /iframe frame:1/);
    assert.deepEqual(result.actionCompletedTargets, [checkoutUrl]);
    assert.ok(!result.actionCompletedTargets.includes("#pay-now"));
    assert.equal(result.traceArtifacts.length, 1);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
    await rm(artifactsRoot, { recursive: true, force: true });
  }
});

test("[Agent Shadow Payment Blocker Smoke] open shadow DOM 최종 결제 후보를 decision 전에 감지한다", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "wedge-runner-agent-shadow-payment-site-"));
  const artifactsRoot = await mkdtemp(join(tmpdir(), "wedge-runner-agent-shadow-payment-artifacts-"));

  try {
    const { checkoutUrl } = await createAgentShadowPaymentFixtureSite(fixtureRoot);
    const result = await executeRealAgentTask({
      task: createAgentCheckoutTask(checkoutUrl),
      artifactsRoot
    });

    assert.equal(result.execution.summary.completedStepCount, 1);
    assert.equal(result.execution.summary.stopped, true);
    assert.equal(result.execution.trace.outcome.status, "POLICY_BLOCKED");
    assert.equal(result.execution.trace.turns.at(-1)?.preDecisionVerification?.outcome, "POLICY_BLOCKED");
    assert.match(result.execution.trace.turns.at(-1)?.preDecisionVerification?.reason ?? "", /shadow root/);
    assert.deepEqual(result.actionCompletedTargets, [checkoutUrl]);
    assert.equal(result.traceArtifacts.length, 1);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
    await rm(artifactsRoot, { recursive: true, force: true });
  }
});

test("[Agent Frame Replay] replay_hint frame_id로 iframe 내부 후보를 static Runner가 클릭한다", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "wedge-runner-agent-frame-replay-site-"));
  const artifactsRoot = await mkdtemp(join(tmpdir(), "wedge-runner-agent-frame-replay-artifacts-"));

  try {
    const { frameUrl } = await createAgentIframeReplayFixtureSite(fixtureRoot);
    const result = await executeRealScenarioPlan({
      runId: "run-agent-frame-replay",
      plan: createAgentIframeReplayPlan(frameUrl),
      artifactsRoot
    });

    assert.equal(result.execution.summary.failedStepCount, 0);
    assert.equal(result.execution.summary.completedStepCount, 4);
    assert.equal(result.execution.summary.stopped, true);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
    await rm(artifactsRoot, { recursive: true, force: true });
  }
});

test("[Agent External Checkout Smoke] allowlist된 외부 checkout redirect는 실제 Playwright 경로에서 허용한다", async () => {
  const artifactsRoot = await mkdtemp(join(tmpdir(), "wedge-runner-agent-external-artifacts-"));
  const fixture = await createAgentExternalCheckoutFixtureServer();

  try {
    const task = createAgentCheckoutTask(fixture.productUrl);
    task.allowed_navigation.allowed_checkout_redirect_origins = [fixture.checkoutOrigin];

    const result = await executeRealAgentTask({
      task,
      artifactsRoot
    });

    assert.equal(result.execution.summary.completedStepCount, 4);
    assert.equal(result.execution.summary.stopped, false);
    assert.equal(result.execution.trace.outcome.status, "SUCCESS");
    assert.ok(result.snapshot.finalUrl.startsWith(fixture.checkoutOrigin));
    assert.deepEqual(result.actionCompletedTargets, [
      fixture.productUrl,
      "#add-to-cart",
      "#cart-link",
      "#external-checkout-link"
    ]);
    assert.ok(!result.actionCompletedTargets.includes("#pay-now"));
    assert.equal(result.traceArtifacts.length, 1);
  } finally {
    await fixture.close();
    await rm(artifactsRoot, { recursive: true, force: true });
  }
});

test("[MVP 가격/결제] checkout 진입점까지 이동하되 실제 결제 commit 전 중단한다", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "wedge-runner-mvp-site-"));
  const artifactsRoot = await mkdtemp(join(tmpdir(), "wedge-runner-mvp-artifacts-"));

  try {
    const { homeUrl } = await createMvpFixtureSite(fixtureRoot);
    const result = await executeRealScenarioPlan({
      runId: "run-mvp-pricing-checkout",
      plan: createMvpPricingCheckoutPlan(homeUrl),
      artifactsRoot
    });

    assert.equal(result.execution.summary.completedStepCount, 8);
    assert.equal(result.execution.summary.stopped, true);
    assert.equal(result.execution.delivery.status, "DELIVERY_COMPLETE");
    assert.ok(result.snapshot.finalUrl.endsWith("/checkout.html"));
    assert.deepEqual(result.checkpointStepKeys, [
      "pricing_001_goto",
      "pricing_004_pricing_checkpoint",
      "pricing_007_checkout_entry_checkpoint"
    ]);
    assert.ok(!result.domSnapshots.some((snapshot) => snapshot.includes('data-payment-committed="true"')));
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
    await rm(artifactsRoot, { recursive: true, force: true });
  }
});

test("[Settle] none 전략은 page 상태를 바꾸지 않고 no_wait 결과를 반환한다", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "wedge-runner-playwright-site-"));
  const artifactsRoot = await mkdtemp(join(tmpdir(), "wedge-runner-playwright-artifacts-"));
  let session: Awaited<ReturnType<ReturnType<typeof createPlaywrightSessionFactory>["createSession"]>> | undefined;

  try {
    const { formUrl } = await createFixtureSite(fixtureRoot);
    const browserFactory = createPlaywrightBrowserFactory(artifactsRoot);

    session = await browserFactory.createSession({
      runId: "run-playwright-settle-none",
      plan: createPlaywrightPlan(formUrl)
    });

    await executeGotoStep(session, formUrl, "step_open_for_settle_none");

    const settleResult = await session.settle({
      type: "none",
      timeout_ms: 500
    });

    const snapshot = session.snapshot();

    assert.equal(settleResult.strategy, "none");
    assert.equal(settleResult.status, "settled");
    assert.equal(settleResult.details?.mode, "no_wait");
    assert.equal(snapshot.finalUrl, formUrl);
  } finally {
    await session?.close();
    await rm(fixtureRoot, { recursive: true, force: true });
    await rm(artifactsRoot, { recursive: true, force: true });
  }
});

test("[Settle] locator_visible/spinner_hidden 전략은 지연 DOM 전환을 기다린다", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "wedge-runner-playwright-site-"));
  const artifactsRoot = await mkdtemp(join(tmpdir(), "wedge-runner-playwright-artifacts-"));
  let session: Awaited<ReturnType<ReturnType<typeof createPlaywrightSessionFactory>["createSession"]>> | undefined;

  try {
    const { formUrl } = await createFixtureSite(fixtureRoot);
    const browserFactory = createPlaywrightBrowserFactory(artifactsRoot);

    session = await browserFactory.createSession({
      runId: "run-playwright-settle-locator",
      plan: createPlaywrightPlan(formUrl)
    });

    await executeGotoStep(session, formUrl);

    await session.execute(
      {
        type: "click",
        target: {
          selector: "#settle-visible-trigger"
        }
      },
      createStep({
        step_id: "step_trigger_visibility",
        stage: "VALUE",
        description: "trigger delayed visibility change",
        action: {
          type: "click",
          target: {
            selector: "#settle-visible-trigger"
          }
        }
      })
    );

    const locatorVisibleResult = await session.settle({
      type: "locator_visible",
      timeout_ms: 2_000,
      target: {
        selector: "#settle-visible"
      }
    });

    await session.execute(
      {
        type: "click",
        target: {
          selector: "#settle-spinner-trigger"
        }
      },
      createStep({
        step_id: "step_trigger_spinner",
        stage: "VALUE",
        description: "trigger delayed spinner hide",
        action: {
          type: "click",
          target: {
            selector: "#settle-spinner-trigger"
          }
        }
      })
    );

    const spinnerHiddenResult = await session.settle({
      type: "spinner_hidden",
      timeout_ms: 2_000,
      target: {
        selector: "#settle-spinner"
      }
    });

    const capturedArtifacts = await session.captureArtifacts();

    assert.equal(locatorVisibleResult.status, "settled");
    assert.equal(locatorVisibleResult.strategy, "locator_visible");
    assert.equal(spinnerHiddenResult.status, "settled");
    assert.equal(spinnerHiddenResult.strategy, "spinner_hidden");
    assert.ok(capturedArtifacts.domSnapshot?.content.includes('data-locator-visible="done"'));
    assert.ok(capturedArtifacts.domSnapshot?.content.includes('data-spinner-hidden="done"'));
  } finally {
    await session?.close();
    await rm(fixtureRoot, { recursive: true, force: true });
    await rm(artifactsRoot, { recursive: true, force: true });
  }
});

test("[Settle] url_change를 감지하고 locator 미출현은 timeout으로 보고한다", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "wedge-runner-playwright-site-"));
  const artifactsRoot = await mkdtemp(join(tmpdir(), "wedge-runner-playwright-artifacts-"));
  let session: Awaited<ReturnType<ReturnType<typeof createPlaywrightSessionFactory>["createSession"]>> | undefined;

  try {
    const { formUrl } = await createFixtureSite(fixtureRoot);
    const browserFactory = createPlaywrightBrowserFactory(artifactsRoot);

    session = await browserFactory.createSession({
      runId: "run-playwright-settle-url",
      plan: createPlaywrightPlan(formUrl)
    });

    await executeGotoStep(session, formUrl);

    await session.execute(
      {
        type: "click",
        target: {
          selector: "#settle-hash-trigger"
        }
      },
      createStep({
        step_id: "step_trigger_hash_change",
        stage: "VALUE",
        description: "trigger delayed hash change",
        action: {
          type: "click",
          target: {
            selector: "#settle-hash-trigger"
          }
        }
      })
    );

    const urlChangeResult = await session.settle({
      type: "url_change",
      timeout_ms: 2_000,
      target: {
        url: "#settled"
      }
    });
    const timeoutResult = await session.settle({
      type: "locator_visible",
      timeout_ms: 150,
      target: {
        selector: "#never-visible"
      }
    });
    const snapshot = session.snapshot();
    const capturedArtifacts = await session.captureArtifacts();

    assert.equal(urlChangeResult.status, "settled");
    assert.equal(urlChangeResult.strategy, "url_change");
    assert.ok(snapshot.finalUrl.endsWith("#settled"));
    assert.equal(timeoutResult.status, "timeout");
    assert.equal(timeoutResult.strategy, "locator_visible");
    assert.ok(capturedArtifacts.domSnapshot?.content.includes('data-url-change="done"'));
  } finally {
    await session?.close();
    await rm(fixtureRoot, { recursive: true, force: true });
    await rm(artifactsRoot, { recursive: true, force: true });
  }
});

test("[Settle] 빠른 url_change/item_count_change를 놓치지 않도록 watcher를 action 전에 준비한다", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "wedge-runner-playwright-site-"));
  const artifactsRoot = await mkdtemp(join(tmpdir(), "wedge-runner-playwright-artifacts-"));
  let session: Awaited<ReturnType<ReturnType<typeof createPlaywrightSessionFactory>["createSession"]>> | undefined;

  try {
    const { formUrl } = await createFixtureSite(fixtureRoot);
    const plan = createPlaywrightPlan(formUrl);
    const browserFactory = createPlaywrightBrowserFactory(artifactsRoot);

    session = await browserFactory.createSession({
      runId: "run-playwright-fast-settle",
      plan
    });

    await executeGotoStep(session, formUrl, "step_open_fast_settle_fixture");

    const urlChangeResult = await executeScenarioStep({
      runId: "run-playwright-fast-settle",
      stepOrder: 1,
      step: createStep({
        step_id: "step_fast_url_change",
        stage: "CTA",
        description: "click immediate url change trigger",
        action: {
          type: "click",
          target: {
            selector: "#settle-hash-fast-trigger"
          }
        },
        settle_strategy: {
          type: "url_change",
          timeout_ms: 500
        }
      }),
      plan,
      session,
      callbackClient: createStubCallbackClient(),
      capturePipeline: {
        collectCheckpoint: async () => {
          throw new Error("checkpoint collection should not be called");
        }
      },
      artifactStore: {
        persistArtifacts: async () => []
      }
    });

    const itemCountResult = await executeScenarioStep({
      runId: "run-playwright-fast-settle",
      stepOrder: 2,
      step: createStep({
        step_id: "step_fast_item_count_change",
        stage: "VALUE",
        description: "click immediate item count trigger",
        action: {
          type: "click",
          target: {
            selector: "#item-count-fast-trigger"
          }
        },
        settle_strategy: {
          type: "item_count_change",
          timeout_ms: 500,
          target: {
            selector: "#item-count-list li"
          },
          expected_count: 2
        }
      }),
      plan,
      session,
      callbackClient: createStubCallbackClient(),
      capturePipeline: {
        collectCheckpoint: async () => {
          throw new Error("checkpoint collection should not be called");
        }
      },
      artifactStore: {
        persistArtifacts: async () => []
      }
    });

    const snapshot = session.snapshot();
    assert.equal(urlChangeResult.stopRequested, false);
    assert.equal(itemCountResult.stopRequested, false);
    assert.ok(snapshot.finalUrl.endsWith("#settled-fast"));
    assert.deepEqual(snapshot.visitedUrls, [formUrl, `${formUrl}#settled-fast`]);
  } finally {
    await session?.close();
    await rm(fixtureRoot, { recursive: true, force: true });
    await rm(artifactsRoot, { recursive: true, force: true });
  }
});

test("[Settle] response 전략은 조건에 맞는 HTTP 응답을 기다린다", async () => {
  const fixtureServer = await createResponseFixtureServer();
  const fixtureRoot = await mkdtemp(join(tmpdir(), "wedge-runner-playwright-site-"));
  const artifactsRoot = await mkdtemp(join(tmpdir(), "wedge-runner-playwright-artifacts-"));
  let session: Awaited<ReturnType<ReturnType<typeof createPlaywrightSessionFactory>["createSession"]>> | undefined;

  try {
    const { formUrl } = fixtureServer;
    const browserFactory = createPlaywrightBrowserFactory(artifactsRoot);

    session = await browserFactory.createSession({
      runId: "run-playwright-fallback-settle",
      plan: createPlaywrightPlan(formUrl)
    });

    await executeGotoStep(session, formUrl);

    await session.execute(
      {
        type: "click",
        target: {
          selector: "#response-trigger"
        }
      },
      createStep({
        step_id: "step_trigger_response_like_change",
        stage: "VALUE",
        description: "trigger delayed response-like change",
        action: {
          type: "click",
          target: {
            selector: "#response-trigger"
          }
        }
      })
    );

    const responseStartedAt = Date.now();
    const responseResult = await session.settle({
      type: "response",
      timeout_ms: 1_000,
      target: {
        url: "/api/mock-response"
      },
      method: "GET",
      status: 200
    });
    const responseElapsedMs = Date.now() - responseStartedAt;
    let capturedArtifacts = await session.captureArtifacts();

    assert.equal(responseResult.status, "settled");
    assert.equal(responseResult.strategy, "response");
    assert.ok(responseResult.durationMs >= 120);
    assert.ok(responseElapsedMs >= 120);
    assert.ok(capturedArtifacts.domSnapshot?.content.includes("Response ready"));
    assert.ok(capturedArtifacts.domSnapshot?.content.includes('data-response-state="done"'));
  } finally {
    await session?.close();
    await fixtureServer.close();
    await rm(fixtureRoot, { recursive: true, force: true });
    await rm(artifactsRoot, { recursive: true, force: true });
  }
});

test("[Settle] 빠른 HTTP response를 놓치지 않도록 watcher를 action 전에 준비한다", async () => {
  const fixtureServer = await createImmediateResponseFixtureServer();
  const artifactsRoot = await mkdtemp(join(tmpdir(), "wedge-runner-playwright-artifacts-"));
  let session: Awaited<ReturnType<ReturnType<typeof createPlaywrightSessionFactory>["createSession"]>> | undefined;

  try {
    const plan = createPlaywrightPlan(fixtureServer.formUrl);
    const browserFactory = createPlaywrightBrowserFactory(artifactsRoot);

    session = await browserFactory.createSession({
      runId: "run-playwright-fast-response-settle",
      plan
    });

    await executeGotoStep(session, fixtureServer.formUrl, "step_open_immediate_response_form", "open immediate response fixture");

    const result = await executeScenarioStep({
      runId: "run-playwright-fast-response-settle",
      stepOrder: 1,
      step: createStep({
        step_id: "step_trigger_fast_response",
        stage: "CTA",
        description: "trigger immediate response",
        action: {
          type: "click",
          target: {
            selector: "#response-trigger"
          }
        },
        settle_strategy: {
          type: "response",
          timeout_ms: 500,
          target: {
            url: "/api/immediate-response"
          }
        }
      }),
      plan,
      session,
      callbackClient: createStubCallbackClient(),
      capturePipeline: {
        collectCheckpoint: async () => {
          throw new Error("checkpoint collection should not be called");
        }
      },
      artifactStore: {
        persistArtifacts: async () => []
      }
    });

    const capturedArtifacts = await session.captureArtifacts();
    assert.equal(result.stopRequested, false);
    assert.ok(capturedArtifacts.domSnapshot?.content.includes('data-response-state="done"'));
    assert.ok(capturedArtifacts.domSnapshot?.content.includes("Immediate response ready"));
  } finally {
    await session?.close();
    await fixtureServer.close();
    await rm(artifactsRoot, { recursive: true, force: true });
  }
});

test("[Settle] pre-armed response timeout이 unhandled rejection을 만들지 않는다", async () => {
  const fixtureServer = await createResponseFixtureServer();
  const artifactsRoot = await mkdtemp(join(tmpdir(), "wedge-runner-playwright-artifacts-"));
  const unhandledRejections: unknown[] = [];
  const recordUnhandledRejection = (reason: unknown) => {
    unhandledRejections.push(reason);
  };
  let session: Awaited<ReturnType<ReturnType<typeof createPlaywrightSessionFactory>["createSession"]>> | undefined;

  process.on("unhandledRejection", recordUnhandledRejection);

  try {
    const plan = createPlaywrightPlan(fixtureServer.formUrl);
    const browserFactory = createPlaywrightBrowserFactory(artifactsRoot);

    session = await browserFactory.createSession({
      runId: "run-playwright-prearmed-response-timeout",
      plan
    });

    await executeGotoStep(session, fixtureServer.formUrl, "step_open_response_timeout_form", "open response timeout fixture");

    const result = await executeScenarioStep({
      runId: "run-playwright-prearmed-response-timeout",
      stepOrder: 1,
      step: createStep({
        step_id: "step_trigger_response_timeout",
        stage: "CTA",
        description: "trigger response that does not match expected status",
        action: {
          type: "click",
          target: {
            selector: "#response-trigger"
          }
        },
        settle_strategy: {
          type: "response",
          timeout_ms: 1,
          target: {
            url: "/api/mock-response"
          },
          status: 204
        }
      }),
      plan,
      session,
      callbackClient: createStubCallbackClient(),
      capturePipeline: {
        collectCheckpoint: async () => {
          throw new Error("checkpoint collection should not be called");
        }
      },
      artifactStore: {
        persistArtifacts: async () => []
      }
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(result.stopRequested, false);
    assert.deepEqual(unhandledRejections, []);
  } finally {
    process.off("unhandledRejection", recordUnhandledRejection);
    await session?.close();
    await fixtureServer.close();
    await rm(artifactsRoot, { recursive: true, force: true });
  }
});

test("[Settle] item_count_change 전략은 지연된 목록 증가를 기다린다", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "wedge-runner-playwright-site-"));
  const artifactsRoot = await mkdtemp(join(tmpdir(), "wedge-runner-playwright-artifacts-"));
  let session: Awaited<ReturnType<ReturnType<typeof createPlaywrightSessionFactory>["createSession"]>> | undefined;

  try {
    const { formUrl } = await createFixtureSite(fixtureRoot);
    const browserFactory = createPlaywrightBrowserFactory(artifactsRoot);

    session = await browserFactory.createSession({
      runId: "run-playwright-item-count-fallback",
      plan: createPlaywrightPlan(formUrl)
    });

    await executeGotoStep(session, formUrl);

    await session.execute(
      {
        type: "click",
        target: {
          selector: "#item-count-trigger"
        }
      },
      createStep({
        step_id: "step_trigger_item_count_change",
        stage: "VALUE",
        description: "trigger delayed item count change",
        action: {
          type: "click",
          target: {
            selector: "#item-count-trigger"
          }
        }
      })
    );

    const itemCountStartedAt = Date.now();
    const itemCountResult = await session.settle({
      type: "item_count_change",
      timeout_ms: 1_000,
      target: {
        selector: "#item-count-list li"
      },
      expected_count: 2
    });
    const itemCountElapsedMs = Date.now() - itemCountStartedAt;
    let capturedArtifacts = await session.captureArtifacts();

    assert.equal(itemCountResult.status, "settled");
    assert.equal(itemCountResult.strategy, "item_count_change");
    assert.ok(itemCountResult.durationMs >= 150);
    assert.ok(itemCountElapsedMs >= 150);
    assert.equal((capturedArtifacts.domSnapshot?.content.match(/<li>/g) ?? []).length, 2);
    assert.ok(capturedArtifacts.domSnapshot?.content.includes('data-item-count-state="done"'));
  } finally {
    await session?.close();
    await rm(fixtureRoot, { recursive: true, force: true });
    await rm(artifactsRoot, { recursive: true, force: true });
  }
});

test("[Settle] response/item_count_change 조건 불만족은 timeout 결과로 보고한다", async () => {
  const fixtureServer = await createResponseFixtureServer();
  const fixtureRoot = await mkdtemp(join(tmpdir(), "wedge-runner-playwright-site-"));
  const artifactsRoot = await mkdtemp(join(tmpdir(), "wedge-runner-playwright-artifacts-"));
  let responseSession: Awaited<ReturnType<ReturnType<typeof createPlaywrightSessionFactory>["createSession"]>> | undefined;
  let itemCountSession: Awaited<ReturnType<ReturnType<typeof createPlaywrightSessionFactory>["createSession"]>> | undefined;

  try {
    const browserFactory = createPlaywrightBrowserFactory(artifactsRoot);

    responseSession = await browserFactory.createSession({
      runId: "run-playwright-response-timeout",
      plan: createPlaywrightPlan(fixtureServer.formUrl)
    });

    await executeGotoStep(responseSession, fixtureServer.formUrl, "step_open_response_form", "open response timeout fixture");

    await responseSession.execute(
      {
        type: "click",
        target: {
          selector: "#response-trigger"
        }
      },
      createStep({
        step_id: "step_trigger_response",
        stage: "INPUT",
        description: "trigger delayed response",
        action: {
          type: "click",
          target: {
            selector: "#response-trigger"
          }
        }
      })
    );

    const responseTimeoutResult = await responseSession.settle({
      type: "response",
      timeout_ms: 120,
      target: {
        url: "/api/mock-response"
      },
      method: "GET",
      status: 204
    });

    assert.equal(responseTimeoutResult.status, "timeout");
    assert.equal(responseTimeoutResult.strategy, "response");
    assert.equal(responseTimeoutResult.details?.status, 204);
    assert.equal(responseTimeoutResult.details?.method, "GET");
    assert.equal(responseTimeoutResult.details?.timeoutMs, 120);

    const { formUrl } = await createFixtureSite(fixtureRoot);
    itemCountSession = await browserFactory.createSession({
      runId: "run-playwright-item-count-timeout",
      plan: createPlaywrightPlan(formUrl)
    });

    await executeGotoStep(itemCountSession, formUrl, "step_open_item_count_form", "open item-count timeout fixture");

    await itemCountSession.execute(
      {
        type: "click",
        target: {
          selector: "#item-count-trigger"
        }
      },
      createStep({
        step_id: "step_trigger_item_count_timeout",
        stage: "VALUE",
        description: "trigger delayed list growth",
        action: {
          type: "click",
          target: {
            selector: "#item-count-trigger"
          }
        }
      })
    );

    const itemCountTimeoutResult = await itemCountSession.settle({
      type: "item_count_change",
      timeout_ms: 120,
      target: {
        selector: "#item-count-list li"
      },
      expected_count: 4,
      count_delta: 3
    });

    assert.equal(itemCountTimeoutResult.status, "timeout");
    assert.equal(itemCountTimeoutResult.strategy, "item_count_change");
    assert.equal(itemCountTimeoutResult.details?.baselineCount, 1);
    assert.equal(itemCountTimeoutResult.details?.currentCount, 1);
    assert.equal(itemCountTimeoutResult.details?.expectedCount, 4);
    assert.equal(itemCountTimeoutResult.details?.countDelta, 3);
    assert.equal(itemCountTimeoutResult.details?.timeoutMs, 120);
  } finally {
    await responseSession?.close();
    await itemCountSession?.close();
    await fixtureServer.close();
    await rm(fixtureRoot, { recursive: true, force: true });
    await rm(artifactsRoot, { recursive: true, force: true });
  }
});

test("[아티팩트 저장] 실제 Playwright screenshot/DOM artifact를 png/html metadata와 파일 내용으로 저장한다", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "wedge-runner-playwright-site-"));
  const artifactsRoot = await mkdtemp(join(tmpdir(), "wedge-runner-playwright-artifacts-"));
  let session: Awaited<ReturnType<ReturnType<typeof createPlaywrightSessionFactory>["createSession"]>> | undefined;

  try {
    const { formUrl } = await createFixtureSite(fixtureRoot);
    const plan = createPlaywrightPlan(formUrl);
    const config = createPlaywrightConfig(artifactsRoot);
    const browserFactory = createPlaywrightSessionFactory(config);
    const capturePipeline = createCapturePipeline();
    const artifactStore = createArtifactStore(config);

    session = await browserFactory.createSession({
      runId: "run-playwright-artifacts",
      plan
    });

    await executeGotoStep(session, formUrl, "step_open_fixture");

    const step = createStep({
      step_id: "step_checkpoint_fixture",
      stage: "FIRST_VIEW",
      description: "capture checkpoint artifacts",
      action: {
        type: "checkpoint"
      },
      checkpoint: true
    });
    const capturedArtifacts = await session.captureArtifacts();
    const collection = await capturePipeline.collectCheckpoint({
      step,
      stepOrder: 1,
      plan,
      pageSnapshot: session.snapshot(),
      settleResult: {
        strategy: "none",
        durationMs: 0,
        status: "settled"
      },
      capturedArtifacts
    });
    const storedArtifacts = await artifactStore.persistArtifacts({
      runId: "run-playwright-artifacts",
      artifacts: collection.artifacts
    });

    const screenshotArtifact = storedArtifacts.find((artifact) => artifact.artifactType === "SCREENSHOT");
    const domArtifact = storedArtifacts.find((artifact) => artifact.artifactType === "DOM_SNAPSHOT");

    assert.ok(screenshotArtifact);
    assert.equal(screenshotArtifact?.mimeType, "image/png");
    assert.equal(screenshotArtifact?.key.endsWith(".png"), true);
    assert.ok((screenshotArtifact?.sizeBytes ?? 0) > 0);

    assert.ok(domArtifact);
    assert.equal(domArtifact?.mimeType, "text/html");
    assert.equal(domArtifact?.key.endsWith(".html"), true);
    assert.ok((domArtifact?.sizeBytes ?? 0) > 0);

    const screenshotFile = await readFile(join(artifactsRoot, ...(screenshotArtifact?.key.split("/") ?? [])));
    const domFile = await readFile(join(artifactsRoot, ...(domArtifact?.key.split("/") ?? [])), "utf8");

    assert.deepEqual(screenshotFile.subarray(0, 8), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    assert.ok(domFile.includes("Runner Playwright Form"));
    assert.ok(domFile.includes("Continue"));
  } finally {
    await session?.close();
    await rm(fixtureRoot, { recursive: true, force: true });
    await rm(artifactsRoot, { recursive: true, force: true });
  }
});

async function createResponseFixtureServer(): Promise<{ formUrl: string; close: () => Promise<void> }> {
  const server = createServer((request, response) => {
    void handleResponseFixtureRequest(request, response);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Unable to resolve response fixture server address");
  }

  return {
    formUrl: `http://127.0.0.1:${address.port}/response-form.html`,
    close: async () => {
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
  };
}

async function createImmediateResponseFixtureServer(): Promise<{ formUrl: string; close: () => Promise<void> }> {
  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");

    if (requestUrl.pathname === "/immediate-response-form.html") {
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8"
      });
      response.end(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Runner Immediate Response</title>
  </head>
  <body>
    <main>
      <h1>Runner Immediate Response</h1>
      <button id="response-trigger" type="button">Load immediate response</button>
      <div id="response-status">Waiting response</div>
    </main>
    <script>
      const responseTrigger = document.getElementById("response-trigger");
      const responseStatus = document.getElementById("response-status");

      responseTrigger?.addEventListener("click", async () => {
        const response = await fetch("/api/immediate-response");
        const payload = await response.json();

        if (responseStatus) {
          responseStatus.textContent = payload.message;
        }

        document.body.dataset.responseState = "done";
      });
    </script>
  </body>
</html>`);
      return;
    }

    if (requestUrl.pathname === "/api/immediate-response") {
      response.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store"
      });
      response.end(JSON.stringify({ ok: true, message: "Immediate response ready" }));
      return;
    }

    response.writeHead(404, {
      "content-type": "text/plain; charset=utf-8"
    });
    response.end("Not found");
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Unable to resolve immediate response fixture server address");
  }

  return {
    formUrl: `http://127.0.0.1:${address.port}/immediate-response-form.html`,
    close: async () => {
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
  };
}

async function executeRealAgentTask({
  task,
  artifactsRoot
}: {
  task: AgentTask;
  artifactsRoot: string;
}) {
  const config = createPlaywrightConfig(artifactsRoot, { useVisualEnv: true });
  const browserFactory = createPlaywrightSessionFactory(config);
  const capturePipeline = createCapturePipeline();
  const artifactStore = createArtifactStore(config);
  const traceArtifacts: Artifact[] = [];
  const agentEvents: AgentEvent[] = [];
  const agentTraces: AgentTraceCallbackPayload[] = [];

  const worker = registerAgentWorker({
    config,
    browserFactory,
    callbackClient: createStubCallbackClient({
      sendArtifacts: async (_callbackRunId, payload) => {
        traceArtifacts.push(...payload.artifacts.filter((artifact) => artifact.artifactType === "TRACE"));
      },
      sendAgentEvents: async (_callbackRunId, payload) => {
        agentEvents.push(...payload.events);
      },
      sendAgentTrace: async (_callbackRunId, payload) => {
        agentTraces.push(payload);
      }
    }),
    capturePipeline,
    artifactStore
  });

  const execution = await worker.handleMessage({
    messageId: "00000000-0000-4000-8000-000000001001",
    messageType: "agent.execute.request",
    schemaVersion: "0.1",
    createdAt: "2026-05-07T00:00:00.000Z",
    producer: "runner-test",
    idempotencyKey: task.idempotency_key,
    payload: {
      agentTask: task
    }
  });

  const actionCompletedTargets = agentEvents
    .filter((event) => event.eventType === "ACTION_COMPLETED")
    .map((event) => (event.payload as { targetKey?: string }).targetKey);

  for (const artifact of traceArtifacts) {
    const traceJson = await readFile(join(artifactsRoot, ...artifact.key.split("/")), "utf8");
    assert.match(traceJson, /"outcome"/);
  }

  return {
    execution,
    snapshot: {
      finalUrl: execution.trace.turns.at(-1)?.actionResult?.finalUrl ?? task.start_url
    },
    actionCompletedTargets,
    agentEvents,
    agentTraces,
    traceArtifacts
  };
}

async function executeRealScenarioPlan({
  runId,
  plan,
  artifactsRoot
}: {
  runId: string;
  plan: ScenarioPlan;
  artifactsRoot: string;
}) {
  const config = createPlaywrightConfig(artifactsRoot, { useVisualEnv: true });
  const browserFactory = createPlaywrightSessionFactory(config);
  const capturePipeline = createCapturePipeline();
  const artifactStore = createArtifactStore(config);
  const checkpointStepKeys: string[] = [];
  const checkpoints: Checkpoint[] = [];
  const domSnapshotKeys: string[] = [];
  const session = await browserFactory.createSession({ runId, plan });

  try {
    const execution = await executeScenario({
      runId,
      plan,
      session,
      callbackClient: createStubCallbackClient({
        sendArtifacts: async (_callbackRunId, payload) => {
          domSnapshotKeys.push(
            ...payload.artifacts
              .filter((artifact) => artifact.artifactType === "DOM_SNAPSHOT")
              .map((artifact) => artifact.key)
          );
        },
        sendCheckpoints: async (_callbackRunId, payload) => {
          checkpointStepKeys.push(...payload.checkpoints.map((checkpoint) => checkpoint.stepKey));
          checkpoints.push(...payload.checkpoints);
        }
      }),
      capturePipeline,
      artifactStore
    });
    const snapshot = session.snapshot();
    const domSnapshots = await Promise.all(
      domSnapshotKeys.map((key) => readFile(join(artifactsRoot, ...key.split("/")), "utf8"))
    );

    return {
      execution,
      snapshot,
      checkpointStepKeys,
      checkpoints,
      domSnapshots
    };
  } finally {
    await session.close();
  }
}

function createPlaywrightConfig(artifactsRoot: string, options: { useVisualEnv?: boolean } = {}) {
  const browserHeadless = options.useVisualEnv
    ? resolveEnvBoolean(process.env.RUNNER_BROWSER_HEADLESS, true)
    : true;
  const playwrightSlowMoMs = options.useVisualEnv
    ? resolveEnvNumber(process.env.RUNNER_PLAYWRIGHT_SLOW_MO_MS, 0)
    : 0;

  return createRunnerTestConfig({
    browserMode: "playwright",
    artifactsRoot,
    callbackLogFile: join(artifactsRoot, "callbacks.jsonl"),
    browserHeadless,
    browserLaunchTimeoutMs: 45_000,
    browserNavigationTimeoutMs: 10_000,
    playwrightSlowMoMs
  });
}

function resolveEnvBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }

  if (value === "1" || value.toLowerCase() === "true" || value.toLowerCase() === "yes") {
    return true;
  }

  if (value === "0" || value.toLowerCase() === "false" || value.toLowerCase() === "no") {
    return false;
  }

  return fallback;
}

function resolveEnvNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function findCheckpoint(checkpoints: Checkpoint[], stepKey: string): Checkpoint {
  const checkpoint = checkpoints.find((candidate) => candidate.stepKey === stepKey);
  assert.ok(checkpoint, `Expected checkpoint for stepKey=${stepKey}`);
  return checkpoint;
}

function findObservation(checkpoint: Checkpoint, type: string): Record<string, unknown> {
  const observation = checkpoint.observations.find((candidate) => candidate.type === type);
  assert.ok(observation, `Expected ${type} observation in checkpoint=${checkpoint.stepKey}`);
  return observation;
}

function readRecordArray(source: Record<string, unknown>, key: string): Record<string, unknown>[] {
  const value = source[key];
  assert.ok(Array.isArray(value), `Expected ${key} to be an array`);
  return value.filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null && !Array.isArray(entry));
}

function readPositiveNumber(source: unknown, key: string): number {
  assert.ok(typeof source === "object" && source !== null && !Array.isArray(source), `Expected source for ${key} to be an object`);
  const value = (source as Record<string, unknown>)[key];
  assert.equal(typeof value, "number", `Expected ${key} to be numeric`);
  assert.ok(Number.isFinite(value), `Expected ${key} to be finite`);
  return value as number;
}

function readString(source: unknown, key: string): string | undefined {
  if (typeof source !== "object" || source === null || Array.isArray(source)) {
    return undefined;
  }

  const value = (source as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

function createPlaywrightBrowserFactory(artifactsRoot: string) {
  return createPlaywrightSessionFactory(createPlaywrightConfig(artifactsRoot));
}

async function createFixtureSite(root: string): Promise<{ formUrl: string; doneUrl: string }> {
  const formFile = join(root, "form.html");
  const doneFile = join(root, "done.html");

  await writeFile(
    formFile,
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Runner Playwright Form</title>
  </head>
  <body>
    <main>
      <h1>Runner Playwright Form</h1>
      <form>
        <label for="email">Email</label>
        <input id="email" name="email" type="email" />

        <label for="plan">Plan</label>
        <select id="plan" name="plan">
          <option value="">Choose a plan</option>
          <option value="starter">Starter</option>
          <option value="pro">Pro</option>
        </select>
      </form>

      <a href="./done.html">Continue</a>

      <section id="hover-area">
        <button id="hover-target" type="button">Hover for async result</button>
        <div id="hover-result" hidden>Pending hover</div>
      </section>

      <section id="settle-area">
        <button id="settle-visible-trigger" type="button">Reveal delayed content</button>
        <div id="settle-visible" hidden>Visible after settle</div>

        <button id="settle-spinner-trigger" type="button">Hide delayed spinner</button>
        <div id="settle-spinner" hidden>Loading delayed state</div>

        <button id="settle-hash-trigger" type="button">Change hash later</button>
        <button id="settle-hash-fast-trigger" type="button">Change hash now</button>
        <div id="never-visible" hidden>Never shown</div>

        <button id="response-trigger" type="button">Simulate delayed response</button>
        <div id="response-status">Waiting response</div>

        <button id="item-count-trigger" type="button">Add delayed list item</button>
        <button id="item-count-fast-trigger" type="button">Add immediate list item</button>
        <ul id="item-count-list">
          <li>Initial item</li>
        </ul>

        <button id="danger-delete-trigger" type="button">Delete account</button>
      </section>

      <div id="scroll-spacer" style="height: 2400px;"></div>
    </main>
    <script>
      const hoverTarget = document.getElementById("hover-target");
      const hoverResult = document.getElementById("hover-result");
      const settleVisibleTrigger = document.getElementById("settle-visible-trigger");
      const settleVisible = document.getElementById("settle-visible");
      const settleSpinnerTrigger = document.getElementById("settle-spinner-trigger");
      const settleSpinner = document.getElementById("settle-spinner");
      const settleHashTrigger = document.getElementById("settle-hash-trigger");
      const settleHashFastTrigger = document.getElementById("settle-hash-fast-trigger");
      const responseTrigger = document.getElementById("response-trigger");
      const responseStatus = document.getElementById("response-status");
      const itemCountTrigger = document.getElementById("item-count-trigger");
      const itemCountFastTrigger = document.getElementById("item-count-fast-trigger");
      const itemCountList = document.getElementById("item-count-list");
      const dangerDeleteTrigger = document.getElementById("danger-delete-trigger");

      hoverTarget?.addEventListener("mouseenter", () => {
        document.body.dataset.hoverState = "hovered";
        window.setTimeout(() => {
          if (hoverResult) {
            hoverResult.hidden = false;
            hoverResult.textContent = "Hover complete";
          }
        }, 120);
      });

      settleVisibleTrigger?.addEventListener("click", () => {
        window.setTimeout(() => {
          if (settleVisible) {
            settleVisible.hidden = false;
            document.body.dataset.locatorVisible = "done";
          }
        }, 120);
      });

      settleSpinnerTrigger?.addEventListener("click", () => {
        if (settleSpinner) {
          settleSpinner.hidden = false;
        }

        window.setTimeout(() => {
          if (settleSpinner) {
            settleSpinner.hidden = true;
            document.body.dataset.spinnerHidden = "done";
          }
        }, 120);
      });

      settleHashTrigger?.addEventListener("click", () => {
        window.setTimeout(() => {
          document.body.dataset.urlChange = "done";
          window.location.hash = "settled";
        }, 120);
      });

      settleHashFastTrigger?.addEventListener("click", () => {
        document.body.dataset.urlChange = "done-fast";
        window.location.hash = "settled-fast";
      });

      responseTrigger?.addEventListener("click", () => {
        window.setTimeout(() => {
          if (responseStatus) {
            responseStatus.textContent = "Response ready";
            document.body.dataset.responseState = "done";
          }
        }, 220);
      });

      itemCountTrigger?.addEventListener("click", () => {
        window.setTimeout(() => {
          if (itemCountList) {
            const nextItem = document.createElement("li");
            nextItem.textContent = "Delayed item";
            itemCountList.appendChild(nextItem);
            document.body.dataset.itemCountState = "done";
          }
        }, 220);
      });

      itemCountFastTrigger?.addEventListener("click", () => {
        if (itemCountList) {
          const nextItem = document.createElement("li");
          nextItem.textContent = "Immediate item";
          itemCountList.appendChild(nextItem);
          document.body.dataset.itemCountState = "done-fast";
        }
      });

      dangerDeleteTrigger?.addEventListener("click", () => {
        document.body.dataset.destructiveClicked = "true";
      });
    </script>
  </body>
</html>`,
    "utf8"
  );

  await writeFile(
    doneFile,
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Runner Done</title>
  </head>
  <body>
    <main>
      <h1>Runner Done</h1>
      <p>Finished real Playwright navigation.</p>
    </main>
  </body>
</html>`,
    "utf8"
  );

  return {
    formUrl: pathToFileURL(formFile).toString(),
    doneUrl: pathToFileURL(doneFile).toString()
  };
}

async function createAgentCheckoutFixtureSite(root: string): Promise<{ productUrl: string }> {
  const productFile = join(root, "product.html");
  const cartFile = join(root, "cart.html");
  const checkoutFile = join(root, "checkout.html");

  await writeFile(
    productFile,
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Agent Product Fixture</title>
  </head>
  <body>
    <main>
      <h1>Agent Checkout Smoke Product</h1>
      <a id="learn-more" href="#details">Learn more</a>
      <button id="add-to-cart" type="button">Add to cart</button>
      <a id="cart-link" href="./cart.html" hidden>View cart</a>
      <section id="details" style="margin-top: 1200px;">Product details</section>
    </main>
    <script>
      document.getElementById("add-to-cart")?.addEventListener("click", () => {
        document.body.dataset.addedToCart = "true";
        document.getElementById("cart-link")?.removeAttribute("hidden");
      });
    </script>
  </body>
</html>`,
    "utf8"
  );

  await writeFile(
    cartFile,
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Cart</title>
  </head>
  <body>
    <main>
      <h1>Cart</h1>
      <p>Smoke product is ready for checkout.</p>
      <a id="checkout-link" href="./checkout.html">Proceed to checkout</a>
    </main>
  </body>
</html>`,
    "utf8"
  );

  await writeFile(
    checkoutFile,
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Checkout</title>
  </head>
  <body>
    <main>
      <h1>Checkout</h1>
      <label for="card-number">Card number</label>
      <input id="card-number" placeholder="Card number" />
      <button id="pay-now" type="button">Pay now</button>
    </main>
    <script>
      document.getElementById("pay-now")?.addEventListener("click", () => {
        document.body.dataset.paymentCommitted = "true";
      });
    </script>
  </body>
</html>`,
    "utf8"
  );

  return {
    productUrl: pathToFileURL(productFile).toString()
  };
}

async function createAgentBlockerFixtureSite(
  root: string,
  input: {
    fileName: string;
    title: string;
    heading: string;
    body: string;
  }
): Promise<{ blockerUrl: string }> {
  const blockerFile = join(root, input.fileName);

  await writeFile(
    blockerFile,
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${input.title}</title>
  </head>
  <body>
    <main>
      <h1>${input.heading}</h1>
      <p>${input.body}</p>
      <button id="blocked-action" type="button">Continue</button>
    </main>
  </body>
</html>`,
    "utf8"
  );

  return {
    blockerUrl: pathToFileURL(blockerFile).toString()
  };
}

async function createAgentIframePaymentFixtureSite(root: string): Promise<{ checkoutUrl: string }> {
  const checkoutFile = join(root, "iframe-checkout.html");

  await writeFile(
    checkoutFile,
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Checkout with iframe payment</title>
  </head>
  <body>
    <main>
      <h1>Checkout</h1>
      <p>Payment is embedded below.</p>
      <iframe
        id="payment-frame"
        title="Payment frame"
        srcdoc='<!doctype html><html lang="en"><body><main><h2>Payment</h2><button id="pay-now" type="button">Pay now</button></main><script>document.getElementById("pay-now")?.addEventListener("click", () => { document.body.dataset.paymentCommitted = "true"; });</script></body></html>'>
      </iframe>
    </main>
  </body>
</html>`,
    "utf8"
  );

  return {
    checkoutUrl: pathToFileURL(checkoutFile).toString()
  };
}

async function createAgentShadowPaymentFixtureSite(root: string): Promise<{ checkoutUrl: string }> {
  const checkoutFile = join(root, "shadow-checkout.html");

  await writeFile(
    checkoutFile,
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Checkout with shadow payment</title>
  </head>
  <body>
    <main>
      <h1>Checkout</h1>
      <p>Payment is rendered by a web component.</p>
      <payment-panel></payment-panel>
    </main>
    <script>
      customElements.define("payment-panel", class extends HTMLElement {
        connectedCallback() {
          const root = this.attachShadow({ mode: "open" });
          root.innerHTML = '<section><h2>Payment</h2><button id="pay-now" type="button">Pay now</button></section>';
          root.getElementById("pay-now")?.addEventListener("click", () => {
            document.body.dataset.paymentCommitted = "true";
          });
        }
      });
    </script>
  </body>
</html>`,
    "utf8"
  );

  return {
    checkoutUrl: pathToFileURL(checkoutFile).toString()
  };
}

async function createAgentIframeReplayFixtureSite(root: string): Promise<{ frameUrl: string }> {
  const frameFile = join(root, "iframe-replay.html");

  await writeFile(
    frameFile,
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Iframe replay fixture</title>
  </head>
  <body>
    <main>
      <h1>Support flow</h1>
      <p>The safe continuation button is embedded in an iframe.</p>
      <iframe
        id="support-frame"
        title="Support frame"
        srcdoc='<!doctype html><html lang="en"><body><main><h2>Support</h2><button id="continue-frame" type="button">Continue in frame</button><script>document.getElementById("continue-frame")?.addEventListener("click", () => { document.body.dataset.frameContinued = "true"; });</script></main></body></html>'>
      </iframe>
    </main>
  </body>
</html>`,
    "utf8"
  );

  return {
    frameUrl: pathToFileURL(frameFile).toString()
  };
}

async function createAgentExternalCheckoutFixtureServer(): Promise<{
  productUrl: string;
  checkoutOrigin: string;
  close: () => Promise<void>;
}> {
  let checkoutOrigin = "";

  const checkoutServer = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");

    if (requestUrl.pathname === "/session") {
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8"
      });
      response.end(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Checkout Redirect Session</title>
  </head>
  <body>
    <main>
      <h1>Checkout</h1>
      <p>External checkout session is ready.</p>
      <button id="pay-now" type="button">Pay now</button>
    </main>
  </body>
</html>`);
      return;
    }

    response.writeHead(404, {
      "content-type": "text/plain; charset=utf-8"
    });
    response.end("Not found");
  });

  await listenOnLocalhost(checkoutServer);
  checkoutOrigin = serverOrigin(checkoutServer);

  const storefrontServer = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");

    if (requestUrl.pathname === "/product") {
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8"
      });
      response.end(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>External Product Fixture</title>
  </head>
  <body>
    <main>
      <h1>External product fixture</h1>
      <button id="add-to-cart" type="button">Add to cart</button>
      <a id="cart-link" href="/cart" hidden>View cart</a>
    </main>
    <script>
      document.getElementById("add-to-cart")?.addEventListener("click", () => {
        document.getElementById("cart-link")?.removeAttribute("hidden");
      });
    </script>
  </body>
</html>`);
      return;
    }

    if (requestUrl.pathname === "/cart") {
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8"
      });
      response.end(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Cart</title>
  </head>
  <body>
    <main>
      <h1>Cart</h1>
      <a id="external-checkout-link" href="${checkoutOrigin}/session">Proceed to checkout</a>
    </main>
  </body>
</html>`);
      return;
    }

    response.writeHead(404, {
      "content-type": "text/plain; charset=utf-8"
    });
    response.end("Not found");
  });

  try {
    await listenOnLocalhost(storefrontServer);
  } catch (error) {
    await closeServer(checkoutServer);
    throw error;
  }

  return {
    productUrl: `${serverOrigin(storefrontServer)}/product`,
    checkoutOrigin,
    close: async () => {
      await Promise.all([
        closeServer(storefrontServer),
        closeServer(checkoutServer)
      ]);
    }
  };
}

async function listenOnLocalhost(server: ReturnType<typeof createServer>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function serverOrigin(server: ReturnType<typeof createServer>): string {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Unable to resolve fixture server address");
  }

  return `http://127.0.0.1:${address.port}`;
}

function readPngDimensions(buffer: Buffer): { width: number; height: number } {
  assert.deepEqual(
    buffer.subarray(0, 8),
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  );

  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20)
  };
}

async function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
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

function createReplayHintOnlyCheckoutTrace(task: AgentTask, productUrl: string): AgentTrace {
  const cartUrl = new URL("./cart.html", productUrl).toString();
  const checkoutUrl = new URL("./checkout.html", productUrl).toString();

  return {
    schema_version: "0.1",
    task_id: task.task_id,
    attempt_id: task.attempt_id,
    attempt_index: task.attempt_index,
    run_id: task.run_id,
    outcome: {
      status: "SUCCESS",
      reason: "Checkout entry reached before payment commit."
    },
    turns: [
      replayTurn({
        turn: 1,
        description: "Open product page",
        targetKey: productUrl,
        action: {
          type: "goto",
          target: {
            url: productUrl
          }
        },
        finalUrl: productUrl,
        stage: "FIRST_VIEW"
      }),
      replayTurn({
        turn: 2,
        description: "Click add to cart via replay hint",
        targetKey: "stale:add-to-cart",
        action: {
          type: "click",
          target: {
            selector: "#stale-add-to-cart"
          },
          options: {
            replay_hint: {
              candidate_fingerprint: "candidate:addtocart000001",
              locator_recipe: [
                {
                  strategy: "role_text",
                  role: "button",
                  text: "Add to cart",
                  confidence: 0.84
                },
                {
                  strategy: "tag_text",
                  tag: "button",
                  text: "Add to cart",
                  confidence: 0.62
                }
              ]
            }
          }
        },
        finalUrl: productUrl,
        stage: "CTA"
      }),
      replayTurn({
        turn: 3,
        description: "Open cart via replay hint",
        targetKey: "stale:cart-link",
        action: {
          type: "click",
          target: {
            selector: "#stale-cart-link"
          },
          options: {
            replay_hint: {
              candidate_fingerprint: "candidate:cartlink000000",
              locator_recipe: [
                {
                  strategy: "role_text",
                  role: "link",
                  text: "View cart",
                  confidence: 0.84
                },
                {
                  strategy: "href",
                  href: cartUrl,
                  confidence: 0.72
                }
              ]
            }
          }
        },
        finalUrl: cartUrl,
        stage: "CTA"
      }),
      replayTurn({
        turn: 4,
        description: "Open checkout via replay hint",
        targetKey: "stale:checkout-link",
        action: {
          type: "click",
          target: {
            selector: "#stale-checkout-link"
          },
          options: {
            replay_hint: {
              candidate_fingerprint: "candidate:checkout000000",
              locator_recipe: [
                {
                  strategy: "role_text",
                  role: "link",
                  text: "Proceed to checkout",
                  confidence: 0.84
                },
                {
                  strategy: "href",
                  href: checkoutUrl,
                  confidence: 0.72
                }
              ]
            }
          }
        },
        finalUrl: checkoutUrl,
        stage: "COMMIT",
        terminal: true
      })
    ]
  };
}

function replayTurn(input: {
  turn: number;
  description: string;
  targetKey: string;
  action: ScenarioAction;
  finalUrl: string;
  stage: ScenarioStage;
  terminal?: boolean;
}): AgentTrace["turns"][number] {
  return {
    turn: input.turn,
    observation: {
      finalUrl: input.finalUrl,
      title: "Agent export replay fixture",
      candidateCount: 1
    },
    preDecisionVerification: {
      satisfied: false,
      terminal: false,
      outcome: "CONTINUE",
      reason: "continue",
      confidence: 0.5,
      phase: "pre_decision"
    },
    decision: {
      kind: "act",
      description: input.description,
      reason: "replay hint fallback smoke",
      confidence: 0.9,
      action: input.action,
      settleStrategy: {
        type: "fixed_short",
        timeout_ms: 100
      },
      stage: input.stage,
      targetKey: input.targetKey
    },
    policy: {
      allowed: true,
      riskClass: input.stage === "COMMIT" ? "CHECKOUT_NAVIGATION" : "LOW",
      reason: "allowed"
    },
    actionResult: {
      actionType: input.action.type,
      finalUrl: input.finalUrl,
      completed: true
    },
    postActionVerification: {
      satisfied: input.terminal === true,
      terminal: input.terminal === true,
      outcome: input.terminal === true ? "SUCCESS" : "CONTINUE",
      reason: input.terminal === true ? "checkout reached" : "continue",
      confidence: 0.8,
      phase: "post_action"
    }
  };
}

function createAgentCheckoutTask(startUrl: string): AgentTask {
  return {
    schema_version: "0.1",
    task_id: "00000000-0000-4000-8000-000000001101",
    attempt_id: "00000000-0000-4000-8000-000000001102",
    attempt_index: 1,
    idempotency_key: "agent-checkout-smoke",
    run_id: "00000000-0000-4000-8000-000000001103",
    project_id: "00000000-0000-4000-8000-000000001104",
    goal_type: "CHECKOUT_ENTRY_VERIFICATION",
    goal: "Find the checkout entry path without submitting payment or final order.",
    start_url: startUrl,
    environment: {
      device: "desktop",
      viewport: {
        width: 1440,
        height: 900
      },
      locale: "ko-KR",
      timezone: "Asia/Seoul",
      auth_state: "anonymous"
    },
    budget: {
      max_steps: 6,
      max_duration_ms: 120_000,
      max_recovery_attempts: 1,
      max_same_page_attempts: 2,
      max_external_redirects: 0
    },
    allowed_navigation: {
      allow_external_navigation: false,
      allowed_origins: [],
      allowed_checkout_redirect_origins: []
    },
    product_selection_policy: {
      mode: "PROVIDED_OR_OBVIOUS_ONLY",
      provided_product_url: startUrl,
      required_option_strategy: "FIRST_AVAILABLE",
      allow_quantity_change: false,
      max_add_to_cart_attempts: 1
    },
    risk_policy: {
      allow_checkout_navigation: true,
      allow_cart_mutation: true,
      allow_shipping_form_entry: true,
      allow_payment_info_entry: false,
      allow_final_payment_submit: false,
      allow_final_order_commit: false,
      allow_destructive_action: false,
      allow_external_message_send: false
    },
    artifact_policy: {
      capture_screenshots: false,
      capture_dom_snapshots: false,
      capture_ax_tree: false,
      capture_trace: true
    }
  };
}

async function createMvpFixtureSite(root: string): Promise<{ homeUrl: string; checkoutUrl: string }> {
  const homeFile = join(root, "mvp-home.html");
  const checkoutFile = join(root, "checkout.html");

  await writeFile(
    homeFile,
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>MVP Runner Fixture</title>
  </head>
  <body>
    <main>
      <section id="hero">
        <h1>MVP Runner Fixture</h1>
        <p>Landing CTA, signup form, and pricing checkout coverage.</p>
        <a id="hero-cta" href="#signup-form">Start free</a>
      </section>

      <section id="signup-form" style="margin-top: 960px;">
        <h2>Start your trial</h2>
        <form>
          <label for="work-email">Work email</label>
          <input id="work-email" name="email" type="email" placeholder="Work email" />

          <label for="company">Company</label>
          <input id="company" name="company" type="text" placeholder="Company" />

          <label for="plan">Plan</label>
          <select id="plan" name="plan" aria-label="Plan">
            <option value="">Choose a plan</option>
            <option value="starter">Starter</option>
            <option value="pro">Pro</option>
          </select>

          <button id="submit-signup" type="button">Create account</button>
        </form>
      </section>

      <section id="pricing" style="margin-top: 960px;">
        <h2>Pricing</h2>
        <article class="plan-card">
          <h3>Starter</h3>
          <p>$19 / month</p>
          <a id="starter-plan" href="./checkout.html">Choose Starter</a>
        </article>
      </section>
    </main>
    <script>
      const signupButton = document.getElementById("submit-signup");
      signupButton?.addEventListener("click", () => {
        document.body.dataset.formSubmitted = "true";
      });
    </script>
  </body>
</html>`,
    "utf8"
  );

  await writeFile(
    checkoutFile,
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>MVP Checkout Entry</title>
  </head>
  <body>
    <main>
      <h1>Checkout entry</h1>
      <form id="payment-method">
        <label for="card-number">Card number</label>
        <input id="card-number" name="card-number" placeholder="Card number" />
        <button id="pay-now" type="button">Pay now</button>
      </form>
    </main>
    <script>
      const payNow = document.getElementById("pay-now");
      payNow?.addEventListener("click", () => {
        document.body.dataset.paymentCommitted = "true";
      });
    </script>
  </body>
</html>`,
    "utf8"
  );

  return {
    homeUrl: pathToFileURL(homeFile).toString(),
    checkoutUrl: pathToFileURL(checkoutFile).toString()
  };
}

function createPlaywrightPlan(startUrl: string): ScenarioPlan {
  return {
    ...createMinimalPlan(),
    start_url: startUrl
  };
}

function createMvpPlan(startUrl: string, templateKey: string, goal: string, steps: ScenarioStep[]): ScenarioPlan {
  return {
    ...createPlaywrightPlan(startUrl),
    plan_id: `mvp_${templateKey}`,
    scenario_type: "template",
    template_key: templateKey,
    goal,
    safety: {
      allow_external_navigation: false,
      allow_payment_commit: false,
      allow_destructive_action: false,
      use_synthetic_inputs: true,
      stop_before_real_payment: true
    },
    steps
  };
}

function createAgentIframeReplayPlan(startUrl: string): ScenarioPlan {
  return createMvpPlan(startUrl, "agent-frame-replay", "iframe 내부 replay 후보를 안전하게 실행", [
    createStep({
      step_id: "agent_frame_replay_001_goto",
      stage: "FIRST_VIEW",
      description: "iframe replay fixture 진입",
      action: {
        type: "goto",
        target: {
          url: startUrl
        }
      },
      checkpoint: true
    }),
    createStep({
      step_id: "agent_frame_replay_002_click",
      stage: "NAVIGATION",
      description: "replay_hint frame_id 후보 클릭",
      action: {
        type: "click",
        target: {
          selector: "#missing-frame-button"
        },
        options: {
          replay_hint: {
            selected_index: 0,
            locator_recipe: [
              {
                strategy: "selector",
                selector: "#continue-frame",
                confidence: 0.95,
                frame_id: "frame:1"
              },
              {
                strategy: "role_text",
                role: "button",
                text: "Continue in frame",
                confidence: 0.9,
                frame_id: "frame:1"
              }
            ]
          }
        }
      },
      settle_strategy: {
        type: "fixed_short",
        timeout_ms: 100
      }
    }),
    createStep({
      step_id: "agent_frame_replay_003_checkpoint",
      stage: "ASSERT",
      description: "frame replay checkpoint",
      action: {
        type: "checkpoint"
      },
      checkpoint: true
    }),
    createStep({
      step_id: "agent_frame_replay_004_stop",
      stage: "COMMIT",
      description: "before_real_submit",
      action: {
        type: "stop_when"
      },
      stop_condition: {
        condition: "before_real_submit"
      }
    })
  ]);
}

function createMvpLandingCtaPlan(startUrl: string): ScenarioPlan {
  return createMvpPlan(startUrl, "landing-cta", "첫 화면 CTA가 다음 행동으로 이어지는지 확인", [
    createStep({
      step_id: "landing_001_goto",
      stage: "FIRST_VIEW",
      description: "대상 URL 진입",
      action: {
        type: "goto",
        target: {
          url: startUrl
        }
      },
      settle_strategy: {
        type: "network_idle",
        timeout_ms: 3_000
      },
      checkpoint: true
    }),
    createStep({
      step_id: "landing_002_first_view_checkpoint",
      stage: "FIRST_VIEW",
      description: "첫 화면 checkpoint",
      action: {
        type: "checkpoint"
      },
      checkpoint: true
    }),
    createStep({
      step_id: "landing_003_click_primary_cta",
      stage: "CTA",
      description: "primary CTA 클릭",
      action: {
        type: "click",
        target: {
          role: "link",
          text_any: ["Start free", "Get started"]
        }
      },
      settle_strategy: {
        type: "url_change",
        timeout_ms: 1_000,
        target: {
          url: "#signup-form"
        }
      }
    }),
    createStep({
      step_id: "landing_004_wait_for_cta_destination",
      stage: "CTA",
      description: "CTA 도착 영역 대기",
      action: {
        type: "wait_for",
        target: {
          selector: "#signup-form"
        },
        options: {
          state: "visible",
          timeout_ms: 1_000
        }
      }
    }),
    createStep({
      step_id: "landing_005_cta_destination_checkpoint",
      stage: "CTA",
      description: "CTA 클릭 후 도착 상태 checkpoint",
      action: {
        type: "checkpoint"
      },
      checkpoint: true
    })
  ]);
}

function createMvpSignupFormPlan(startUrl: string): ScenarioPlan {
  return createMvpPlan(startUrl, "signup-form", "가입/문의 form 도달성과 synthetic input 입력 가능성 확인", [
    createStep({
      step_id: "signup_001_goto",
      stage: "FIRST_VIEW",
      description: "대상 URL 진입",
      action: {
        type: "goto",
        target: {
          url: startUrl
        }
      },
      settle_strategy: {
        type: "network_idle",
        timeout_ms: 3_000
      },
      checkpoint: true
    }),
    createStep({
      step_id: "signup_002_first_view_checkpoint",
      stage: "FIRST_VIEW",
      description: "첫 화면 checkpoint",
      action: {
        type: "checkpoint"
      },
      checkpoint: true
    }),
    createStep({
      step_id: "signup_003_click_signup_cta",
      stage: "CTA",
      description: "가입 CTA 클릭",
      action: {
        type: "click",
        target: {
          href_contains: "#signup-form"
        }
      },
      settle_strategy: {
        type: "url_change",
        timeout_ms: 1_000,
        target: {
          url: "#signup-form"
        }
      }
    }),
    createStep({
      step_id: "signup_004_wait_for_form",
      stage: "INPUT",
      description: "form 노출 대기",
      action: {
        type: "wait_for",
        target: {
          selector: "#signup-form form"
        },
        options: {
          state: "visible",
          timeout_ms: 1_000
        }
      }
    }),
    createStep({
      step_id: "signup_005_fill_email",
      stage: "INPUT",
      description: "synthetic email 입력",
      action: {
        type: "fill",
        target: {
          placeholder_any: ["Work email", "Email"]
        },
        value: "test+wedge@example.com"
      }
    }),
    createStep({
      step_id: "signup_006_fill_company",
      stage: "INPUT",
      description: "synthetic company 입력",
      action: {
        type: "fill",
        target: {
          name: "company"
        },
        value: "Wedge Test Company"
      }
    }),
    createStep({
      step_id: "signup_007_select_plan",
      stage: "INPUT",
      description: "plan dropdown 선택",
      action: {
        type: "select",
        target: {
          label: "Plan"
        },
        value: "starter"
      }
    }),
    createStep({
      step_id: "signup_008_submit_ready_checkpoint",
      stage: "INPUT",
      description: "submit 직전 checkpoint",
      action: {
        type: "checkpoint"
      },
      checkpoint: true
    }),
    createStep({
      step_id: "signup_009_stop_before_submit",
      stage: "COMMIT",
      description: "실제 가입 제출 전 중지",
      action: {
        type: "stop_when"
      },
      stop_condition: {
        url_includes: "#signup-form"
      }
    })
  ]);
}

function createMvpPricingCheckoutPlan(startUrl: string): ScenarioPlan {
  return createMvpPlan(startUrl, "pricing-checkout", "가격 영역과 checkout 진입 직전까지 확인", [
    createStep({
      step_id: "pricing_001_goto",
      stage: "FIRST_VIEW",
      description: "대상 URL 진입",
      action: {
        type: "goto",
        target: {
          url: startUrl
        }
      },
      settle_strategy: {
        type: "network_idle",
        timeout_ms: 3_000
      },
      checkpoint: true
    }),
    createStep({
      step_id: "pricing_002_scroll_to_pricing",
      stage: "VALUE",
      description: "pricing 영역으로 스크롤",
      action: {
        type: "scroll",
        value: 2200
      }
    }),
    createStep({
      step_id: "pricing_003_wait_for_pricing",
      stage: "VALUE",
      description: "pricing card 노출 대기",
      action: {
        type: "wait_for",
        target: {
          selector: "#pricing .plan-card"
        },
        options: {
          state: "visible",
          timeout_ms: 1_000
        }
      }
    }),
    createStep({
      step_id: "pricing_004_pricing_checkpoint",
      stage: "VALUE",
      description: "가격 영역 checkpoint",
      action: {
        type: "checkpoint"
      },
      checkpoint: true
    }),
    createStep({
      step_id: "pricing_005_click_plan_cta",
      stage: "CTA",
      description: "plan CTA 클릭",
      action: {
        type: "click",
        target: {
          role: "link",
          text: "Choose Starter"
        }
      },
      settle_strategy: {
        type: "url_change",
        timeout_ms: 2_000,
        target: {
          url: "checkout.html"
        }
      }
    }),
    createStep({
      step_id: "pricing_006_wait_for_checkout_entry",
      stage: "COMMIT",
      description: "checkout 진입 화면 대기",
      action: {
        type: "wait_for",
        target: {
          selector: "#payment-method"
        },
        options: {
          state: "visible",
          timeout_ms: 1_000
        }
      }
    }),
    createStep({
      step_id: "pricing_007_checkout_entry_checkpoint",
      stage: "COMMIT",
      description: "결제 직전 checkpoint",
      action: {
        type: "checkpoint"
      },
      checkpoint: true
    }),
    createStep({
      step_id: "pricing_008_stop_before_payment",
      stage: "COMMIT",
      description: "실제 결제 전 중지",
      action: {
        type: "stop_when"
      },
      stop_condition: {
        url_includes: "checkout.html"
      }
    })
  ]);
}

function createStep(overrides: Partial<ScenarioStep> & Pick<ScenarioStep, "step_id" | "stage" | "description" | "action">): ScenarioStep {
  return {
    step_id: overrides.step_id,
    stage: overrides.stage,
    description: overrides.description,
    action: overrides.action,
    settle_strategy: overrides.settle_strategy ?? {
      type: "none",
      timeout_ms: 0
    },
    checkpoint: overrides.checkpoint ?? false,
    stop_condition: overrides.stop_condition
  };
}

async function executeGotoStep(
  session: Awaited<ReturnType<ReturnType<typeof createPlaywrightSessionFactory>["createSession"]>>,
  url: string,
  stepId: string = "step_open_form",
  description: string = "open local fixture page"
): Promise<void> {
  await session.execute(
    {
      type: "goto",
      target: {
        url
      }
    },
    createStep({
      step_id: stepId,
      stage: "FIRST_VIEW",
      description,
      action: {
        type: "goto",
        target: {
          url
        }
      }
    })
  );
}

async function handleResponseFixtureRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");

  if (requestUrl.pathname === "/response-form.html") {
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8"
    });
    response.end(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Runner Response Settle</title>
  </head>
  <body>
    <main>
      <h1>Runner Response Settle</h1>
      <button id="response-trigger" type="button">Load delayed response</button>
      <div id="response-status">Waiting response</div>
    </main>
    <script>
      const responseTrigger = document.getElementById("response-trigger");
      const responseStatus = document.getElementById("response-status");

      responseTrigger?.addEventListener("click", async () => {
        const response = await fetch("/api/mock-response?kind=cta");
        const payload = await response.json();

        if (responseStatus) {
          responseStatus.textContent = payload.message;
        }

        document.body.dataset.responseState = "done";
      });
    </script>
  </body>
</html>`);
    return;
  }

  if (requestUrl.pathname === "/api/mock-response") {
    await new Promise((resolve) => setTimeout(resolve, 180));
    response.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    });
    response.end(JSON.stringify({ ok: true, message: "Response ready" }));
    return;
  }

  response.writeHead(404, {
    "content-type": "text/plain; charset=utf-8"
  });
  response.end("Not found");
}
