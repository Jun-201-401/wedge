import assert from "node:assert/strict";
import test from "node:test";
import { loadRunnerConfig } from "../src/config/index.ts";

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

type ArtifactEnvKey = typeof ARTIFACT_ENV_KEYS[number];

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
