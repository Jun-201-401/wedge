package com.wedge.mcp.gateway.application;

import com.wedge.mcp.gateway.application.command.McpDecisionGatewayCommand;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;

public record McpPendingDecision(
        UUID id,
        UUID runId,
        String sessionId,
        String clientName,
        McpDecisionGatewayCommand command,
        McpPendingDecisionStatus status,
        Instant createdAt,
        Instant expiresAt,
        Map<String, Object> decision
) {
    public boolean expiredAt(Instant now) {
        return expiresAt != null && !expiresAt.isAfter(now);
    }
}
