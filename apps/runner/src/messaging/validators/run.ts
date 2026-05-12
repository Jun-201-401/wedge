import type { RunExecuteMessage } from "../../shared/contracts.ts";
import { isRecord } from "../../shared/utils.ts";
import {
  assertLiteralString,
  assertNonEmptyString,
  assertOneOf,
  assertOptionalBoolean,
  assertScenarioPlan,
  assertScenarioPlanConsistency,
  PAYLOAD_DEVICE_PRESETS,
  RunnerMessageValidationError
} from "./common.ts";

const RUNNER_MESSAGE_TYPE = "run.execute.request";

export function assertRunExecuteMessage(value: unknown): asserts value is RunExecuteMessage {
  if (!isRecord(value)) {
    throw new RunnerMessageValidationError("runner message must be a JSON object");
  }
  assertLiteralString(value.messageType, RUNNER_MESSAGE_TYPE, "runner messageType");
  assertNonEmptyString(value.messageId, "runner messageId");
  assertNonEmptyString(value.schemaVersion, "runner schemaVersion");
  assertNonEmptyString(value.createdAt, "runner createdAt");
  assertNonEmptyString(value.producer, "runner producer");
  assertRunExecutePayload(value.payload);
}

function assertRunExecutePayload(value: unknown): asserts value is RunExecuteMessage["payload"] {
  if (!isRecord(value)) {
    throw new RunnerMessageValidationError("runner payload must be an object");
  }
  assertNonEmptyString(value.runId, "runner payload.runId");
  assertNonEmptyString(value.projectId, "runner payload.projectId");
  assertNonEmptyString(value.startUrl, "runner payload.startUrl");
  assertNonEmptyString(value.goal, "runner payload.goal");
  assertOneOf(value.devicePreset, PAYLOAD_DEVICE_PRESETS, "runner payload.devicePreset");
  assertNonEmptyString(value.scenarioTemplateVersionId, "runner payload.scenarioTemplateVersionId");
  assertRunArtifactPolicy(value.artifactPolicy);
  assertScenarioPlan(value.scenarioPlan);
  assertScenarioPlanConsistency(
    {
      startUrl: value.startUrl,
      goal: value.goal,
      devicePreset: value.devicePreset
    },
    value.scenarioPlan
  );
}

function assertRunArtifactPolicy(value: unknown): void {
  if (value === undefined) {
    return;
  }
  if (!isRecord(value)) {
    throw new RunnerMessageValidationError("runner payload.artifactPolicy must be an object");
  }
  assertOptionalBoolean(value.captureScreenshot, "runner payload.artifactPolicy.captureScreenshot");
  assertOptionalBoolean(value.captureScreenshots, "runner payload.artifactPolicy.captureScreenshots");
  assertOptionalBoolean(value.captureDomSnapshot, "runner payload.artifactPolicy.captureDomSnapshot");
  assertOptionalBoolean(value.captureDomSnapshots, "runner payload.artifactPolicy.captureDomSnapshots");
  assertOptionalBoolean(value.captureAxTree, "runner payload.artifactPolicy.captureAxTree");
  assertOptionalBoolean(value.captureTrace, "runner payload.artifactPolicy.captureTrace");
  assertOptionalBoolean(value.captureHar, "runner payload.artifactPolicy.captureHar");
  assertOptionalBoolean(value.capturePerformance, "runner payload.artifactPolicy.capturePerformance");
  assertOptionalBoolean(value.capture_screenshots, "runner payload.artifactPolicy.capture_screenshots");
  assertOptionalBoolean(value.capture_dom_snapshots, "runner payload.artifactPolicy.capture_dom_snapshots");
  assertOptionalBoolean(value.capture_ax_tree, "runner payload.artifactPolicy.capture_ax_tree");
  assertOptionalBoolean(value.capture_trace, "runner payload.artifactPolicy.capture_trace");
  assertOptionalBoolean(value.capture_har, "runner payload.artifactPolicy.capture_har");
  assertOptionalBoolean(value.capture_performance, "runner payload.artifactPolicy.capture_performance");
}
