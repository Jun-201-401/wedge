package com.wedge.run.application.command;

import java.time.OffsetDateTime;
import java.util.Map;
import java.util.UUID;

public record RunnerAgentTraceCommand(
        UUID taskId,
        UUID attemptId,
        OffsetDateTime occurredAt,
        Map<String, Object> trace
) {
}
