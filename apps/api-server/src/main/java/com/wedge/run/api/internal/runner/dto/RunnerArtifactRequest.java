package com.wedge.run.api.internal.runner.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.PositiveOrZero;
import java.time.OffsetDateTime;
import java.util.UUID;

public record RunnerArtifactRequest(
        @NotNull UUID artifactId,
        @NotBlank String stepKey,
        @NotNull RunnerArtifactType artifactType,
        @NotBlank String bucket,
        @NotBlank String key,
        @NotBlank String mimeType,
        @Positive Integer width,
        @Positive Integer height,
        @PositiveOrZero long sizeBytes,
        @NotBlank String sha256,
        @NotNull OffsetDateTime createdAt
) {
}
