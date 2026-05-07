import type { RunExecuteMessage } from "../../shared/contracts.ts";
import { isRecord } from "../../shared/utils.ts";
import {
  assertLiteralString,
  assertNonEmptyString,
  assertOneOf,
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
