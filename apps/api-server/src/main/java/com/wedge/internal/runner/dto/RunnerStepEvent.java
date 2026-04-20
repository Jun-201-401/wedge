package com.wedge.internal.runner.dto;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.time.OffsetDateTime;
import java.util.Map;
import java.util.UUID;

public record RunnerStepEvent(
        @NotNull UUID eventId,
        @Min(1) int stepOrder,
        @NotBlank String stepKey,
        @NotNull RunnerStepEventType eventType,
        @NotNull OffsetDateTime occurredAt,
        @NotNull Map<String, Object> payload
) {
}
