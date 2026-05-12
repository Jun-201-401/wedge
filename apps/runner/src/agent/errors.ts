import { ScenarioExecutionError, type ScenarioExecutionSummary } from "../scenario/executor/index.ts";
import type { AgentTrace } from "../shared/contracts.ts";
import type { DeliverySummary } from "../delivery/index.ts";
import type { RunnerFailureCode } from "../shared/utils.ts";

export class AgentExecutionError extends ScenarioExecutionError {
  readonly trace: AgentTrace;

  constructor(input: {
    cause: unknown;
    summary: ScenarioExecutionSummary;
    delivery: DeliverySummary;
    failedStepKey: string;
    failedStepOrder: number;
    failureCode: RunnerFailureCode;
    trace: AgentTrace;
  }) {
    super(input);
    this.name = "AgentExecutionError";
    this.trace = input.trace;
  }
}
