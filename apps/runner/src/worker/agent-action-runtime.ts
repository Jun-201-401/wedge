import type {
  AgentActionRuntime,
  AgentActionRuntimeErrorInput,
  AgentActionRuntimeFailureInput,
  AgentActionRuntimeStepInput
} from "../agent/index.ts";
import { emitFailureCheckpointArtifactsAndCallbacks } from "../scenario/executor/checkpoint-emitter.ts";
import { ScenarioExecutionError } from "../scenario/executor/index.ts";
import { executeScenarioStep } from "../scenario/executor/step-executor.ts";

export function createScenarioBackedAgentActionRuntime(): AgentActionRuntime {
  return {
    executeStep: (input: AgentActionRuntimeStepInput) =>
      executeScenarioStep({
        ...input,
        emitStepEvents: false
      }),
    emitFailureEvidence: (input: AgentActionRuntimeFailureInput) =>
      emitFailureCheckpointArtifactsAndCallbacks(input),
    createExecutionError: (input: AgentActionRuntimeErrorInput) =>
      new ScenarioExecutionError(input)
  };
}
