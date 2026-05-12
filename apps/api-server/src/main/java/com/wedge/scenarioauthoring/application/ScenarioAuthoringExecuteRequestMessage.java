package com.wedge.scenarioauthoring.application;

import java.util.Map;

public record ScenarioAuthoringExecuteRequestMessage(
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
