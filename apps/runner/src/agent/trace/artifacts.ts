import type { CallbackClient } from "../../callback/index.ts";
import type { DeliveryIssue } from "../../delivery/index.ts";
import type { AgentTask, Artifact, ArtifactDraft } from "../../shared/contracts.ts";
import { errorMessage } from "../../shared/utils.ts";
import type { ArtifactStore } from "../../storage/index.ts";
import { createAgentScenarioPlanExportArtifact, type AgentTraceScenarioPlanExport } from "./export.ts";
import { createAgentTraceArtifact, type AgentTrace } from "./index.ts";

export async function persistAgentTraceArtifact({
  task,
  runId,
  trace,
  artifactStore,
  callbackClient
}: {
  task: AgentTask;
  runId: string;
  trace: AgentTrace;
  artifactStore: ArtifactStore;
  callbackClient: CallbackClient;
}): Promise<{ artifact?: Artifact; deliveryIssues: DeliveryIssue[] }> {
  return persistAgentArtifact({
    runId,
    artifactStore,
    callbackClient,
    shouldPersist: task.artifact_policy?.capture_trace !== false,
    createArtifact: () => createAgentTraceArtifact(trace),
    stepKey: "agent_trace",
    storageFailureMessage: "agent trace artifact storage failed",
    callbackFailureMessage: "agent trace artifact callback failed"
  });
}

export async function persistAgentScenarioPlanExportArtifact({
  task,
  runId,
  traceExport,
  artifactStore,
  callbackClient
}: {
  task: AgentTask;
  runId: string;
  traceExport: AgentTraceScenarioPlanExport;
  artifactStore: ArtifactStore;
  callbackClient: CallbackClient;
}): Promise<{ artifact?: Artifact; deliveryIssues: DeliveryIssue[] }> {
  return persistAgentArtifact({
    runId,
    artifactStore,
    callbackClient,
    shouldPersist: task.artifact_policy?.capture_trace !== false && traceExport.status === "EXPORTED",
    createArtifact: () => createAgentScenarioPlanExportArtifact(traceExport),
    stepKey: "agent_scenario_plan_export",
    storageFailureMessage: "agent scenario plan export artifact storage failed",
    callbackFailureMessage: "agent scenario plan export artifact callback failed"
  });
}

async function persistAgentArtifact({
  runId,
  artifactStore,
  callbackClient,
  shouldPersist,
  createArtifact,
  stepKey,
  storageFailureMessage,
  callbackFailureMessage
}: {
  runId: string;
  artifactStore: ArtifactStore;
  callbackClient: CallbackClient;
  shouldPersist: boolean;
  createArtifact: () => ArtifactDraft;
  stepKey: string;
  storageFailureMessage: string;
  callbackFailureMessage: string;
}): Promise<{ artifact?: Artifact; deliveryIssues: DeliveryIssue[] }> {
  if (!shouldPersist) {
    return {
      deliveryIssues: []
    };
  }

  const deliveryIssues: DeliveryIssue[] = [];
  let storedArtifacts: Artifact[] = [];

  try {
    storedArtifacts = await artifactStore.persistArtifacts({
      runId,
      artifacts: [createArtifact()]
    });
  } catch (error) {
    deliveryIssues.push({
      scope: "artifact-storage",
      stepKey,
      message: `${storageFailureMessage}: ${errorMessage(error)}`
    });
  }

  if (storedArtifacts.length > 0) {
    try {
      await callbackClient.sendArtifacts(runId, {
        artifacts: storedArtifacts
      });
    } catch (error) {
      deliveryIssues.push({
        scope: "artifacts-callback",
        stepKey,
        message: `${callbackFailureMessage}: ${errorMessage(error)}`
      });
    }
  }

  return {
    artifact: storedArtifacts[0],
    deliveryIssues
  };
}
