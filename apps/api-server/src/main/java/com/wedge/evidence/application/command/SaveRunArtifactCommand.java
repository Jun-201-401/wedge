package com.wedge.evidence.application.command;

import com.wedge.evidence.domain.ArtifactType;
import java.time.OffsetDateTime;
import java.util.UUID;

public record SaveRunArtifactCommand(
        UUID artifactId,
        String stepKey,
        ArtifactType artifactType,
        String bucket,
        String key,
        String mimeType,
        Integer width,
        Integer height,
        long sizeBytes,
        String sha256,
        OffsetDateTime createdAt
) {
}
