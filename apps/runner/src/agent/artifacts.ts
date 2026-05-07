import type { CallbackClient } from "../callback/index.ts";
import type { DeliveryIssue } from "../delivery/index.ts";
import type { AgentTask, Artifact } from "../shared/contracts.ts";
import { errorMessage } from "../shared/utils.ts";
import type { ArtifactStore } from "../storage/index.ts";
import { createAgentScenarioPlanExportArtifact, type AgentTraceScenarioPlanExport } from "./trace-export.ts";
import { createAgentTraceArtifact, type AgentTrace } from "./trace.ts";

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
  if (task.artifact_policy?.capture_trace === false) {
    return {
      deliveryIssues: []
    };
  }

  const deliveryIssues: DeliveryIssue[] = [];
  let storedArtifacts: Artifact[] = [];

  try {
    storedArtifacts = await artifactStore.persistArtifacts({
      runId,
      artifacts: [createAgentTraceArtifact(trace)]
    });
  } catch (error) {
    deliveryIssues.push({
      scope: "artifact-storage",
      stepKey: "agent_trace",
      message: `agent trace artifact storage failed: ${errorMessage(error)}`
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
        stepKey: "agent_trace",
        message: `agent trace artifact callback failed: ${errorMessage(error)}`
      });
    }
  }

  return {
    artifact: storedArtifacts[0],
    deliveryIssues
  };
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
  if (task.artifact_policy?.capture_trace === false || traceExport.status !== "EXPORTED") {
    return {
      deliveryIssues: []
    };
  }

  const deliveryIssues: DeliveryIssue[] = [];
  let storedArtifacts: Artifact[] = [];

  try {
    storedArtifacts = await artifactStore.persistArtifacts({
      runId,
      artifacts: [createAgentScenarioPlanExportArtifact(traceExport)]
    });
  } catch (error) {
    deliveryIssues.push({
      scope: "artifact-storage",
      stepKey: "agent_scenario_plan_export",
      message: `agent scenario plan export artifact storage failed: ${errorMessage(error)}`
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
        stepKey: "agent_scenario_plan_export",
        message: `agent scenario plan export artifact callback failed: ${errorMessage(error)}`
      });
    }
  }

  return {
    artifact: storedArtifacts[0],
    deliveryIssues
  };
}
