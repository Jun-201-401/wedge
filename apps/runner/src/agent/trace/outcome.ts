import type { AgentFinalOutcome, AgentOutcome } from "../../shared/contracts.ts";

export interface AgentOutcomeInput {
  finalOutcome: AgentFinalOutcome;
  category: AgentOutcome["category"];
  reason: string;
  evidenceRefs?: string[];
  verificationId?: string | null;
  policyResultId?: string | null;
}

export function createAgentOutcome(input: AgentOutcomeInput): AgentOutcome {
  return {
    schema_version: "0.1",
    final_outcome: input.finalOutcome,
    category: input.category,
    terminal: true,
    reason: input.reason,
    evidence_refs: input.evidenceRefs ?? [],
    verification_id: input.verificationId ?? null,
    policy_result_id: input.policyResultId ?? null
  };
}
