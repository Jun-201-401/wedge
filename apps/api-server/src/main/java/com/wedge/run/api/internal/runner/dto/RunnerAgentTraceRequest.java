package com.wedge.run.api.internal.runner.dto;

import jakarta.validation.constraints.NotNull;
import java.time.OffsetDateTime;
import java.util.Map;
import java.util.UUID;

public record RunnerAgentTraceRequest(
        @NotNull UUID taskId,
        @NotNull UUID attemptId,
        @NotNull OffsetDateTime occurredAt,
        @NotNull Map<String, Object> trace
) {
}
