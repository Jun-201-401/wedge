import { randomUUID } from "node:crypto";
import type { BrowserPageSnapshot } from "../browser/playwright/index.ts";
import type {
  AgentObservation as AgentObservationSummary,
  AgentObservationBudget,
  AgentObservationCandidateSummary,
  AgentObservationFormControlSummary,
  AgentObservationPageSignals,
  AgentTask,
  ArtifactDraft,
  ScenarioAction
} from "../shared/contracts.ts";
import { candidateFingerprint, candidateText } from "./component-target.ts";
import type { AgentDecision } from "./planner.ts";
import type { AgentPolicyResult } from "./policy.ts";
import { redactAgentTrace, redactSensitiveString } from "./redaction.ts";
import { policySemantics, verifierSemantics } from "./semantics.ts";
import type { AgentVerificationResult } from "./verifier.ts";

export interface AgentTurnTrace {
  turn: number;
  observation: AgentObservationSummary;
  preDecisionVerification: AgentVerificationResult;
  decision?: AgentDecision;
  policy?: AgentPolicyResult;
  actionResult?: {
    actionType: ScenarioAction["type"];
    finalUrl: string;
    completed: boolean;
  };
  postActionVerification?: AgentVerificationResult;
}

export interface AgentTrace {
  schema_version: "0.1";
  task_id: string;
  attempt_id: string;
  attempt_index: number;
  run_id: string;
  turns: AgentTurnTrace[];
  outcome: {
    status: "RUNNING" | "SUCCESS" | "POLICY_BLOCKED" | "BLOCKED" | "FAILED" | "EXHAUSTED";
    reason: string;
  };
}

export function createAgentTrace(task: AgentTask): AgentTrace {
  return {
    schema_version: "0.1",
    task_id: task.task_id,
    attempt_id: task.attempt_id,
    attempt_index: task.attempt_index,
    run_id: task.run_id,
    turns: [],
    outcome: {
      status: "RUNNING",
      reason: "Agent execution is in progress."
    }
  };
}

export function summarizeObservation(
  snapshot: BrowserPageSnapshot,
  budget: AgentObservationBudget = {}
): AgentTurnTrace["observation"] {
  const maxCandidates = Math.max(0, Math.min(snapshot.interactiveComponents.length, budget.max_candidates ?? 10));
  return {
    finalUrl: redactSensitiveString(snapshot.finalUrl),
    title: redactSensitiveString(snapshot.title),
    candidateCount: snapshot.interactiveComponents.length,
    visibleTextSample: visibleTextSample(snapshot, budget.max_visible_text_chars ?? 1_000),
    candidates: snapshot.interactiveComponents
      .slice(0, maxCandidates)
      .map((component, index): AgentObservationCandidateSummary => ({
        candidateId: `candidate_${String(index + 1).padStart(3, "0")}`,
        candidateFingerprint: candidateFingerprint(component),
        role: component.role,
        tag: component.tag,
        text: redactSensitiveString(component.text),
        inputType: component.input_type ?? null,
        labelText: component.label_text ? redactSensitiveString(component.label_text) : null,
        placeholder: component.placeholder ? redactSensitiveString(component.placeholder) : null,
        name: component.name ? redactSensitiveString(component.name) : null,
        required: component.required === true,
        disabled: component.disabled === true,
        isFormControl: component.is_form_control === true,
        clickable: component.clickable,
        isCtaCandidate: component.is_cta_candidate,
        isPrimaryLike: component.is_primary_like,
        frameId: component.frame_id ?? null,
        shadowRoot: component.shadow_root === true,
        ...hrefHints(component.href),
        riskHint: riskHintForCandidate(component),
        bounds: component.bounds
      })),
    formControls: formControls(snapshot),
    pageSignals: pageSignals(snapshot)
  };
}

export function createAgentTraceArtifact(trace: AgentTrace): ArtifactDraft {
  return {
    artifactId: randomUUID(),
    artifactType: "TRACE",
    stepKey: "agent_trace",
    mimeType: "application/json",
    fileExtension: "json",
    content: JSON.stringify(redactAgentTrace(trace), null, 2)
  };
}

function visibleTextSample(snapshot: BrowserPageSnapshot, maxChars: number): string[] {
  const samples = uniqueNonEmptyStrings([
    snapshot.title,
    ...snapshot.breadcrumb,
    ...snapshot.toastTexts,
    ...snapshot.visiblePrices,
    ...snapshot.productCards.flatMap((card) => [
      card.element_text,
      card.visible_price ?? ""
    ]),
    ...snapshot.interactiveComponents.map((component) => component.text)
  ]);

  const result: string[] = [];
  let remaining = Math.max(0, maxChars);

  for (const sample of samples) {
    if (remaining <= 0) {
      break;
    }
    const redacted = redactSensitiveString(sample).slice(0, Math.min(200, remaining));
    if (redacted.length === 0) {
      continue;
    }
    result.push(redacted);
    remaining -= redacted.length;
  }

  return result;
}

function formControls(snapshot: BrowserPageSnapshot): AgentObservationFormControlSummary[] {
  const fieldControls = Object.entries(snapshot.fields).map(([key, value]) => ({
    controlKey: redactSensitiveString(key),
    controlType: "field" as const,
    hasValue: value.length > 0
  }));
  const selectControls = Object.entries(snapshot.selectedOptions).map(([key, value]) => ({
    controlKey: redactSensitiveString(key),
    controlType: "select" as const,
    hasValue: value.length > 0
  }));

  return [...fieldControls, ...selectControls].slice(0, 20);
}

function pageSignals(snapshot: BrowserPageSnapshot): AgentObservationPageSignals {
  const signalText = pageSignalText(snapshot);

  return {
    visitedUrlCount: snapshot.visitedUrls.length,
    consoleErrorCount: snapshot.consoleErrors.length,
    networkErrorCount: snapshot.networkErrors.length,
    breadcrumbCount: snapshot.breadcrumb.length,
    toastCount: snapshot.toastTexts.length,
    visiblePriceCount: snapshot.visiblePrices.length,
    productCardCount: snapshot.productCards.length,
    cartCount: snapshot.cartCount,
    hasLoginWallSignal: verifierSemantics.loginWall.test(signalText),
    hasCaptchaSignal: verifierSemantics.captcha.test(signalText),
    hasPaymentOrCommitSignal: policySemantics.paymentInfo.test(signalText) || policySemantics.finalCommit.test(signalText)
  };
}

function riskHintForCandidate(component: Parameters<typeof candidateText>[0]): string | null {
  const text = candidateText(component);
  if (policySemantics.finalCommit.test(text)) {
    return "PAYMENT_COMMIT";
  }
  if (policySemantics.paymentInfo.test(text)) {
    return "PAYMENT_INFO_ENTRY";
  }
  if (policySemantics.shippingForm.test(text)) {
    return "SHIPPING_FORM_ENTRY";
  }
  if (policySemantics.destructive.test(text)) {
    return "DESTRUCTIVE_ACTION";
  }
  if (policySemantics.externalMessage.test(text)) {
    return "EXTERNAL_MESSAGE_SEND";
  }
  if (policySemantics.cartMutation.test(text)) {
    return "CART_MUTATION";
  }
  if (policySemantics.checkoutNavigation.test(text)) {
    return "CHECKOUT_NAVIGATION";
  }
  return null;
}

function hrefHints(href: string | null | undefined): Pick<AgentObservationCandidateSummary, "hrefOrigin" | "hrefPathHint"> {
  if (!href) {
    return {
      hrefOrigin: null,
      hrefPathHint: null
    };
  }

  const redactedHref = redactSensitiveString(href);
  try {
    const parsed = new URL(redactedHref);
    return {
      hrefOrigin: parsed.origin,
      hrefPathHint: parsed.pathname || "/"
    };
  } catch {
    return {
      hrefOrigin: null,
      hrefPathHint: redactedHref.slice(0, 120)
    };
  }
}

function pageSignalText(snapshot: BrowserPageSnapshot): string {
  return [
    snapshot.finalUrl,
    snapshot.title,
    ...snapshot.breadcrumb,
    ...snapshot.toastTexts,
    ...snapshot.visiblePrices,
    ...snapshot.productCards.map((card) => card.element_text),
    ...snapshot.interactiveComponents.map((component) => candidateText(component)),
    ...snapshot.consoleErrors,
    ...snapshot.networkErrors
  ].join(" ");
}

function uniqueNonEmptyStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = value.trim().replace(/\s+/g, " ");
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}
