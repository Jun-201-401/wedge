import type { CallbackClient } from "../../callback/index.ts";
import type { DeliveryIssue } from "../../delivery/index.ts";
import type { ArtifactStore } from "../../storage/index.ts";
import type { AgentTrace, ArtifactDraft } from "../../shared/contracts.ts";
import { errorMessage } from "../../shared/utils.ts";

export async function persistAgentTraceArtifact(input: {
  runId: string;
  trace: AgentTrace;
  artifactStore: ArtifactStore;
  callbackClient: CallbackClient;
}): Promise<DeliveryIssue[]> {
  const deliveryIssues: DeliveryIssue[] = [];
  const artifact: ArtifactDraft = {
    artifactId: input.trace.trace_id,
    artifactType: "TRACE",
    stepKey: "agent_trace",
    mimeType: "application/json",
    fileExtension: "json",
    content: `${JSON.stringify(input.trace, null, 2)}\n`
  };

  let storedArtifacts: Awaited<ReturnType<ArtifactStore["persistArtifacts"]>> = [];
  try {
    storedArtifacts = await input.artifactStore.persistArtifacts({
      runId: input.runId,
      artifacts: [artifact]
    });
  } catch (error) {
    deliveryIssues.push({
      scope: "artifact-storage",
      stepKey: artifact.stepKey,
      message: `agent trace artifact storage failed: ${errorMessage(error)}`
    });
    return deliveryIssues;
  }

  try {
    if (storedArtifacts.length > 0) {
      await input.callbackClient.sendArtifacts(input.runId, { artifacts: storedArtifacts });
    }
  } catch (error) {
    deliveryIssues.push({
      scope: "artifacts-callback",
      stepKey: artifact.stepKey,
      message: `agent trace artifact callback failed: ${errorMessage(error)}`
    });
  }

  return deliveryIssues;
}
