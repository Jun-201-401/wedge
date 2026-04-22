import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import type { RunnerConfig } from "../config/index.ts";
import type { Artifact, ArtifactDraft } from "../shared/contracts.ts";
import { errorMessage, logOperationalEvent, sanitizePathFragment, sleep, toIsoTimestamp } from "../shared/utils.ts";
import { appendArtifactOutboxRecord } from "./outbox.ts";

export interface ArtifactStore {
  persistArtifacts: (input: { runId: string; artifacts: ArtifactDraft[] }) => Promise<Artifact[]>;
}

export function createArtifactStore(
  config: RunnerConfig,
  transportStore: ArtifactStore = createFilesystemArtifactStore(config)
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

export function createFilesystemArtifactStore(config: Pick<RunnerConfig, "artifactsRoot" | "artifactBucket">): ArtifactStore {
  return {
    async persistArtifacts({ runId, artifacts }) {
      const storedArtifacts: Artifact[] = [];

      for (const artifact of artifacts) {
        const artifactKey = createArtifactKey(runId, artifact);
        const absolutePath = createFilesystemPath(config.artifactsRoot, artifactKey);
        const contentBuffer = decodeArtifactContent(artifact);
        const sha256 = createHash("sha256").update(contentBuffer).digest("hex");

        await mkdir(dirname(absolutePath), { recursive: true });
        await writeFile(absolutePath, contentBuffer);

        storedArtifacts.push({
          artifactId: artifact.artifactId,
          artifactType: artifact.artifactType,
          bucket: config.artifactBucket,
          key: artifactKey,
          mimeType: artifact.mimeType,
          width: artifact.width,
          height: artifact.height,
          sizeBytes: contentBuffer.byteLength,
          sha256,
          createdAt: toIsoTimestamp(),
          stepKey: artifact.stepKey
        });
      }

      return storedArtifacts;
    }
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
