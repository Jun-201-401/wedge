import type { InteractiveComponentObservationItem } from "../shared/contracts.ts";
import { targetKey } from "./component-target.ts";
import type { AgentDecisionInput, AgentDecisionPromptMetadata } from "./planner.ts";
import { redactSensitiveString, redactSensitiveValue } from "./redaction.ts";

export interface LlmCandidateReference {
  id: string;
  rawTargetKey: string;
  component: InteractiveComponentObservationItem;
}

export const LLM_PROMPT_PAYLOAD_SHAPE_VERSION = "llm-prompt-v1";

export function createLlmCandidateReferences(components: InteractiveComponentObservationItem[]): LlmCandidateReference[] {
  return components.filter((component) => !component.shadow_root).map((component, index) => ({
    id: `candidate_${String(index + 1).padStart(3, "0")}`,
    rawTargetKey: targetKey(component),
    component
  }));
}

export function createLlmRequestPayload(
  input: AgentDecisionInput,
  model: string,
  candidateReferences: LlmCandidateReference[],
  endpoint: string
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
      candidates: candidateReferences.map(candidatePromptSummary)
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

  const instructions = [
    "Return only JSON for a constrained browser AgentDecision.",
    "Allowed actions are goto start_url before start, click an observed target_key, scroll, checkpoint without browser action, or finish.",
    "Never invent selectors, credentials, payment data, shell commands, JavaScript, or final purchase actions.",
    "For signup, lead, contact, or pricing goals, click only observed candidates whose text, href, label, placeholder, or role clearly matches that goal; otherwise scroll or finish.",
    "Do not click unrelated product, category, menu, or shopping links for signup, lead, contact, or pricing goals.",
    "Policy and verifier run after this decision and may reject unsafe actions."
  ].join(" ");

  if (isResponsesEndpoint(endpoint)) {
    return {
      model,
      text: {
        format: {
          type: "json_object"
        }
      },
      input: [
        {
          role: "system",
          content: instructions
        },
        {
          role: "user",
          content: JSON.stringify(userPayload)
        }
      ]
    };
  }

  return {
    model,
    temperature: 0,
    response_format: {
      type: "json_object"
    },
    messages: [
      {
        role: "system",
        content: instructions
      },
      {
        role: "user",
        content: JSON.stringify(userPayload)
      }
    ]
  };
}

export function createLlmPromptMetadata(
  candidateReferences: LlmCandidateReference[]
): AgentDecisionPromptMetadata {
  return {
    payloadShapeVersion: LLM_PROMPT_PAYLOAD_SHAPE_VERSION,
    candidateCount: candidateReferences.length,
    redacted: true,
    rawPromptStored: false,
    rawCandidateSelectorsIncluded: false,
    rawCandidateHrefsIncluded: false
  };
}

function candidatePromptSummary(candidate: LlmCandidateReference): Record<string, unknown> {
  return {
    targetKey: candidate.id,
    text: redactSensitiveString(candidate.component.text),
    role: candidate.component.role,
    tag: candidate.component.tag,
    inputType: candidate.component.input_type ?? null,
    labelText: candidate.component.label_text ? redactSensitiveString(candidate.component.label_text) : null,
    placeholder: candidate.component.placeholder ? redactSensitiveString(candidate.component.placeholder) : null,
    isFormControl: candidate.component.is_form_control === true,
    frameId: candidate.component.frame_id ?? null,
    hrefHint: hrefPromptHint(candidate.component.href),
    selectorHint: selectorPromptHint(candidate.component.selector),
    isPrimaryLike: candidate.component.is_primary_like,
    isCtaCandidate: candidate.component.is_cta_candidate
  };
}

function hrefPromptHint(href: string | null | undefined): Record<string, unknown> | null {
  if (!href) {
    return null;
  }

  try {
    const parsed = new URL(redactSensitiveString(href));
    return {
      origin: parsed.origin,
      pathHint: semanticPathHint(parsed.pathname)
    };
  } catch {
    return {
      pathHint: semanticPathHint(redactSensitiveString(href))
    };
  }
}

function semanticPathHint(path: string): string {
  const semanticSegments = path
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => {
      const redacted = redactSensitiveString(segment);
      if (redacted !== segment) {
        return redacted;
      }
      return checkoutSemanticHint(segment) ?? "[REDACTED_PATH_SEGMENT]";
    });

  return semanticSegments.length > 0 ? `/${semanticSegments.join("/")}` : "/";
}

function selectorPromptHint(selector: string | null | undefined): string | null {
  if (!selector) {
    return null;
  }

  const redacted = redactSensitiveString(selector);
  if (redacted !== selector) {
    return redacted;
  }

  return checkoutSemanticHint(selector);
}

function checkoutSemanticHint(value: string): string | null {
  const normalized = value.toLowerCase();
  if (normalized.includes("add") && normalized.includes("cart")) {
    return "add-cart";
  }
  if (normalized.includes("checkout")) {
    return "checkout";
  }
  if (normalized.includes("cart")) {
    return "cart";
  }
  if (normalized.includes("payment") || normalized.includes("pay")) {
    return "payment";
  }
  if (normalized.includes("login") || normalized.includes("signin")) {
    return "login";
  }
  if (normalized.includes("captcha") || normalized.includes("challenge")) {
    return "challenge";
  }
  if (normalized.includes("signup") || normalized.includes("register")) {
    return "signup";
  }
  if (normalized.includes("product")) {
    return "product";
  }
  return null;
}

function isResponsesEndpoint(endpoint: string): boolean {
  try {
    return new URL(endpoint).pathname.endsWith("/responses");
  } catch {
    return endpoint.endsWith("/responses");
  }
}
