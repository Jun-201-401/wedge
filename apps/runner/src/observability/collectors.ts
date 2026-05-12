import type { CheckpointCollection } from "../capture/index.ts";
import type { Artifact, ArtifactDraft, ScenarioPlan } from "../shared/contracts.ts";

export type CollectorStatus = "success" | "failed" | "skipped";

export type CollectorName =
  | "screenshot"
  | "dom_snapshot"
  | "ax_tree"
  | "har"
  | "trace"
  | "performance"
  | "layout"
  | "network_timeline"
  | "visibility";

export interface CollectorStatusEntry {
  status: CollectorStatus;
  requested: boolean;
  count: number;
  reason?: string;
}

export type CollectorStatusSummary = Record<CollectorName, CollectorStatusEntry>;

const COLLECTOR_NAMES = [
  "screenshot",
  "dom_snapshot",
  "ax_tree",
  "har",
  "trace",
  "performance",
  "layout",
  "network_timeline",
  "visibility"
] as const satisfies readonly CollectorName[];

export interface ArtifactManifestSummary {
  requestedCount: number;
  storedCount: number;
  requestedTypes: Record<string, number>;
  storedTypes: Record<string, number>;
  totalStoredBytes: number;
  artifactIds: string[];
  storedKeys: string[];
}

export function createEmptyCollectorStatusSummary(plan?: ScenarioPlan): CollectorStatusSummary {
  return Object.fromEntries(
    COLLECTOR_NAMES.map((collector) => [collector, createSkippedCollectorStatus(isCollectorRequested(collector, plan), "not_observed")])
  ) as CollectorStatusSummary;
}

export function summarizeCheckpointCollectors(plan: ScenarioPlan, collection: CheckpointCollection): CollectorStatusSummary {
  const artifactCounts = countArtifactsByType(collection.artifacts);
  const observationCounts = countObservationsByType(collection.checkpoint.observations);

  return {
    screenshot: requiredArtifactStatus(artifactCounts.SCREENSHOT ?? 0),
    dom_snapshot: requiredArtifactStatus(artifactCounts.DOM_SNAPSHOT ?? 0),
    ax_tree: optionalArtifactStatus(plan.artifact_policy?.capture_ax_tree === true, artifactCounts.AX_TREE ?? 0, "policy_disabled"),
    har: optionalArtifactStatus(plan.artifact_policy?.capture_har === true, artifactCounts.HAR ?? 0, "no_network_events"),
    trace: optionalArtifactStatus(plan.artifact_policy?.capture_trace === true, artifactCounts.TRACE ?? 0, "policy_disabled"),
    performance: optionalObservationStatus(plan.artifact_policy?.capture_performance === true, observationCounts.performance_metric ?? 0, "policy_disabled"),
    layout: baselineObservationStatus(observationCounts.layout_collector ?? 0),
    network_timeline: baselineObservationStatus(observationCounts.network_timeline ?? 0),
    visibility: baselineObservationStatus((observationCounts.interactive_components ?? 0) + (observationCounts.visible_text_blocks ?? 0))
  };
}

export function mergeCollectorStatusSummaries(...summaries: Array<CollectorStatusSummary | undefined>): CollectorStatusSummary {
  const merged = createEmptyCollectorStatusSummary();

  for (const summary of summaries) {
    if (!summary) {
      continue;
    }

    for (const collector of COLLECTOR_NAMES) {
      merged[collector] = mergeCollectorStatus(merged[collector], summary[collector]);
    }
  }

  return merged;
}

export function summarizeArtifactManifest(input: {
  requestedArtifacts: ArtifactDraft[];
  storedArtifacts: Artifact[];
}): ArtifactManifestSummary {
  return {
    requestedCount: input.requestedArtifacts.length,
    storedCount: input.storedArtifacts.length,
    requestedTypes: countArtifactsByType(input.requestedArtifacts),
    storedTypes: countArtifactsByType(input.storedArtifacts),
    totalStoredBytes: input.storedArtifacts.reduce((total, artifact) => total + Math.max(artifact.sizeBytes ?? 0, 0), 0),
    artifactIds: input.storedArtifacts.map((artifact) => artifact.artifactId),
    storedKeys: input.storedArtifacts.map((artifact) => artifact.key)
  };
}

function requiredArtifactStatus(count: number): CollectorStatusEntry {
  return count > 0
    ? { status: "success", requested: true, count }
    : { status: "failed", requested: true, count, reason: "missing_required_artifact" };
}

function optionalArtifactStatus(requested: boolean, count: number, skippedReason: string): CollectorStatusEntry {
  if (!requested) {
    return createSkippedCollectorStatus(false, skippedReason);
  }

  return count > 0
    ? { status: "success", requested: true, count }
    : { status: "skipped", requested: true, count, reason: skippedReason };
}

function optionalObservationStatus(requested: boolean, count: number, skippedReason: string): CollectorStatusEntry {
  if (!requested) {
    return createSkippedCollectorStatus(false, skippedReason);
  }

  return count > 0
    ? { status: "success", requested: true, count }
    : { status: "skipped", requested: true, count, reason: "no_observation" };
}

function baselineObservationStatus(count: number): CollectorStatusEntry {
  return count > 0
    ? { status: "success", requested: true, count }
    : { status: "skipped", requested: true, count, reason: "no_observation" };
}

function createSkippedCollectorStatus(requested: boolean, reason: string): CollectorStatusEntry {
  return {
    status: "skipped",
    requested,
    count: 0,
    reason
  };
}

function mergeCollectorStatus(left: CollectorStatusEntry, right: CollectorStatusEntry): CollectorStatusEntry {
  const count = left.count + right.count;
  const requested = left.requested || right.requested;
  if (left.status === "failed" || right.status === "failed") {
    return { status: "failed", requested, count, reason: right.status === "failed" ? right.reason : left.reason };
  }
  if (left.status === "success" || right.status === "success") {
    return { status: "success", requested, count };
  }
  return { status: "skipped", requested, count, reason: right.reason ?? left.reason };
}

function isCollectorRequested(collector: CollectorName, plan?: ScenarioPlan): boolean {
  if (!plan) {
    return false;
  }

  if (collector === "ax_tree") {
    return plan.artifact_policy?.capture_ax_tree === true;
  }
  if (collector === "har") {
    return plan.artifact_policy?.capture_har === true;
  }
  if (collector === "trace") {
    return plan.artifact_policy?.capture_trace === true;
  }
  if (collector === "performance") {
    return plan.artifact_policy?.capture_performance === true;
  }
  return true;
}

function countArtifactsByType(artifacts: Array<Pick<Artifact | ArtifactDraft, "artifactType">>): Record<string, number> {
  return countBy(artifacts.map((artifact) => artifact.artifactType));
}

function countObservationsByType(observations: Array<Record<string, unknown>>): Record<string, number> {
  return countBy(observations.flatMap((observation) => typeof observation.type === "string" ? [observation.type] : []));
}

function countBy(values: string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}
