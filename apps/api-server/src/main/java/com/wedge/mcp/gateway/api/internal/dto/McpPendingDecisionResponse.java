package com.wedge.mcp.gateway.api.internal.dto;

import com.wedge.mcp.gateway.application.McpPendingDecision;
import com.wedge.mcp.gateway.application.McpPendingDecisionStatus;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;

public record McpPendingDecisionResponse(
        UUID pendingDecisionId,
        UUID runId,
        McpPendingDecisionStatus status,
        String sessionId,
        String clientName,
        Instant expiresAt,
        Map<String, Object> decision
) {
    public static McpPendingDecisionResponse from(McpPendingDecision pendingDecision) {
        return new McpPendingDecisionResponse(
                pendingDecision.id(),
                pendingDecision.runId(),
                pendingDecision.status(),
                pendingDecision.sessionId(),
                pendingDecision.clientName(),
                pendingDecision.expiresAt(),
                pendingDecision.decision()
        );
    }
}
