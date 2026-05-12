package com.wedge.run.api.internal.runner.dto;

import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import java.util.Map;
import java.util.UUID;

public record RunnerMessageIdempotencyRecordRequest(
        @NotNull UUID runId,
        @NotEmpty Map<String, Object> result
) {
}
