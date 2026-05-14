import type { AgentArtifactPolicy, RunExecuteMessage, ScenarioPlan } from "../shared/contracts.ts";

export function applyRunArtifactPolicy(
  scenarioPlan: ScenarioPlan,
  artifactPolicy: RunExecuteMessage["payload"]["artifactPolicy"]
): ScenarioPlan {
  const normalizedPolicy = normalizeRunArtifactPolicy(artifactPolicy);
  if (!normalizedPolicy) {
    return scenarioPlan;
  }

  return {
    ...scenarioPlan,
    artifact_policy: {
      ...scenarioPlan.artifact_policy,
      ...normalizedPolicy
    }
  };
}

function normalizeRunArtifactPolicy(
  artifactPolicy: RunExecuteMessage["payload"]["artifactPolicy"]
): AgentArtifactPolicy | null {
  if (!artifactPolicy) {
    return null;
  }

  const normalized: AgentArtifactPolicy = {};
  setOptionalBoolean(normalized, "capture_screenshots", readArtifactPolicyBoolean(artifactPolicy, "capture_screenshots", "captureScreenshot", "captureScreenshots"));
  setOptionalString(normalized, "screenshot_mode", readArtifactPolicyString(artifactPolicy, "screenshot_mode", "screenshotMode"));
  setOptionalBoolean(normalized, "capture_dom_snapshots", readArtifactPolicyBoolean(artifactPolicy, "capture_dom_snapshots", "captureDomSnapshot", "captureDomSnapshots"));
  setOptionalBoolean(normalized, "capture_ax_tree", readArtifactPolicyBoolean(artifactPolicy, "capture_ax_tree", "captureAxTree"));
  setOptionalBoolean(normalized, "capture_trace", readArtifactPolicyBoolean(artifactPolicy, "capture_trace", "captureTrace"));
  setOptionalBoolean(normalized, "capture_har", readArtifactPolicyBoolean(artifactPolicy, "capture_har", "captureHar"));
  setOptionalBoolean(normalized, "capture_performance", readArtifactPolicyBoolean(artifactPolicy, "capture_performance", "capturePerformance"));

  return Object.keys(normalized).length > 0 ? normalized : null;
}

function readArtifactPolicyString(
  artifactPolicy: RunExecuteMessage["payload"]["artifactPolicy"],
  ...keys: string[]
): string | undefined {
  if (!artifactPolicy) {
    return undefined;
  }
  const record = artifactPolicy as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string") {
      return value;
    }
  }
  return undefined;
}

function readArtifactPolicyBoolean(
  artifactPolicy: RunExecuteMessage["payload"]["artifactPolicy"],
  ...keys: string[]
): boolean | undefined {
  if (!artifactPolicy) {
    return undefined;
  }
  const record = artifactPolicy as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "boolean") {
      return value;
    }
  }
  return undefined;
}

function setOptionalBoolean<K extends keyof AgentArtifactPolicy>(
  policy: AgentArtifactPolicy,
  key: K,
  value: boolean | undefined
): void {
  if (value !== undefined) {
    policy[key] = value as never;
  }
}

function setOptionalString<K extends keyof AgentArtifactPolicy>(
  policy: AgentArtifactPolicy,
  key: K,
  value: string | undefined
): void {
  if (value !== undefined) {
    policy[key] = value as never;
  }
}
