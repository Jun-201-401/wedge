import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createS3ArtifactStore, createS3SignedRequest } from "../src/storage/index.ts";
import { createRunnerTestConfig } from "./support.ts";

test("createS3ArtifactStore uploads artifacts through S3-compatible putObject and returns metadata", async () => {
  const uploads: Array<{ bucket: string; key: string; body: Buffer; contentType: string; endpoint: string }> = [];
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
        contentType: input.contentType,
        endpoint: input.endpoint
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
  assert.equal(uploads[0].endpoint, "http://localhost:9000");
  assert.equal(uploads[0].bucket, "wedge-artifacts");
  assert.equal(uploads[0].key, "run-1/step-001-main/artifact-1-screenshot.png");
  assert.equal(uploads[0].contentType, "image/png");
  assert.equal(uploads[0].body.toString(), "image-body");
  assert.equal(artifact.bucket, "wedge-artifacts");
  assert.equal(artifact.key, uploads[0].key);
  assert.equal(artifact.sizeBytes, Buffer.byteLength("image-body"));
  assert.equal(artifact.sha256, createHash("sha256").update("image-body").digest("hex"));
});

test("createS3SignedRequest builds MinIO path-style SigV4 request", () => {
  const request = createS3SignedRequest({
    method: "PUT",
    endpoint: "http://localhost:9000",
    region: "us-east-1",
    bucket: "wedge-artifacts",
    key: "run-1/step 001/a.png",
    accessKeyId: "minio",
    secretAccessKey: "minio-secret",
    payloadHash: createHash("sha256").update("body").digest("hex"),
    contentType: "image/png",
    forcePathStyle: true,
    now: new Date("2026-04-29T00:00:00.000Z")
  });

  assert.equal(request.url, "http://localhost:9000/wedge-artifacts/run-1/step%20001/a.png");
  assert.equal(request.headers.host, "localhost:9000");
  assert.equal(request.headers["x-amz-date"], "20260429T000000Z");
  assert.equal(request.headers["content-type"], "image/png");
  assert.match(request.headers.authorization, /^AWS4-HMAC-SHA256 Credential=minio\/20260429\/us-east-1\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[a-f0-9]{64}$/);
});
