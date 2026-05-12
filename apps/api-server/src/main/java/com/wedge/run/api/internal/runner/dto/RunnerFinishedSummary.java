package com.wedge.run.api.internal.runner.dto;

import jakarta.validation.constraints.Min;
import java.util.Map;

public record RunnerFinishedSummary(
        @Min(0) int completedStepCount,
        @Min(0) int failedStepCount,
        boolean stopped,
        Map<String, Object> collectorStatus
) {
}
