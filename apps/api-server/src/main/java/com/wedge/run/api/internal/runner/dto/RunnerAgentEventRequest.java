package com.wedge.run.api.internal.runner.dto;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.time.OffsetDateTime;
import java.util.Map;
import java.util.UUID;

public record RunnerAgentEventRequest(
        @NotBlank String eventId,
        @NotNull UUID taskId,
        @NotNull UUID attemptId,
        @Min(1) Integer turn,
        @NotBlank String eventType,
        @NotNull OffsetDateTime occurredAt,
        @NotNull Map<String, Object> payload
) {
}
