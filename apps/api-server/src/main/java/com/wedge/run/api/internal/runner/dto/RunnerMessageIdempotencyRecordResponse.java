package com.wedge.run.api.internal.runner.dto;

import java.time.OffsetDateTime;
import java.util.Map;
import java.util.UUID;

public record RunnerMessageIdempotencyRecordResponse(
        String scope,
        String idempotencyKeyHash,
        boolean found,
        UUID runId,
        Map<String, Object> result,
        OffsetDateTime completedAt
) {
    public static RunnerMessageIdempotencyRecordResponse empty(String scope, String idempotencyKeyHash) {
        return new RunnerMessageIdempotencyRecordResponse(
                scope,
                idempotencyKeyHash,
                false,
                null,
                null,
                null
        );
    }
}
