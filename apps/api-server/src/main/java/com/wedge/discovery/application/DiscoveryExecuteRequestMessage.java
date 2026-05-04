package com.wedge.discovery.application;

import java.util.Map;

public record DiscoveryExecuteRequestMessage(
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
