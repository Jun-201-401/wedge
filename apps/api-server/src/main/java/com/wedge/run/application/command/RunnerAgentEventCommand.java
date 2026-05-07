package com.wedge.run.application.command;

import java.time.OffsetDateTime;
import java.util.Map;
import java.util.UUID;

public record RunnerAgentEventCommand(
        UUID eventId,
        String taskId,
        String attemptId,
        Integer turn,
        String eventType,
        OffsetDateTime occurredAt,
        Map<String, Object> payload
) {
}
