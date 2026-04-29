import assert from "node:assert/strict";
import test from "node:test";
import { loadRunnerConfig } from "../src/config/index.ts";

const ARTIFACT_ENV_KEYS = [
  "RUNNER_ARTIFACT_STORAGE",
  "RUNNER_ARTIFACT_BUCKET",
  "RUNNER_ARTIFACT_PREFIX",
  "AWS_REGION"
] as const;

type ArtifactEnvKey = typeof ARTIFACT_ENV_KEYS[number];

test("loadRunnerConfig defaults artifact storage to filesystem", () => {
  withArtifactEnv({}, () => {
    const config = loadRunnerConfig({ serviceName: "runner-test" });

    assert.equal(config.artifactStorage, "filesystem");
    assert.equal(config.artifactBucket, "local-runner");
    assert.equal(config.artifactPrefix, "");
    assert.equal(config.awsRegion, undefined);
  });
});

test("loadRunnerConfig reads S3 artifact storage environment", () => {
  withArtifactEnv(
    {
      RUNNER_ARTIFACT_STORAGE: "s3",
      RUNNER_ARTIFACT_BUCKET: "wedge-artifacts-prod",
      RUNNER_ARTIFACT_PREFIX: "runs",
      AWS_REGION: "ap-northeast-2"
    },
    () => {
      const config = loadRunnerConfig({ serviceName: "runner-test" });

      assert.equal(config.artifactStorage, "s3");
      assert.equal(config.artifactBucket, "wedge-artifacts-prod");
      assert.equal(config.artifactPrefix, "runs");
      assert.equal(config.awsRegion, "ap-northeast-2");
    }
  );
});

test("loadRunnerConfig falls back to filesystem for unsupported artifact storage values", () => {
  withArtifactEnv({ RUNNER_ARTIFACT_STORAGE: "memory" }, () => {
    const config = loadRunnerConfig({ serviceName: "runner-test" });

    assert.equal(config.artifactStorage, "filesystem");
  });
});

function withArtifactEnv(values: Partial<Record<ArtifactEnvKey, string>>, run: () => void): void {
  const previous = snapshotArtifactEnv();

  try {
    for (const key of ARTIFACT_ENV_KEYS) {
      delete process.env[key];
    }

    for (const [key, value] of Object.entries(values) as Array<[ArtifactEnvKey, string]>) {
      process.env[key] = value;
    }

    run();
  } finally {
    restoreArtifactEnv(previous);
  }
}

function snapshotArtifactEnv(): Partial<Record<ArtifactEnvKey, string>> {
  const snapshot: Partial<Record<ArtifactEnvKey, string>> = {};

  for (const key of ARTIFACT_ENV_KEYS) {
    if (process.env[key] !== undefined) {
      snapshot[key] = process.env[key];
    }
  }

  return snapshot;
}

function restoreArtifactEnv(snapshot: Partial<Record<ArtifactEnvKey, string>>): void {
  for (const key of ARTIFACT_ENV_KEYS) {
    delete process.env[key];
  }

  for (const [key, value] of Object.entries(snapshot) as Array<[ArtifactEnvKey, string]>) {
    process.env[key] = value;
  }
}
