import { createHash, createHmac } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import type { RunnerConfig } from "../config/index.ts";
import type { Artifact, ArtifactDraft } from "../shared/contracts.ts";
import { errorMessage, logOperationalEvent, sanitizePathFragment, sleep, toIsoTimestamp } from "../shared/utils.ts";
import { appendArtifactOutboxRecord } from "./outbox.ts";

export interface ArtifactStore {
  persistArtifacts: (input: { runId: string; artifacts: ArtifactDraft[] }) => Promise<Artifact[]>;
}

interface StoredArtifactDraft {
  artifact: ArtifactDraft;
  key: string;
  body: Buffer;
  sha256: string;
}

export interface S3PutObjectInput {
  endpoint: string;
  region: string;
  bucket: string;
  key: string;
  accessKeyId: string;
  secretAccessKey: string;
  body: Buffer;
  contentType: string;
  forcePathStyle: boolean;
}

export interface S3SignedRequestInput {
  method: "PUT" | "GET";
  endpoint: string;
  region: string;
  bucket: string;
  key: string;
  accessKeyId: string;
  secretAccessKey: string;
  payloadHash: string;
  contentType?: string;
  forcePathStyle: boolean;
  now?: Date;
}

export function createArtifactStore(
  config: RunnerConfig,
  transportStore: ArtifactStore = createConfiguredArtifactStore(config)
): ArtifactStore {
  return {
    async persistArtifacts({ runId, artifacts }) {
      let lastError: unknown;
      let firstErrorMessage: string | null = null;
      let failureCount = 0;
      const maxAttempts = config.artifactRetryDelaysMs.length + 1;

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          const storedArtifacts = await transportStore.persistArtifacts({ runId, artifacts });
          if (failureCount > 0) {
            logOperationalEvent(
              "artifact-storage",
              "retry_sequence_recovered",
              {
                runId,
                artifactCount: artifacts.length,
                failedAttempts: failureCount,
                recoveredOnAttempt: attempt,
                maxAttempts,
                firstErrorMessage,
                lastErrorMessage: errorMessage(lastError)
              },
              "warn"
            );
          }
          return storedArtifacts;
        } catch (error) {
          lastError = error;
          failureCount += 1;
          if (firstErrorMessage === null) {
            firstErrorMessage = errorMessage(error);
          }

          if (attempt < maxAttempts) {
            await sleep(config.artifactRetryDelaysMs[attempt - 1] ?? 0);
          }
        }
      }

      const lastErrorMessage = errorMessage(lastError);
      logOperationalEvent(
        "artifact-storage",
        "retry_sequence_exhausted",
        {
          runId,
          artifactCount: artifacts.length,
          failedAttempts: failureCount,
          maxAttempts,
          firstErrorMessage,
          lastErrorMessage
        },
        "error"
      );

      try {
        await appendArtifactOutboxRecord(config, {
          runId,
          artifacts,
          attempts: maxAttempts,
          errorMessage: lastErrorMessage
        });
        logOperationalEvent(
          "artifact-storage",
          "outbox_record_appended",
          {
            runId,
            artifactCount: artifacts.length,
            attempts: maxAttempts,
            errorMessage: lastErrorMessage
          },
          "error"
        );
      } catch (outboxError) {
        throw new Error(
          `artifact storage failed after ${maxAttempts} attempts: ${lastErrorMessage}; artifact outbox persistence failed: ${errorMessage(outboxError)}`
        );
      }

      throw new Error(`artifact storage failed after ${maxAttempts} attempts: ${lastErrorMessage}`);
    }
  };
}

function createConfiguredArtifactStore(config: RunnerConfig): ArtifactStore {
  if (config.artifactStoreMode === "s3") {
    return createS3ArtifactStore(config);
  }

  return createFilesystemArtifactStore(config);
}

export function createFilesystemArtifactStore(config: Pick<RunnerConfig, "artifactsRoot" | "artifactBucket">): ArtifactStore {
  return {
    async persistArtifacts({ runId, artifacts }) {
      const storedArtifacts: Artifact[] = [];

      for (const artifact of artifacts) {
        const draft = createStoredArtifactDraft(runId, artifact);
        const absolutePath = createFilesystemPath(config.artifactsRoot, draft.key);

        await mkdir(dirname(absolutePath), { recursive: true });
        await writeFile(absolutePath, draft.body);

        storedArtifacts.push(toStoredArtifact(config.artifactBucket, draft));
      }

      return storedArtifacts;
    }
  };
}

export function createS3ArtifactStore(
  config: Pick<
    RunnerConfig,
    | "artifactBucket"
    | "artifactS3Endpoint"
    | "artifactS3Region"
    | "artifactS3AccessKeyId"
    | "artifactS3SecretAccessKey"
    | "artifactS3ForcePathStyle"
  >,
  putObject: (input: S3PutObjectInput) => Promise<void> = putS3Object
): ArtifactStore {
  if (!config.artifactS3Endpoint) {
    throw new Error("RUNNER_ARTIFACT_S3_ENDPOINT is required when RUNNER_ARTIFACT_STORAGE=s3");
  }

  if (!config.artifactS3AccessKeyId || !config.artifactS3SecretAccessKey) {
    throw new Error("RUNNER_ARTIFACT_S3_ACCESS_KEY_ID and RUNNER_ARTIFACT_S3_SECRET_ACCESS_KEY are required when RUNNER_ARTIFACT_STORAGE=s3");
  }

  return {
    async persistArtifacts({ runId, artifacts }) {
      const storedArtifacts: Artifact[] = [];

      for (const artifact of artifacts) {
        const draft = createStoredArtifactDraft(runId, artifact);
        await putObject({
          endpoint: config.artifactS3Endpoint as string,
          region: config.artifactS3Region,
          bucket: config.artifactBucket,
          key: draft.key,
          accessKeyId: config.artifactS3AccessKeyId as string,
          secretAccessKey: config.artifactS3SecretAccessKey as string,
          body: draft.body,
          contentType: artifact.mimeType,
          forcePathStyle: config.artifactS3ForcePathStyle
        });

        storedArtifacts.push(toStoredArtifact(config.artifactBucket, draft));
      }

      return storedArtifacts;
    }
  };
}

async function putS3Object(input: S3PutObjectInput): Promise<void> {
  const request = createS3SignedRequest({
    method: "PUT",
    endpoint: input.endpoint,
    region: input.region,
    bucket: input.bucket,
    key: input.key,
    accessKeyId: input.accessKeyId,
    secretAccessKey: input.secretAccessKey,
    payloadHash: createHash("sha256").update(input.body).digest("hex"),
    contentType: input.contentType,
    forcePathStyle: input.forcePathStyle
  });

  const response = await fetch(request.url, {
    method: "PUT",
    headers: request.headers,
    body: input.body
  });

  if (!response.ok) {
    const responseBody = await response.text().catch(() => "");
    throw new Error(`S3 artifact upload failed with status ${response.status}${responseBody ? `: ${responseBody}` : ""}`);
  }
}

export function createS3SignedRequest(input: S3SignedRequestInput): { url: string; headers: Record<string, string> } {
  const now = input.now ?? new Date();
  const amzDate = toAmzDate(now);
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = input.payloadHash;
  const url = buildS3ObjectUrl(input.endpoint, input.bucket, input.key, input.forcePathStyle);
  const parsedUrl = new URL(url);
  const headers: Record<string, string> = {
    host: hostHeader(parsedUrl),
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate
  };

  if (input.contentType) {
    headers["content-type"] = input.contentType;
  }

  const sortedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = sortedHeaderNames.map((name) => `${name}:${headers[name]}`).join("\n") + "\n";
  const signedHeaders = sortedHeaderNames.join(";");
  const canonicalRequest = [
    input.method,
    parsedUrl.pathname,
    parsedUrl.searchParams.toString(),
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join("\n");
  const credentialScope = `${dateStamp}/${input.region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    createHash("sha256").update(canonicalRequest).digest("hex")
  ].join("\n");
  const signature = hmac(signingKey(input.secretAccessKey, dateStamp, input.region), stringToSign).toString("hex");

  return {
    url,
    headers: {
      ...headers,
      authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
    }
  };
}

function createStoredArtifactDraft(runId: string, artifact: ArtifactDraft): StoredArtifactDraft {
  const body = decodeArtifactContent(artifact);
  return {
    artifact,
    key: createArtifactKey(runId, artifact),
    body,
    sha256: createHash("sha256").update(body).digest("hex")
  };
}

function toStoredArtifact(bucket: string, draft: StoredArtifactDraft): Artifact {
  return {
    artifactId: draft.artifact.artifactId,
    artifactType: draft.artifact.artifactType,
    bucket,
    key: draft.key,
    mimeType: draft.artifact.mimeType,
    width: draft.artifact.width,
    height: draft.artifact.height,
    sizeBytes: draft.body.byteLength,
    sha256: draft.sha256,
    createdAt: toIsoTimestamp(),
    stepKey: draft.artifact.stepKey
  };
}

function createArtifactKey(runId: string, artifact: ArtifactDraft): string {
  const artifactName = `${artifact.artifactId}-${sanitizePathFragment(artifact.artifactType.toLowerCase())}.${artifact.fileExtension}`;
  return posix.join(runId, sanitizePathFragment(artifact.stepKey), artifactName);
}

function createFilesystemPath(artifactsRoot: string, artifactKey: string): string {
  return join(artifactsRoot, ...artifactKey.split("/"));
}

function decodeArtifactContent(artifact: ArtifactDraft): Buffer {
  if (artifact.contentEncoding === "base64") {
    return Buffer.from(artifact.content, "base64");
  }

  return Buffer.from(artifact.content, "utf8");
}

function buildS3ObjectUrl(endpoint: string, bucket: string, key: string, forcePathStyle: boolean): string {
  const baseUrl = new URL(endpoint.endsWith("/") ? endpoint : `${endpoint}/`);
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");

  if (forcePathStyle) {
    baseUrl.pathname = joinUrlPath(baseUrl.pathname, encodeURIComponent(bucket), encodedKey);
    return baseUrl.toString();
  }

  baseUrl.hostname = `${bucket}.${baseUrl.hostname}`;
  baseUrl.pathname = joinUrlPath(baseUrl.pathname, encodedKey);
  return baseUrl.toString();
}

function joinUrlPath(...parts: string[]): string {
  const joined = parts
    .filter((part) => part !== "")
    .map((part, index) => index === 0 ? part.replace(/\/+$/g, "") : part.replace(/^\/+|\/+$/g, ""))
    .filter((part) => part !== "")
    .join("/");
  return joined.startsWith("/") ? joined : `/${joined}`;
}

function toAmzDate(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function hostHeader(url: URL): string {
  return url.port ? `${url.hostname}:${url.port}` : url.hostname;
}

function signingKey(secretAccessKey: string, dateStamp: string, region: string): Buffer {
  const dateKey = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, "s3");
  return hmac(serviceKey, "aws4_request");
}

function hmac(key: string | Buffer, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}
