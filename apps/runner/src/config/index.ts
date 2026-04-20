import { hostname } from "node:os";
import { resolve } from "node:path";

export interface RunnerConfig {
  serviceName: string;
  workerId: string;
  artifactsRoot: string;
  callbackLogFile: string;
  artifactBucket: string;
  simulatedDelayCapMs: number;
}

export function loadRunnerConfig(overrides: Partial<RunnerConfig> = {}): RunnerConfig {
  const serviceName = overrides.serviceName ?? process.env.RUNNER_SERVICE_NAME ?? "runner";
  const artifactsRoot =
    overrides.artifactsRoot ??
    resolve(process.cwd(), process.env.RUNNER_ARTIFACTS_ROOT ?? ".runner-artifacts");

  return {
    serviceName,
    workerId: overrides.workerId ?? `${serviceName}-${hostname()}-${process.pid}`,
    artifactsRoot,
    callbackLogFile:
      overrides.callbackLogFile ??
      resolve(artifactsRoot, process.env.RUNNER_CALLBACK_LOG_FILE ?? "callbacks.jsonl"),
    artifactBucket: overrides.artifactBucket ?? process.env.RUNNER_ARTIFACT_BUCKET ?? "local-runner",
    simulatedDelayCapMs: overrides.simulatedDelayCapMs ?? Number(process.env.RUNNER_SIMULATED_DELAY_CAP_MS ?? 25)
  };
}
