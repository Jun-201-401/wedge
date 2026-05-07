import type { AgentTrace } from "./trace.ts";
import type { AgentVerificationOutcome } from "./verifier.ts";

export function traceStatusFromVerification(outcome: AgentVerificationOutcome): AgentTrace["outcome"]["status"] {
  switch (outcome) {
    case "SUCCESS":
      return "SUCCESS";
    case "POLICY_BLOCKED":
      return "POLICY_BLOCKED";
    case "BLOCKED_LOGIN":
    case "BLOCKED_CAPTCHA":
      return "BLOCKED";
    case "EXHAUSTED":
      return "EXHAUSTED";
    case "CONTINUE":
      return "RUNNING";
  }
}

export function shouldReportStopped(trace: AgentTrace): boolean {
  return trace.outcome.status === "POLICY_BLOCKED" || trace.outcome.status === "BLOCKED";
}
