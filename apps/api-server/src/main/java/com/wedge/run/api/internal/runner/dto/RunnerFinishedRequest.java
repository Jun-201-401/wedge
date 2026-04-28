package com.wedge.run.api.internal.runner.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.time.OffsetDateTime;

public record RunnerFinishedRequest(
        @NotBlank String workerId,
        @NotNull OffsetDateTime executionFinishedAt,
        @Valid @NotNull RunnerFinishedSummary summary
) {
}
