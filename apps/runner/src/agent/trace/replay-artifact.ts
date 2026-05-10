import type { CallbackClient } from "../../callback/index.ts";
import type { DeliveryIssue } from "../../delivery/index.ts";
import type { ArtifactStore } from "../../storage/index.ts";
import type { ArtifactDraft, ScenarioPlan } from "../../shared/contracts.ts";
import { errorMessage } from "../../shared/utils.ts";

export async function persistAgentReplayPlanArtifact(input: {
  runId: string;
  traceId: string;
  plan: ScenarioPlan;
  artifactStore: ArtifactStore;
  callbackClient: CallbackClient;
}): Promise<DeliveryIssue[]> {
  const deliveryIssues: DeliveryIssue[] = [];
  const artifact: ArtifactDraft = {
    artifactId: `${input.traceId}-replay-plan`,
    artifactType: "OTHER",
    stepKey: "agent_replay_plan",
    mimeType: "application/json",
    fileExtension: "json",
    content: `${JSON.stringify(input.plan, null, 2)}\n`
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
      message: `agent replay plan artifact storage failed: ${errorMessage(error)}`
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
      message: `agent replay plan artifact callback failed: ${errorMessage(error)}`
    });
  }

  return deliveryIssues;
}
