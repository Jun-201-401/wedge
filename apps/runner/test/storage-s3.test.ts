import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createS3ArtifactStore } from "../src/storage/index.ts";
import { createRunnerTestConfig } from "./support.ts";

test("createS3ArtifactStore uploads artifacts through S3-compatible putObject and returns metadata", async () => {
  const uploads: Array<{ bucket: string; key: string; body: Buffer; contentType: string }> = [];
  const store = createS3ArtifactStore(
    createRunnerTestConfig({
      artifactBucket: "wedge-artifacts",
      artifactS3Endpoint: "http://localhost:9000",
      artifactS3AccessKeyId: "minio",
      artifactS3SecretAccessKey: "minio-secret"
    }),
    async (input) => {
      uploads.push({
        bucket: input.bucket,
        key: input.key,
        body: input.body,
        contentType: input.contentType
      });
    }
  );

  const [artifact] = await store.persistArtifacts({
    runId: "run-1",
    artifacts: [
      {
        artifactId: "artifact-1",
        artifactType: "SCREENSHOT",
        stepKey: "step 001/main",
        mimeType: "image/png",
        fileExtension: "png",
        content: Buffer.from("image-body").toString("base64"),
        contentEncoding: "base64",
        width: 1440,
        height: 900
      }
    ]
  });

  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].bucket, "wedge-artifacts");
  assert.equal(uploads[0].key, "runs/run-1/step-001-main/artifact-1-screenshot.png");
  assert.equal(uploads[0].contentType, "image/png");
  assert.equal(uploads[0].body.toString(), "image-body");
  assert.equal(artifact.bucket, "wedge-artifacts");
  assert.equal(artifact.key, uploads[0].key);
  assert.equal(artifact.sizeBytes, Buffer.byteLength("image-body"));
  assert.equal(artifact.sha256, createHash("sha256").update("image-body").digest("hex"));
});

test("createS3ArtifactStore rejects partial explicit S3 credentials", () => {
  assert.throws(
    () => createS3ArtifactStore(createRunnerTestConfig({
      artifactBucket: "wedge-artifacts",
      artifactS3AccessKeyId: "artifact-access-key",
      artifactS3SecretAccessKey: undefined
    })),
    /must be set together/
  );
});
