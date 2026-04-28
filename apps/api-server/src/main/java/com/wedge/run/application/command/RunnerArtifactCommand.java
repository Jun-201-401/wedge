package com.wedge.run.application.command;

import java.time.OffsetDateTime;
import java.util.UUID;

public record RunnerArtifactCommand(
        UUID artifactId,
        String stepKey,
        String artifactType,
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
