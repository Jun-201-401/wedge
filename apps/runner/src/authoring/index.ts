import { randomUUID } from "node:crypto";
import type { CallbackClient } from "../callback/index.ts";
import type { RunnerConfig } from "../config/index.ts";
import type { ScenarioAuthoringExecuteMessage, ScenarioAuthoringProviderTraceEntry, ScenarioAuthoringProviderType } from "../shared/contracts.ts";
import {
  createFailedInternalLlmTrace,
  ScenarioAuthoringLlmProvider,
  type ScenarioAuthoringLlmTransport
} from "./llm-provider.ts";
import {
  createRuleBasedScenarioAuthoringResult,
  type ScenarioAuthoringProviderResult
} from "./rule-based-provider.ts";

export interface ScenarioAuthoringExecutionInput {
  message: ScenarioAuthoringExecuteMessage;
  config: RunnerConfig;
  callbackClient?: CallbackClient;
  llmTransport?: ScenarioAuthoringLlmTransport;
}

export interface ScenarioAuthoringExecutionResult extends ScenarioAuthoringProviderResult {
  authoringJobId: string;
  candidateCount: number;
}

export async function executeScenarioAuthoring({
  message,
  config,
  callbackClient,
  llmTransport
}: ScenarioAuthoringExecutionInput): Promise<ScenarioAuthoringExecutionResult> {
  const authoringJobId = message.payload.authoringJobId;

  try {
    await callbackClient?.sendScenarioAuthoringAccepted?.(authoringJobId, {
      eventId: randomUUID(),
      workerId: config.workerId,
      acceptedAt: new Date().toISOString()
    });

    const result = await createScenarioAuthoringResult(message, config, llmTransport);

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
        provider_type: firstProviderType(message) ?? "RULE_BASED"
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

async function createScenarioAuthoringResult(
  message: ScenarioAuthoringExecuteMessage,
  config: RunnerConfig,
  llmTransport?: ScenarioAuthoringLlmTransport
): Promise<ScenarioAuthoringProviderResult> {
  const providerTrace: ScenarioAuthoringProviderTraceEntry[] = [];
  const providerOrder = message.payload.providerPolicy.provider_order;
  const fallbackAllowed = message.payload.providerPolicy.fallback_allowed;
  let lastError: unknown = null;

  for (const providerType of providerOrder) {
    if (providerType === "INTERNAL_LLM") {
      const startedAt = new Date();
      try {
        const result = await new ScenarioAuthoringLlmProvider({
          endpoint: config.scenarioAuthoringLlmEndpoint,
          apiKey: config.scenarioAuthoringLlmApiKey,
          model: config.scenarioAuthoringLlmModel,
          timeoutMs: config.scenarioAuthoringLlmTimeoutMs,
          transport: llmTransport
        }).create(message);
        return {
          ...result,
          providerTrace: [...providerTrace, ...result.providerTrace]
        };
      } catch (error) {
        lastError = error;
        providerTrace.push(createFailedInternalLlmTrace({ model: config.scenarioAuthoringLlmModel }, startedAt, error));
        if (!fallbackAllowed) {
          break;
        }
        continue;
      }
    }

    if (providerType === "RULE_BASED") {
      const result = createRuleBasedScenarioAuthoringResult(message);
      return {
        ...result,
        providerTrace: [...providerTrace, ...result.providerTrace]
      };
    }

    providerTrace.push(skippedProviderTrace(providerType, "Provider is reserved but not implemented in runner ScenarioAuthoring."));
  }

  throw new Error(lastError instanceof Error ? lastError.message : "No ScenarioAuthoring provider produced a valid candidate");
}

function firstProviderType(message: ScenarioAuthoringExecuteMessage): ScenarioAuthoringProviderType | null {
  return message.payload.providerPolicy.provider_order[0] ?? null;
}

function skippedProviderTrace(
  providerType: ScenarioAuthoringProviderType,
  reason: string
): ScenarioAuthoringProviderTraceEntry {
  const now = new Date().toISOString();
  return {
    provider_type: providerType,
    provider_name: "runner-scenario-authoring-provider-router",
    status: "SKIPPED",
    fallback_reason: reason,
    started_at: now,
    finished_at: now
  };
}
