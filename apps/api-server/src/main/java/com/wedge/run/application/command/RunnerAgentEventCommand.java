package com.wedge.run.application.command;

import java.time.OffsetDateTime;
import java.util.Map;
import java.util.UUID;

public record RunnerAgentEventCommand(
        String schemaVersion,
        String eventId,
        UUID taskId,
        UUID attemptId,
        UUID runId,
        int stepIndex,
        String eventType,
        OffsetDateTime occurredAt,
        Map<String, Object> payload
) {
}
