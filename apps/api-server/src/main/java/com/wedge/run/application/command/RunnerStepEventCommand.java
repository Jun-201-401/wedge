package com.wedge.run.application.command;

import java.time.OffsetDateTime;
import java.util.Map;
import java.util.UUID;

public record RunnerStepEventCommand(
        UUID eventId,
        int stepOrder,
        String stepKey,
        String eventType,
        OffsetDateTime occurredAt,
        Map<String, Object> payload
) {
}
