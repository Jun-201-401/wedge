import type { EvidenceArtifact, EvidencePacket, RunArtifact } from '../../../entities/run';

const ARTIFACT_TYPE_MAP: Record<string, string> = {
  AX_TREE: 'ax_tree',
  CONSOLE_LOG: 'console_log',
  DOM_SNAPSHOT: 'dom_snapshot',
  FRAME: 'frame',
  HAR: 'har',
  OTHER: 'other',
  REPORT_HTML: 'report',
  REPORT_JSON: 'report',
  REPORT_MARKDOWN: 'report',
  REPORT_PDF: 'report',
  SCREENSHOT: 'screenshot',
  TRACE: 'trace',
};

export function normalizeRunArtifactType(artifactType: string) {
  return ARTIFACT_TYPE_MAP[artifactType] ?? artifactType.toLowerCase();
}

function mapRunArtifactToEvidenceArtifact(artifact: RunArtifact): EvidenceArtifact {
  return {
    artifact_id: artifact.id,
    type: normalizeRunArtifactType(artifact.artifactType),
    uri: artifact.contentUrl ?? artifact.url ?? '',
    mime_type: artifact.mimeType,
    size_bytes: artifact.sizeBytes,
    metadata: {
      createdAt: artifact.createdAt,
      height: artifact.height,
      stepId: artifact.stepId,
      stepKey: artifact.stepKey,
      width: artifact.width,
    },
  };
}

export function hydrateEvidenceArtifacts(evidencePacket: EvidencePacket, artifacts: RunArtifact[]) {
  if (artifacts.length === 0) {
    return evidencePacket;
  }

  const runArtifactsById = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
  const mergedArtifacts = evidencePacket.artifacts.map((artifact) => {
    const runArtifact = runArtifactsById.get(artifact.artifact_id);

    if (!runArtifact) {
      return artifact;
    }

    return {
      ...artifact,
      mime_type: artifact.mime_type ?? runArtifact.mimeType,
      size_bytes: artifact.size_bytes ?? runArtifact.sizeBytes,
      type: artifact.type || normalizeRunArtifactType(runArtifact.artifactType),
      uri: artifact.uri || runArtifact.contentUrl || runArtifact.url || '',
    };
  });
  const evidenceArtifactIds = new Set(mergedArtifacts.map((artifact) => artifact.artifact_id));
  const additionalArtifacts = artifacts
    .filter((artifact) => !evidenceArtifactIds.has(artifact.id))
    .map(mapRunArtifactToEvidenceArtifact);

  return {
    ...evidencePacket,
    artifacts: [...mergedArtifacts, ...additionalArtifacts],
  };
}
