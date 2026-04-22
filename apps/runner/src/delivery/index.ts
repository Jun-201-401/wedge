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
  if (issues.length === 0) {
    return "DELIVERY_COMPLETE";
  }

  if (issues.some((issue) => issue.scope === "finished-callback")) {
    return "DELIVERY_FAILED";
  }

  return "DELIVERY_PARTIAL";
}
