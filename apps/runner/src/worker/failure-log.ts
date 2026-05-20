import { type DeliverySummary } from "../delivery/index.ts";
import { ScenarioExecutionError } from "../scenario/executor/index.ts";

export function scenarioFailureLogDetails(error: unknown): Record<string, unknown> {
  if (!(error instanceof ScenarioExecutionError)) {
    return {};
  }

  return {
    failedStepKey: error.failedStepKey,
    failedStepOrder: error.failedStepOrder,
    lastCheckpointId: error.failureCheckpointId ?? null,
    failureArtifactRefs: error.failureArtifactRefs,
    timeoutPhase: error.timeoutPhase,
    timeoutMs: error.timeoutMs,
    timeoutPolicy: error.timeoutPolicy,
    summary: error.summary,
    ...deliveryLogDetails(error.delivery)
  };
}

function deliveryLogDetails(delivery: DeliverySummary): Record<string, unknown> {
  return {
    deliveryStatus: delivery.status,
    deliveryIssueCount: delivery.issues.length,
    deliveryIssueScopes: delivery.issues.map((issue) => issue.scope),
    deliveryIssues: delivery.issues.map((issue) => ({
      scope: issue.scope,
      stepKey: issue.stepKey ?? null,
      message: issue.message
    }))
  };
}
