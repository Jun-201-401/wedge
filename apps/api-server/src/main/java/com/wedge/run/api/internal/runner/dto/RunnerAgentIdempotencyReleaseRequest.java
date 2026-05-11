package com.wedge.run.api.internal.runner.dto;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.util.UUID;

public record RunnerAgentIdempotencyReleaseRequest(
        @NotNull UUID runId,
        @NotBlank String taskId,
        @NotBlank String attemptId,
        @NotNull @Min(1) Integer attemptIndex
) {
}
