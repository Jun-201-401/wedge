package com.wedge.run.api.internal.runner.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import java.time.OffsetDateTime;
import java.util.Map;
import java.util.UUID;

public record RunnerAgentEvent(
        @NotNull UUID eventId,
        @NotBlank String taskId,
        @NotBlank String attemptId,
        @Positive Integer turn,
        @NotNull RunnerAgentEventType eventType,
        @NotNull OffsetDateTime occurredAt,
        @NotNull Map<String, Object> payload
) {
}
