import { createHash } from "node:crypto";
import type { InteractiveComponentObservationItem, TargetDescriptorMap } from "../shared/contracts.ts";

export interface AgentReplayTargetHint {
  candidate_fingerprint: string;
  locator_recipe: AgentLocatorRecipeEntry[];
}

export type AgentLocatorRecipeEntry =
  | {
      strategy: "selector";
      selector: string;
      confidence: number;
    }
  | {
      strategy: "role_text";
      role: string;
      text: string;
      confidence: number;
    }
  | {
      strategy: "href";
      href: string;
      confidence: number;
    }
  | {
      strategy: "tag_text";
      tag: string;
      text: string;
      confidence: number;
    };

export function targetFromComponent(component: InteractiveComponentObservationItem): TargetDescriptorMap {
  const target: TargetDescriptorMap = {};

  if (component.selector) {
    target.selector = component.selector;
  }

  if (component.role) {
    target.role = component.role;
  }

  if (component.text) {
    target.text = component.text;
  }

  if (component.href) {
    target.url = component.href;
  }

  return target;
}

export function targetKey(component: InteractiveComponentObservationItem): string {
  return component.selector ?? `${component.role ?? component.tag}:${component.text}`;
}

export function candidateText(component: InteractiveComponentObservationItem): string {
  return [
    component.text,
    component.role ?? "",
    component.href ?? "",
    component.selector ?? "",
    component.tag
  ].join(" ");
}

export function replayHintFromComponent(component: InteractiveComponentObservationItem): AgentReplayTargetHint {
  return {
    candidate_fingerprint: candidateFingerprint(component),
    locator_recipe: locatorRecipeFromComponent(component)
  };
}

export function candidateFingerprint(component: InteractiveComponentObservationItem): string {
  const normalized = {
    selector: normalizeText(component.selector),
    role: normalizeText(component.role),
    text: normalizeText(component.text),
    href: normalizeUrl(component.href),
    tag: normalizeText(component.tag),
    bounds: normalizeBounds(component.bounds)
  };

  return `candidate:${createHash("sha256")
    .update(JSON.stringify(normalized))
    .digest("hex")
    .slice(0, 16)}`;
}

export function locatorRecipeFromComponent(component: InteractiveComponentObservationItem): AgentLocatorRecipeEntry[] {
  const recipe: AgentLocatorRecipeEntry[] = [];

  if (component.selector) {
    recipe.push({
      strategy: "selector",
      selector: component.selector,
      confidence: 0.9
    });
  }

  if (component.role && component.text) {
    recipe.push({
      strategy: "role_text",
      role: component.role,
      text: component.text,
      confidence: component.selector ? 0.78 : 0.84
    });
  }

  if (component.href) {
    recipe.push({
      strategy: "href",
      href: component.href,
      confidence: 0.72
    });
  }

  if (component.tag && component.text) {
    recipe.push({
      strategy: "tag_text",
      tag: component.tag,
      text: component.text,
      confidence: 0.62
    });
  }

  return recipe;
}

function normalizeText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeUrl(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);
    url.hash = "";
    return url.href.toLowerCase();
  } catch {
    return normalizeText(value);
  }
}

function normalizeBounds(componentBounds: InteractiveComponentObservationItem["bounds"]): Record<string, unknown> {
  return {
    x: Math.round(componentBounds.x),
    y: Math.round(componentBounds.y),
    width: Math.round(componentBounds.width),
    height: Math.round(componentBounds.height),
    unit: componentBounds.unit
  };
}
