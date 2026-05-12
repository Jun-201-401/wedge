import { randomUUID } from "node:crypto";
import type { CallbackClient } from "../callback/index.ts";
import { createDeliveryIssue, type DeliveryIssue } from "../delivery/index.ts";
import type { AgentCallbackEventType, AgentEventBatch, AgentTask, AgentTraceCallbackPayload, Artifact } from "../shared/contracts.ts";
import { errorMessage, toIsoTimestamp } from "../shared/utils.ts";
import { redactAgentTrace, redactSensitiveValue } from "./redaction.ts";
import type { AgentTrace } from "./trace/index.ts";

export function createAgentEventBatch(input: {
  task: AgentTask;
  eventType: AgentCallbackEventType;
  payload: Record<string, unknown>;
  turn?: number;
}): AgentEventBatch {
  return {
    events: [
      {
        eventId: randomUUID(),
        taskId: input.task.task_id,
        attemptId: input.task.attempt_id,
        turn: input.turn,
        eventType: input.eventType,
        occurredAt: toIsoTimestamp(),
        payload: redactSensitiveValue(input.payload) as Record<string, unknown>
      }
    ]
  };
}

export async function emitAgentEventBestEffort(
  callbackClient: CallbackClient,
  runId: string,
  task: AgentTask,
  eventType: AgentCallbackEventType,
  payload: Record<string, unknown>,
  turn?: number
): Promise<DeliveryIssue[]> {
  try {
    await callbackClient.sendAgentEvents(runId, createAgentEventBatch({ task, eventType, payload, turn }));
    return [];
  } catch (error) {
    return [
      createDeliveryIssue({
        scope: "agent-events-callback",
        stepKey: turn ? `agent_turn_${String(turn).padStart(3, "0")}` : "agent",
        message: `agent event ${eventType} delivery failed: ${errorMessage(error)}`
      })
    ];
  }
}

export function createAgentTraceCallbackPayload(input: {
  task: AgentTask;
  trace: AgentTrace;
  traceArtifact?: Artifact;
}): AgentTraceCallbackPayload {
  return {
    taskId: input.task.task_id,
    attemptId: input.task.attempt_id,
    occurredAt: toIsoTimestamp(),
    trace: redactAgentTrace(input.trace) as unknown as Record<string, unknown>,
    traceArtifact: input.traceArtifact
  };
}

export async function emitAgentTraceBestEffort(
  callbackClient: CallbackClient,
  runId: string,
  task: AgentTask,
  trace: AgentTrace,
  traceArtifact?: Artifact
): Promise<DeliveryIssue[]> {
  try {
    await callbackClient.sendAgentTrace(runId, createAgentTraceCallbackPayload({ task, trace, traceArtifact }));
    return [];
  } catch (error) {
    return [
      createDeliveryIssue({
        scope: "agent-trace-callback",
        stepKey: "agent_trace",
        message: `agent trace callback failed: ${errorMessage(error)}`
      })
    ];
  }
}
