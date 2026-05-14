import type { TargetDescriptor } from "../../shared/contracts.ts";
import { describeTarget } from "../../shared/utils.ts";

export function inferFieldKey(target: TargetDescriptor | undefined, fallback: string): string {
  if (target && typeof target === "object") {
    if (typeof target.label === "string" && target.label.length > 0) {
      return target.label;
    }

    if (Array.isArray(target.label_any) && target.label_any.length > 0) {
      return target.label_any[0];
    }

    if (typeof target.placeholder === "string" && target.placeholder.length > 0) {
      return target.placeholder;
    }

    if (Array.isArray(target.placeholder_any) && target.placeholder_any.length > 0) {
      return target.placeholder_any[0];
    }

    if (typeof target.name === "string" && target.name.length > 0) {
      return target.name;
    }

    if (Array.isArray(target.name_any) && target.name_any.length > 0) {
      return target.name_any[0];
    }

    if (typeof target.selector === "string" && target.selector.length > 0) {
      return target.selector;
    }
  }

  return fallback;
}

export function inferGotoUrl(target: TargetDescriptor | undefined, fallbackUrl: string): string {
  if (typeof target === "string") {
    return target;
  }

  if (target && typeof target === "object" && typeof target.url === "string" && target.url.length > 0) {
    return target.url;
  }

  return fallbackUrl;
}

export function inferNavigationUrl(currentUrl: string, target: TargetDescriptor | undefined): string | null {
  if (target && typeof target === "object" && typeof target.url === "string") {
    return target.url;
  }

  const targetText = describeTarget(target)?.toLowerCase() ?? "";
  if (targetText.includes("signup") || targetText.includes("회원가입") || targetText.includes("start free")) {
    return new URL("/signup", currentUrl).toString();
  }

  return null;
}
