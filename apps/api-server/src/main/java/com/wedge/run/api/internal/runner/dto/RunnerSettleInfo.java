package com.wedge.run.api.internal.runner.dto;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

public record RunnerSettleInfo(
        @NotBlank String strategy,
        @Min(0) int durationMs,
        @NotNull RunnerSettleStatus status
) {
}
