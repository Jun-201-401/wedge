import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { RunnerConfig } from "../config/index.ts";
import { createArtifactStore, type ArtifactStore } from "../storage/index.ts";
import type {
  Artifact,
  ArtifactDraft,
  DiscoveryCheckpointRequest,
  DiscoveryFlowType,
  DiscoverySummaryPayload,
  ScenarioStage,
  SiteDiscoveryResult
} from "../shared/contracts.ts";
import type { DiscoveryCollectionResult, DiscoveryExecutionResult, ExecuteDiscoveryInput } from "./index.ts";

export interface DiscoveryPersistenceLifecycleInput {
  input: ExecuteDiscoveryInput;
  collect: (input: ExecuteDiscoveryInput) => Promise<DiscoveryCollectionResult>;
}

export async function executeDiscoveryPersistenceLifecycle({
  input,
  collect
}: DiscoveryPersistenceLifecycleInput): Promise<DiscoveryExecutionResult> {
  const browserSessionId = randomUUID();

  try {
    await input.callbackClient?.sendDiscoveryAccepted?.(input.message.payload.discoveryId, {
      eventId: randomUUID(),
      workerId: input.config.workerId,
      acceptedAt: new Date().toISOString(),
      browserSessionId
    });

    const collection = await collect(input);
    const artifactStore = input.artifactStore ?? createArtifactStore(input.config);
    const storedArtifactsByCheckpointId = await persistDiscoveryArtifacts(
      artifactStore,
      collection.result.discovery_id,
      collection.artifactDraftsByCheckpointId
    );
    const resultFile = createDiscoveryResultFilePath(input.config, collection.result.discovery_id);
    await writeDiscoveryResult(resultFile, collection.result);

    for (const checkpoint of createDiscoveryCheckpointRequests(
      collection.result,
      input.config.workerId,
      storedArtifactsByCheckpointId
    )) {
      await input.callbackClient?.sendDiscoveryCheckpoints?.(input.message.payload.discoveryId, checkpoint);
    }

    await input.callbackClient?.sendDiscoveryFinished?.(input.message.payload.discoveryId, {
      eventId: randomUUID(),
      workerId: input.config.workerId,
      finishedAt: new Date().toISOString(),
      finalUrl: collection.result.final_url,
      summary: createDiscoverySummaryPayload(collection.result)
    });

    return {
      discoveryId: collection.result.discovery_id,
      result: collection.result,
      resultFile
    };
  } catch (error) {
    await input.callbackClient?.sendDiscoveryFailed?.(input.message.payload.discoveryId, {
      eventId: randomUUID(),
      workerId: input.config.workerId,
      failedAt: new Date().toISOString(),
      failureCode: "DISCOVERY_EXECUTION_FAILED",
      failureMessage: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

export function createDiscoverySummaryPayload(result: SiteDiscoveryResult): DiscoverySummaryPayload {
  const recommendations = result.scenario_recommendations.map((recommendation) => ({
    scenarioType: recommendation.scenario_type,
    recommendationLevel: recommendation.recommendation_level,
    confidence: recommendation.confidence,
    reason: recommendation.reason,
    evidenceRefs: recommendation.evidence_refs,
    evidenceSummary: recommendation.evidence_summary ?? null,
    suggestedStartUrl: recommendation.suggested_start_url ?? null,
    suggestedTarget: recommendation.suggested_target ?? null
  }));

  return {
    detectedFlowTypes: result.detected_flow_types,
    missingFlowTypes: result.missing_flow_types ?? [],
    primaryCtaCount: countRecommendations(result, "LANDING_CTA"),
    formCandidateCount: countRecommendations(result, "SIGNUP_LEAD_FORM"),
    pricingEntrypointCount: countRecommendations(result, "PRICING"),
    checkoutEntrypointCount: countRecommendations(result, "PURCHASE_CHECKOUT"),
    scenarioRecommendations: recommendations
  };
}

export function createDiscoveryCheckpointRequests(
  result: SiteDiscoveryResult,
  workerId: string,
  storedArtifactsByCheckpointId: Map<string, Artifact[]> = new Map()
): DiscoveryCheckpointRequest[] {
  return result.checkpoints.map((checkpoint, index) => {
    const checkpointId = readString(checkpoint, "checkpoint_id", `cp_${String(index + 1).padStart(3, "0")}`);
    const durationMs = readNumber(checkpoint, "duration_ms") ?? readSettleDuration(checkpoint);
    const storedArtifacts = storedArtifactsByCheckpointId.get(checkpointId) ?? [];
    const callbackArtifacts = storedArtifacts.map(toDiscoveryCallbackArtifact);

    return {
      eventId: randomUUID(),
      workerId,
      checkpoint: {
        checkpointId,
        stepKey: readString(checkpoint, "step_key", `discovery_${checkpointId}`),
        stage: readScenarioStage(checkpoint, "stage", "FIRST_VIEW"),
        trigger: readRecord(checkpoint, "trigger", {
          type: "discovery",
          source: "site_discovery",
          inputUrl: result.input_url
        }),
        settle: readSettle(checkpoint, durationMs),
        state: readRecord(checkpoint, "state", {}),
        observations: readRecordArray(checkpoint, "observations"),
        deltas: readRecordArray(checkpoint, "deltas"),
        artifactRefs: callbackArtifacts.length > 0
          ? callbackArtifacts.map((artifact) => String(artifact.artifactId))
          : readStringArray(checkpoint, "artifact_refs")
      },
      artifacts: callbackArtifacts.length > 0 ? callbackArtifacts : readRecordArray(checkpoint, "artifacts"),
      observations: []
    };
  });
}

async function persistDiscoveryArtifacts(
  artifactStore: ArtifactStore,
  discoveryId: string,
  artifactDraftsByCheckpointId: Map<string, ArtifactDraft[]>
): Promise<Map<string, Artifact[]>> {
  const storedArtifactsByCheckpointId = new Map<string, Artifact[]>();

  for (const [checkpointId, artifacts] of artifactDraftsByCheckpointId) {
    if (artifacts.length === 0) {
      continue;
    }

    storedArtifactsByCheckpointId.set(
      checkpointId,
      await artifactStore.persistArtifacts({
        runId: discoveryId,
        artifacts
      })
    );
  }

  return storedArtifactsByCheckpointId;
}

export async function writeDiscoveryResult(resultFile: string, result: SiteDiscoveryResult): Promise<void> {
  await mkdir(dirname(resultFile), {
    recursive: true
  });
  await writeFile(resultFile, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}

export function createDiscoveryResultFilePath(config: RunnerConfig, discoveryId: string): string {
  return resolve(config.artifactsRoot, "discoveries", sanitizePathSegment(discoveryId), "site-discovery-result.json");
}

function toDiscoveryCallbackArtifact(artifact: Artifact): Record<string, unknown> {
  return {
    artifactId: artifact.artifactId,
    artifactType: artifact.artifactType,
    bucket: artifact.bucket,
    key: artifact.key,
    mimeType: artifact.mimeType,
    width: artifact.width,
    height: artifact.height,
    sizeBytes: artifact.sizeBytes,
    sha256: artifact.sha256,
    createdAt: artifact.createdAt,
    stepKey: artifact.stepKey
  };
}

function countRecommendations(result: SiteDiscoveryResult, flowType: DiscoveryFlowType): number {
  return result.flow_candidates
    ?.find((candidate) => candidate.flow_type === flowType)
    ?.entrypoint_candidates.length ?? 0;
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function readString(payload: Record<string, unknown>, key: string, fallback: string): string {
  const value = payload[key];
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function readNumber(payload: Record<string, unknown>, key: string): number | undefined {
  const value = payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readScenarioStage(payload: Record<string, unknown>, key: string, fallback: ScenarioStage): ScenarioStage {
  const value = payload[key];
  if (value === "FIRST_VIEW" || value === "VALUE" || value === "CTA" || value === "INPUT" || value === "COMMIT") {
    return value;
  }
  return fallback;
}

function readRecord(
  payload: Record<string, unknown>,
  key: string,
  fallback: Record<string, unknown>
): Record<string, unknown> {
  const value = payload[key];
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return fallback;
}

function readRecordArray(payload: Record<string, unknown>, key: string): Record<string, unknown>[] {
  const value = payload[key];
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is Record<string, unknown> =>
    Boolean(item) && typeof item === "object" && !Array.isArray(item)
  );
}

function readStringArray(payload: Record<string, unknown>, key: string): string[] {
  const value = payload[key];
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

function readSettle(payload: Record<string, unknown>, durationMs: number): DiscoveryCheckpointRequest["checkpoint"]["settle"] {
  const settle = readRecord(payload, "settle", {});
  return {
    ...settle,
    strategy: typeof settle.strategy === "string" ? settle.strategy : "domcontentloaded",
    durationMs,
    status: settle.status === "timeout" || settle.status === "failed" ? settle.status : "settled"
  };
}

function readSettleDuration(payload: Record<string, unknown>): number {
  const settle = readRecord(payload, "settle", {});
  return typeof settle.durationMs === "number" && Number.isFinite(settle.durationMs) ? settle.durationMs : 0;
}
