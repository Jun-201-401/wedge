package com.wedge.run.api.internal.runner.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.time.OffsetDateTime;
import java.util.Map;

public record RunnerAgentTraceRequest(
        @NotBlank String taskId,
        @NotBlank String attemptId,
        @NotNull OffsetDateTime occurredAt,
        @NotNull Map<String, Object> trace,
        @Valid RunnerArtifactRequest traceArtifact
) {
}
