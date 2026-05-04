import assert from "node:assert/strict";
import test from "node:test";
import {
  RUNNER_MQ_WORKER_NAMES,
  startRunnerMqRuntime,
  type CloseableRuntimeResource,
  type RunnerMqRuntimeConfig
} from "../src/runtime/index.ts";

test("[MQ 운영 모드] consumer와 callback/artifact outbox replay worker를 함께 시작하고 역순으로 종료한다", async () => {
  const events: string[] = [];

  const runtime = await startRunnerMqRuntime({
    config: createRuntimeConfig(),
    startCallbackOutboxReplayWorker: async () => createResource("callback", events),
    startArtifactOutboxReplayWorker: async () => createResource("artifact", events),
    startMqConsumer: async () => createResource("mq", events)
  });

  assert.deepEqual(events, ["start:callback", "start:artifact", "start:mq"]);
  assert.deepEqual(runtime.enabledWorkers, [
    RUNNER_MQ_WORKER_NAMES.mqConsumer,
    RUNNER_MQ_WORKER_NAMES.callbackOutboxReplay,
    RUNNER_MQ_WORKER_NAMES.artifactOutboxReplay
  ]);
  assert.ok(runtime.mqConsumer);
  assert.ok(runtime.callbackOutboxWorker);
  assert.ok(runtime.artifactOutboxWorker);

  await runtime.close();

  assert.deepEqual(events, [
    "start:callback",
    "start:artifact",
    "start:mq",
    "close:mq",
    "close:artifact",
    "close:callback"
  ]);
});

test("[MQ 운영 모드] 설정으로 outbox replay worker를 비활성화하면 MQ consumer만 시작한다", async () => {
  const events: string[] = [];

  const runtime = await startRunnerMqRuntime({
    config: createRuntimeConfig({
      mqCallbackOutboxWorkerEnabled: false,
      mqArtifactOutboxWorkerEnabled: false
    }),
    startCallbackOutboxReplayWorker: async () => createResource("callback", events),
    startArtifactOutboxReplayWorker: async () => createResource("artifact", events),
    startMqConsumer: async () => createResource("mq", events)
  });

  assert.deepEqual(events, ["start:mq"]);
  assert.deepEqual(runtime.enabledWorkers, [RUNNER_MQ_WORKER_NAMES.mqConsumer]);
  assert.equal(runtime.callbackOutboxWorker, undefined);
  assert.equal(runtime.artifactOutboxWorker, undefined);

  await runtime.close();

  assert.deepEqual(events, ["start:mq", "close:mq"]);
});

test("[MQ 운영 모드] MQ consumer 시작 실패 시 먼저 띄운 recovery worker를 정리한다", async () => {
  const events: string[] = [];

  await assert.rejects(
    () =>
      startRunnerMqRuntime({
        config: createRuntimeConfig(),
        startCallbackOutboxReplayWorker: async () => createResource("callback", events),
        startArtifactOutboxReplayWorker: async () => createResource("artifact", events),
        startMqConsumer: async () => {
          events.push("start:mq");
          throw new Error("mq unavailable");
        }
      }),
    /mq unavailable/
  );

  assert.deepEqual(events, [
    "start:callback",
    "start:artifact",
    "start:mq",
    "close:artifact",
    "close:callback"
  ]);
});

function createResource(name: string, events: string[]): CloseableRuntimeResource {
  events.push(`start:${name}`);

  return {
    close: async () => {
      events.push(`close:${name}`);
    }
  };
}

function createRuntimeConfig(overrides: Partial<RunnerMqRuntimeConfig> = {}): RunnerMqRuntimeConfig {
  return {
    mqCallbackOutboxWorkerEnabled: true,
    mqArtifactOutboxWorkerEnabled: true,
    ...overrides
  };
}
