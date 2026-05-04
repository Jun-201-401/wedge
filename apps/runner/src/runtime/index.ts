export interface CloseableRuntimeResource {
  close: () => Promise<void>;
}

export const RUNNER_MQ_WORKER_NAMES = {
  mqConsumer: "mq-consumer",
  callbackOutboxReplay: "callback-outbox-replay",
  artifactOutboxReplay: "artifact-outbox-replay"
} as const;

export interface RunnerMqRuntimeConfig {
  mqCallbackOutboxWorkerEnabled: boolean;
  mqArtifactOutboxWorkerEnabled: boolean;
}

export interface RunnerMqRuntime {
  close: () => Promise<void>;
  mqConsumer: CloseableRuntimeResource;
  callbackOutboxWorker?: CloseableRuntimeResource;
  artifactOutboxWorker?: CloseableRuntimeResource;
  enabledWorkers: string[];
}

export interface StartRunnerMqRuntimeInput {
  config: RunnerMqRuntimeConfig;
  startMqConsumer: () => Promise<CloseableRuntimeResource>;
  startCallbackOutboxReplayWorker: () => Promise<CloseableRuntimeResource>;
  startArtifactOutboxReplayWorker: () => Promise<CloseableRuntimeResource>;
}

export async function startRunnerMqRuntime({
  config,
  startMqConsumer,
  startCallbackOutboxReplayWorker,
  startArtifactOutboxReplayWorker
}: StartRunnerMqRuntimeInput): Promise<RunnerMqRuntime> {
  const startedResources: CloseableRuntimeResource[] = [];
  let callbackOutboxWorker: CloseableRuntimeResource | undefined;
  let artifactOutboxWorker: CloseableRuntimeResource | undefined;
  let mqConsumer: CloseableRuntimeResource | undefined;

  try {
    if (config.mqCallbackOutboxWorkerEnabled) {
      callbackOutboxWorker = await startCallbackOutboxReplayWorker();
      startedResources.push(callbackOutboxWorker);
    }

    if (config.mqArtifactOutboxWorkerEnabled) {
      artifactOutboxWorker = await startArtifactOutboxReplayWorker();
      startedResources.push(artifactOutboxWorker);
    }

    mqConsumer = await startMqConsumer();
    startedResources.push(mqConsumer);
  } catch (error) {
    try {
      await closeRuntimeResources([...startedResources].reverse());
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "failed to start runner MQ runtime and cleanup started resources");
    }

    throw error;
  }

  return {
    mqConsumer,
    callbackOutboxWorker,
    artifactOutboxWorker,
    enabledWorkers: [
      RUNNER_MQ_WORKER_NAMES.mqConsumer,
      ...(callbackOutboxWorker ? [RUNNER_MQ_WORKER_NAMES.callbackOutboxReplay] : []),
      ...(artifactOutboxWorker ? [RUNNER_MQ_WORKER_NAMES.artifactOutboxReplay] : [])
    ],
    close: async () => {
      await closeRuntimeResources([...startedResources].reverse());
    }
  };
}

async function closeRuntimeResources(resources: CloseableRuntimeResource[]): Promise<void> {
  const errors: unknown[] = [];

  for (const resource of resources) {
    try {
      await resource.close();
    } catch (error) {
      errors.push(error);
    }
  }

  if (errors.length === 1) {
    throw errors[0];
  }

  if (errors.length > 1) {
    throw new AggregateError(errors, "failed to close runner runtime resources");
  }
}
