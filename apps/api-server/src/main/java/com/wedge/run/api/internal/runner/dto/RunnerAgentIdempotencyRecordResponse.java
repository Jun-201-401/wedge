package com.wedge.run.api.internal.runner.dto;

import java.time.OffsetDateTime;
import java.util.Map;
import java.util.UUID;

public record RunnerAgentIdempotencyRecordResponse(
        String idempotencyKeyHash,
        boolean found,
        UUID runId,
        String taskId,
        String attemptId,
        Integer attemptIndex,
        Map<String, Object> result,
        OffsetDateTime completedAt
) {
    public static RunnerAgentIdempotencyRecordResponse empty(String idempotencyKeyHash) {
        return new RunnerAgentIdempotencyRecordResponse(
                idempotencyKeyHash,
                false,
                null,
                null,
                null,
                null,
                null,
                null
        );
    }
}
