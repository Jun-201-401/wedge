package com.wedge.evidence.api.dto;

import com.wedge.evidence.domain.Artifact;
import com.wedge.evidence.domain.ArtifactType;
import java.time.OffsetDateTime;
import java.util.UUID;

public record ArtifactResponse(
        UUID id,
        UUID runId,
        UUID stepId,
        String stepKey,
        ArtifactType artifactType,
        String bucket,
        String key,
        String mimeType,
        Integer width,
        Integer height,
        long sizeBytes,
        String sha256,
        String url,
        String contentUrl,
        OffsetDateTime createdAt
) {
    public static ArtifactResponse from(Artifact artifact) {
        return new ArtifactResponse(
                artifact.getId(),
                artifact.getRunId(),
                artifact.getStepId(),
                inferStepKey(artifact.getRunId(), artifact.getS3Key()),
                artifact.getArtifactType(),
                artifact.getS3Bucket(),
                artifact.getS3Key(),
                artifact.getMimeType(),
                artifact.getWidth(),
                artifact.getHeight(),
                artifact.getSizeBytes(),
                artifact.getSha256(),
                artifact.getPublicUrl(),
                contentUrl(artifact),
                artifact.getCreatedAt()
        );
    }

    public static String contentUrl(Artifact artifact) {
        return "/api/runs/" + artifact.getRunId() + "/artifacts/" + artifact.getId() + "/content";
    }

    private static String inferStepKey(UUID runId, String key) {
        if (runId == null || key == null || key.isBlank()) {
            return null;
        }

        String runPrefix = runId + "/";
        if (!key.startsWith(runPrefix)) {
            return null;
        }

        String remainder = key.substring(runPrefix.length());
        int separatorIndex = remainder.indexOf('/');
        if (separatorIndex <= 0) {
            return null;
        }

        return remainder.substring(0, separatorIndex);
    }
}
