package com.wedge.run.api.dto;

import java.time.OffsetDateTime;
import java.util.Map;
import java.util.UUID;

public record RunEventResponse(
        UUID id,
        UUID runId,
        UUID stepId,
        String stepKey,
        String eventType,
        String eventSource,
        Map<String, Object> payload,
        OffsetDateTime occurredAt
) {
}
