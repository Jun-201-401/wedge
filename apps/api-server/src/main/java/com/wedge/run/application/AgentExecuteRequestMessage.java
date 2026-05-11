package com.wedge.run.application;

import java.util.Map;

public record AgentExecuteRequestMessage(
        String messageId,
        String messageType,
        String schemaVersion,
        String createdAt,
        String producer,
        String correlationId,
        String idempotencyKey,
        Map<String, Object> payload
) {
}
