export type DeliveryStatus = "DELIVERY_COMPLETE" | "DELIVERY_PARTIAL" | "DELIVERY_FAILED";
export type DeliveryFailureImpact = "partial" | "fatal";
export type DeliveryIssueScope =
  | "step-events"
  | "artifact-storage"
  | "artifacts-callback"
  | "agent-events-callback"
  | "agent-trace-callback"
  | "checkpoints-callback"
  | "failure-capture"
  | "finished-callback";

export interface DeliveryIssue {
  scope: DeliveryIssueScope;
  stepKey?: string;
  impact?: DeliveryFailureImpact;
  message: string;
}

export interface DeliverySummary {
  status: DeliveryStatus;
  issues: DeliveryIssue[];
}

export const DELIVERY_FAILURE_IMPACT_BY_SCOPE: Record<DeliveryIssueScope, DeliveryFailureImpact> = {
  "step-events": "partial",
  "artifact-storage": "partial",
  "artifacts-callback": "partial",
  "agent-events-callback": "partial",
  "agent-trace-callback": "partial",
  "checkpoints-callback": "partial",
  "failure-capture": "partial",
  "finished-callback": "fatal"
};

export function createDeliveryIssue(input: DeliveryIssue): DeliveryIssue {
  return {
    ...input,
    impact: input.impact ?? resolveDeliveryIssueImpact(input)
  };
}

export function createDeliverySummary(issues: DeliveryIssue[] = []): DeliverySummary {
  return {
    status: resolveDeliveryStatus(issues),
    issues
  };
}

export function mergeDeliveryIssues(...groups: Array<DeliveryIssue[] | undefined>): DeliveryIssue[] {
  return groups.flatMap((group) => group ?? []);
}

export function resolveDeliveryStatus(issues: DeliveryIssue[]): DeliveryStatus {
  if (!hasDeliveryIssues(issues)) {
    return "DELIVERY_COMPLETE";
  }

  if (hasFatalDeliveryIssue(issues)) {
    return "DELIVERY_FAILED";
  }

  return "DELIVERY_PARTIAL";
}

function hasDeliveryIssues(issues: DeliveryIssue[]): boolean {
  return issues.length > 0;
}

function hasFatalDeliveryIssue(issues: DeliveryIssue[]): boolean {
  return issues.some((issue) => resolveDeliveryIssueImpact(issue) === "fatal");
}

export function resolveDeliveryIssueImpact(issue: DeliveryIssue): DeliveryFailureImpact {
  return issue.impact ?? DELIVERY_FAILURE_IMPACT_BY_SCOPE[issue.scope];
}
