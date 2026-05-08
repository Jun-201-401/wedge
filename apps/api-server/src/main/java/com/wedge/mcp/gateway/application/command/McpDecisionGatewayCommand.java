package com.wedge.mcp.gateway.application.command;

import java.util.List;

public record McpDecisionGatewayCommand(
        String goal,
        String startUrl,
        AgentState state,
        PageObservation page,
        List<String> allowedActions,
        OutputSchema outputSchema
) {
    public record AgentState(
            boolean started,
            int scrollCount,
            List<String> clickedTargetKeys
    ) {
    }

    public record PageObservation(
            String finalUrl,
            String title,
            List<Candidate> candidates
    ) {
    }

    public record Candidate(
            String targetKey,
            String text,
            String role,
            String tag,
            boolean primaryLike,
            boolean ctaCandidate
    ) {
    }

    public record OutputSchema(
            String kind,
            String actionType,
            String targetKey,
            String scrollY,
            String stage,
            String reason,
            String confidence
    ) {
    }
}
