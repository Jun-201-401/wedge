import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createPlaywrightSessionFactory } from "../src/browser/playwright/index.ts";
import { createCapturePipeline } from "../src/capture/index.ts";
import { executeScenarioStep } from "../src/scenario/executor/step-executor.ts";
import { createArtifactStore } from "../src/storage/index.ts";
import type { ScenarioPlan, ScenarioStep } from "../src/shared/contracts.ts";
import { createMinimalPlan, createRunnerTestConfig, createStubCallbackClient } from "./support.ts";

test("real playwright mode executes goto/fill/select and captures real screenshot and DOM snapshot", async () => {
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
    assert.deepEqual(
      Buffer.from(capturedArtifacts.screenshot?.contentBase64 ?? "", "base64").subarray(0, 8),
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

test("real playwright mode select falls back to matching an option label", async () => {
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

test("real playwright mode click target navigates to the linked page", async () => {
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

test("real playwright mode blocks destructive click targets before locator click executes", async () => {
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

test("real playwright mode hover triggers DOM changes and wait_for observes delayed visibility", async () => {
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

test("real playwright mode wait_for rejects when no locator or url condition is satisfied", async () => {
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

test("real playwright settle none returns no_wait details without mutating page state", async () => {
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

test("real playwright settle supports locator_visible and spinner_hidden for delayed DOM transitions", async () => {
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

test("real playwright settle supports url_change and reports timeout when locator never appears", async () => {
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

test("executeScenarioStep pre-arms fast url_change and item_count_change settle watchers", async () => {
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

test("real playwright response settle waits for matching HTTP response before returning", async () => {
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

test("executeScenarioStep pre-arms fast response settle watchers", async () => {
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

test("real playwright item_count_change waits for delayed list growth before returning", async () => {
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

test("real playwright response and item_count_change report timeout when settle conditions are not met", async () => {
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

test("real playwright artifacts persist with png/html metadata and filesystem content", async () => {
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

function createPlaywrightConfig(artifactsRoot: string) {
  return createRunnerTestConfig({
    browserMode: "playwright",
    artifactsRoot,
    callbackLogFile: join(artifactsRoot, "callbacks.jsonl"),
    browserLaunchTimeoutMs: 45_000,
    browserNavigationTimeoutMs: 10_000
  });
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

function createPlaywrightPlan(startUrl: string): ScenarioPlan {
  return {
    ...createMinimalPlan(),
    start_url: startUrl
  };
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
