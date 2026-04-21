import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import type { RunnerConfig } from "../config/index.ts";
import type { Artifact, ArtifactDraft } from "../shared/contracts.ts";
import { sanitizePathFragment, toIsoTimestamp } from "../shared/utils.ts";

export interface ArtifactStore {
  persistArtifacts: (input: { runId: string; artifacts: ArtifactDraft[] }) => Promise<Artifact[]>;
}

export function createArtifactStore(config: RunnerConfig): ArtifactStore {
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
