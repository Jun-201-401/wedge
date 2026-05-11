package com.wedge.evidence.api.dto;

import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import java.util.List;
import java.util.UUID;

public record ArtifactPresignedUrlRequest(
        @NotEmpty List<@NotNull UUID> artifactIds
) {
}
