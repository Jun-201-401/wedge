import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createS3ArtifactStore } from "../src/storage/index.ts";

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
  "[MinIO 통합] S3 artifact store가 MinIO에 업로드한 객체를 다시 읽을 수 있다",
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

    const client = new S3Client({
      region: minioRegion,
      endpoint: minioEndpoint as string,
      forcePathStyle: true,
      credentials: {
        accessKeyId: minioAccessKeyId as string,
        secretAccessKey: minioSecretAccessKey as string
      }
    });
    const response = await client.send(new GetObjectCommand({
      Bucket: minioBucket as string,
      Key: artifact.key
    }));
    const downloaded = await response.Body?.transformToString();

    assert.equal(downloaded, body);
  }
);
