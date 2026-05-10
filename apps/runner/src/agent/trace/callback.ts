import type { CallbackClient } from "../../callback/index.ts";
import type { DeliveryIssue } from "../../delivery/index.ts";
import type { AgentTrace } from "../../shared/contracts.ts";
import { errorMessage } from "../../shared/utils.ts";

export async function emitAgentTraceCallbacks(input: {
  runId: string;
  trace: AgentTrace;
  callbackClient: CallbackClient;
}): Promise<DeliveryIssue[]> {
  const deliveryIssues: DeliveryIssue[] = [];

  if (input.trace.events.length > 0) {
    try {
      await input.callbackClient.sendAgentEvents(input.runId, {
        events: input.trace.events
      });
    } catch (error) {
      deliveryIssues.push({
        scope: "agent-events-callback",
        message: `agent events callback failed: ${errorMessage(error)}`
      });
    }
  }

  try {
    await input.callbackClient.sendAgentTrace(input.runId, {
      trace: input.trace
    });
  } catch (error) {
    deliveryIssues.push({
      scope: "agent-trace-callback",
      message: `agent trace callback failed: ${errorMessage(error)}`
    });
  }

  return deliveryIssues;
}
