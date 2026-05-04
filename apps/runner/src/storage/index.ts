import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
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
  bucket: string;
  key: string;
  body: Buffer;
  contentType: string;
}

export function createArtifactStore(
  config: RunnerConfig,
  transportStore: ArtifactStore = createArtifactTransportStore(config)
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

export function createArtifactTransportStore(
  config: Pick<
    RunnerConfig,
    | "artifactsRoot"
    | "artifactStoreMode"
    | "artifactBucket"
    | "artifactS3Endpoint"
    | "artifactS3Region"
    | "artifactS3AccessKeyId"
    | "artifactS3SecretAccessKey"
    | "artifactS3ForcePathStyle"
  >
): ArtifactStore {
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
  putObject?: (input: S3PutObjectInput) => Promise<void>
): ArtifactStore {
  const putArtifactObject = putObject ?? createS3PutObject(config);

  return {
    async persistArtifacts({ runId, artifacts }) {
      const storedArtifacts: Artifact[] = [];

      for (const artifact of artifacts) {
        const draft = createStoredArtifactDraft(runId, artifact);
        await putArtifactObject({
          bucket: config.artifactBucket,
          key: draft.key,
          body: draft.body,
          contentType: artifact.mimeType
        });

        storedArtifacts.push(toStoredArtifact(config.artifactBucket, draft));
      }

      return storedArtifacts;
    }
  };
}

function createS3PutObject(
  config: Pick<
    RunnerConfig,
    | "artifactS3Endpoint"
    | "artifactS3Region"
    | "artifactS3AccessKeyId"
    | "artifactS3SecretAccessKey"
    | "artifactS3ForcePathStyle"
  >
): (input: S3PutObjectInput) => Promise<void> {
  if ((config.artifactS3AccessKeyId && !config.artifactS3SecretAccessKey) || (!config.artifactS3AccessKeyId && config.artifactS3SecretAccessKey)) {
    throw new Error("RUNNER_ARTIFACT_S3_ACCESS_KEY_ID and RUNNER_ARTIFACT_S3_SECRET_ACCESS_KEY must be set together");
  }

  const clientConfig: ConstructorParameters<typeof S3Client>[0] = {
    region: config.artifactS3Region,
    forcePathStyle: config.artifactS3ForcePathStyle
  };

  if (config.artifactS3Endpoint) {
    clientConfig.endpoint = config.artifactS3Endpoint;
  }

  if (config.artifactS3AccessKeyId && config.artifactS3SecretAccessKey) {
    clientConfig.credentials = {
      accessKeyId: config.artifactS3AccessKeyId as string,
      secretAccessKey: config.artifactS3SecretAccessKey as string
    };
  }

  const client = new S3Client(clientConfig);

  return async (input) => {
    await client.send(new PutObjectCommand({
      Bucket: input.bucket,
      Key: input.key,
      Body: input.body,
      ContentType: input.contentType
    }));
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
  return posix.join("runs", runId, sanitizePathFragment(artifact.stepKey), artifactName);
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
