package com.wedge.mcp.gateway.api.dto;

import java.util.Map;
import java.util.UUID;

public record ResolveMcpPendingDecisionResponse(
        boolean resolved,
        String message,
        UUID pendingDecisionId,
        UUID runId,
        String model,
        String stopReason,
        Map<String, Object> decision
) {
    public static ResolveMcpPendingDecisionResponse none(String message) {
        return new ResolveMcpPendingDecisionResponse(false, message, null, null, null, null, null);
    }

    public static ResolveMcpPendingDecisionResponse resolved(
            UUID pendingDecisionId,
            UUID runId,
            String model,
            String stopReason,
            Map<String, Object> decision
    ) {
        return new ResolveMcpPendingDecisionResponse(
                true,
                "MCP pending decision was resolved.",
                pendingDecisionId,
                runId,
                model,
                stopReason,
                decision
        );
    }
}
