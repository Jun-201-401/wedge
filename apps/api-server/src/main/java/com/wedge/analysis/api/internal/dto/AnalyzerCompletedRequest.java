package com.wedge.analysis.api.internal.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public record AnalyzerCompletedRequest(
        @NotNull UUID analysisJobId,
        @NotNull UUID runId,
        @NotBlank String analyzerVersion,
        @NotBlank String promptVersion,
        @NotNull Map<String, Object> modelInfo,
        @Valid @NotNull List<Map<String, Object>> topFindings,
        @Valid @NotNull List<Map<String, Object>> nudges,
        @NotNull Map<String, Object> judgeResult,
        @NotNull OffsetDateTime completedAt
) {
}
