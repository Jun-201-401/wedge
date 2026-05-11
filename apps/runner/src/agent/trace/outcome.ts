import type { AgentFinalOutcome, AgentOutcome, AgentOutcomeStatus } from "../../shared/contracts.ts";

export interface AgentOutcomeInput {
  finalOutcome: AgentFinalOutcome;
  category: AgentOutcomeStatus;
  reason: string;
  evidenceRefs?: string[];
  verificationId?: string | null;
  policyResultId?: string | null;
}

export function createAgentOutcome(input: AgentOutcomeInput): AgentOutcome {
  return {
    status: input.finalOutcome,
    reason: input.reason
  };
}
