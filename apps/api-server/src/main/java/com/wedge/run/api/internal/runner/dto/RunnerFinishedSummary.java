package com.wedge.run.api.internal.runner.dto;

import jakarta.validation.constraints.Min;

public record RunnerFinishedSummary(
        @Min(0) int completedStepCount,
        @Min(0) int failedStepCount,
        boolean stopped
) {
}
