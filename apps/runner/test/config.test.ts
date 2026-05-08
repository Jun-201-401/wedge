import assert from "node:assert/strict";
import test from "node:test";
import {
  loadRunnerConfig,
  RUNNER_MQ_ARTIFACT_OUTBOX_WORKER_ENABLED_ENV,
  RUNNER_MQ_CALLBACK_OUTBOX_WORKER_ENABLED_ENV
} from "../src/config/index.ts";

const ARTIFACT_ENV_KEYS = [
  "RUNNER_ARTIFACT_STORAGE",
  "RUNNER_ARTIFACT_BUCKET",
  "RUNNER_ARTIFACT_S3_ENDPOINT",
  "RUNNER_ARTIFACT_S3_REGION",
  "RUNNER_ARTIFACT_S3_ACCESS_KEY_ID",
  "RUNNER_ARTIFACT_S3_SECRET_ACCESS_KEY",
  "RUNNER_ARTIFACT_S3_FORCE_PATH_STYLE",
  "AWS_REGION",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY"
] as const;

const MQ_RUNTIME_ENV_KEYS = [
  RUNNER_MQ_CALLBACK_OUTBOX_WORKER_ENABLED_ENV,
  RUNNER_MQ_ARTIFACT_OUTBOX_WORKER_ENABLED_ENV,
  "RUNNER_MQ_PREFETCH",
  "RUNNER_AGENT_CONCURRENCY",
  "RUNNER_AGENT_IDEMPOTENCY_STORE_ENABLED",
  "RUNNER_AGENT_IDEMPOTENCY_STORE_MODE",
  "RUNNER_MQ_MAX_DELIVERY_ATTEMPTS"
] as const;

const AGENT_LLM_ENV_KEYS = [
  "RUNNER_AGENT_DECISION_MODE",
  "RUNNER_AGENT_LLM_ENDPOINT",
  "RUNNER_AGENT_LLM_API_KEY",
  "RUNNER_AGENT_LLM_MODEL",
  "RUNNER_AGENT_LLM_TIMEOUT_MS"
] as const;

type ArtifactEnvKey = typeof ARTIFACT_ENV_KEYS[number];
type MqRuntimeEnvKey = typeof MQ_RUNTIME_ENV_KEYS[number];
type AgentLlmEnvKey = typeof AGENT_LLM_ENV_KEYS[number];
type EnvSnapshot<K extends string> = Partial<Record<K, string>>;

test("[설정] artifact storage 기본값은 로컬 filesystem이다", () => {
  withArtifactEnv({}, () => {
    const config = loadRunnerConfig({ serviceName: "runner-test" });

    assert.equal(config.artifactStoreMode, "filesystem");
    assert.equal(config.artifactBucket, "local-runner");
    assert.equal(config.artifactS3Endpoint, undefined);
    assert.equal(config.artifactS3Region, "us-east-1");
    assert.equal(config.artifactS3AccessKeyId, undefined);
    assert.equal(config.artifactS3SecretAccessKey, undefined);
    assert.equal(config.artifactS3ForcePathStyle, false);
  });
});

test("[설정] S3 artifact storage 환경변수를 RunnerConfig로 읽는다", () => {
  withArtifactEnv(
    {
      RUNNER_ARTIFACT_STORAGE: "s3",
      RUNNER_ARTIFACT_BUCKET: "wedge-artifacts-prod",
      RUNNER_ARTIFACT_S3_ENDPOINT: "https://s3.ap-northeast-2.amazonaws.com",
      RUNNER_ARTIFACT_S3_REGION: "ap-northeast-2",
      RUNNER_ARTIFACT_S3_ACCESS_KEY_ID: "artifact-access-key",
      RUNNER_ARTIFACT_S3_SECRET_ACCESS_KEY: "artifact-secret-key",
      RUNNER_ARTIFACT_S3_FORCE_PATH_STYLE: "false"
    },
    () => {
      const config = loadRunnerConfig({ serviceName: "runner-test" });

      assert.equal(config.artifactStoreMode, "s3");
      assert.equal(config.artifactBucket, "wedge-artifacts-prod");
      assert.equal(config.artifactS3Endpoint, "https://s3.ap-northeast-2.amazonaws.com");
      assert.equal(config.artifactS3Region, "ap-northeast-2");
      assert.equal(config.artifactS3AccessKeyId, "artifact-access-key");
      assert.equal(config.artifactS3SecretAccessKey, "artifact-secret-key");
      assert.equal(config.artifactS3ForcePathStyle, false);
    }
  );
});

test("[설정] AWS S3 모드에서는 AWS SDK 표준 credential 환경변수를 사용할 수 있다", () => {
  withArtifactEnv(
    {
      RUNNER_ARTIFACT_STORAGE: "s3",
      RUNNER_ARTIFACT_BUCKET: "wedge-artifacts-prod",
      AWS_REGION: "ap-northeast-2",
      AWS_ACCESS_KEY_ID: "aws-access-key",
      AWS_SECRET_ACCESS_KEY: "aws-secret-key"
    },
    () => {
      const config = loadRunnerConfig({ serviceName: "runner-test" });

      assert.equal(config.artifactStoreMode, "s3");
      assert.equal(config.artifactBucket, "wedge-artifacts-prod");
      assert.equal(config.artifactS3Endpoint, undefined);
      assert.equal(config.artifactS3Region, "ap-northeast-2");
      assert.equal(config.artifactS3AccessKeyId, "aws-access-key");
      assert.equal(config.artifactS3SecretAccessKey, "aws-secret-key");
      assert.equal(config.artifactS3ForcePathStyle, false);
    }
  );
});

test("[설정] 지원하지 않는 artifact storage 값은 filesystem으로 안전하게 fallback한다", () => {
  withArtifactEnv({ RUNNER_ARTIFACT_STORAGE: "memory" }, () => {
    const config = loadRunnerConfig({ serviceName: "runner-test" });

    assert.equal(config.artifactStoreMode, "filesystem");
  });
});

test("[설정] MQ consumer 모드는 callback/artifact outbox replay worker를 기본 활성화한다", () => {
  withMqRuntimeEnv({}, () => {
    const config = loadRunnerConfig({ serviceName: "runner-test" });

    assert.equal(config.mqCallbackOutboxWorkerEnabled, true);
    assert.equal(config.mqArtifactOutboxWorkerEnabled, true);
  });
});

test("[설정] MQ consumer outbox replay worker는 환경변수로 끌 수 있다", () => {
  withMqRuntimeEnv(
    {
      RUNNER_MQ_CALLBACK_OUTBOX_WORKER_ENABLED: "false",
      RUNNER_MQ_ARTIFACT_OUTBOX_WORKER_ENABLED: "0"
    },
    () => {
      const config = loadRunnerConfig({ serviceName: "runner-test" });

      assert.equal(config.mqCallbackOutboxWorkerEnabled, false);
      assert.equal(config.mqArtifactOutboxWorkerEnabled, false);
    }
  );
});

test("[설정] Agent concurrency는 MQ prefetch와 별도 환경변수로 읽는다", () => {
  withMqRuntimeEnv(
    {
      RUNNER_MQ_PREFETCH: "4",
      RUNNER_AGENT_CONCURRENCY: "1"
    },
    () => {
      const config = loadRunnerConfig({ serviceName: "runner-test" });

      assert.equal(config.mqPrefetch, 4);
      assert.equal(config.agentConcurrency, 1);
    }
  );
});

test("[설정] Agent concurrency는 1 이상의 정수만 허용한다", () => {
  withMqRuntimeEnv(
    {
      RUNNER_AGENT_CONCURRENCY: "0"
    },
    () => {
      const config = loadRunnerConfig({ serviceName: "runner-test" });

      assert.equal(config.agentConcurrency, 1);
    }
  );
});

test("[설정] Agent idempotency store는 기본 활성화되고 환경변수로 끌 수 있다", () => {
  withMqRuntimeEnv({}, () => {
    const config = loadRunnerConfig({ serviceName: "runner-test" });

    assert.equal(config.agentIdempotencyStoreEnabled, true);
    assert.equal(config.agentIdempotencyStoreMode, "local");
    assert.equal(config.agentIdempotencyLeaseTtlMs, 300_000);
  });

  withMqRuntimeEnv(
    {
      RUNNER_AGENT_IDEMPOTENCY_STORE_ENABLED: "false"
    },
    () => {
      const config = loadRunnerConfig({ serviceName: "runner-test" });

      assert.equal(config.agentIdempotencyStoreEnabled, false);
    }
  );
});

test("[설정] Agent idempotency store mode는 API 저장소 모드를 읽는다", () => {
  withMqRuntimeEnv(
    {
      RUNNER_AGENT_IDEMPOTENCY_STORE_MODE: "api",
      RUNNER_AGENT_IDEMPOTENCY_LEASE_TTL_MS: "120000"
    },
    () => {
      const config = loadRunnerConfig({ serviceName: "runner-test" });

      assert.equal(config.agentIdempotencyStoreMode, "api");
      assert.equal(config.agentIdempotencyLeaseTtlMs, 120_000);
    }
  );
});

test("[설정] MQ max delivery attempts는 poison message 차단용 양의 정수만 허용한다", () => {
  withMqRuntimeEnv(
    {
      RUNNER_MQ_MAX_DELIVERY_ATTEMPTS: "5"
    },
    () => {
      const config = loadRunnerConfig({ serviceName: "runner-test" });

      assert.equal(config.mqMaxDeliveryAttempts, 5);
    }
  );

  withMqRuntimeEnv(
    {
      RUNNER_MQ_MAX_DELIVERY_ATTEMPTS: "0"
    },
    () => {
      const config = loadRunnerConfig({ serviceName: "runner-test" });

      assert.equal(config.mqMaxDeliveryAttempts, 3);
    }
  );
});

test("[설정] Agent decision client는 기본 heuristic이고 env로만 LLM mode를 활성화한다", () => {
  withAgentLlmEnv({}, () => {
    const config = loadRunnerConfig({ serviceName: "runner-test" });

    assert.equal(config.agentDecisionMode, "heuristic");
    assert.equal(config.agentLlmEndpoint, undefined);
    assert.equal(config.agentLlmModel, "agent-decision");
    assert.equal(config.agentLlmTimeoutMs, 10_000);
  });

  withAgentLlmEnv(
    {
      RUNNER_AGENT_DECISION_MODE: "llm",
      RUNNER_AGENT_LLM_ENDPOINT: "https://llm.example/decision",
      RUNNER_AGENT_LLM_API_KEY: "secret",
      RUNNER_AGENT_LLM_MODEL: "agent-model",
      RUNNER_AGENT_LLM_TIMEOUT_MS: "5000"
    },
    () => {
      const config = loadRunnerConfig({ serviceName: "runner-test" });

      assert.equal(config.agentDecisionMode, "llm");
      assert.equal(config.agentLlmEndpoint, "https://llm.example/decision");
      assert.equal(config.agentLlmApiKey, "secret");
      assert.equal(config.agentLlmModel, "agent-model");
      assert.equal(config.agentLlmTimeoutMs, 5_000);
    }
  );
});

function withArtifactEnv(values: Partial<Record<ArtifactEnvKey, string>>, run: () => void): void {
  withEnv(ARTIFACT_ENV_KEYS, values, run);
}

function withMqRuntimeEnv(values: Partial<Record<MqRuntimeEnvKey, string>>, run: () => void): void {
  withEnv(MQ_RUNTIME_ENV_KEYS, values, run);
}

function withAgentLlmEnv(values: Partial<Record<AgentLlmEnvKey, string>>, run: () => void): void {
  withEnv(AGENT_LLM_ENV_KEYS, values, run);
}

function withEnv<K extends string>(
  keys: readonly K[],
  values: Partial<Record<K, string>>,
  run: () => void
): void {
  const previous = snapshotEnv(keys);

  try {
    for (const key of keys) {
      delete process.env[key];
    }

    for (const [key, value] of Object.entries(values) as Array<[K, string]>) {
      process.env[key] = value;
    }

    run();
  } finally {
    restoreEnv(keys, previous);
  }
}

function snapshotEnv<K extends string>(keys: readonly K[]): EnvSnapshot<K> {
  const snapshot: EnvSnapshot<K> = {};

  for (const key of keys) {
    if (process.env[key] !== undefined) {
      snapshot[key] = process.env[key];
    }
  }

  return snapshot;
}

function restoreEnv<K extends string>(keys: readonly K[], snapshot: EnvSnapshot<K>): void {
  for (const key of keys) {
    delete process.env[key];
  }

  for (const [key, value] of Object.entries(snapshot) as Array<[K, string]>) {
    process.env[key] = value;
  }
}
