package com.wedge.internal.analysis.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.time.OffsetDateTime;
import java.util.UUID;

public record AnalyzerFailedRequest(
        @NotNull UUID analysisJobId,
        @NotNull UUID runId,
        @NotNull OffsetDateTime failedAt,
        @NotBlank String errorCode,
        @NotBlank String errorMessage
) {
}
