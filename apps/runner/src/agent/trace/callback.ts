import type { CallbackClient } from "../../callback/index.ts";
import type { DeliveryIssue } from "../../delivery/index.ts";
import type { AgentTrace } from "../../shared/contracts.ts";
import { errorMessage, toIsoTimestamp } from "../../shared/utils.ts";

export async function emitAgentTraceCallbacks(input: {
  runId: string;
  trace: AgentTrace;
  callbackClient: CallbackClient;
}): Promise<DeliveryIssue[]> {
  const deliveryIssues: DeliveryIssue[] = [];

  try {
    await input.callbackClient.sendAgentTrace(input.runId, {
      taskId: input.trace.task_id,
      attemptId: input.trace.attempt_id,
      occurredAt: toIsoTimestamp(),
      trace: input.trace as unknown as Record<string, unknown>
    });
  } catch (error) {
    deliveryIssues.push({
      scope: "agent-trace-callback",
      message: `agent trace callback failed: ${errorMessage(error)}`
    });
  }

  return deliveryIssues;
}
