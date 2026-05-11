package com.wedge.evidence.api.dto;

import com.wedge.evidence.domain.ArtifactType;
import java.time.Instant;
import java.util.UUID;

public record ArtifactPresignedUrlItemResponse(
        UUID artifactId,
        ArtifactType artifactType,
        String mimeType,
        String url,
        Instant expiresAt
) {
}
