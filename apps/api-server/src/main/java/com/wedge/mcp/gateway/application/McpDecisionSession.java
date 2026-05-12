package com.wedge.mcp.gateway.application;

import java.time.Instant;
import java.util.UUID;

public record McpDecisionSession(
        UUID runId,
        String sessionId,
        String clientName,
        boolean samplingSupported,
        Instant registeredAt,
        Instant expiresAt
) {
    public boolean expired(Instant now) {
        return !expiresAt.isAfter(now);
    }
}
