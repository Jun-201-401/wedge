export type DeliveryStatus = "DELIVERY_COMPLETE" | "DELIVERY_PARTIAL" | "DELIVERY_FAILED";

export interface DeliveryIssue {
  scope:
    | "step-events"
    | "artifact-storage"
    | "artifacts-callback"
    | "checkpoints-callback"
    | "finished-callback";
  stepKey?: string;
  message: string;
}

export interface DeliverySummary {
  status: DeliveryStatus;
  issues: DeliveryIssue[];
}

const FATAL_DELIVERY_SCOPES = new Set<DeliveryIssue["scope"]>(["finished-callback"]);

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
  return issues.some((issue) => FATAL_DELIVERY_SCOPES.has(issue.scope));
}
