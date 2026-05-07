package com.wedge.mcp.spike.dto;

public record SpikeAgentDecision(
        String decisionType,
        String tool,
        String candidateId,
        String reason,
        Double confidence
) {
}
