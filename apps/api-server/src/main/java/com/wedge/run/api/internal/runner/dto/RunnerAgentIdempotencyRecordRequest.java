package com.wedge.run.api.internal.runner.dto;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import java.util.Map;
import java.util.UUID;

public record RunnerAgentIdempotencyRecordRequest(
        @NotNull UUID runId,
        @NotBlank String taskId,
        @NotBlank String attemptId,
        @NotNull @Min(1) Integer attemptIndex,
        @NotEmpty Map<String, Object> result
) {
}
