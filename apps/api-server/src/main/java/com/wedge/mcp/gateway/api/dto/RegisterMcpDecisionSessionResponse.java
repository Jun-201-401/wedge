package com.wedge.mcp.gateway.api.dto;

import com.wedge.mcp.gateway.application.McpDecisionSession;
import java.time.Instant;
import java.util.UUID;

public record RegisterMcpDecisionSessionResponse(
        UUID runId,
        String sessionId,
        String clientName,
        boolean samplingSupported,
        boolean samplingRoutingReady,
        Instant expiresAt
) {
    public static RegisterMcpDecisionSessionResponse fromSession(McpDecisionSession session) {
        return new RegisterMcpDecisionSessionResponse(
                session.runId(),
                session.sessionId(),
                session.clientName(),
                session.samplingSupported(),
                false,
                session.expiresAt()
        );
    }
}
