import { randomUUID } from "node:crypto";
import type { CallbackClient } from "../../callback/index.ts";
import type { StepEvent, StepEventBatch } from "../../shared/contracts.ts";
import { toIsoTimestamp } from "../../shared/utils.ts";

export function createStepEventBatch(
  stepOrder: number,
  stepKey: string,
  eventType: StepEvent["eventType"],
  payload: Record<string, unknown>
): StepEventBatch {
  return {
    events: [
      {
        eventId: randomUUID(),
        stepOrder,
        stepKey,
        eventType,
        occurredAt: toIsoTimestamp(),
        payload
      }
    ]
  };
}

export async function emitStepEvent(
  callbackClient: CallbackClient,
  runId: string,
  stepOrder: number,
  stepKey: string,
  eventType: StepEvent["eventType"],
  payload: Record<string, unknown>
): Promise<void> {
  await callbackClient.sendStepEvents(runId, createStepEventBatch(stepOrder, stepKey, eventType, payload));
}
