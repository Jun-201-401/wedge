package com.wedge.analysis.api.internal.dto;

import jakarta.validation.constraints.NotNull;
import java.time.OffsetDateTime;
import java.util.UUID;

public record AnalyzerStartedRequest(
        @NotNull UUID analysisJobId,
        @NotNull UUID runId,
        @NotNull OffsetDateTime startedAt
) {
}
