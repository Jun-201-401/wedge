import type { DiscoveryExecuteMessage } from "../../shared/contracts.ts";
import { isRecord } from "../../shared/utils.ts";
import {
  assertLiteralString,
  assertNonEmptyString,
  assertOneOf,
  PAYLOAD_DEVICE_PRESETS,
  RunnerMessageValidationError
} from "./common.ts";

const DISCOVERY_MESSAGE_TYPE = "discovery.execute.request";

export function assertDiscoveryExecuteMessage(value: unknown): asserts value is DiscoveryExecuteMessage {
  if (!isRecord(value)) {
    throw new RunnerMessageValidationError("discovery message must be a JSON object");
  }
  assertLiteralString(value.messageType, DISCOVERY_MESSAGE_TYPE, "discovery messageType");
  assertNonEmptyString(value.messageId, "discovery messageId");
  assertNonEmptyString(value.schemaVersion, "discovery schemaVersion");
  assertNonEmptyString(value.createdAt, "discovery createdAt");
  assertNonEmptyString(value.producer, "discovery producer");
  assertDiscoveryExecutePayload(value.payload);
}

function assertDiscoveryExecutePayload(value: unknown): asserts value is DiscoveryExecuteMessage["payload"] {
  if (!isRecord(value)) {
    throw new RunnerMessageValidationError("discovery payload must be an object");
  }
  assertNonEmptyString(value.discoveryId, "discovery payload.discoveryId");
  assertNonEmptyString(value.projectId, "discovery payload.projectId");
  assertNonEmptyString(value.url, "discovery payload.url");
  assertOneOf(value.devicePreset, PAYLOAD_DEVICE_PRESETS, "discovery payload.devicePreset");
  if (!isRecord(value.viewport)) {
    throw new RunnerMessageValidationError("discovery payload.viewport must be an object");
  }
  if (typeof value.viewport.width !== "number" || value.viewport.width < 1) {
    throw new RunnerMessageValidationError("discovery payload.viewport.width must be >= 1");
  }
  if (typeof value.viewport.height !== "number" || value.viewport.height < 1) {
    throw new RunnerMessageValidationError("discovery payload.viewport.height must be >= 1");
  }
  if (typeof value.maxDurationMs !== "number" || value.maxDurationMs < 1_000) {
    throw new RunnerMessageValidationError("discovery payload.maxDurationMs must be >= 1000");
  }
  if (typeof value.maxScrollCount !== "number" || value.maxScrollCount < 0) {
    throw new RunnerMessageValidationError("discovery payload.maxScrollCount must be >= 0");
  }
}
