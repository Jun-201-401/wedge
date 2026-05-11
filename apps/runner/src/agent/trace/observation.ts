import type { BrowserPageSnapshot } from "../../browser/playwright/index.ts";
import type { AgentTask } from "../../shared/contracts.ts";
import { toIsoTimestamp } from "../../shared/utils.ts";

export function createTraceObservation(
  task: AgentTask,
  stepIndex: number,
  observationId: string,
  snapshot: BrowserPageSnapshot
): Record<string, unknown> {
  return {
    schema_version: "0.1",
    observation_id: observationId,
    task_id: task.task_id,
    step_index: stepIndex,
    captured_at: toIsoTimestamp(),
    url: snapshot.finalUrl,
    origin: readOrigin(snapshot.finalUrl),
    title: snapshot.title,
    page_kind: inferPageKind(snapshot.finalUrl, snapshot.title),
    visible_headings: [],
    visible_text_sample: [],
    forms: [],
    candidates: snapshot.interactiveComponents.map((component, index) => ({
      candidate_id: `candidate-${stepIndex}-${index + 1}`,
      candidate_fingerprint: `${component.role ?? component.tag}:${component.text}:${component.selector ?? ""}`,
      role: component.role,
      text: component.text,
      accessible_name: component.text,
      tag_name: component.tag,
      input_type: null,
      href: null,
      form_action: null,
      form_method: null,
      is_visible: true,
      is_enabled: component.clickable,
      is_in_viewport: true,
      is_covered_or_occluded: "unknown",
      occlusion_reason: null,
      bounding_box: component.bounds,
      frame_id: "main",
      shadow_root_path: null,
      locator_recipe: {
        frame_id: "main",
        role: component.role,
        text: component.text,
        selector: component.selector
      },
      kind_hint: component.is_cta_candidate ? "CTA" : "INTERACTIVE",
      risk_hint: component.is_cta_candidate ? "CHECKOUT_NAVIGATION" : "UNKNOWN",
      confidence: component.is_primary_like ? 0.82 : 0.65,
      source: ["DOM", "HEURISTIC"],
      nearby_text: [],
      parent_section_heading: null,
      language_hint: task.environment.locale
    })),
    risk_candidates: [],
    artifact_refs: {}
  };
}

function readOrigin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "unknown";
  }
}

function inferPageKind(url: string, title: string): string {
  const text = `${url} ${title}`.toLowerCase();
  if (/checkout|payment|결제|주문/.test(text)) {
    return "CHECKOUT";
  }
  if (/cart|장바구니/.test(text)) {
    return "CART";
  }
  if (/pricing|price|요금|가격/.test(text)) {
    return "PRICING";
  }
  return "UNKNOWN";
}
