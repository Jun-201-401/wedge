import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createS3ArtifactStore, createS3SignedRequest } from "../src/storage/index.ts";

const minioEndpoint = process.env.WEDGE_MINIO_E2E_ENDPOINT;
const minioAccessKeyId = process.env.WEDGE_MINIO_E2E_ACCESS_KEY_ID;
const minioSecretAccessKey = process.env.WEDGE_MINIO_E2E_SECRET_ACCESS_KEY;
const minioBucket = process.env.WEDGE_MINIO_E2E_BUCKET;
const minioRegion = process.env.WEDGE_MINIO_E2E_REGION ?? "us-east-1";

const minioE2eConfigured =
  Boolean(minioEndpoint) &&
  Boolean(minioAccessKeyId) &&
  Boolean(minioSecretAccessKey) &&
  Boolean(minioBucket);

test(
  "createS3ArtifactStore uploads to MinIO and the object can be read back",
  { skip: !minioE2eConfigured },
  async () => {
    const body = `runner-minio-e2e-${Date.now()}`;
    const store = createS3ArtifactStore({
      artifactBucket: minioBucket as string,
      artifactS3Endpoint: minioEndpoint,
      artifactS3Region: minioRegion,
      artifactS3AccessKeyId: minioAccessKeyId,
      artifactS3SecretAccessKey: minioSecretAccessKey,
      artifactS3ForcePathStyle: true
    });

    const [artifact] = await store.persistArtifacts({
      runId: "runner-minio-e2e",
      artifacts: [
        {
          artifactId: "artifact-minio-e2e",
          artifactType: "CONSOLE_LOG",
          stepKey: "step 001/minio upload",
          mimeType: "text/plain",
          fileExtension: "txt",
          content: body
        }
      ]
    });

    assert.equal(artifact.bucket, minioBucket);
    assert.equal(artifact.sizeBytes, Buffer.byteLength(body));
    assert.equal(artifact.sha256, createHash("sha256").update(body).digest("hex"));

    const request = createS3SignedRequest({
      method: "GET",
      endpoint: minioEndpoint as string,
      region: minioRegion,
      bucket: minioBucket as string,
      key: artifact.key,
      accessKeyId: minioAccessKeyId as string,
      secretAccessKey: minioSecretAccessKey as string,
      payloadHash: createHash("sha256").update("").digest("hex"),
      forcePathStyle: true
    });
    const response = await fetch(request.url, {
      method: "GET",
      headers: request.headers
    });
    const downloaded = await response.text();

    assert.equal(response.status, 200, downloaded);
    assert.equal(downloaded, body);
  }
);
