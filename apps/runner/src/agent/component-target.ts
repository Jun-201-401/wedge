import type { InteractiveComponentObservationItem, TargetDescriptorMap } from "../shared/contracts.ts";

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
