import type { BrowserCaptureOptions, BrowserSession } from "../../browser/playwright/index.ts";
import type { CallbackClient } from "../../callback/index.ts";
import type { CapturePipeline, JourneyDepthContext } from "../../capture/index.ts";
import type { DeliveryIssue } from "../../delivery/index.ts";
import {
  createEmptyCollectorStatusSummary,
  type CollectorStatusSummary
} from "../../observability/collectors.ts";
import type { ArtifactStore } from "../../storage/index.ts";
import type { ScenarioPlan, ScenarioStep } from "../../shared/contracts.ts";
import { errorMessage, logOperationalEvent, sleep } from "../../shared/utils.ts";
import { executeScenarioAction } from "../actions/index.ts";
import { RunnerExecutionPolicyError } from "../policy.ts";
import { emitCheckpointArtifactsAndCallbacks } from "./checkpoint-emitter.ts";
import { emitStepEventBestEffort } from "./step-events.ts";

export interface ScenarioStepExecutorInput {
  runId: string;
  stepOrder: number;
  step: ScenarioStep;
  plan: ScenarioPlan;
  session: BrowserSession;
  callbackClient: CallbackClient;
  capturePipeline: CapturePipeline;
  artifactStore: ArtifactStore;
  emitStepEvents?: boolean;
  journeyDepthContext?: JourneyDepthContext;
}

export interface ScenarioStepExecutionResult {
  stopRequested: boolean;
  deliveryIssues: DeliveryIssue[];
  collectorStatus: CollectorStatusSummary;
}

const RETRYABLE_ACTION_TYPES = new Set(["click", "fill", "wait_for"]);
const DEFAULT_ACTION_RECOVERY_MAX_ATTEMPTS = 3;
const MAX_ACTION_RECOVERY_ATTEMPTS = 5;
const DEFAULT_ACTION_RECOVERY_DELAY_MS = 250;

export async function executeScenarioStep({
  runId,
  stepOrder,
  step,
  plan,
  session,
  callbackClient,
  capturePipeline,
  artifactStore,
  emitStepEvents = true,
  journeyDepthContext
}: ScenarioStepExecutorInput): Promise<ScenarioStepExecutionResult> {
  const deliveryIssues: DeliveryIssue[] = [];

  if (emitStepEvents) {
    deliveryIssues.push(...(await emitStepEventBestEffort(callbackClient, runId, stepOrder, step.step_id, "STEP_STARTED", {
      description: step.description,
      stage: step.stage
    })));
  }

  const beforeSnapshot = step.checkpoint ? session.snapshot() : undefined;
  let actionResult;
  let preparedSettle: Awaited<ReturnType<NonNullable<BrowserSession["prepareSettle"]>>> | null = null;
  try {
    const recoveredExecution = await executeScenarioActionWithRecovery({
      runId,
      stepOrder,
      step,
      session
    });
    actionResult = recoveredExecution.actionResult;
    preparedSettle = recoveredExecution.preparedSettle;
  } catch (error) {
    await preparedSettle?.cancel();
    throw error;
  }

  if (emitStepEvents) {
    deliveryIssues.push(...(await emitStepEventBestEffort(callbackClient, runId, stepOrder, step.step_id, "ACTION_EXECUTED", {
      actionType: actionResult.actionType,
      target: actionResult.targetSummary,
      details: actionResult.details
    })));
  }

  const settleResult = preparedSettle ? await preparedSettle.settle() : await session.settle(step.settle_strategy);
  if (settleResult.status === "timeout") {
    logOperationalEvent(
      "scenario-executor",
      "step_settle_timeout",
      {
        runId,
        stepOrder,
        stepKey: step.step_id,
        stage: step.stage,
        settleStrategy: step.settle_strategy.type,
        timeoutMs: step.settle_strategy.timeout_ms,
        timeoutPolicy: "continue_with_timeout_settle_status",
        details: settleResult.details ?? {}
      },
      "warn"
    );
  }
  const pageSnapshot = session.snapshot();
  const capturedArtifacts = step.checkpoint
    ? await session.captureArtifacts(createBrowserCaptureOptions(plan))
    : undefined;

  if (step.checkpoint) {
    const checkpointResult = await emitCheckpointArtifactsAndCallbacks({
      runId,
      stepOrder,
      step,
      plan,
      beforeSnapshot,
      pageSnapshot,
      actionResult,
      settleResult,
      capturedArtifacts,
      journeyDepthContext,
      callbackClient,
      capturePipeline,
      artifactStore
    });
    deliveryIssues.push(...checkpointResult.deliveryIssues);
    return {
      stopRequested: actionResult.stopRequested,
      deliveryIssues: await appendStepCompletedEvent({
        deliveryIssues,
        emitStepEvents,
        callbackClient,
        runId,
        stepOrder,
        step,
        settleResult,
        pageSnapshot
      }),
      collectorStatus: checkpointResult.collectorStatus
    };
  }

  return {
    stopRequested: actionResult.stopRequested,
    deliveryIssues: await appendStepCompletedEvent({
      deliveryIssues,
      emitStepEvents,
      callbackClient,
      runId,
      stepOrder,
      step,
      settleResult,
      pageSnapshot
    }),
    collectorStatus: createEmptyCollectorStatusSummary()
  };
}

async function executeScenarioActionWithRecovery({
  runId,
  stepOrder,
  step,
  session
}: {
  runId: string;
  stepOrder: number;
  step: ScenarioStep;
  session: BrowserSession;
}): Promise<{
  actionResult: Awaited<ReturnType<typeof executeScenarioAction>>;
  preparedSettle: Awaited<ReturnType<NonNullable<BrowserSession["prepareSettle"]>>> | null;
}> {
  const maxAttempts = resolveActionRecoveryMaxAttempts(step);
  const failures: Array<{ attempt: number; message: string }> = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const preparedSettle = await session.prepareSettle?.(step.settle_strategy) ?? null;

    try {
      const actionResult = await executeScenarioAction(session, step);
      if (failures.length === 0) {
        return {
          actionResult,
          preparedSettle
        };
      }

      return {
        actionResult: {
          ...actionResult,
          details: {
            ...actionResult.details,
            recovery: {
              recovered: true,
              attempts: attempt,
              failedAttempts: failures
            }
          }
        },
        preparedSettle
      };
    } catch (error) {
      await preparedSettle?.cancel();

      if (!shouldRetryActionFailure(step, error, attempt, maxAttempts)) {
        throw error;
      }

      failures.push({
        attempt,
        message: errorMessage(error)
      });

      logOperationalEvent(
        "scenario-executor",
        "action_recovery_retry",
        {
          runId,
          stepOrder,
          stepKey: step.step_id,
          stage: step.stage,
          actionType: step.action.type,
          attempt,
          nextAttempt: attempt + 1,
          maxAttempts,
          failureMessage: errorMessage(error)
        },
        "warn"
      );

      await waitBeforeActionRecoveryRetry(session, step);
    }
  }

  throw new Error("action recovery retry exhausted without a terminal error");
}

function shouldRetryActionFailure(
  step: ScenarioStep,
  error: unknown,
  attempt: number,
  maxAttempts: number
): boolean {
  if (attempt >= maxAttempts) {
    return false;
  }

  if (!RETRYABLE_ACTION_TYPES.has(step.action.type)) {
    return false;
  }

  if (error instanceof RunnerExecutionPolicyError) {
    return false;
  }

  if (error instanceof Error && error.name === "BrowserCrashError") {
    return false;
  }

  return true;
}

function resolveActionRecoveryMaxAttempts(step: ScenarioStep): number {
  if (!RETRYABLE_ACTION_TYPES.has(step.action.type)) {
    return 1;
  }

  if (step.action.options?.recovery_retry === false || step.action.options?.disable_recovery_retry === true) {
    return 1;
  }

  const configuredAttempts =
    readNumberOption(step, "recovery_max_attempts") ??
    readNumberOption(step, "recoveryMaxAttempts");

  if (configuredAttempts === undefined) {
    return DEFAULT_ACTION_RECOVERY_MAX_ATTEMPTS;
  }

  if (!Number.isInteger(configuredAttempts) || configuredAttempts < 1) {
    return DEFAULT_ACTION_RECOVERY_MAX_ATTEMPTS;
  }

  return Math.min(configuredAttempts, MAX_ACTION_RECOVERY_ATTEMPTS);
}

async function waitBeforeActionRecoveryRetry(session: BrowserSession, step: ScenarioStep): Promise<void> {
  const delayMs = resolveActionRecoveryDelayMs(step);

  try {
    await session.settle({
      type: "fixed_short",
      timeout_ms: delayMs
    });
  } catch (error) {
    logOperationalEvent(
      "scenario-executor",
      "action_recovery_wait_failed",
      {
        stepKey: step.step_id,
        actionType: step.action.type,
        failureMessage: errorMessage(error)
      },
      "warn"
    );
    await sleep(delayMs);
  }
}

function resolveActionRecoveryDelayMs(step: ScenarioStep): number {
  const configuredDelay =
    readNumberOption(step, "recovery_delay_ms") ??
    readNumberOption(step, "recoveryDelayMs");

  if (configuredDelay === undefined || !Number.isFinite(configuredDelay) || configuredDelay < 0) {
    return DEFAULT_ACTION_RECOVERY_DELAY_MS;
  }

  return Math.min(configuredDelay, 2_000);
}

function readNumberOption(step: ScenarioStep, key: string): number | undefined {
  const value = step.action.options?.[key];
  return typeof value === "number" ? value : undefined;
}

async function appendStepCompletedEvent({
  deliveryIssues,
  emitStepEvents,
  callbackClient,
  runId,
  stepOrder,
  step,
  settleResult,
  pageSnapshot
}: {
  deliveryIssues: DeliveryIssue[];
  emitStepEvents: boolean;
  callbackClient: CallbackClient;
  runId: string;
  stepOrder: number;
  step: ScenarioStep;
  settleResult: Awaited<ReturnType<BrowserSession["settle"]>>;
  pageSnapshot: ReturnType<BrowserSession["snapshot"]>;
}): Promise<DeliveryIssue[]> {
  if (!emitStepEvents) {
    return deliveryIssues;
  }

  return [
    ...deliveryIssues,
    ...(await emitStepEventBestEffort(callbackClient, runId, stepOrder, step.step_id, "STEP_COMPLETED", {
      settle: settleResult,
      finalUrl: pageSnapshot.finalUrl
    }))
  ];
}

function createBrowserCaptureOptions(plan: ScenarioPlan): BrowserCaptureOptions {
  const options: BrowserCaptureOptions = {};
  if (plan.artifact_policy?.screenshot_mode) {
    options.screenshotMode = plan.artifact_policy.screenshot_mode;
  }
  if (plan.artifact_policy?.capture_ax_tree === true) {
    options.captureAxTree = true;
  }
  if (plan.artifact_policy?.capture_har === true) {
    options.captureHar = true;
  }
  if (plan.artifact_policy?.capture_performance === true) {
    options.capturePerformance = true;
  }
  if (plan.artifact_policy?.capture_trace === true) {
    options.captureTrace = true;
  }
  return options;
}
