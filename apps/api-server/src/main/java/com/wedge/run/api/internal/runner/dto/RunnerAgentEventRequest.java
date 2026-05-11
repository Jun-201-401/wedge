package com.wedge.run.api.internal.runner.dto;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import java.time.OffsetDateTime;
import java.util.Map;
import java.util.UUID;

public record RunnerAgentEventRequest(
        @NotBlank
        @Pattern(regexp = "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
        String eventId,
        @NotNull UUID taskId,
        @NotNull UUID attemptId,
        @Min(1) Integer turn,
        @NotNull RunnerAgentEventType eventType,
        @NotNull OffsetDateTime occurredAt,
        @NotNull Map<String, Object> payload
) {
}
