import { randomUUID } from "node:crypto";
import type { CallbackClient } from "../callback/index.ts";
import type { RunnerConfig } from "../config/index.ts";
import type { ScenarioAuthoringExecuteMessage } from "../shared/contracts.ts";
import {
  createRuleBasedScenarioAuthoringResult,
  type ScenarioAuthoringProviderResult
} from "./rule-based-provider.ts";

export interface ScenarioAuthoringExecutionInput {
  message: ScenarioAuthoringExecuteMessage;
  config: RunnerConfig;
  callbackClient?: CallbackClient;
}

export interface ScenarioAuthoringExecutionResult extends ScenarioAuthoringProviderResult {
  authoringJobId: string;
  candidateCount: number;
}

export async function executeScenarioAuthoring({
  message,
  config,
  callbackClient
}: ScenarioAuthoringExecutionInput): Promise<ScenarioAuthoringExecutionResult> {
  const authoringJobId = message.payload.authoringJobId;

  try {
    await callbackClient?.sendScenarioAuthoringAccepted?.(authoringJobId, {
      eventId: randomUUID(),
      workerId: config.workerId,
      acceptedAt: new Date().toISOString()
    });

    const result = createRuleBasedScenarioAuthoringResult(message);

    await callbackClient?.sendScenarioAuthoringFinished?.(authoringJobId, {
      eventId: randomUUID(),
      workerId: config.workerId,
      finishedAt: new Date().toISOString(),
      providerTrace: result.providerTrace,
      candidates: result.candidates,
      validation: result.validation,
      provenance: result.provenance
    });

    return {
      authoringJobId,
      candidateCount: result.candidates.length,
      ...result
    };
  } catch (error) {
    const failureMessage = error instanceof Error ? error.message : String(error);
    await callbackClient?.sendScenarioAuthoringFailed?.(authoringJobId, {
      eventId: randomUUID(),
      workerId: config.workerId,
      failedAt: new Date().toISOString(),
      failure: {
        failure_code: "SCENARIO_AUTHORING_FAILED",
        failure_message: failureMessage,
        provider_type: "RULE_BASED"
      },
      providerTrace: [],
      validation: {
        schema_valid: false,
        safety_valid: false,
        fit_requirements_valid: false,
        errors: [
          {
            code: "SCENARIO_AUTHORING_FAILED",
            message: failureMessage
          }
        ],
        warnings: []
      },
      provenance: {
        source_discovery_id: message.payload.sourceDiscoveryId,
        source_evidence_refs: [],
        prompt_version: "scenario-authoring-v1",
        generated_at: new Date().toISOString()
      }
    });
    throw error;
  }
}
