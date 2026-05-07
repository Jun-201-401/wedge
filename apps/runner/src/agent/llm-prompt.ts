import type { InteractiveComponentObservationItem } from "../shared/contracts.ts";
import { targetKey } from "./component-target.ts";
import type { AgentDecisionInput } from "./planner.ts";
import { redactSensitiveValue } from "./redaction.ts";

export interface LlmCandidateReference {
  id: string;
  rawTargetKey: string;
  component: InteractiveComponentObservationItem;
}

export function createLlmCandidateReferences(components: InteractiveComponentObservationItem[]): LlmCandidateReference[] {
  return components.map((component, index) => ({
    id: `candidate_${String(index + 1).padStart(3, "0")}`,
    rawTargetKey: targetKey(component),
    component
  }));
}

export function createLlmRequestPayload(
  input: AgentDecisionInput,
  model: string,
  candidateReferences: LlmCandidateReference[]
): Record<string, unknown> {
  const userPayload = redactSensitiveValue({
    goal: input.goal,
    startUrl: input.startUrl,
    state: {
      started: input.state.started,
      scrollCount: input.state.scrollCount,
      clickedTargetKeys: [...input.state.clickedTargetKeys]
    },
    page: {
      finalUrl: input.observation.snapshot.finalUrl,
      title: input.observation.snapshot.title,
      candidates: candidateReferences.map((candidate) => ({
        targetKey: candidate.id,
        text: candidate.component.text,
        selector: candidate.component.selector,
        role: candidate.component.role,
        href: candidate.component.href,
        tag: candidate.component.tag,
        isPrimaryLike: candidate.component.is_primary_like,
        isCtaCandidate: candidate.component.is_cta_candidate
      }))
    },
    outputSchema: {
      kind: "act|checkpoint|finish",
      targetKey: "opaque candidate targetKey for click, null otherwise",
      actionType: "goto|click|scroll|checkpoint",
      scrollY: "number, only for scroll",
      stage: "FIRST_VIEW|VALUE|CTA|INPUT|COMMIT",
      reason: "short reason",
      confidence: "0..1"
    }
  });

  return {
    model,
    temperature: 0,
    response_format: {
      type: "json_object"
    },
    messages: [
      {
        role: "system",
        content: [
          "Return only JSON for a constrained browser AgentDecision.",
          "Allowed actions are goto start_url before start, click an observed target_key, scroll, checkpoint without browser action, or finish.",
          "Never invent selectors, credentials, payment data, shell commands, JavaScript, or final purchase actions.",
          "Policy and verifier run after this decision and may reject unsafe actions."
        ].join(" ")
      },
      {
        role: "user",
        content: JSON.stringify(userPayload)
      }
    ]
  };
}
